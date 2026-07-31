import { DatabaseSync } from "node:sqlite";

import {
  StrategyEvidenceBindingSchema,
  type StrategyEvidenceBinding,
} from "../../contracts/src/index.js";
import type {
  StrategyEvidenceBindingRepository,
} from "../../core/src/strategy-evidence-approval-service.js";

export class SqliteStrategyEvidenceBindingRepository
  implements StrategyEvidenceBindingRepository
{
  constructor(private readonly database: DatabaseSync) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS strategy_evidence_binding_versions (
        binding_id TEXT NOT NULL,
        version_id TEXT PRIMARY KEY,
        version_index INTEGER NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        actor_id TEXT,
        idempotency_key TEXT,
        UNIQUE(binding_id, version_index),
        UNIQUE(actor_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_strategy_evidence_binding_latest
        ON strategy_evidence_binding_versions(binding_id, version_index DESC);
      CREATE TRIGGER IF NOT EXISTS strategy_evidence_binding_no_update
        BEFORE UPDATE ON strategy_evidence_binding_versions
        BEGIN
          SELECT RAISE(ABORT, 'STRATEGY_EVIDENCE_BINDING_IMMUTABLE');
        END;
      CREATE TRIGGER IF NOT EXISTS strategy_evidence_binding_no_delete
        BEFORE DELETE ON strategy_evidence_binding_versions
        BEGIN
          SELECT RAISE(ABORT, 'STRATEGY_EVIDENCE_BINDING_IMMUTABLE');
        END;
    `);
  }

  save(
    binding: StrategyEvidenceBinding,
    creationIdentity?: { actorId: string; idempotencyKey: string },
  ): StrategyEvidenceBinding {
    const parsed = StrategyEvidenceBindingSchema.parse(binding);
    this.database
      .prepare(`
        INSERT INTO strategy_evidence_binding_versions (
          binding_id, version_id, version_index, fingerprint, payload_json, created_at,
          actor_id, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        parsed.bindingId,
        parsed.versionId,
        parsed.versionIndex,
        parsed.fingerprint,
        JSON.stringify(parsed),
        parsed.updatedAt,
        creationIdentity?.actorId ?? null,
        creationIdentity?.idempotencyKey ?? null,
      );
    return parsed;
  }

  get(bindingId: string): StrategyEvidenceBinding {
    const row = this.database
      .prepare(`
        SELECT payload_json
        FROM strategy_evidence_binding_versions
        WHERE binding_id = ?
        ORDER BY version_index DESC
        LIMIT 1
      `)
      .get(bindingId) as { payload_json: string } | undefined;
    if (!row) {
      throw new Error("STRATEGY_EVIDENCE_BINDING_NOT_FOUND");
    }
    return StrategyEvidenceBindingSchema.parse(JSON.parse(row.payload_json));
  }

  getVersion(versionId: string): StrategyEvidenceBinding {
    const row = this.database
      .prepare(`
        SELECT payload_json
        FROM strategy_evidence_binding_versions
        WHERE version_id = ?
      `)
      .get(versionId) as { payload_json: string } | undefined;
    if (!row) {
      throw new Error("STRATEGY_EVIDENCE_BINDING_NOT_FOUND");
    }
    return StrategyEvidenceBindingSchema.parse(JSON.parse(row.payload_json));
  }

  listVersions(bindingId: string): readonly StrategyEvidenceBinding[] {
    const rows = this.database
      .prepare(`
        SELECT payload_json
        FROM strategy_evidence_binding_versions
        WHERE binding_id = ?
        ORDER BY version_index ASC
      `)
      .all(bindingId) as Array<{ payload_json: string }>;
    return rows.map((row) =>
      StrategyEvidenceBindingSchema.parse(JSON.parse(row.payload_json)),
    );
  }

  findByCreationIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): StrategyEvidenceBinding | undefined {
    const row = this.database
      .prepare(`
        SELECT binding_id
        FROM strategy_evidence_binding_versions
        WHERE actor_id = ? AND idempotency_key = ?
        LIMIT 1
      `)
      .get(actorId, idempotencyKey) as { binding_id: string } | undefined;
    return row ? this.get(row.binding_id) : undefined;
  }

  findLatestByConfigurationVersionId(
    configurationVersionId: string,
  ): StrategyEvidenceBinding | undefined {
    const row = this.database
      .prepare(`
        SELECT payload_json
        FROM strategy_evidence_binding_versions
        WHERE json_extract(payload_json, '$.configurationRef.versionId') = ?
        ORDER BY created_at DESC, version_index DESC
        LIMIT 1
      `)
      .get(configurationVersionId) as { payload_json: string } | undefined;
    return row
      ? StrategyEvidenceBindingSchema.parse(JSON.parse(row.payload_json))
      : undefined;
  }
}
