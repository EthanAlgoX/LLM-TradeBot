import { DatabaseSync } from "node:sqlite";
import {
  ApprovedPaperPlanSchema,
  PaperActivationRecordSchema,
  PaperRuntimeControlStateSchema,
  type ApprovedPaperPlan,
  type PaperActivationRecord,
  type PaperRuntimeControlState,
} from "../../contracts/src/index.js";
import {
  ApprovedPaperPlanError,
  type ApprovedPaperPlanRepository,
} from "../../core/src/approved-paper-plan-service.js";

interface JsonRow {
  record_json: string;
}

function conflict(
  message: string,
  fields: Readonly<Record<string, string>>,
): ApprovedPaperPlanError {
  return new ApprovedPaperPlanError(
    "PAPER_PLAN_CONFLICT",
    message,
    fields,
  );
}

export class SqliteApprovedPaperPlanRepository
  implements ApprovedPaperPlanRepository
{
  constructor(private readonly database: DatabaseSync) {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS approved_paper_plans (
        plan_id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL UNIQUE,
        fingerprint TEXT NOT NULL UNIQUE,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS approved_paper_plan_idempotency (
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        PRIMARY KEY (actor_id, idempotency_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS paper_activation_audits (
        activation_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL UNIQUE,
        plan_fingerprint TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        activated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS paper_activation_idempotency (
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        activation_id TEXT NOT NULL,
        PRIMARY KEY (actor_id, idempotency_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS paper_runtime_control_audits (
        control_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS paper_runtime_control_idempotency (
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        control_id TEXT NOT NULL,
        PRIMARY KEY (actor_id, idempotency_key)
      ) STRICT;
    `);
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  findPlanByIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): ApprovedPaperPlan | undefined {
    const row = this.database
      .prepare(`
        SELECT p.record_json
        FROM approved_paper_plan_idempotency i
        JOIN approved_paper_plans p ON p.plan_id = i.plan_id
        WHERE i.actor_id = ? AND i.idempotency_key = ?
      `)
      .get(actorId, idempotencyKey) as unknown as JsonRow | undefined;
    return row
      ? ApprovedPaperPlanSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }

  findPlanByDraftId(draftId: string): ApprovedPaperPlan | undefined {
    const row = this.database
      .prepare(
        "SELECT record_json FROM approved_paper_plans WHERE draft_id = ?",
      )
      .get(draftId) as unknown as JsonRow | undefined;
    return row
      ? ApprovedPaperPlanSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }

  savePlan(
    plan: ApprovedPaperPlan,
    actorId: string,
    idempotencyKey: string,
  ): ApprovedPaperPlan {
    const parsed = ApprovedPaperPlanSchema.parse(plan);
    try {
      return this.transaction(() => {
        this.database
          .prepare(`
            INSERT INTO approved_paper_plans (
              plan_id, draft_id, fingerprint, record_json, created_at
            ) VALUES (?, ?, ?, ?, ?)
          `)
          .run(
            parsed.planId,
            parsed.draftId,
            parsed.fingerprint,
            JSON.stringify(parsed),
            parsed.createdAt,
          );
        this.database
          .prepare(`
            INSERT INTO approved_paper_plan_idempotency (
              actor_id, idempotency_key, plan_id
            ) VALUES (?, ?, ?)
          `)
          .run(actorId, idempotencyKey, parsed.planId);
        return parsed;
      });
    } catch {
      const idempotent = this.findPlanByIdempotency(actorId, idempotencyKey);
      if (idempotent?.fingerprint === parsed.fingerprint) {
        return idempotent;
      }
      throw conflict("Approved Paper Plan conflicts with an immutable record.", {
        planId: parsed.planId,
        draftId: parsed.draftId,
      });
    }
  }

  getPlan(planId: string): ApprovedPaperPlan {
    const row = this.database
      .prepare(
        "SELECT record_json FROM approved_paper_plans WHERE plan_id = ?",
      )
      .get(planId) as unknown as JsonRow | undefined;
    if (!row) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_NOT_FOUND",
        "Approved Paper Plan was not found.",
        { planId },
      );
    }
    return ApprovedPaperPlanSchema.parse(JSON.parse(row.record_json));
  }

  findActivationByIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): PaperActivationRecord | undefined {
    const row = this.database
      .prepare(`
        SELECT a.record_json
        FROM paper_activation_idempotency i
        JOIN paper_activation_audits a
          ON a.activation_id = i.activation_id
        WHERE i.actor_id = ? AND i.idempotency_key = ?
      `)
      .get(actorId, idempotencyKey) as unknown as JsonRow | undefined;
    return row
      ? PaperActivationRecordSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }

  findActivationByPlanId(
    planId: string,
  ): PaperActivationRecord | undefined {
    const row = this.database
      .prepare(
        "SELECT record_json FROM paper_activation_audits WHERE plan_id = ?",
      )
      .get(planId) as unknown as JsonRow | undefined;
    return row
      ? PaperActivationRecordSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }

  saveActivation(
    activation: PaperActivationRecord,
    actorId: string,
    idempotencyKey: string,
  ): PaperActivationRecord {
    const parsed = PaperActivationRecordSchema.parse(activation);
    try {
      return this.transaction(() => {
        this.database
          .prepare(`
            INSERT INTO paper_activation_audits (
              activation_id, plan_id, plan_fingerprint, actor_id,
              record_json, activated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `)
          .run(
            parsed.activationId,
            parsed.planId,
            parsed.planFingerprint,
            parsed.actorId,
            JSON.stringify(parsed),
            parsed.activatedAt,
          );
        this.database
          .prepare(`
            INSERT INTO paper_activation_idempotency (
              actor_id, idempotency_key, activation_id
            ) VALUES (?, ?, ?)
          `)
          .run(actorId, idempotencyKey, parsed.activationId);
        return parsed;
      });
    } catch {
      const idempotent = this.findActivationByIdempotency(
        actorId,
        idempotencyKey,
      );
      if (idempotent?.activationId === parsed.activationId) {
        return idempotent;
      }
      throw conflict("Paper Plan activation conflicts with an existing audit.", {
        planId: parsed.planId,
      });
    }
  }

  findControlByIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimeControlState | undefined {
    const row = this.database
      .prepare(`
        SELECT c.record_json
        FROM paper_runtime_control_idempotency i
        JOIN paper_runtime_control_audits c ON c.control_id = i.control_id
        WHERE i.actor_id = ? AND i.idempotency_key = ?
      `)
      .get(actorId, idempotencyKey) as unknown as JsonRow | undefined;
    return row
      ? PaperRuntimeControlStateSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }

  getCurrentControl(
    planId: string,
  ): PaperRuntimeControlState | undefined {
    const row = this.database
      .prepare(`
        SELECT record_json
        FROM paper_runtime_control_audits
        WHERE plan_id = ?
        ORDER BY rowid DESC
        LIMIT 1
      `)
      .get(planId) as unknown as JsonRow | undefined;
    return row
      ? PaperRuntimeControlStateSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }

  saveControl(
    control: PaperRuntimeControlState,
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimeControlState {
    const parsed = PaperRuntimeControlStateSchema.parse(control);
    try {
      return this.transaction(() => {
        this.database
          .prepare(`
            INSERT INTO paper_runtime_control_audits (
              control_id, plan_id, mode, actor_id, record_json, recorded_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `)
          .run(
            parsed.controlId,
            parsed.planId,
            parsed.mode,
            parsed.actorId,
            JSON.stringify(parsed),
            parsed.recordedAt,
          );
        this.database
          .prepare(`
            INSERT INTO paper_runtime_control_idempotency (
              actor_id, idempotency_key, control_id
            ) VALUES (?, ?, ?)
          `)
          .run(actorId, idempotencyKey, parsed.controlId);
        return parsed;
      });
    } catch {
      const idempotent = this.findControlByIdempotency(actorId, idempotencyKey);
      if (idempotent?.controlId === parsed.controlId) {
        return idempotent;
      }
      throw conflict("Runtime control conflicts with an existing audit.", {
        planId: parsed.planId,
      });
    }
  }
}
