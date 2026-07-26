import { DatabaseSync } from "node:sqlite";
import {
  PaperRuntimeLeaseSchema,
  PaperRuntimePreflightReportSchema,
  PaperRuntimeStopRecordSchema,
  type PaperRuntimeLease,
  type PaperRuntimePreflightReport,
  type PaperRuntimeStopRecord,
} from "../../contracts/src/index.js";
import { PaperRuntimeActivationError } from "./paper-runtime-activation.js";

interface JsonRow {
  record_json: string;
}

export class SqlitePaperRuntimeOperationsRepository {
  constructor(private readonly database: DatabaseSync) {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS paper_runtime_preflight_reports (
        report_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        plan_fingerprint TEXT NOT NULL,
        binding_fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS paper_runtime_preflight_idempotency (
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        report_id TEXT NOT NULL,
        PRIMARY KEY (actor_id, idempotency_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS paper_runtime_fencing_counters (
        plan_id TEXT PRIMARY KEY,
        last_token INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS paper_runtime_leases (
        run_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        fencing_token INTEGER NOT NULL,
        status TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS one_active_paper_runtime_lease_per_plan
      ON paper_runtime_leases(plan_id)
      WHERE status = 'active';

      CREATE TABLE IF NOT EXISTS paper_runtime_stop_records (
        stop_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS one_paper_runtime_stop_per_run
      ON paper_runtime_stop_records(run_id);

      CREATE TABLE IF NOT EXISTS paper_runtime_stop_idempotency (
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        stop_id TEXT NOT NULL,
        PRIMARY KEY (actor_id, idempotency_key)
      ) STRICT;
    `);
  }

  findPreflightByIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimePreflightReport | undefined {
    const row = this.database
      .prepare(
        `SELECT p.record_json
         FROM paper_runtime_preflight_idempotency i
         JOIN paper_runtime_preflight_reports p ON p.report_id = i.report_id
         WHERE i.actor_id = ? AND i.idempotency_key = ?`,
      )
      .get(actorId, idempotencyKey) as JsonRow | undefined;
    return row
      ? PaperRuntimePreflightReportSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }

  savePreflight(
    report: PaperRuntimePreflightReport,
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimePreflightReport {
    const parsed = PaperRuntimePreflightReportSchema.parse(report);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO paper_runtime_preflight_reports (
             report_id, plan_id, plan_fingerprint, binding_fingerprint,
             status, created_at, expires_at, record_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.reportId,
          parsed.planId,
          parsed.planFingerprint,
          parsed.bindingFingerprint,
          parsed.status,
          parsed.createdAt,
          parsed.expiresAt,
          JSON.stringify(parsed),
        );
      this.database
        .prepare(
          `INSERT INTO paper_runtime_preflight_idempotency (
             actor_id, idempotency_key, report_id
           ) VALUES (?, ?, ?)`,
        )
        .run(actorId, idempotencyKey, parsed.reportId);
      this.database.exec("COMMIT");
      return parsed;
    } catch {
      this.database.exec("ROLLBACK");
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_RUN_CONFLICT",
        "Paper Runtime preflight conflicts with an immutable record.",
        { planId: parsed.planId, reportId: parsed.reportId },
      );
    }
  }

  findLatestPreflight(
    planId: string,
  ): PaperRuntimePreflightReport | undefined {
    const row = this.database
      .prepare(
        `SELECT record_json
         FROM paper_runtime_preflight_reports
         WHERE plan_id = ?
         ORDER BY created_at DESC, report_id DESC
         LIMIT 1`,
      )
      .get(planId) as JsonRow | undefined;
    return row
      ? PaperRuntimePreflightReportSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }

  acquireLease(
    runId: string,
    planId: string,
    ownerId: string,
    now: Date,
    ttlMs: number,
  ): PaperRuntimeLease {
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const active = this.database
        .prepare(
          `SELECT record_json FROM paper_runtime_leases
           WHERE plan_id = ? AND status = 'active'`,
        )
        .get(planId) as JsonRow | undefined;
      if (active) {
        const lease = PaperRuntimeLeaseSchema.parse(
          JSON.parse(active.record_json),
        );
        if (Date.parse(lease.expiresAt) > now.getTime()) {
          throw new PaperRuntimeActivationError(
            "PAPER_RUNTIME_LEASE_CONFLICT",
            "A live fenced Paper Runtime lease already owns this plan.",
            {
              planId,
              ownerId: lease.ownerId,
              fencingToken: String(lease.fencingToken),
            },
          );
        }
        const orphaned = PaperRuntimeLeaseSchema.parse({
          ...lease,
          status: "orphaned",
          releasedAt: nowIso,
        });
        this.database
          .prepare(
            `UPDATE paper_runtime_leases
             SET status = 'orphaned', record_json = ?
             WHERE run_id = ?`,
          )
          .run(JSON.stringify(orphaned), orphaned.runId);
      }
      this.database
        .prepare(
          `INSERT INTO paper_runtime_fencing_counters (plan_id, last_token)
           VALUES (?, 1)
           ON CONFLICT(plan_id) DO UPDATE SET last_token = last_token + 1`,
        )
        .run(planId);
      const tokenRow = this.database
        .prepare(
          "SELECT last_token FROM paper_runtime_fencing_counters WHERE plan_id = ?",
        )
        .get(planId) as { last_token: number };
      const lease = PaperRuntimeLeaseSchema.parse({
        schemaVersion: "1.0.0",
        runId,
        planId,
        ownerId,
        fencingToken: tokenRow.last_token,
        status: "active",
        acquiredAt: nowIso,
        heartbeatAt: nowIso,
        expiresAt,
      });
      this.database
        .prepare(
          `INSERT INTO paper_runtime_leases (
             run_id, plan_id, owner_id, fencing_token, status, expires_at, record_json
           ) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        )
        .run(
          runId,
          planId,
          ownerId,
          lease.fencingToken,
          expiresAt,
          JSON.stringify(lease),
        );
      this.database.exec("COMMIT");
      return lease;
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (error instanceof PaperRuntimeActivationError) throw error;
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_LEASE_CONFLICT",
        "Paper Runtime lease could not be acquired.",
        { runId, planId },
      );
    }
  }

  heartbeatLease(
    runId: string,
    ownerId: string,
    fencingToken: number,
    now: Date,
    ttlMs: number,
  ): PaperRuntimeLease {
    const current = this.getLease(runId);
    if (
      current.status !== "active" ||
      current.ownerId !== ownerId ||
      current.fencingToken !== fencingToken ||
      Date.parse(current.expiresAt) <= now.getTime()
    ) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_LEASE_LOST",
        "Paper Runtime fencing lease is missing, expired, or owned by another process.",
        { runId, ownerId, fencingToken: String(fencingToken) },
      );
    }
    const renewed = PaperRuntimeLeaseSchema.parse({
      ...current,
      heartbeatAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    });
    const changed = this.database
      .prepare(
        `UPDATE paper_runtime_leases
         SET expires_at = ?, record_json = ?
         WHERE run_id = ? AND owner_id = ? AND fencing_token = ? AND status = 'active'`,
      )
      .run(
        renewed.expiresAt,
        JSON.stringify(renewed),
        runId,
        ownerId,
        fencingToken,
      );
    if (changed.changes !== 1) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_LEASE_LOST",
        "Paper Runtime lease changed during heartbeat.",
        { runId, ownerId, fencingToken: String(fencingToken) },
      );
    }
    return renewed;
  }

  getLease(runId: string): PaperRuntimeLease {
    const row = this.database
      .prepare("SELECT record_json FROM paper_runtime_leases WHERE run_id = ?")
      .get(runId) as JsonRow | undefined;
    if (!row) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_LEASE_LOST",
        "Paper Runtime lease was not found.",
        { runId },
      );
    }
    return PaperRuntimeLeaseSchema.parse(JSON.parse(row.record_json));
  }

  releaseLease(
    runId: string,
    ownerId: string,
    fencingToken: number,
    status: "released" | "lost" | "orphaned",
    now: Date,
  ): PaperRuntimeLease {
    const current = this.getLease(runId);
    if (
      current.ownerId !== ownerId ||
      current.fencingToken !== fencingToken
    ) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_LEASE_LOST",
        "Only the fenced lease owner may release a Paper Runtime lease.",
        { runId, ownerId, fencingToken: String(fencingToken) },
      );
    }
    const released = PaperRuntimeLeaseSchema.parse({
      ...current,
      status,
      releasedAt: now.toISOString(),
    });
    this.database
      .prepare(
        `UPDATE paper_runtime_leases
         SET status = ?, record_json = ?
         WHERE run_id = ? AND owner_id = ? AND fencing_token = ?`,
      )
      .run(
        status,
        JSON.stringify(released),
        runId,
        ownerId,
        fencingToken,
      );
    return released;
  }

  recoverExpiredLeases(now: Date): readonly PaperRuntimeLease[] {
    const rows = this.database
      .prepare(
        `SELECT record_json FROM paper_runtime_leases
         WHERE status = 'active' AND expires_at <= ?`,
      )
      .all(now.toISOString()) as unknown as JsonRow[];
    return rows.map((row) => {
      const lease = PaperRuntimeLeaseSchema.parse(JSON.parse(row.record_json));
      return this.releaseLease(
        lease.runId,
        lease.ownerId,
        lease.fencingToken,
        "orphaned",
        now,
      );
    });
  }

  findStopByIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimeStopRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT s.record_json
         FROM paper_runtime_stop_idempotency i
         JOIN paper_runtime_stop_records s ON s.stop_id = i.stop_id
         WHERE i.actor_id = ? AND i.idempotency_key = ?`,
      )
      .get(actorId, idempotencyKey) as JsonRow | undefined;
    return row
      ? PaperRuntimeStopRecordSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }

  saveStop(
    record: PaperRuntimeStopRecord,
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimeStopRecord {
    const parsed = PaperRuntimeStopRecordSchema.parse(record);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO paper_runtime_stop_records (
             stop_id, run_id, status, requested_at, record_json
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.stopId,
          parsed.runId,
          parsed.status,
          parsed.requestedAt,
          JSON.stringify(parsed),
        );
      this.database
        .prepare(
          `INSERT INTO paper_runtime_stop_idempotency (
             actor_id, idempotency_key, stop_id
           ) VALUES (?, ?, ?)`,
        )
        .run(actorId, idempotencyKey, parsed.stopId);
      this.database.exec("COMMIT");
      return parsed;
    } catch {
      this.database.exec("ROLLBACK");
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_RUN_CONFLICT",
        "A Paper Runtime stop request is already recorded.",
        { runId: parsed.runId },
      );
    }
  }

  findStop(runId: string): PaperRuntimeStopRecord | undefined {
    const row = this.database
      .prepare(
        "SELECT record_json FROM paper_runtime_stop_records WHERE run_id = ?",
      )
      .get(runId) as JsonRow | undefined;
    return row
      ? PaperRuntimeStopRecordSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }

  markStopDrained(runId: string, now: Date): PaperRuntimeStopRecord {
    const current = this.findStop(runId);
    if (!current) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_STOP_NOT_FOUND",
        "Paper Runtime stop request was not found.",
        { runId },
      );
    }
    const drained = PaperRuntimeStopRecordSchema.parse({
      ...current,
      status: "drained",
      drainedAt: now.toISOString(),
    });
    this.database
      .prepare(
        `UPDATE paper_runtime_stop_records
         SET status = 'drained', record_json = ?
         WHERE run_id = ?`,
      )
      .run(JSON.stringify(drained), runId);
    return drained;
  }
}
