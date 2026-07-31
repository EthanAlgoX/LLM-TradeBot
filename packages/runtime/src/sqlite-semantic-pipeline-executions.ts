import type { DatabaseSync } from "node:sqlite";

import {
  SemanticPipelineExecutionRecordSchema,
  type SemanticPipelineExecutionRecord,
} from "../../contracts/src/index.js";
import type { SemanticPipelineExecutionRepository } from "../../core/src/configurable-semantic-pipeline-execution-service.js";

interface Row { record_json: string }

export class SqliteSemanticPipelineExecutionRepository implements SemanticPipelineExecutionRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS semantic_pipeline_executions (
        execution_id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        configuration_version_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(actor_id, idempotency_key)
      );
      CREATE TRIGGER IF NOT EXISTS semantic_pipeline_execution_update_forbidden
      BEFORE UPDATE ON semantic_pipeline_executions
      BEGIN SELECT RAISE(ABORT, 'SEMANTIC_PIPELINE_EXECUTION_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS semantic_pipeline_execution_delete_forbidden
      BEFORE DELETE ON semantic_pipeline_executions
      BEGIN SELECT RAISE(ABORT, 'SEMANTIC_PIPELINE_EXECUTION_IMMUTABLE'); END;
    `);
  }

  findByIdempotency(actorId: string, idempotencyKey: string): SemanticPipelineExecutionRecord | undefined {
    const row = this.database.prepare(`
      SELECT record_json FROM semantic_pipeline_executions
      WHERE actor_id = ? AND idempotency_key = ?
    `).get(actorId, idempotencyKey) as unknown as Row | undefined;
    return row ? SemanticPipelineExecutionRecordSchema.parse(JSON.parse(row.record_json)) : undefined;
  }

  get(executionId: string): SemanticPipelineExecutionRecord {
    const row = this.database.prepare(`
      SELECT record_json FROM semantic_pipeline_executions WHERE execution_id = ?
    `).get(executionId) as unknown as Row | undefined;
    if (!row) throw new Error(`SEMANTIC_PIPELINE_EXECUTION_NOT_FOUND:${executionId}`);
    return SemanticPipelineExecutionRecordSchema.parse(JSON.parse(row.record_json));
  }

  save(record: SemanticPipelineExecutionRecord): void {
    const parsed = SemanticPipelineExecutionRecordSchema.parse(record);
    this.database.prepare(`
      INSERT INTO semantic_pipeline_executions (
        execution_id, actor_id, idempotency_key, configuration_version_id,
        fingerprint, record_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsed.executionId,
      parsed.actorId,
      parsed.idempotencyKey,
      parsed.configurationRef.id,
      parsed.fingerprint,
      JSON.stringify(parsed),
      parsed.createdAt,
    );
  }
}
