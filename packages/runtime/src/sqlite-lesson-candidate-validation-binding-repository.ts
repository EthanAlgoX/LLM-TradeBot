import { DatabaseSync } from "node:sqlite";
import {
  LessonCandidateValidationBindingSchema,
  type LessonCandidateValidationBinding,
} from "../../contracts/src/index.js";
import type {
  LessonCandidateValidationBindingRepository,
} from "../../core/src/lesson-candidate-validation-binding-service.js";

interface BindingRow {
  payload_json: string;
}

export class SqliteLessonCandidateValidationBindingRepository
  implements LessonCandidateValidationBindingRepository
{
  public constructor(private readonly database: DatabaseSync) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS lesson_candidate_validation_binding_versions (
        binding_id TEXT NOT NULL,
        version_id TEXT PRIMARY KEY,
        version_index INTEGER NOT NULL,
        parent_fingerprint TEXT,
        fingerprint TEXT NOT NULL UNIQUE,
        review_id TEXT NOT NULL,
        source_trade_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        UNIQUE(binding_id, version_index),
        UNIQUE(actor_id, idempotency_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS lesson_validation_binding_by_review
        ON lesson_candidate_validation_binding_versions(review_id, version_index DESC);
      CREATE TRIGGER IF NOT EXISTS lesson_validation_binding_no_update
        BEFORE UPDATE ON lesson_candidate_validation_binding_versions
        BEGIN
          SELECT RAISE(ABORT, 'LESSON_VALIDATION_BINDING_IMMUTABLE');
        END;
      CREATE TRIGGER IF NOT EXISTS lesson_validation_binding_no_delete
        BEFORE DELETE ON lesson_candidate_validation_binding_versions
        BEGIN
          SELECT RAISE(ABORT, 'LESSON_VALIDATION_BINDING_IMMUTABLE');
        END;
    `);
  }

  public append(
    binding: LessonCandidateValidationBinding,
    identity: { actorId: string; idempotencyKey: string },
  ): void {
    const parsed = LessonCandidateValidationBindingSchema.parse(binding);
    this.database.prepare(`
      INSERT INTO lesson_candidate_validation_binding_versions (
        binding_id, version_id, version_index, parent_fingerprint,
        fingerprint, review_id, source_trade_id, payload_json,
        created_at, actor_id, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsed.bindingId,
      parsed.versionId,
      parsed.versionIndex,
      parsed.parentFingerprint ?? null,
      parsed.fingerprint,
      parsed.reviewRef.id,
      parsed.sourceTradeId,
      JSON.stringify(parsed),
      parsed.createdAt,
      identity.actorId,
      identity.idempotencyKey,
    );
  }

  public findByCreationIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): LessonCandidateValidationBinding | undefined {
    const row = this.database.prepare(`
      SELECT payload_json
      FROM lesson_candidate_validation_binding_versions
      WHERE actor_id = ? AND idempotency_key = ?
      LIMIT 1
    `).get(actorId, idempotencyKey) as unknown as BindingRow | undefined;
    return row ? this.parse(row) : undefined;
  }

  public findLatestByReviewId(
    reviewId: string,
  ): LessonCandidateValidationBinding | undefined {
    const row = this.database.prepare(`
      SELECT payload_json
      FROM lesson_candidate_validation_binding_versions
      WHERE review_id = ?
      ORDER BY version_index DESC
      LIMIT 1
    `).get(reviewId) as unknown as BindingRow | undefined;
    return row ? this.parse(row) : undefined;
  }

  public findLatestBySourceTradeId(
    sourceTradeId: string,
  ): LessonCandidateValidationBinding | undefined {
    const row = this.database.prepare(`
      SELECT payload_json
      FROM lesson_candidate_validation_binding_versions
      WHERE source_trade_id = ?
      ORDER BY created_at DESC, version_index DESC
      LIMIT 1
    `).get(sourceTradeId) as unknown as BindingRow | undefined;
    return row ? this.parse(row) : undefined;
  }

  public get(bindingId: string): LessonCandidateValidationBinding {
    const row = this.database.prepare(`
      SELECT payload_json
      FROM lesson_candidate_validation_binding_versions
      WHERE binding_id = ?
      ORDER BY version_index DESC
      LIMIT 1
    `).get(bindingId) as unknown as BindingRow | undefined;
    if (!row) throw new Error("LESSON_VALIDATION_BINDING_NOT_FOUND");
    return this.parse(row);
  }

  public listVersions(
    bindingId: string,
  ): readonly LessonCandidateValidationBinding[] {
    const rows = this.database.prepare(`
      SELECT payload_json
      FROM lesson_candidate_validation_binding_versions
      WHERE binding_id = ?
      ORDER BY version_index ASC
    `).all(bindingId) as unknown as BindingRow[];
    return rows.map((row) => this.parse(row));
  }

  private parse(row: BindingRow): LessonCandidateValidationBinding {
    return LessonCandidateValidationBindingSchema.parse(
      JSON.parse(row.payload_json),
    );
  }
}
