import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  ShadowReplayAuditAppendInputSchema,
  ShadowReplayAuditRecordSchema,
  type ShadowReplayAuditAppendInput,
  type ShadowReplayAuditRecord,
} from "../../contracts/src/index.js";
import type { ShadowReplayAuditPort } from "../../core/src/approved-lesson-materialization-service.js";

function fingerprint(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export interface ShadowReplayAuditHistoryPort {
  listBySelectedTradeId(input: { selectedTradeId: string; cursor?: string; limit: number }): Promise<{ records: ShadowReplayAuditRecord[]; nextCursor?: string }>;
}

export class SQLiteShadowReplayAuditRepository implements ShadowReplayAuditPort, ShadowReplayAuditHistoryPort {
  private readonly database: DatabaseSync;
  public constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS shadow_replay_audit_records (
        audit_id TEXT PRIMARY KEY,
        selected_trade_id TEXT NOT NULL,
        version_index INTEGER NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        append_input_json TEXT NOT NULL,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(selected_trade_id, version_index),
        UNIQUE(actor_id, idempotency_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS shadow_replay_audit_trade_idx ON shadow_replay_audit_records(selected_trade_id, version_index DESC);
      CREATE TRIGGER IF NOT EXISTS shadow_replay_audit_no_update BEFORE UPDATE ON shadow_replay_audit_records BEGIN SELECT RAISE(ABORT, 'SHADOW_REPLAY_AUDIT_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS shadow_replay_audit_no_delete BEFORE DELETE ON shadow_replay_audit_records BEGIN SELECT RAISE(ABORT, 'SHADOW_REPLAY_AUDIT_IMMUTABLE'); END;
    `);
  }

  public async append(raw: ShadowReplayAuditAppendInput): Promise<ShadowReplayAuditRecord> {
    const input = ShadowReplayAuditAppendInputSchema.parse(raw);
    const existing = this.database.prepare("SELECT append_input_json, record_json FROM shadow_replay_audit_records WHERE actor_id = ? AND idempotency_key = ?").get(input.actorId, input.idempotencyKey) as { append_input_json: string; record_json: string } | undefined;
    if (existing) {
      if (JSON.stringify(input) !== existing.append_input_json) throw new Error("SHADOW_REPLAY_AUDIT_IDEMPOTENCY_CONFLICT");
      return ShadowReplayAuditRecordSchema.parse(JSON.parse(existing.record_json));
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database.prepare("SELECT COALESCE(MAX(version_index), 0) AS maximum FROM shadow_replay_audit_records WHERE selected_trade_id = ?").get(input.selectedTradeId) as { maximum: number };
      const versionIndex = row.maximum + 1;
      const identity = { input, versionIndex };
      const record = ShadowReplayAuditRecordSchema.parse({
        ...input,
        schemaVersion: "1.0.0",
        id: `shadow-replay-audit:${fingerprint(identity).slice(7, 31)}`,
        versionIndex,
        humanVersion: `1.0.${versionIndex}`,
        fingerprint: fingerprint(identity),
      });
      this.database.prepare("INSERT INTO shadow_replay_audit_records(audit_id, selected_trade_id, version_index, fingerprint, actor_id, idempotency_key, append_input_json, record_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(record.id, record.selectedTradeId, record.versionIndex, record.fingerprint, record.actorId, record.idempotencyKey, JSON.stringify(input), JSON.stringify(record), record.createdAt);
      this.database.exec("COMMIT");
      return record;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  public async listBySelectedTradeId(input: { selectedTradeId: string; cursor?: string; limit: number }) {
    if (!input.selectedTradeId || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20) throw new Error("SHADOW_REPLAY_AUDIT_QUERY_INVALID");
    const before = input.cursor ? this.decodeCursor(input.cursor) : Number.MAX_SAFE_INTEGER;
    const rows = this.database.prepare("SELECT record_json, version_index FROM shadow_replay_audit_records WHERE selected_trade_id = ? AND version_index < ? ORDER BY version_index DESC LIMIT ?").all(input.selectedTradeId, before, input.limit + 1) as Array<{ record_json: string; version_index: number }>;
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      records: page.map((row) => ShadowReplayAuditRecordSchema.parse(JSON.parse(row.record_json))),
      ...(rows.length > input.limit && last ? { nextCursor: Buffer.from(String(last.version_index), "utf8").toString("base64url") } : {}),
    };
  }

  private decodeCursor(cursor: string): number {
    const value = Number(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Number.isInteger(value) || value < 1) throw new Error("SHADOW_REPLAY_AUDIT_CURSOR_INVALID");
    return value;
  }
  public close(): void { this.database.close(); }
}
