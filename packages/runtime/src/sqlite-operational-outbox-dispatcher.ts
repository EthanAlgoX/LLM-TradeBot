import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  OperationalDeadLetterReplayRequestSchema,
  OperationalDeadLetterSchema,
  OperationalDeliveryAttemptSchema,
  OperationalDeliveryTemplateSchema,
  OperationalDispatcherStateSchema,
  type OperationalDeadLetter,
  type OperationalDeadLetterReplayRequest,
  type OperationalDeliveryAttempt,
  type OperationalDeliveryTemplate,
  type OperationalDispatcherState,
} from "../../contracts/src/index.js";

export interface DispatchableOperationalEvent {
  eventId: string;
  runId: string;
  sequence: number;
  eventType: string;
  occurredAt: string;
  fingerprint: string;
  machineFields: Record<string, string | number | boolean | null>;
  exchangeWriteAllowed: false;
}

export interface OperationalDeliverySink {
  readonly sinkKind: OperationalDeliveryTemplate["sinkKind"];
  deliver(event: Readonly<DispatchableOperationalEvent>): Promise<void>;
}

export interface OperationalDispatcherActor {
  actorId: string;
  roles: readonly string[];
}

export interface OperationalOutboxDispatcherOptions {
  database: DatabaseSync;
  dispatcherId?: string;
  now?: () => Date;
  leaseDurationMs?: number;
}

export class OperationalOutboxDispatcherError extends Error {
  constructor(
    readonly code:
      | "DISPATCHER_LEASE_HELD"
      | "DISPATCHER_FENCED"
      | "DELIVERY_TEMPLATE_DUPLICATE"
      | "DELIVERY_TEMPLATE_NOT_FOUND"
      | "DELIVERY_SINK_KIND_MISMATCH"
      | "DELIVERY_REPLAY_FORBIDDEN"
      | "DELIVERY_DEAD_LETTER_NOT_FOUND"
      | "DELIVERY_DEAD_LETTER_NOT_REPLAYABLE"
      | "DELIVERY_EVENT_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "OperationalOutboxDispatcherError";
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

const fingerprint = (value: unknown): string =>
  `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;

const stableId = (prefix: string): string =>
  `${prefix}:${randomUUID().toLowerCase()}`;

const parseJsonRecord = (
  value: unknown,
): Record<string, string | number | boolean | null> => {
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return {};
    }
    const result: Record<string, string | number | boolean | null> = {};
    for (const [key, item] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
      ) {
        result[key] = item;
      }
    }
    return result;
  } catch {
    return {};
  }
};

const valueOf = (
  row: Record<string, unknown>,
  ...names: string[]
): unknown => {
  for (const name of names) {
    if (row[name] !== undefined) {
      return row[name];
    }
  }
  return undefined;
};

const toIso = (value: unknown): string => {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new OperationalOutboxDispatcherError(
      "DELIVERY_EVENT_INVALID",
      "Operational event has an invalid timestamp",
    );
  }
  return new Date(value).toISOString();
};

const mapEventRow = (row: Record<string, unknown>): DispatchableOperationalEvent => {
  const eventId = String(valueOf(row, "event_id", "eventId") ?? "");
  const runId = String(valueOf(row, "run_id", "runId") ?? "");
  const sequence = Number(valueOf(row, "sequence", "event_sequence") ?? 0);
  const eventType = String(valueOf(row, "event_type", "eventType") ?? "");
  const occurredAt = toIso(
    valueOf(row, "occurred_at", "occurredAt", "created_at", "createdAt"),
  );
  const machineFields = parseJsonRecord(
    valueOf(row, "machine_fields_json", "machineFieldsJson", "machine_fields"),
  );
  if (!eventId || !runId || !eventType || !Number.isInteger(sequence) || sequence < 1) {
    throw new OperationalOutboxDispatcherError(
      "DELIVERY_EVENT_INVALID",
      "Operational event does not contain stable delivery identifiers",
    );
  }
  const safeEvent = {
    eventId,
    runId,
    sequence,
    eventType,
    occurredAt,
    machineFields,
    exchangeWriteAllowed: false as const,
  };
  return {
    ...safeEvent,
    fingerprint: fingerprint(safeEvent),
  };
};

const mapAttempt = (row: Record<string, unknown>): OperationalDeliveryAttempt =>
  OperationalDeliveryAttemptSchema.parse({
    schemaVersion: "1.0.0",
    attemptId: row.attempt_id,
    eventId: row.event_id,
    runId: row.run_id,
    eventSequence: row.event_sequence,
    eventFingerprint: row.event_fingerprint,
    templateId: row.template_id,
    templateFingerprint: row.template_fingerprint,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastAttemptAt: row.last_attempt_at,
    deliveredAt: row.delivered_at,
    deadLetteredAt: row.dead_lettered_at,
    errorCode: row.error_code,
    leaseOwnerId: row.lease_owner_id,
    fencingToken: row.fencing_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    externalNetworkAllowed: false,
  });

const mapDeadLetter = (row: Record<string, unknown>): OperationalDeadLetter =>
  OperationalDeadLetterSchema.parse({
    schemaVersion: "1.0.0",
    deadLetterId: row.dead_letter_id,
    attemptId: row.attempt_id,
    eventId: row.event_id,
    runId: row.run_id,
    templateId: row.template_id,
    eventFingerprint: row.event_fingerprint,
    reasonCode: row.reason_code,
    incidentType: "delivery_failure",
    incidentStatus: row.incident_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    replayedAt: row.replayed_at,
  });

export class RegisteredOperationalDeliveryRegistry {
  readonly #registrations = new Map<
    string,
    { template: OperationalDeliveryTemplate; sink: OperationalDeliverySink }
  >();

  register(
    templateInput: OperationalDeliveryTemplate,
    sink: OperationalDeliverySink,
  ): void {
    const template = OperationalDeliveryTemplateSchema.parse(templateInput);
    if (this.#registrations.has(template.templateId)) {
      throw new OperationalOutboxDispatcherError(
        "DELIVERY_TEMPLATE_DUPLICATE",
        `Delivery template ${template.templateId} is already registered`,
      );
    }
    if (template.sinkKind !== sink.sinkKind) {
      throw new OperationalOutboxDispatcherError(
        "DELIVERY_SINK_KIND_MISMATCH",
        "Registered sink kind does not match its immutable template",
      );
    }
    this.#registrations.set(template.templateId, { template, sink });
  }

  get(templateId: string): {
    template: OperationalDeliveryTemplate;
    sink: OperationalDeliverySink;
  } {
    const registration = this.#registrations.get(templateId);
    if (!registration) {
      throw new OperationalOutboxDispatcherError(
        "DELIVERY_TEMPLATE_NOT_FOUND",
        `Delivery template ${templateId} is not registered`,
      );
    }
    return registration;
  }

  list(): OperationalDeliveryTemplate[] {
    return [...this.#registrations.values()]
      .map(({ template }) => template)
      .sort((left, right) => left.templateId.localeCompare(right.templateId));
  }
}

export class InMemoryOperationalDeliverySink
  implements OperationalDeliverySink
{
  readonly sinkKind = "in_memory_test" as const;
  readonly events: DispatchableOperationalEvent[] = [];
  failuresRemaining = 0;

  async deliver(event: Readonly<DispatchableOperationalEvent>): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("IN_MEMORY_DELIVERY_FAILURE");
    }
    this.events.push(structuredClone(event));
  }
}

export class LocalJsonlOperationalAuditSink
  implements OperationalDeliverySink
{
  readonly sinkKind = "local_jsonl_audit" as const;
  readonly #directory: string;
  readonly #filePath: string;

  constructor(serverOwnedDirectory: string) {
    const directory = resolve(serverOwnedDirectory);
    if (!directory || directory === sep) {
      throw new Error("A bounded server-owned audit directory is required");
    }
    this.#directory = directory;
    this.#filePath = resolve(directory, "tradebot-operational-audit.jsonl");
    if (
      !this.#filePath.startsWith(`${directory}${sep}`) ||
      basename(this.#filePath) !== "tradebot-operational-audit.jsonl"
    ) {
      throw new Error("Audit file must remain inside the registered directory");
    }
  }

  async deliver(event: Readonly<DispatchableOperationalEvent>): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    const record = {
      schemaVersion: "1.0.0",
      eventId: event.eventId,
      runId: event.runId,
      sequence: event.sequence,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      eventFingerprint: event.fingerprint,
      machineFields: event.machineFields,
      exchangeWriteAllowed: false,
    };
    await appendFile(this.#filePath, `${stableStringify(record)}\n`, {
      encoding: "utf8",
      flag: "a",
    });
  }
}

export class SqliteOperationalOutboxDispatcher {
  readonly #database: DatabaseSync;
  readonly #registry = new RegisteredOperationalDeliveryRegistry();
  readonly #dispatcherId: string;
  readonly #now: () => Date;
  readonly #leaseDurationMs: number;
  readonly #eventStatement: StatementSync;

  constructor(options: OperationalOutboxDispatcherOptions) {
    this.#database = options.database;
    this.#dispatcherId = options.dispatcherId ?? "paper-runtime-operational-outbox";
    this.#now = options.now ?? (() => new Date());
    this.#leaseDurationMs = options.leaseDurationMs ?? 30_000;
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS operational_dispatcher_lease (
        dispatcher_id TEXT PRIMARY KEY,
        owner_id TEXT,
        fencing_token INTEGER NOT NULL DEFAULT 0,
        lease_expires_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operational_delivery_attempts (
        attempt_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        event_sequence INTEGER NOT NULL,
        event_fingerprint TEXT NOT NULL,
        template_id TEXT NOT NULL,
        template_fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_attempt_at TEXT,
        delivered_at TEXT,
        dead_lettered_at TEXT,
        error_code TEXT,
        lease_owner_id TEXT,
        fencing_token INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(event_id, template_id)
      );
      CREATE INDEX IF NOT EXISTS idx_operational_delivery_due
        ON operational_delivery_attempts(status, next_attempt_at, event_sequence);
      CREATE TABLE IF NOT EXISTS operational_delivery_dead_letters (
        dead_letter_id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL UNIQUE,
        event_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        template_id TEXT NOT NULL,
        event_fingerprint TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        incident_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        replayed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS operational_delivery_replays (
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        dead_letter_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(actor_id, idempotency_key)
      );
    `);
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO operational_dispatcher_lease(
          dispatcher_id, owner_id, fencing_token, lease_expires_at, updated_at
        ) VALUES (?, NULL, 0, NULL, ?)`,
      )
      .run(this.#dispatcherId, this.#now().toISOString());
    this.#recoverInterruptedDeliveries();
    this.#eventStatement = this.#database.prepare(
      `SELECT * FROM paper_runtime_operational_events
       ORDER BY run_id ASC, sequence ASC`,
    );
  }

  registerTemplate(
    template: OperationalDeliveryTemplate,
    sink: OperationalDeliverySink,
  ): void {
    this.#registry.register(template, sink);
  }

  listTemplates(): OperationalDeliveryTemplate[] {
    return this.#registry.list();
  }

  getState(): OperationalDispatcherState {
    const row = this.#database
      .prepare(
        `SELECT * FROM operational_dispatcher_lease WHERE dispatcher_id = ?`,
      )
      .get(this.#dispatcherId) as Record<string, unknown>;
    return OperationalDispatcherStateSchema.parse({
      schemaVersion: "1.0.0",
      dispatcherId: this.#dispatcherId,
      ownerId: row.owner_id,
      fencingToken: row.fencing_token,
      leaseExpiresAt: row.lease_expires_at,
      registeredTemplateIds: this.#registry
        .list()
        .map((template) => template.templateId),
      externalDeliveryConfigured: false,
      networkRequestCount: 0,
      updatedAt: row.updated_at,
    });
  }

  listAttempts(limit = 100): OperationalDeliveryAttempt[] {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    return (
      this.#database
        .prepare(
          `SELECT * FROM operational_delivery_attempts
           ORDER BY updated_at DESC, event_sequence DESC
           LIMIT ?`,
        )
        .all(boundedLimit) as Record<string, unknown>[]
    ).map(mapAttempt);
  }

  listDeadLetters(limit = 100): OperationalDeadLetter[] {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    return (
      this.#database
        .prepare(
          `SELECT * FROM operational_delivery_dead_letters
           ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(boundedLimit) as Record<string, unknown>[]
    ).map(mapDeadLetter);
  }

  async dispatchAvailable(ownerId: string, limit = 100): Promise<{
    state: OperationalDispatcherState;
    processed: OperationalDeliveryAttempt[];
  }> {
    const fencingToken = this.#acquireLease(ownerId);
    this.#materializeAttempts();
    const now = this.#now().toISOString();
    const due = this.#database
      .prepare(
        `SELECT * FROM operational_delivery_attempts
         WHERE status IN ('queued', 'retry_wait')
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY event_sequence ASC, template_id ASC
         LIMIT ?`,
      )
      .all(now, Math.max(1, Math.min(100, Math.trunc(limit)))) as Record<
      string,
      unknown
    >[];
    const processed: OperationalDeliveryAttempt[] = [];
    for (const row of due) {
      this.#assertLease(ownerId, fencingToken);
      processed.push(await this.#deliver(row, ownerId, fencingToken));
    }
    return { state: this.getState(), processed };
  }

  releaseLease(ownerId: string, fencingToken: number): void {
    const result = this.#database
      .prepare(
        `UPDATE operational_dispatcher_lease
         SET owner_id = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE dispatcher_id = ? AND owner_id = ? AND fencing_token = ?`,
      )
      .run(
        this.#now().toISOString(),
        this.#dispatcherId,
        ownerId,
        fencingToken,
      );
    if (Number(result.changes) !== 1) {
      throw new OperationalOutboxDispatcherError(
        "DISPATCHER_FENCED",
        "Dispatcher lease was lost before release",
      );
    }
  }

  replayDeadLetter(
    deadLetterId: string,
    requestInput: OperationalDeadLetterReplayRequest,
    actor: OperationalDispatcherActor,
  ): OperationalDeliveryAttempt {
    if (!actor.roles.includes("operator")) {
      throw new OperationalOutboxDispatcherError(
        "DELIVERY_REPLAY_FORBIDDEN",
        "Operator role is required to replay a dead letter",
      );
    }
    const request = OperationalDeadLetterReplayRequestSchema.parse(requestInput);
    const previous = this.#database
      .prepare(
        `SELECT dead_letter_id FROM operational_delivery_replays
         WHERE actor_id = ? AND idempotency_key = ?`,
      )
      .get(actor.actorId, request.idempotencyKey) as
      | Record<string, unknown>
      | undefined;
    const effectiveDeadLetterId = previous
      ? String(previous.dead_letter_id)
      : deadLetterId;
    const deadLetter = this.#database
      .prepare(
        `SELECT * FROM operational_delivery_dead_letters WHERE dead_letter_id = ?`,
      )
      .get(effectiveDeadLetterId) as Record<string, unknown> | undefined;
    if (!deadLetter) {
      throw new OperationalOutboxDispatcherError(
        "DELIVERY_DEAD_LETTER_NOT_FOUND",
        "Delivery dead letter was not found",
      );
    }
    if (!previous && deadLetter.incident_status !== "open") {
      throw new OperationalOutboxDispatcherError(
        "DELIVERY_DEAD_LETTER_NOT_REPLAYABLE",
        "Delivery dead letter has already been replayed",
      );
    }
    this.#registry.get(String(deadLetter.template_id));
    const now = this.#now().toISOString();
    if (!previous) {
      this.#database.exec("BEGIN IMMEDIATE");
      try {
        this.#database
          .prepare(
            `INSERT INTO operational_delivery_replays(
              actor_id, idempotency_key, dead_letter_id, created_at
            ) VALUES (?, ?, ?, ?)`,
          )
          .run(actor.actorId, request.idempotencyKey, deadLetterId, now);
        this.#database
          .prepare(
            `UPDATE operational_delivery_dead_letters
             SET incident_status = 'replayed', replayed_at = ?, updated_at = ?
             WHERE dead_letter_id = ? AND incident_status = 'open'`,
          )
          .run(now, now, deadLetterId);
        this.#database
          .prepare(
            `UPDATE operational_delivery_attempts
             SET status = 'queued', attempt_count = 0, next_attempt_at = ?,
                 last_attempt_at = NULL, delivered_at = NULL,
                 dead_lettered_at = NULL, error_code = NULL,
                 lease_owner_id = NULL, fencing_token = NULL, updated_at = ?
             WHERE attempt_id = ?`,
          )
          .run(now, now, String(deadLetter.attempt_id));
        this.#database.exec("COMMIT");
      } catch (error) {
        this.#database.exec("ROLLBACK");
        throw error;
      }
    }
    const attempt = this.#database
      .prepare(
        `SELECT * FROM operational_delivery_attempts WHERE attempt_id = ?`,
      )
      .get(String(deadLetter.attempt_id)) as Record<string, unknown>;
    return mapAttempt(attempt);
  }

  #recoverInterruptedDeliveries(): void {
    const now = this.#now().toISOString();
    this.#database
      .prepare(
        `UPDATE operational_delivery_attempts
         SET status = 'retry_wait', next_attempt_at = ?, error_code = ?,
             lease_owner_id = NULL, fencing_token = NULL, updated_at = ?
         WHERE status = 'delivering'`,
      )
      .run(now, "dispatcher_restart_recovery", now);
  }

  #materializeAttempts(): void {
    const templates = this.#registry
      .list()
      .filter((template) => template.lifecycleStatus === "active");
    if (templates.length === 0) {
      return;
    }
    const rows = this.#eventStatement.all() as Record<string, unknown>[];
    const insert = this.#database.prepare(
      `INSERT OR IGNORE INTO operational_delivery_attempts(
        attempt_id, event_id, run_id, event_sequence, event_fingerprint,
        template_id, template_fingerprint, status, attempt_count,
        next_attempt_at, last_attempt_at, delivered_at, dead_lettered_at,
        error_code, lease_owner_id, fencing_token, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, NULL, NULL, NULL,
        NULL, NULL, NULL, ?, ?)`,
    );
    const now = this.#now().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        const event = mapEventRow(row);
        for (const template of templates) {
          insert.run(
            stableId("delivery-attempt"),
            event.eventId,
            event.runId,
            event.sequence,
            event.fingerprint,
            template.templateId,
            template.fingerprint,
            now,
            now,
            now,
          );
        }
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #acquireLease(ownerId: string): number {
    const nowDate = this.#now();
    const now = nowDate.toISOString();
    const expiresAt = new Date(
      nowDate.getTime() + this.#leaseDurationMs,
    ).toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#database
        .prepare(
          `SELECT * FROM operational_dispatcher_lease WHERE dispatcher_id = ?`,
        )
        .get(this.#dispatcherId) as Record<string, unknown>;
      const currentOwner = row.owner_id === null ? null : String(row.owner_id);
      const currentExpiry =
        typeof row.lease_expires_at === "string"
          ? Date.parse(row.lease_expires_at)
          : 0;
      if (
        currentOwner &&
        currentOwner !== ownerId &&
        currentExpiry > nowDate.getTime()
      ) {
        throw new OperationalOutboxDispatcherError(
          "DISPATCHER_LEASE_HELD",
          "Operational dispatcher lease is held by another owner",
        );
      }
      const currentToken = Number(row.fencing_token);
      const fencingToken =
        currentOwner === ownerId && currentExpiry > nowDate.getTime()
          ? currentToken
          : currentToken + 1;
      this.#database
        .prepare(
          `UPDATE operational_dispatcher_lease
           SET owner_id = ?, fencing_token = ?, lease_expires_at = ?, updated_at = ?
           WHERE dispatcher_id = ?`,
        )
        .run(ownerId, fencingToken, expiresAt, now, this.#dispatcherId);
      this.#database.exec("COMMIT");
      return fencingToken;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #assertLease(ownerId: string, fencingToken: number): void {
    const row = this.#database
      .prepare(
        `SELECT owner_id, fencing_token, lease_expires_at
         FROM operational_dispatcher_lease WHERE dispatcher_id = ?`,
      )
      .get(this.#dispatcherId) as Record<string, unknown>;
    if (
      row.owner_id !== ownerId ||
      Number(row.fencing_token) !== fencingToken ||
      typeof row.lease_expires_at !== "string" ||
      Date.parse(row.lease_expires_at) <= this.#now().getTime()
    ) {
      throw new OperationalOutboxDispatcherError(
        "DISPATCHER_FENCED",
        "Operational dispatcher owner has been fenced",
      );
    }
  }

  async #deliver(
    row: Record<string, unknown>,
    ownerId: string,
    fencingToken: number,
  ): Promise<OperationalDeliveryAttempt> {
    const registration = this.#registry.get(String(row.template_id));
    const now = this.#now().toISOString();
    const claim = this.#database
      .prepare(
        `UPDATE operational_delivery_attempts
         SET status = 'delivering', last_attempt_at = ?, lease_owner_id = ?,
             fencing_token = ?, updated_at = ?
         WHERE attempt_id = ? AND status IN ('queued', 'retry_wait')`,
      )
      .run(now, ownerId, fencingToken, now, String(row.attempt_id));
    if (Number(claim.changes) !== 1) {
      const current = this.#database
        .prepare(
          `SELECT * FROM operational_delivery_attempts WHERE attempt_id = ?`,
        )
        .get(String(row.attempt_id)) as Record<string, unknown>;
      return mapAttempt(current);
    }
    const eventRow = this.#database
      .prepare(
        `SELECT * FROM paper_runtime_operational_events
         WHERE event_id = ? LIMIT 1`,
      )
      .get(String(row.event_id)) as Record<string, unknown> | undefined;
    if (!eventRow) {
      return this.#recordFailure(
        row,
        registration.template,
        "delivery_event_missing",
      );
    }
    const event = mapEventRow(eventRow);
    if (event.fingerprint !== row.event_fingerprint) {
      return this.#recordFailure(
        row,
        registration.template,
        "delivery_event_fingerprint_mismatch",
      );
    }
    try {
      await registration.sink.deliver(Object.freeze(structuredClone(event)));
      this.#assertLease(ownerId, fencingToken);
      const deliveredAt = this.#now().toISOString();
      this.#database
        .prepare(
          `UPDATE operational_delivery_attempts
           SET status = 'delivered', attempt_count = attempt_count + 1,
               next_attempt_at = NULL, delivered_at = ?, error_code = NULL,
               updated_at = ?
           WHERE attempt_id = ? AND lease_owner_id = ? AND fencing_token = ?`,
        )
        .run(
          deliveredAt,
          deliveredAt,
          String(row.attempt_id),
          ownerId,
          fencingToken,
        );
    } catch {
      return this.#recordFailure(
        row,
        registration.template,
        "registered_sink_delivery_failed",
      );
    }
    const updated = this.#database
      .prepare(
        `SELECT * FROM operational_delivery_attempts WHERE attempt_id = ?`,
      )
      .get(String(row.attempt_id)) as Record<string, unknown>;
    return mapAttempt(updated);
  }

  #recordFailure(
    row: Record<string, unknown>,
    template: OperationalDeliveryTemplate,
    errorCode: string,
  ): OperationalDeliveryAttempt {
    const attemptCount = Number(row.attempt_count) + 1;
    const nowDate = this.#now();
    const now = nowDate.toISOString();
    if (attemptCount >= template.maxAttempts) {
      const deadLetteredAt = now;
      this.#database.exec("BEGIN IMMEDIATE");
      try {
        this.#database
          .prepare(
            `UPDATE operational_delivery_attempts
             SET status = 'dead_letter', attempt_count = ?,
                 next_attempt_at = NULL, dead_lettered_at = ?, error_code = ?,
                 updated_at = ?
             WHERE attempt_id = ?`,
          )
          .run(
            attemptCount,
            deadLetteredAt,
            errorCode,
            now,
            String(row.attempt_id),
          );
        this.#database
          .prepare(
            `INSERT OR IGNORE INTO operational_delivery_dead_letters(
              dead_letter_id, attempt_id, event_id, run_id, template_id,
              event_fingerprint, reason_code, incident_status,
              created_at, updated_at, replayed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL)`,
          )
          .run(
            stableId("delivery-dead-letter"),
            String(row.attempt_id),
            String(row.event_id),
            String(row.run_id),
            String(row.template_id),
            String(row.event_fingerprint),
            errorCode,
            now,
            now,
          );
        this.#database.exec("COMMIT");
      } catch (error) {
        this.#database.exec("ROLLBACK");
        throw error;
      }
    } else {
      const exponent = Math.max(0, attemptCount - 1);
      const backoff = Math.min(
        template.initialBackoffMs * 2 ** exponent,
        template.maxBackoffMs,
      );
      const nextAttemptAt = new Date(nowDate.getTime() + backoff).toISOString();
      this.#database
        .prepare(
          `UPDATE operational_delivery_attempts
           SET status = 'retry_wait', attempt_count = ?, next_attempt_at = ?,
               error_code = ?, updated_at = ?
           WHERE attempt_id = ?`,
        )
        .run(
          attemptCount,
          nextAttemptAt,
          errorCode,
          now,
          String(row.attempt_id),
        );
    }
    const updated = this.#database
      .prepare(
        `SELECT * FROM operational_delivery_attempts WHERE attempt_id = ?`,
      )
      .get(String(row.attempt_id)) as Record<string, unknown>;
    return mapAttempt(updated);
  }
}

export const createOperationalDeliveryTemplate = (
  input: Omit<
    OperationalDeliveryTemplate,
    "schemaVersion" | "fingerprint" | "deliveryConfigured" | "externalNetworkAllowed"
  >,
): OperationalDeliveryTemplate => {
  const content = {
    schemaVersion: "1.0.0" as const,
    ...input,
    deliveryConfigured: true as const,
    externalNetworkAllowed: false as const,
  };
  return OperationalDeliveryTemplateSchema.parse({
    ...content,
    fingerprint: fingerprint(content),
  });
};
