import { DatabaseSync } from "node:sqlite";
import {
  PaperRuntimeCycleAuditSchema,
  PaperRuntimeRunSchema,
  type PaperRuntimeCycleAudit,
  type PaperRuntimeRun,
} from "../../contracts/src/index.js";
import {
  PaperRuntimeActivationError,
  type PaperRuntimeRunRepository,
} from "./paper-runtime-activation.js";

interface JsonRow {
  record_json: string;
}

export class SqlitePaperRuntimeRunRepository
  implements PaperRuntimeRunRepository
{
  constructor(private readonly database: DatabaseSync) {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS paper_runtime_runs (
        run_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        status TEXT NOT NULL,
        record_json TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      DROP INDEX IF EXISTS one_active_paper_run_per_plan;
      CREATE UNIQUE INDEX one_active_paper_run_per_plan
      ON paper_runtime_runs(plan_id)
      WHERE status IN ('queued', 'running', 'stop_requested');

      CREATE TABLE IF NOT EXISTS paper_runtime_run_idempotency (
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        run_id TEXT NOT NULL,
        PRIMARY KEY (actor_id, idempotency_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS paper_runtime_cycle_audits (
        run_id TEXT NOT NULL,
        cycle INTEGER NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY (run_id, cycle)
      ) STRICT;
    `);
    this.recoverInterruptedRuns();
  }

  private recoverInterruptedRuns(): void {
    const hasLeaseTable = Boolean(
      this.database
        .prepare(
          "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'paper_runtime_leases'",
        )
        .get(),
    );
    const rows = this.database
      .prepare(
        hasLeaseTable
          ? `
        SELECT r.record_json
        FROM paper_runtime_runs r
        WHERE r.status IN ('queued', 'running', 'stop_requested')
          AND NOT EXISTS (
            SELECT 1
            FROM paper_runtime_leases l
            WHERE l.run_id = r.run_id AND l.status = 'active'
          )
      `
          : `
        SELECT record_json
        FROM paper_runtime_runs
        WHERE status IN ('queued', 'running', 'stop_requested')
      `,
      )
      .all() as unknown as JsonRow[];
    for (const row of rows) {
      const run = PaperRuntimeRunSchema.parse(JSON.parse(row.record_json));
      this.replaceRun(
        PaperRuntimeRunSchema.parse({
          ...run,
          status: "failed",
          failureCode: "PAPER_RUNTIME_RESTART_INTERRUPTED",
          finishedAt: new Date().toISOString(),
        }),
      );
    }
  }

  findByIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimeRun | undefined {
    const row = this.database
      .prepare(`
        SELECT r.record_json
        FROM paper_runtime_run_idempotency i
        JOIN paper_runtime_runs r ON r.run_id = i.run_id
        WHERE i.actor_id = ? AND i.idempotency_key = ?
      `)
      .get(actorId, idempotencyKey) as unknown as JsonRow | undefined;
    return row
      ? PaperRuntimeRunSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }

  findActive(planId: string): PaperRuntimeRun | undefined {
    const row = this.database
      .prepare(`
        SELECT record_json
        FROM paper_runtime_runs
        WHERE plan_id = ? AND status IN ('queued', 'running', 'stop_requested')
      `)
      .get(planId) as unknown as JsonRow | undefined;
    return row
      ? PaperRuntimeRunSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }

  findLatestRun(): PaperRuntimeRun | undefined {
    const row = this.database
      .prepare(`
        SELECT record_json
        FROM paper_runtime_runs
        ORDER BY updated_at DESC, requested_at DESC
        LIMIT 1
      `)
      .get() as unknown as JsonRow | undefined;
    return row
      ? PaperRuntimeRunSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }

  createRun(
    run: PaperRuntimeRun,
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimeRun {
    const parsed = PaperRuntimeRunSchema.parse(run);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
          INSERT INTO paper_runtime_runs (
            run_id, plan_id, status, record_json, requested_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          parsed.runId,
          parsed.planId,
          parsed.status,
          JSON.stringify(parsed),
          parsed.requestedAt,
          parsed.requestedAt,
        );
      this.database
        .prepare(`
          INSERT INTO paper_runtime_run_idempotency (
            actor_id, idempotency_key, run_id
          ) VALUES (?, ?, ?)
        `)
        .run(actorId, idempotencyKey, parsed.runId);
      this.database.exec("COMMIT");
      return parsed;
    } catch {
      this.database.exec("ROLLBACK");
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_RUN_CONFLICT",
        "Paper Runtime run conflicts with an active or idempotent record.",
        { planId: parsed.planId, runId: parsed.runId },
      );
    }
  }

  replaceRun(run: PaperRuntimeRun): PaperRuntimeRun {
    const parsed = PaperRuntimeRunSchema.parse(run);
    const changed = this.database
      .prepare(`
        UPDATE paper_runtime_runs
        SET status = ?, record_json = ?, updated_at = ?
        WHERE run_id = ?
      `)
      .run(
        parsed.status,
        JSON.stringify(parsed),
        new Date().toISOString(),
        parsed.runId,
      );
    if (changed.changes !== 1) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_RUN_NOT_FOUND",
        "Paper Runtime run was not found.",
        { runId: parsed.runId },
      );
    }
    return parsed;
  }

  getRun(runId: string): PaperRuntimeRun {
    const row = this.database
      .prepare(
        "SELECT record_json FROM paper_runtime_runs WHERE run_id = ?",
      )
      .get(runId) as unknown as JsonRow | undefined;
    if (!row) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_RUN_NOT_FOUND",
        "Paper Runtime run was not found.",
        { runId },
      );
    }
    return PaperRuntimeRunSchema.parse(JSON.parse(row.record_json));
  }

  appendCycle(audit: PaperRuntimeCycleAudit): PaperRuntimeCycleAudit {
    const parsed = PaperRuntimeCycleAuditSchema.parse(audit);
    try {
      this.database
        .prepare(`
          INSERT INTO paper_runtime_cycle_audits (
            run_id, cycle, record_json
          ) VALUES (?, ?, ?)
        `)
        .run(parsed.runId, parsed.cycle, JSON.stringify(parsed));
      return parsed;
    } catch {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_RUN_CONFLICT",
        "Paper Runtime cycle audit is immutable.",
        { runId: parsed.runId, cycle: String(parsed.cycle) },
      );
    }
  }

  getCycles(runId: string): readonly PaperRuntimeCycleAudit[] {
    const rows = this.database
      .prepare(`
        SELECT record_json
        FROM paper_runtime_cycle_audits
        WHERE run_id = ?
        ORDER BY cycle ASC
      `)
      .all(runId) as unknown as JsonRow[];
    return rows.map((row) =>
      PaperRuntimeCycleAuditSchema.parse(JSON.parse(row.record_json)),
    );
  }

  markOrphaned(runId: string, now: Date): PaperRuntimeRun {
    const run = this.getRun(runId);
    if (!["queued", "running", "stop_requested"].includes(run.status)) {
      return run;
    }
    return this.replaceRun(
      PaperRuntimeRunSchema.parse({
        ...run,
        status: "orphaned",
        failureCode: "PAPER_RUNTIME_ORPHANED_LEASE",
        finishedAt: now.toISOString(),
      }),
    );
  }
}
