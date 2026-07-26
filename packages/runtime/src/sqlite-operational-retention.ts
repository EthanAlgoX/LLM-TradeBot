import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  OperationalAuditExportManifestSchema,
  OperationalRetentionExecutionRecordSchema,
  OperationalRetentionExecutionRequestSchema,
  OperationalRetentionPolicySchema,
  OperationalRetentionPreviewRequestSchema,
  OperationalRetentionPreviewSchema,
  type OperationalAuditExportManifest,
  type OperationalRetentionExecutionRecord,
  type OperationalRetentionExecutionRequest,
  type OperationalRetentionPolicy,
  type OperationalRetentionPreview,
  type OperationalRetentionPreviewRequest,
} from "../../contracts/src/index.js";
import type {
  OperationalDispatcherActor,
  SqliteOperationalOutboxDispatcher,
} from "./sqlite-operational-outbox-dispatcher.js";

type SqlRow = Record<string, unknown>;

type Candidate = {
  eventId: string;
  runId: string;
  sequence: number;
  eventFingerprint: string;
  attemptIds: string[];
};

type CandidateEvaluation = {
  candidates: Candidate[];
  protectedReasonCounts: Record<string, number>;
  truncated: boolean;
};

export interface OperationalRetentionStatus {
  policy: OperationalRetentionPolicy;
  manifests: OperationalAuditExportManifest[];
  executions: OperationalRetentionExecutionRecord[];
}

export class OperationalRetentionError extends Error {
  constructor(
    readonly code:
      | "RETENTION_OPERATOR_REQUIRED"
      | "RETENTION_POLICY_DISABLED"
      | "RETENTION_MANIFEST_NOT_FOUND"
      | "RETENTION_MANIFEST_FINGERPRINT_MISMATCH"
      | "RETENTION_CANDIDATE_DRIFT"
      | "RETENTION_EXECUTION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "OperationalRetentionError";
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

const id = (prefix: string): string =>
  `${prefix}:${randomUUID().toLowerCase()}`;

const increment = (record: Record<string, number>, key: string): void => {
  record[key] = (record[key] ?? 0) + 1;
};

const tableExists = (database: DatabaseSync, tableName: string): boolean =>
  Boolean(
    database
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      )
      .get(tableName),
  );

const mapManifest = (row: SqlRow): OperationalAuditExportManifest =>
  OperationalAuditExportManifestSchema.parse({
    schemaVersion: "1.0.0",
    manifestId: row.manifest_id,
    previewId: row.preview_id,
    policyId: row.policy_id,
    policyFingerprint: row.policy_fingerprint,
    candidateFingerprint: row.candidate_fingerprint,
    manifestFingerprint: row.manifest_fingerprint,
    cutoffAt: row.cutoff_at,
    eventCount: row.event_count,
    attemptCount: row.attempt_count,
    firstSequence: row.first_sequence,
    lastSequence: row.last_sequence,
    lifecycleStatus: "sealed",
    createdAt: row.created_at,
    payloadIncluded: false,
    externalNetworkAllowed: false,
    exchangeWriteAllowed: false,
  });

const mapExecution = (row: SqlRow): OperationalRetentionExecutionRecord =>
  OperationalRetentionExecutionRecordSchema.parse({
    schemaVersion: "1.0.0",
    executionId: row.execution_id,
    manifestId: row.manifest_id,
    manifestFingerprint: row.manifest_fingerprint,
    policyId: row.policy_id,
    actorId: row.actor_id,
    idempotencyKey: row.idempotency_key,
    deletedEventCount: row.deleted_event_count,
    deletedAttemptCount: row.deleted_attempt_count,
    firstSequence: row.first_sequence,
    lastSequence: row.last_sequence,
    executedAt: row.executed_at,
    candidateSetRevalidated: true,
    payloadRecorded: false,
    exchangeWriteAllowed: false,
  });

export class SqliteOperationalRetentionService {
  readonly #database: DatabaseSync;
  readonly #dispatcher: SqliteOperationalOutboxDispatcher;
  readonly #policy: OperationalRetentionPolicy;
  readonly #now: () => Date;

  constructor(options: {
    database: DatabaseSync;
    dispatcher: SqliteOperationalOutboxDispatcher;
    policy: OperationalRetentionPolicy;
    now?: () => Date;
  }) {
    this.#database = options.database;
    this.#dispatcher = options.dispatcher;
    this.#policy = OperationalRetentionPolicySchema.parse(options.policy);
    this.#now = options.now ?? (() => new Date());
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS operational_retention_previews (
        preview_id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        policy_id TEXT NOT NULL,
        policy_fingerprint TEXT NOT NULL,
        cutoff_at TEXT NOT NULL,
        candidate_fingerprint TEXT NOT NULL,
        candidate_event_ids_json TEXT NOT NULL,
        candidate_attempt_ids_json TEXT NOT NULL,
        protected_reason_counts_json TEXT NOT NULL,
        truncated INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(actor_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS operational_audit_export_manifests (
        manifest_id TEXT PRIMARY KEY,
        preview_id TEXT NOT NULL UNIQUE,
        policy_id TEXT NOT NULL,
        policy_fingerprint TEXT NOT NULL,
        candidate_fingerprint TEXT NOT NULL,
        manifest_fingerprint TEXT NOT NULL UNIQUE,
        cutoff_at TEXT NOT NULL,
        event_count INTEGER NOT NULL,
        attempt_count INTEGER NOT NULL,
        first_sequence INTEGER,
        last_sequence INTEGER,
        candidate_snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operational_retention_executions (
        execution_id TEXT PRIMARY KEY,
        manifest_id TEXT NOT NULL UNIQUE,
        manifest_fingerprint TEXT NOT NULL,
        policy_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        deleted_event_count INTEGER NOT NULL,
        deleted_attempt_count INTEGER NOT NULL,
        first_sequence INTEGER,
        last_sequence INTEGER,
        executed_at TEXT NOT NULL,
        UNIQUE(actor_id, idempotency_key)
      );
      CREATE TRIGGER IF NOT EXISTS immutable_operational_audit_manifest_update
      BEFORE UPDATE ON operational_audit_export_manifests
      BEGIN
        SELECT RAISE(ABORT, 'OPERATIONAL_AUDIT_MANIFEST_IMMUTABLE');
      END;
      CREATE TRIGGER IF NOT EXISTS immutable_operational_audit_manifest_delete
      BEFORE DELETE ON operational_audit_export_manifests
      BEGIN
        SELECT RAISE(ABORT, 'OPERATIONAL_AUDIT_MANIFEST_IMMUTABLE');
      END;
      CREATE TRIGGER IF NOT EXISTS immutable_operational_retention_execution_update
      BEFORE UPDATE ON operational_retention_executions
      BEGIN
        SELECT RAISE(ABORT, 'OPERATIONAL_RETENTION_EXECUTION_IMMUTABLE');
      END;
      CREATE TRIGGER IF NOT EXISTS immutable_operational_retention_execution_delete
      BEFORE DELETE ON operational_retention_executions
      BEGIN
        SELECT RAISE(ABORT, 'OPERATIONAL_RETENTION_EXECUTION_IMMUTABLE');
      END;
    `);
  }

  getStatus(): OperationalRetentionStatus {
    return {
      policy: this.#policy,
      manifests: (
        this.#database
          .prepare(
            `SELECT * FROM operational_audit_export_manifests
             ORDER BY created_at DESC LIMIT 20`,
          )
          .all() as SqlRow[]
      ).map(mapManifest),
      executions: (
        this.#database
          .prepare(
            `SELECT * FROM operational_retention_executions
             ORDER BY executed_at DESC LIMIT 20`,
          )
          .all() as SqlRow[]
      ).map(mapExecution),
    };
  }

  createPreview(
    requestInput: OperationalRetentionPreviewRequest,
    actor: OperationalDispatcherActor,
  ): {
    preview: OperationalRetentionPreview;
    manifest: OperationalAuditExportManifest;
  } {
    this.#requireOperator(actor);
    const request = OperationalRetentionPreviewRequestSchema.parse(requestInput);
    const prior = this.#database
      .prepare(
        `SELECT preview_id FROM operational_retention_previews
         WHERE actor_id = ? AND idempotency_key = ?`,
      )
      .get(actor.actorId, request.idempotencyKey) as SqlRow | undefined;
    if (prior) {
      return this.#loadPreviewResult(String(prior.preview_id));
    }
    const createdAt = this.#now().toISOString();
    const cutoffAt = new Date(
      this.#now().getTime() - this.#policy.retentionDays * 86_400_000,
    ).toISOString();
    const evaluation = this.#evaluate(cutoffAt);
    const candidateFingerprint = this.#candidateFingerprint(
      cutoffAt,
      evaluation.candidates,
    );
    const previewId = id("retention-preview");
    const manifestId = id("audit-manifest");
    const eventIds = evaluation.candidates.map((item) => item.eventId);
    const attemptIds = evaluation.candidates.flatMap(
      (item) => item.attemptIds,
    );
    const sequences = evaluation.candidates.map((item) => item.sequence);
    const preview = OperationalRetentionPreviewSchema.parse({
      schemaVersion: "1.0.0",
      previewId,
      policyId: this.#policy.policyId,
      policyFingerprint: this.#policy.fingerprint,
      cutoffAt,
      candidateFingerprint,
      eligibleEventIds: eventIds,
      eligibleAttemptIds: attemptIds,
      eligibleEventCount: eventIds.length,
      eligibleAttemptCount: attemptIds.length,
      protectedReasonCounts: evaluation.protectedReasonCounts,
      truncated: evaluation.truncated,
      createdAt,
      exchangeWriteAllowed: false,
    });
    const manifestContent = {
      schemaVersion: "1.0.0" as const,
      manifestId,
      previewId,
      policyId: this.#policy.policyId,
      policyFingerprint: this.#policy.fingerprint,
      candidateFingerprint,
      cutoffAt,
      eventCount: eventIds.length,
      attemptCount: attemptIds.length,
      firstSequence: sequences.length ? Math.min(...sequences) : null,
      lastSequence: sequences.length ? Math.max(...sequences) : null,
      lifecycleStatus: "sealed" as const,
      createdAt,
      payloadIncluded: false as const,
      externalNetworkAllowed: false as const,
      exchangeWriteAllowed: false as const,
    };
    const manifest = OperationalAuditExportManifestSchema.parse({
      ...manifestContent,
      manifestFingerprint: hash(manifestContent),
    });
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare(
          `INSERT INTO operational_retention_previews(
            preview_id, actor_id, idempotency_key, policy_id,
            policy_fingerprint, cutoff_at, candidate_fingerprint,
            candidate_event_ids_json, candidate_attempt_ids_json,
            protected_reason_counts_json, truncated, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          previewId,
          actor.actorId,
          request.idempotencyKey,
          this.#policy.policyId,
          this.#policy.fingerprint,
          cutoffAt,
          candidateFingerprint,
          JSON.stringify(eventIds),
          JSON.stringify(attemptIds),
          JSON.stringify(evaluation.protectedReasonCounts),
          evaluation.truncated ? 1 : 0,
          createdAt,
        );
      this.#database
        .prepare(
          `INSERT INTO operational_audit_export_manifests(
            manifest_id, preview_id, policy_id, policy_fingerprint,
            candidate_fingerprint, manifest_fingerprint, cutoff_at,
            event_count, attempt_count, first_sequence, last_sequence,
            candidate_snapshot_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          manifest.manifestId,
          manifest.previewId,
          manifest.policyId,
          manifest.policyFingerprint,
          manifest.candidateFingerprint,
          manifest.manifestFingerprint,
          manifest.cutoffAt,
          manifest.eventCount,
          manifest.attemptCount,
          manifest.firstSequence,
          manifest.lastSequence,
          stableStringify(evaluation.candidates),
          manifest.createdAt,
        );
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return { preview, manifest };
  }

  execute(
    requestInput: OperationalRetentionExecutionRequest,
    actor: OperationalDispatcherActor,
  ): OperationalRetentionExecutionRecord {
    this.#requireOperator(actor);
    const request =
      OperationalRetentionExecutionRequestSchema.parse(requestInput);
    if (
      this.#policy.lifecycleStatus !== "enabled" ||
      !this.#policy.cleanupAllowed
    ) {
      throw new OperationalRetentionError(
        "RETENTION_POLICY_DISABLED",
        "Registered retention policy does not permit cleanup",
      );
    }
    const prior = this.#database
      .prepare(
        `SELECT * FROM operational_retention_executions
         WHERE actor_id = ? AND idempotency_key = ?`,
      )
      .get(actor.actorId, request.idempotencyKey) as SqlRow | undefined;
    if (prior) {
      return mapExecution(prior);
    }
    const manifestRow = this.#database
      .prepare(
        `SELECT * FROM operational_audit_export_manifests
         WHERE manifest_id = ?`,
      )
      .get(request.manifestId) as SqlRow | undefined;
    if (!manifestRow) {
      throw new OperationalRetentionError(
        "RETENTION_MANIFEST_NOT_FOUND",
        "Audit export manifest was not found",
      );
    }
    const manifest = mapManifest(manifestRow);
    if (manifest.manifestFingerprint !== request.manifestFingerprint) {
      throw new OperationalRetentionError(
        "RETENTION_MANIFEST_FINGERPRINT_MISMATCH",
        "Audit export manifest fingerprint does not match",
      );
    }
    if (manifest.policyFingerprint !== this.#policy.fingerprint) {
      throw new OperationalRetentionError(
        "RETENTION_EXECUTION_CONFLICT",
        "Registered retention policy changed after preview",
      );
    }
    const evaluation = this.#evaluate(manifest.cutoffAt);
    const currentFingerprint = this.#candidateFingerprint(
      manifest.cutoffAt,
      evaluation.candidates,
    );
    if (currentFingerprint !== manifest.candidateFingerprint) {
      throw new OperationalRetentionError(
        "RETENTION_CANDIDATE_DRIFT",
        "Retention candidate set changed after audit export",
      );
    }
    const expectedSnapshot = String(manifestRow.candidate_snapshot_json);
    if (stableStringify(evaluation.candidates) !== expectedSnapshot) {
      throw new OperationalRetentionError(
        "RETENTION_CANDIDATE_DRIFT",
        "Retention candidate lineage changed after audit export",
      );
    }
    const eventIds = evaluation.candidates.map((item) => item.eventId);
    const attemptIds = evaluation.candidates.flatMap(
      (item) => item.attemptIds,
    );
    const sequences = evaluation.candidates.map((item) => item.sequence);
    const executedAt = this.#now().toISOString();
    const execution = OperationalRetentionExecutionRecordSchema.parse({
      schemaVersion: "1.0.0",
      executionId: id("retention-execution"),
      manifestId: manifest.manifestId,
      manifestFingerprint: manifest.manifestFingerprint,
      policyId: this.#policy.policyId,
      actorId: actor.actorId,
      idempotencyKey: request.idempotencyKey,
      deletedEventCount: eventIds.length,
      deletedAttemptCount: attemptIds.length,
      firstSequence: sequences.length ? Math.min(...sequences) : null,
      lastSequence: sequences.length ? Math.max(...sequences) : null,
      executedAt,
      candidateSetRevalidated: true,
      payloadRecorded: false,
      exchangeWriteAllowed: false,
    });
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare(
          `INSERT INTO operational_retention_executions(
            execution_id, manifest_id, manifest_fingerprint, policy_id,
            actor_id, idempotency_key, deleted_event_count,
            deleted_attempt_count, first_sequence, last_sequence, executed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          execution.executionId,
          execution.manifestId,
          execution.manifestFingerprint,
          execution.policyId,
          execution.actorId,
          execution.idempotencyKey,
          execution.deletedEventCount,
          execution.deletedAttemptCount,
          execution.firstSequence,
          execution.lastSequence,
          execution.executedAt,
        );
      for (const attemptId of attemptIds) {
        this.#database
          .prepare(
            `DELETE FROM operational_delivery_dead_letters
             WHERE attempt_id = ? AND incident_status != 'open'`,
          )
          .run(attemptId);
        this.#database
          .prepare(
            `DELETE FROM operational_delivery_attempts
             WHERE attempt_id = ? AND status = 'delivered'`,
          )
          .run(attemptId);
      }
      for (const eventId of eventIds) {
        this.#database
          .prepare(
            `DELETE FROM paper_runtime_operational_events WHERE event_id = ?`,
          )
          .run(eventId);
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return execution;
  }

  #loadPreviewResult(previewId: string): {
    preview: OperationalRetentionPreview;
    manifest: OperationalAuditExportManifest;
  } {
    const previewRow = this.#database
      .prepare(
        `SELECT * FROM operational_retention_previews WHERE preview_id = ?`,
      )
      .get(previewId) as SqlRow;
    const eventIds = JSON.parse(
      String(previewRow.candidate_event_ids_json),
    ) as string[];
    const attemptIds = JSON.parse(
      String(previewRow.candidate_attempt_ids_json),
    ) as string[];
    const preview = OperationalRetentionPreviewSchema.parse({
      schemaVersion: "1.0.0",
      previewId: previewRow.preview_id,
      policyId: previewRow.policy_id,
      policyFingerprint: previewRow.policy_fingerprint,
      cutoffAt: previewRow.cutoff_at,
      candidateFingerprint: previewRow.candidate_fingerprint,
      eligibleEventIds: eventIds,
      eligibleAttemptIds: attemptIds,
      eligibleEventCount: eventIds.length,
      eligibleAttemptCount: attemptIds.length,
      protectedReasonCounts: JSON.parse(
        String(previewRow.protected_reason_counts_json),
      ),
      truncated: Boolean(previewRow.truncated),
      createdAt: previewRow.created_at,
      exchangeWriteAllowed: false,
    });
    const manifestRow = this.#database
      .prepare(
        `SELECT * FROM operational_audit_export_manifests
         WHERE preview_id = ?`,
      )
      .get(previewId) as SqlRow;
    return { preview, manifest: mapManifest(manifestRow) };
  }

  #evaluate(cutoffAt: string): CandidateEvaluation {
    const templates = this.#dispatcher
      .listTemplates()
      .filter((template) => template.lifecycleStatus === "active");
    const templateIds = new Set(templates.map((template) => template.templateId));
    const eventRows = this.#database
      .prepare(
        `SELECT event_id, run_id, sequence, occurred_at
         FROM paper_runtime_operational_events
         ORDER BY run_id ASC, sequence ASC`,
      )
      .all() as SqlRow[];
    const protectedReasonCounts: Record<string, number> = {
      too_new: 0,
      no_registered_template: 0,
      missing_delivery: 0,
      non_terminal_attempt: 0,
      open_delivery_failure: 0,
      open_runtime_incident: 0,
      orphaned_run: 0,
    };
    const candidates: Candidate[] = [];
    let truncated = false;
    for (const eventRow of eventRows) {
      if (String(eventRow.occurred_at) >= cutoffAt) {
        increment(protectedReasonCounts, "too_new");
        continue;
      }
      if (templateIds.size === 0) {
        increment(protectedReasonCounts, "no_registered_template");
        continue;
      }
      const runId = String(eventRow.run_id);
      if (this.#isOrphanedRun(runId)) {
        increment(protectedReasonCounts, "orphaned_run");
        continue;
      }
      if (this.#hasOpenRuntimeIncident(runId)) {
        increment(protectedReasonCounts, "open_runtime_incident");
        continue;
      }
      const attempts = this.#database
        .prepare(
          `SELECT * FROM operational_delivery_attempts
           WHERE event_id = ? ORDER BY template_id ASC`,
        )
        .all(String(eventRow.event_id)) as SqlRow[];
      const byTemplate = new Map(
        attempts.map((attempt) => [String(attempt.template_id), attempt]),
      );
      if ([...templateIds].some((templateId) => !byTemplate.has(templateId))) {
        increment(protectedReasonCounts, "missing_delivery");
        continue;
      }
      if (
        attempts.some(
          (attempt) =>
            templateIds.has(String(attempt.template_id)) &&
            attempt.status !== "delivered",
        )
      ) {
        increment(protectedReasonCounts, "non_terminal_attempt");
        continue;
      }
      const attemptIds = attempts
        .filter((attempt) => templateIds.has(String(attempt.template_id)))
        .map((attempt) => String(attempt.attempt_id));
      const openDeliveryFailure = attempts.some((attempt) =>
        this.#database
          .prepare(
            `SELECT dead_letter_id FROM operational_delivery_dead_letters
             WHERE attempt_id = ? AND incident_status = 'open'`,
          )
          .get(String(attempt.attempt_id)),
      );
      if (openDeliveryFailure) {
        increment(protectedReasonCounts, "open_delivery_failure");
        continue;
      }
      if (candidates.length >= this.#policy.candidateLimit) {
        truncated = true;
        continue;
      }
      const fingerprints = new Set(
        attempts
          .filter((attempt) => templateIds.has(String(attempt.template_id)))
          .map((attempt) => String(attempt.event_fingerprint)),
      );
      if (fingerprints.size !== 1) {
        increment(protectedReasonCounts, "missing_delivery");
        continue;
      }
      candidates.push({
        eventId: String(eventRow.event_id),
        runId,
        sequence: Number(eventRow.sequence),
        eventFingerprint: [...fingerprints][0]!,
        attemptIds,
      });
    }
    return { candidates, protectedReasonCounts, truncated };
  }

  #isOrphanedRun(runId: string): boolean {
    if (!tableExists(this.#database, "paper_runtime_runs")) {
      return false;
    }
    const row = this.#database
      .prepare(`SELECT status FROM paper_runtime_runs WHERE run_id = ?`)
      .get(runId) as SqlRow | undefined;
    return row?.status === "orphaned";
  }

  #hasOpenRuntimeIncident(runId: string): boolean {
    if (!tableExists(this.#database, "paper_runtime_incidents")) {
      return false;
    }
    const columns = this.#database
      .prepare(`PRAGMA table_info(paper_runtime_incidents)`)
      .all() as SqlRow[];
    const names = new Set(columns.map((column) => String(column.name)));
    const statusColumn = names.has("status")
      ? "status"
      : names.has("incident_status")
        ? "incident_status"
        : null;
    if (!statusColumn) {
      return false;
    }
    return Boolean(
      this.#database
        .prepare(
          `SELECT incident_id FROM paper_runtime_incidents
           WHERE run_id = ? AND ${statusColumn} = 'open' LIMIT 1`,
        )
        .get(runId),
    );
  }

  #candidateFingerprint(cutoffAt: string, candidates: Candidate[]): string {
    return hash({
      policyId: this.#policy.policyId,
      policyFingerprint: this.#policy.fingerprint,
      cutoffAt,
      candidates,
    });
  }

  #requireOperator(actor: OperationalDispatcherActor): void {
    if (!actor.roles.includes("operator")) {
      throw new OperationalRetentionError(
        "RETENTION_OPERATOR_REQUIRED",
        "Operator role is required for retention",
      );
    }
  }
}

export const createOperationalRetentionPolicy = (
  input: Omit<
    OperationalRetentionPolicy,
    "schemaVersion" | "fingerprint" | "serverRegistered" | "clientMutable"
  >,
): OperationalRetentionPolicy => {
  const content = {
    schemaVersion: "1.0.0" as const,
    ...input,
    serverRegistered: true as const,
    clientMutable: false as const,
  };
  return OperationalRetentionPolicySchema.parse({
    ...content,
    fingerprint: hash(content),
  });
};
