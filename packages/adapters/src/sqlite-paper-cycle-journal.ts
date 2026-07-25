import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PaperCycleRecordSchema, type PaperCycleRecord } from "../../contracts/src/index.js";
import type { PaperCycleJournal } from "../../core/src/ports.js";

export class SQLitePaperCycleJournal implements PaperCycleJournal {
  private readonly database: DatabaseSync;
  constructor(path: string) { mkdirSync(dirname(path), { recursive: true }); this.database = new DatabaseSync(path); this.database.exec("CREATE TABLE IF NOT EXISTS paper_cycle_journal (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, record_json TEXT NOT NULL);"); }
  async append(record: PaperCycleRecord): Promise<void> { const value = PaperCycleRecordSchema.parse(record); this.database.prepare("INSERT INTO paper_cycle_journal(account_id, record_json) VALUES (?, ?)").run(value.accountId, JSON.stringify(value)); }
  async latest(accountId: string, limit = 10): Promise<readonly PaperCycleRecord[]> { const rows = this.database.prepare("SELECT record_json FROM paper_cycle_journal WHERE account_id = ? ORDER BY id DESC LIMIT ?").all(accountId, limit) as { record_json: string }[]; return rows.map((row) => PaperCycleRecordSchema.parse(JSON.parse(row.record_json))); }
  close(): void { this.database.close(); }
}
