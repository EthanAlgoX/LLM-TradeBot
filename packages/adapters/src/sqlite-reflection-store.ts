import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  ReflectionLessonCandidateSchema,
  ReflectionReportSchema,
  type ReflectionLessonCandidate,
  type ReflectionReport,
} from "../../contracts/src/index.js";
import type { ReflectionStore } from "../../core/src/ports.js";

export class SQLiteReflectionStore implements ReflectionStore {
  private readonly database: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec("CREATE TABLE IF NOT EXISTS reflection_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, report_json TEXT NOT NULL, created_at TEXT NOT NULL);");
    this.database.exec("CREATE TABLE IF NOT EXISTS reflection_lesson_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, candidate_id TEXT NOT NULL, candidate_fingerprint TEXT NOT NULL, source_trade_id TEXT NOT NULL, source_reflection_fingerprint TEXT NOT NULL, candidate_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(account_id, candidate_id)); CREATE INDEX IF NOT EXISTS reflection_candidates_trade ON reflection_lesson_candidates(account_id, source_trade_id, id);");
  }
  async save(accountId: string, report: ReflectionReport): Promise<void> {
    const validated = ReflectionReportSchema.parse(report);
    const reportFingerprint = `sha256:${createHash("sha256").update(JSON.stringify(validated)).digest("hex")}`;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("INSERT INTO reflection_reports(account_id, report_json, created_at) VALUES (?, ?, ?)").run(accountId, JSON.stringify(validated), validated.asOf.toISOString());
      for (const candidate of validated.semanticLessonCandidates ?? []) {
        const existing = this.database.prepare("SELECT candidate_fingerprint FROM reflection_lesson_candidates WHERE account_id = ? AND candidate_id = ?").get(accountId, candidate.id) as { candidate_fingerprint: string } | undefined;
        if (existing && existing.candidate_fingerprint !== candidate.fingerprint) {
          throw new Error("REFLECTION_LESSON_CANDIDATE_FINGERPRINT_CONFLICT");
        }
        if (!existing) {
          this.database.prepare("INSERT INTO reflection_lesson_candidates(account_id, candidate_id, candidate_fingerprint, source_trade_id, source_reflection_fingerprint, candidate_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(accountId, candidate.id, candidate.fingerprint, candidate.failedTradeRef.tradeId, reportFingerprint, JSON.stringify(candidate), candidate.createdAt);
        }
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  async latest(accountId: string): Promise<ReflectionReport | undefined> {
    const row = this.database.prepare("SELECT report_json FROM reflection_reports WHERE account_id = ? ORDER BY id DESC LIMIT 1").get(accountId) as { report_json: string } | undefined;
    return row ? ReflectionReportSchema.parse(JSON.parse(row.report_json)) : undefined;
  }
  async getCandidate(accountId: string, candidateId: string): Promise<StoredReflectionLessonCandidate | undefined> {
    const row = this.database.prepare("SELECT candidate_json, source_reflection_fingerprint FROM reflection_lesson_candidates WHERE account_id = ? AND candidate_id = ?").get(accountId, candidateId) as { candidate_json: string; source_reflection_fingerprint: string } | undefined;
    return row ? {
      candidate: ReflectionLessonCandidateSchema.parse(JSON.parse(row.candidate_json)),
      sourceReflectionFingerprint: row.source_reflection_fingerprint as `sha256:${string}`,
    } : undefined;
  }
  async findCandidateBySourceTradeId(accountId: string, sourceTradeId: string): Promise<StoredReflectionLessonCandidate | undefined> {
    const row = this.database.prepare("SELECT candidate_json, source_reflection_fingerprint FROM reflection_lesson_candidates WHERE account_id = ? AND source_trade_id = ? ORDER BY id DESC LIMIT 1").get(accountId, sourceTradeId) as { candidate_json: string; source_reflection_fingerprint: string } | undefined;
    return row ? {
      candidate: ReflectionLessonCandidateSchema.parse(JSON.parse(row.candidate_json)),
      sourceReflectionFingerprint: row.source_reflection_fingerprint as `sha256:${string}`,
    } : undefined;
  }
  close(): void { this.database.close(); }
}

export interface StoredReflectionLessonCandidate {
  candidate: ReflectionLessonCandidate;
  sourceReflectionFingerprint: `sha256:${string}`;
}
