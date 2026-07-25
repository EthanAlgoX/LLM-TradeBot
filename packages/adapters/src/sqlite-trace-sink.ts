import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { StageEventSchema, type StageEvent } from "../../contracts/src/index.js";
import type { TraceSink } from "../../core/src/ports.js";

/** SQLite-backed append-only trace store for CLI/TUI replay. */
export class SQLiteTraceSink implements TraceSink {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS runtime_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        agent TEXT NOT NULL,
        phase TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runtime_events_trace_id_id ON runtime_events(trace_id, id);
    `);
  }

  async append(rawEvent: StageEvent): Promise<void> {
    const event = StageEventSchema.parse(rawEvent);
    this.database.prepare(
      "INSERT INTO runtime_events(trace_id, stage, agent, phase, occurred_at, event_json) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(event.traceId, event.stage, event.agent, event.phase, event.at.toISOString(), JSON.stringify(event));
  }

  load(traceId: string): StageEvent[] {
    const rows = this.database.prepare("SELECT event_json FROM runtime_events WHERE trace_id = ? ORDER BY id ASC").all(traceId) as { event_json: string }[];
    return rows.map((row) => StageEventSchema.parse(JSON.parse(row.event_json)));
  }

  latestTraceId(): string | undefined {
    const row = this.database.prepare("SELECT trace_id FROM runtime_events ORDER BY id DESC LIMIT 1").get() as { trace_id: string } | undefined;
    return row?.trace_id;
  }

  close(): void {
    this.database.close();
  }
}
