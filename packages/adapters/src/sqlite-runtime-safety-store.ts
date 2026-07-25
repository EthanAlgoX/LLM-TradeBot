import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RuntimeSafetyStateSchema, type RuntimeSafetyState } from "../../contracts/src/index.js";
import type { RuntimeSafetyStore } from "../../core/src/ports.js";

/** Durable, local-only runtime failure/cooldown state. No credentials or prompts are stored. */
export class SQLiteRuntimeSafetyStore implements RuntimeSafetyStore {
  private readonly database: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec("CREATE TABLE IF NOT EXISTS runtime_safety_states (scope TEXT PRIMARY KEY, state_json TEXT NOT NULL);");
  }
  async load(scope: string): Promise<RuntimeSafetyState | undefined> {
    const row = this.database.prepare("SELECT state_json FROM runtime_safety_states WHERE scope = ?").get(scope) as { state_json: string } | undefined;
    return row ? RuntimeSafetyStateSchema.parse(JSON.parse(row.state_json)) : undefined;
  }
  async save(scope: string, state: RuntimeSafetyState): Promise<void> {
    const validated = RuntimeSafetyStateSchema.parse(state);
    this.database.prepare("INSERT INTO runtime_safety_states(scope, state_json) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET state_json = excluded.state_json").run(scope, JSON.stringify(validated));
  }
  close(): void { this.database.close(); }
}
