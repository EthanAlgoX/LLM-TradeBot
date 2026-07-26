import { createHash } from "node:crypto";
import {
  OperationalDispatcherScheduleSchema,
  OperationalOutboxWorkerStateSchema,
  type OperationalDispatcherSchedule,
  type OperationalOutboxWorkerState,
} from "../../contracts/src/index.js";

export interface OperationalOutboxDispatchRunner {
  dispatchAvailable(
    ownerId: string,
    limit?: number,
  ): Promise<{ processed: readonly unknown[] }>;
}

export interface OperationalOutboxScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface OperationalOutboxWorkerOptions {
  dispatcher: OperationalOutboxDispatchRunner;
  schedule: OperationalDispatcherSchedule;
  ownerId: string;
  workerId?: string;
  now?: () => Date;
  scheduler?: OperationalOutboxScheduler;
}

const defaultScheduler: OperationalOutboxScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const safeErrorCode = (error: unknown): string => {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z0-9][a-z0-9._:-]*$/i.test(error.code)
  ) {
    return error.code.toLowerCase();
  }
  return "operational_dispatch_tick_failed";
};

export class DurableOperationalOutboxWorker {
  readonly #dispatcher: OperationalOutboxDispatchRunner;
  readonly #schedule: OperationalDispatcherSchedule;
  readonly #ownerId: string;
  readonly #workerId: string;
  readonly #now: () => Date;
  readonly #scheduler: OperationalOutboxScheduler;
  #timer: unknown = null;
  #running = false;
  #tickInProgress = false;
  #lastStartedAt: string | null = null;
  #lastCompletedAt: string | null = null;
  #lastErrorCode: string | null = null;
  #nextRunAt: string | null = null;
  #totalTicks = 0;
  #totalProcessed = 0;

  constructor(options: OperationalOutboxWorkerOptions) {
    this.#dispatcher = options.dispatcher;
    this.#schedule = OperationalDispatcherScheduleSchema.parse(
      options.schedule,
    );
    this.#ownerId = options.ownerId;
    this.#workerId = options.workerId ?? "operational-outbox-worker";
    this.#now = options.now ?? (() => new Date());
    this.#scheduler = options.scheduler ?? defaultScheduler;
  }

  start(): OperationalOutboxWorkerState {
    if (this.#schedule.lifecycleStatus === "disabled" || this.#running) {
      return this.getState();
    }
    this.#running = true;
    this.#scheduleNext(0);
    return this.getState();
  }

  stop(): OperationalOutboxWorkerState {
    this.#running = false;
    if (this.#timer !== null) {
      this.#scheduler.clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#nextRunAt = null;
    return this.getState();
  }

  async runOnce(): Promise<OperationalOutboxWorkerState> {
    if (this.#tickInProgress) {
      return this.getState();
    }
    this.#tickInProgress = true;
    this.#lastStartedAt = this.#now().toISOString();
    this.#lastErrorCode = null;
    try {
      const result = await this.#dispatcher.dispatchAvailable(
        this.#ownerId,
        this.#schedule.batchLimit,
      );
      this.#totalProcessed += result.processed.length;
    } catch (error) {
      this.#lastErrorCode = safeErrorCode(error);
    } finally {
      this.#totalTicks += 1;
      this.#lastCompletedAt = this.#now().toISOString();
      this.#tickInProgress = false;
    }
    return this.getState();
  }

  getState(): OperationalOutboxWorkerState {
    return OperationalOutboxWorkerStateSchema.parse({
      schemaVersion: "1.0.0",
      workerId: this.#workerId,
      scheduleId: this.#schedule.scheduleId,
      enabled: this.#schedule.lifecycleStatus === "enabled",
      running: this.#running,
      tickInProgress: this.#tickInProgress,
      ownerId: this.#ownerId,
      lastStartedAt: this.#lastStartedAt,
      lastCompletedAt: this.#lastCompletedAt,
      lastErrorCode: this.#lastErrorCode,
      nextRunAt: this.#nextRunAt,
      totalTicks: this.#totalTicks,
      totalProcessed: this.#totalProcessed,
      overlapAllowed: false,
      externalNetworkAllowed: false,
    });
  }

  #scheduleNext(delayMs: number): void {
    if (!this.#running) {
      return;
    }
    this.#nextRunAt = new Date(
      this.#now().getTime() + delayMs,
    ).toISOString();
    this.#timer = this.#scheduler.setTimeout(() => {
      this.#timer = null;
      this.#nextRunAt = null;
      void this.runOnce().finally(() => {
        if (this.#running) {
          this.#scheduleNext(this.#schedule.intervalMs);
        }
      });
    }, delayMs);
  }
}

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const hash = (value: unknown): string =>
  `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;

export const createOperationalDispatcherSchedule = (
  input: Omit<
    OperationalDispatcherSchedule,
    | "schemaVersion"
    | "fingerprint"
    | "overlapAllowed"
    | "clientMutable"
    | "externalNetworkAllowed"
  >,
): OperationalDispatcherSchedule => {
  const content = {
    schemaVersion: "1.0.0" as const,
    ...input,
    overlapAllowed: false as const,
    clientMutable: false as const,
    externalNetworkAllowed: false as const,
  };
  return OperationalDispatcherScheduleSchema.parse({
    ...content,
    fingerprint: hash(content),
  });
};
