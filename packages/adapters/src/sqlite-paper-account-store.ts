import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PaperAccountStateSchema, SCHEMA_VERSION, type PaperAccountState } from "../../contracts/src/index.js";

/** Small durable store for a paper account; account state is written as one validated snapshot. */
export class SQLitePaperAccountStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS paper_account_states (
        account_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  async load(accountId: string): Promise<PaperAccountState | undefined> {
    const row = this.database.prepare("SELECT state_json FROM paper_account_states WHERE account_id = ?").get(accountId) as { state_json: string } | undefined;
    return row ? PaperAccountStateSchema.parse(JSON.parse(row.state_json)) : undefined;
  }

  async save(accountId: string, state: PaperAccountState): Promise<void> {
    const validated = PaperAccountStateSchema.parse(state);
    this.database.prepare(`
      INSERT INTO paper_account_states(account_id, state_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
    `).run(accountId, JSON.stringify(validated), new Date().toISOString());
  }

  async initialize(accountId: string, initialCash: number): Promise<PaperAccountState> {
    const existing = await this.load(accountId);
    if (existing) return existing;
    const state = PaperAccountStateSchema.parse({ schemaVersion: SCHEMA_VERSION, cash: initialCash, realizedPnl: 0, fees: 0, positions: [], closedTrades: [] });
    await this.save(accountId, state);
    return state;
  }

  close(): void { this.database.close(); }
}
