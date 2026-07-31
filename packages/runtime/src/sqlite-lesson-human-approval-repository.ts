import { DatabaseSync } from "node:sqlite";

import {
  LessonHumanApprovalResponseSchema,
  type LessonHumanApprovalResponse,
} from "../../contracts/src/index.js";
import type { LessonHumanApprovalRepository } from "../../core/src/lesson-human-approval-service.js";

interface Row { payload_json: string }

export class SQLiteLessonHumanApprovalRepository
  implements LessonHumanApprovalRepository
{
  private readonly database: DatabaseSync;

  public constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS lesson_human_approval_records (
        approval_id TEXT NOT NULL,
        version_id TEXT PRIMARY KEY,
        version_index INTEGER NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        selected_trade_id TEXT NOT NULL UNIQUE,
        lifecycle_status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        UNIQUE(approval_id, version_index),
        UNIQUE(actor_id, idempotency_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS lesson_human_approval_by_trade
        ON lesson_human_approval_records(selected_trade_id, created_at DESC);
      CREATE TRIGGER IF NOT EXISTS lesson_human_approval_no_update
        BEFORE UPDATE ON lesson_human_approval_records
        BEGIN
          SELECT RAISE(ABORT, 'LESSON_HUMAN_APPROVAL_IMMUTABLE');
        END;
      CREATE TRIGGER IF NOT EXISTS lesson_human_approval_no_delete
        BEFORE DELETE ON lesson_human_approval_records
        BEGIN
          SELECT RAISE(ABORT, 'LESSON_HUMAN_APPROVAL_IMMUTABLE');
        END;
    `);
  }

  public append(
    rawResponse: LessonHumanApprovalResponse,
    identity: { actorId: string; idempotencyKey: string },
  ): void {
    const response = LessonHumanApprovalResponseSchema.parse(rawResponse);
    this.database.prepare(`
      INSERT INTO lesson_human_approval_records (
        approval_id, version_id, version_index, fingerprint,
        selected_trade_id, lifecycle_status, payload_json, created_at,
        actor_id, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      response.approval.approvalId,
      response.approval.versionId,
      response.approval.versionIndex,
      response.approval.fingerprint,
      response.approval.selectedTradeId,
      response.approval.lifecycleStatus,
      JSON.stringify(response),
      response.approval.createdAt,
      identity.actorId,
      identity.idempotencyKey,
    );
  }

  public findByIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): LessonHumanApprovalResponse | undefined {
    const row = this.database.prepare(`
      SELECT payload_json FROM lesson_human_approval_records
      WHERE actor_id = ? AND idempotency_key = ? LIMIT 1
    `).get(actorId, idempotencyKey) as unknown as Row | undefined;
    return row ? this.parse(row) : undefined;
  }

  public findLatestBySelectedTradeId(
    selectedTradeId: string,
  ): LessonHumanApprovalResponse | undefined {
    const row = this.database.prepare(`
      SELECT payload_json FROM lesson_human_approval_records
      WHERE selected_trade_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(selectedTradeId) as unknown as Row | undefined;
    return row ? this.parse(row) : undefined;
  }

  public get(approvalId: string): LessonHumanApprovalResponse {
    const row = this.database.prepare(`
      SELECT payload_json FROM lesson_human_approval_records
      WHERE approval_id = ? ORDER BY version_index DESC LIMIT 1
    `).get(approvalId) as unknown as Row | undefined;
    if (!row) throw new Error("LESSON_HUMAN_APPROVAL_NOT_FOUND");
    return this.parse(row);
  }

  public listVersions(approvalId: string): readonly LessonHumanApprovalResponse[] {
    const rows = this.database.prepare(`
      SELECT payload_json FROM lesson_human_approval_records
      WHERE approval_id = ? ORDER BY version_index ASC
    `).all(approvalId) as unknown as Row[];
    return rows.map((row) => this.parse(row));
  }

  public close(): void {
    this.database.close();
  }

  private parse(row: Row): LessonHumanApprovalResponse {
    return LessonHumanApprovalResponseSchema.parse(JSON.parse(row.payload_json));
  }
}
