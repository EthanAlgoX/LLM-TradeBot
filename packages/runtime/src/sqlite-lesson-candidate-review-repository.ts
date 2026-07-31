import { DatabaseSync } from "node:sqlite";
import {
  LessonCandidateReviewRecordSchema,
  type LessonCandidateReviewRecord,
} from "../../contracts/src/index.js";
import type {
  LessonCandidateReviewHistoryPort,
  LessonCandidateReviewRepository,
} from "../../core/src/comparative-trade-review-service.js";

export class SQLiteLessonCandidateReviewRepository
  implements LessonCandidateReviewRepository, LessonCandidateReviewHistoryPort
{
  private readonly database: DatabaseSync;

  public constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS lesson_candidate_reviews (
        review_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        candidate_id TEXT NOT NULL,
        candidate_fingerprint TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        evidence_fingerprint TEXT NOT NULL,
        lifecycle_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS lesson_candidate_reviews_candidate_idx
        ON lesson_candidate_reviews(candidate_id, created_at);
    `);
  }

  public async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<LessonCandidateReviewRecord | undefined> {
    const row = this.database
      .prepare(
        `SELECT record_json
         FROM lesson_candidate_reviews
         WHERE idempotency_key = ?`,
      )
      .get(idempotencyKey) as { record_json: string } | undefined;
    return row
      ? LessonCandidateReviewRecordSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }

  public async append(recordInput: LessonCandidateReviewRecord): Promise<void> {
    const record = LessonCandidateReviewRecordSchema.parse(recordInput);
    this.database
      .prepare(
        `INSERT INTO lesson_candidate_reviews (
           review_id,
           idempotency_key,
           candidate_id,
           candidate_fingerprint,
           evidence_id,
           evidence_fingerprint,
           lifecycle_status,
           created_at,
           record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.idempotencyKey,
        record.candidateId,
        record.candidateFingerprint,
        record.comparativeEvidenceId,
        record.comparativeEvidenceFingerprint,
        record.lifecycleStatus,
        record.createdAt,
        JSON.stringify(record),
      );
  }

  public async listByCandidateId(input: {
    candidateId: string;
    cursor?: string;
    limit: number;
  }): Promise<{
    records: LessonCandidateReviewRecord[];
    nextCursor?: string;
  }> {
    if (
      !input.candidateId ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 20
    ) {
      throw new Error("LESSON_REVIEW_HISTORY_QUERY_INVALID");
    }
    const cursor = input.cursor
      ? this.decodeCursor(input.cursor)
      : undefined;
    const rows = cursor
      ? this.database.prepare(
          `SELECT review_id, created_at, record_json
           FROM lesson_candidate_reviews
           WHERE candidate_id = ?
             AND (
               created_at < ?
               OR (created_at = ? AND review_id < ?)
             )
           ORDER BY created_at DESC, review_id DESC
           LIMIT ?`,
        ).all(
          input.candidateId,
          cursor.createdAt,
          cursor.createdAt,
          cursor.reviewId,
          input.limit + 1,
        )
      : this.database.prepare(
          `SELECT review_id, created_at, record_json
           FROM lesson_candidate_reviews
           WHERE candidate_id = ?
           ORDER BY created_at DESC, review_id DESC
           LIMIT ?`,
        ).all(input.candidateId, input.limit + 1);
    const page = rows.slice(0, input.limit) as Array<{
      review_id: string;
      created_at: string;
      record_json: string;
    }>;
    const records = page.map((row) =>
      LessonCandidateReviewRecordSchema.parse(JSON.parse(row.record_json)));
    const last = page.at(-1);
    return {
      records,
      ...(rows.length > input.limit && last
        ? {
            nextCursor: Buffer.from(
              JSON.stringify({
                createdAt: last.created_at,
                reviewId: last.review_id,
              }),
              "utf8",
            ).toString("base64url"),
          }
        : {}),
    };
  }

  private decodeCursor(cursor: string): {
    createdAt: string;
    reviewId: string;
  } {
    try {
      const value = JSON.parse(
        Buffer.from(cursor, "base64url").toString("utf8"),
      ) as unknown;
      if (
        !value ||
        typeof value !== "object" ||
        Object.keys(value).length !== 2 ||
        typeof (value as { createdAt?: unknown }).createdAt !== "string" ||
        !Number.isFinite(Date.parse(
          (value as { createdAt: string }).createdAt,
        )) ||
        typeof (value as { reviewId?: unknown }).reviewId !== "string" ||
        !(value as { reviewId: string }).reviewId
      ) {
        throw new Error("invalid");
      }
      return value as { createdAt: string; reviewId: string };
    } catch {
      throw new Error("LESSON_REVIEW_HISTORY_CURSOR_INVALID");
    }
  }

  public close(): void {
    this.database.close();
  }
}
