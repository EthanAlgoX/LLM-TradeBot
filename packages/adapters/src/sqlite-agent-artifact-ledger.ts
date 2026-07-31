import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AgentArtifactQuerySchema, AgentArtifactSchema, type AgentArtifact, type AgentArtifactQuery } from "../../contracts/src/index.js";
import type { ArtifactLedger } from "../../core/src/ports.js";

/** Local append-only evidence store. JSON permits contract evolution without a destructive migration. */
export class SQLiteAgentArtifactLedger implements ArtifactLedger {
  private readonly database: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true }); this.database = new DatabaseSync(path);
    this.database.exec("CREATE TABLE IF NOT EXISTS agent_artifacts (id INTEGER PRIMARY KEY AUTOINCREMENT, trace_id TEXT NOT NULL, symbol TEXT, stage TEXT NOT NULL, order_id TEXT, artifact_json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS agent_artifacts_trace_id_id ON agent_artifacts(trace_id, id);");
    try { this.database.exec("ALTER TABLE agent_artifacts ADD COLUMN order_id TEXT;"); } catch { /* Existing database already has the column. */ }
    try { this.database.exec("ALTER TABLE agent_artifacts ADD COLUMN trade_id TEXT;"); } catch { /* Existing database already has the column. */ }
    this.database.exec("CREATE INDEX IF NOT EXISTS agent_artifacts_order_id ON agent_artifacts(order_id); CREATE INDEX IF NOT EXISTS agent_artifacts_trade_id ON agent_artifacts(trade_id);");
  }
  async append(raw: AgentArtifact): Promise<void> { const value = AgentArtifactSchema.parse(raw); this.database.prepare("INSERT INTO agent_artifacts(trace_id, symbol, stage, order_id, trade_id, artifact_json) VALUES (?, ?, ?, ?, ?, ?)").run(value.traceId, value.symbol ?? null, value.stage, value.orderId ?? null, value.tradeId ?? null, JSON.stringify(value)); }
  async query(raw: AgentArtifactQuery): Promise<readonly AgentArtifact[]> {
    const query = AgentArtifactQuerySchema.parse(raw); const clauses: string[] = []; const values: (string | number)[] = [];
    if (query.traceId) { clauses.push("trace_id = ?"); values.push(query.traceId); }
    if (query.orderId) { clauses.push("order_id = ?"); values.push(query.orderId); }
    if (query.tradeId) { clauses.push("trade_id = ?"); values.push(query.tradeId); }
    if (query.symbol) { clauses.push("symbol = ?"); values.push(query.symbol); }
    if (query.stage) { clauses.push("stage = ?"); values.push(query.stage); }
    values.push(query.limit);
    const rows = this.database.prepare(`SELECT artifact_json FROM agent_artifacts WHERE ${clauses.join(" AND ")} ORDER BY id ASC LIMIT ?`).all(...values) as { artifact_json: string }[];
    return rows.map((row) => AgentArtifactSchema.parse(JSON.parse(row.artifact_json)));
  }
  close(): void { this.database.close(); }
}
