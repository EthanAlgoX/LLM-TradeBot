import { PaperWatchPlanSchema, PaperWatchReportSchema, SCHEMA_VERSION, type PaperWatchPlan, type PaperWatchReport } from "../../contracts/src/index.js";

export interface SequentialCycleRunnerOptions {
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly shouldStop?: () => boolean;
}

/** Bounded sequential runner. It deliberately never starts concurrent trading cycles. */
export class SequentialCycleRunner {
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly shouldStop: () => boolean;

  constructor(options: SequentialCycleRunnerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.shouldStop = options.shouldStop ?? (() => false);
  }

  async run(rawPlan: PaperWatchPlan, cycle: (index: number) => Promise<void>): Promise<PaperWatchReport> {
    const plan = PaperWatchPlanSchema.parse(rawPlan);
    const cycles = [];
    let stoppedEarly = false;
    for (let index = 1; index <= plan.cycles; index += 1) {
      const startedAt = this.now();
      try {
        await cycle(index);
        cycles.push({ cycle: index, startedAt, finishedAt: this.now(), status: "ok" as const });
      } catch (error) {
        cycles.push({ cycle: index, startedAt, finishedAt: this.now(), status: "error" as const, error: error instanceof Error ? error.message : String(error) });
        if (!plan.continueOnError) { stoppedEarly = true; break; }
      }
      if (index < plan.cycles && plan.intervalMs > 0) await this.sleep(plan.intervalMs);
    }
    return PaperWatchReportSchema.parse({ schemaVersion: SCHEMA_VERSION, plan, cycles, successCount: cycles.filter((item) => item.status === "ok").length, errorCount: cycles.filter((item) => item.status === "error").length, stoppedEarly });
  }

  async runUntilStopped(
    rawPlan: PaperWatchPlan,
    cycle: (index: number) => Promise<void>,
  ): Promise<PaperWatchReport> {
    const plan = PaperWatchPlanSchema.parse(rawPlan);
    const retainedCycles: Array<{
      cycle: number;
      startedAt: Date;
      finishedAt: Date;
      status: "ok" | "error";
      error?: string;
    }> = [];
    let successCount = 0;
    let errorCount = 0;
    for (let index = 1; index <= Number.MAX_SAFE_INTEGER; index += 1) {
      const startedAt = this.now();
      try {
        await cycle(index);
        successCount += 1;
        retainedCycles.push({
          cycle: index,
          startedAt,
          finishedAt: this.now(),
          status: "ok",
        });
      } catch (error) {
        errorCount += 1;
        retainedCycles.push({
          cycle: index,
          startedAt,
          finishedAt: this.now(),
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        if (!plan.continueOnError) {
          return PaperWatchReportSchema.parse({
            schemaVersion: SCHEMA_VERSION,
            plan,
            cycles: retainedCycles.slice(-100),
            successCount,
            errorCount,
            stoppedEarly: true,
          });
        }
      }
      if (retainedCycles.length > 100) retainedCycles.shift();
      if (this.shouldStop()) {
        return PaperWatchReportSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          plan,
          cycles: retainedCycles,
          successCount,
          errorCount,
          stoppedEarly: true,
        });
      }
      let remainingIntervalMs = plan.intervalMs;
      while (remainingIntervalMs > 0) {
        const waitMs = Math.min(250, remainingIntervalMs);
        await this.sleep(waitMs);
        remainingIntervalMs -= waitMs;
        if (this.shouldStop()) {
          return PaperWatchReportSchema.parse({
            schemaVersion: SCHEMA_VERSION,
            plan,
            cycles: retainedCycles,
            successCount,
            errorCount,
            stoppedEarly: true,
          });
        }
      }
    }
    throw new Error("Continuous cycle index exhausted.");
  }
}
