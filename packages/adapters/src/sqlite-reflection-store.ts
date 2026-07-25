import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ReflectionReportSchema, type ReflectionReport } from "../../contracts/src/index.js";
import type { ReflectionStore } from "../../core/src/ports.js";

export class SQLiteReflectionStore implements ReflectionStore {
  private readonly database: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec("CREATE TABLE IF NOT EXISTS reflection_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, report_json TEXT NOT NULL, created_at TEXT NOT NULL);");
  }
  async save(accountId: string, report: ReflectionReport): Promise<void> {
    const validated = ReflectionReportSchema.parse(report);
    this.database.prepare("INSERT INTO reflection_reports(account_id, report_json, created_at) VALUES (?, ?, ?)").run(accountId, JSON.stringify(validated), validated.asOf.toISOString());
  }
  async latest(accountId: string): Promise<ReflectionReport | undefined> {
    const row = this.database.prepare("SELECT report_json FROM reflection_reports WHERE account_id = ? ORDER BY id DESC LIMIT 1").get(accountId) as { report_json: string } | undefined;
    return row ? ReflectionReportSchema.parse(JSON.parse(row.report_json)) : undefined;
  }
  close(): void { this.database.close(); }
}
