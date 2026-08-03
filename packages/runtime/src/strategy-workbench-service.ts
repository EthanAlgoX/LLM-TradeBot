import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { StrategyDraftSchema, StrategyIntentSchema, StrategyRecommendationSchema, StrategyWorkbenchCommandSchema, type AgentCategory } from "../../contracts/src/index.js";
import type { AgentDefinitionService } from "./agent-definition-service.js";
import type { ConversationReplayRepository } from "../../core/src/orchestration-copilot-service.js";

const hash = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const now = () => new Date().toISOString();
const unsafe = /(?:<\/?[a-z]|https?:\/\/|\b(?:select|insert|delete|update)\b|\b(?:javascript|sql|secret|token|password|prompt|tool|runtime|trade|order)\b|[\\/](?:Users|etc|tmp)\b)/iu;
const needs = (message: string, words: readonly string[]) => words.some((word) => message.toLowerCase().includes(word));

export class StrategyWorkbenchError extends Error { constructor(readonly code: string) { super(code); } }

export class StrategyWorkbenchService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly agents: AgentDefinitionService,
    private readonly replay?: ConversationReplayRepository,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS strategy_workbench_intents (intent_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, conversation_id TEXT NOT NULL, turn_id TEXT NOT NULL, intent_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(actor_id, conversation_id, turn_id));
CREATE TABLE IF NOT EXISTS strategy_workbench_recommendations (recommendation_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, conversation_id TEXT NOT NULL, intent_id TEXT NOT NULL, request_fingerprint TEXT NOT NULL, recommendation_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(actor_id, request_fingerprint));
CREATE TABLE IF NOT EXISTS strategy_workbench_drafts (draft_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, recommendation_id TEXT NOT NULL, request_fingerprint TEXT NOT NULL, draft_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(actor_id, recommendation_id));
CREATE TRIGGER IF NOT EXISTS strategy_workbench_intents_no_update BEFORE UPDATE ON strategy_workbench_intents BEGIN SELECT RAISE(ABORT, 'WORKBENCH_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS strategy_workbench_recommendations_no_update BEFORE UPDATE ON strategy_workbench_recommendations BEGIN SELECT RAISE(ABORT, 'WORKBENCH_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS strategy_workbench_drafts_no_update BEFORE UPDATE ON strategy_workbench_drafts BEGIN SELECT RAISE(ABORT, 'WORKBENCH_IMMUTABLE'); END;`);
  }

  recommend(actorId: string, input: unknown) {
    const command = StrategyWorkbenchCommandSchema.parse(input);
    if (unsafe.test(command.message)) throw new StrategyWorkbenchError("UNSAFE_STRATEGY_REQUEST");
    const lower = command.message.toLowerCase();
    const market = needs(lower, ["btc", "crypto", "加密", "比特币"]) ? "crypto" : undefined;
    const horizon = needs(lower, ["短", "中", "长", "5m", "15m", "1h", "周期", "horizon"]) ? "multi-horizon" : undefined;
    const riskPreference = needs(lower, ["风险", "risk", "低风险", "保守"]) ? "bounded" : undefined;
    const objective = needs(lower, ["收益", "return", "趋势", "trend", "目标"]) ? "risk-adjusted-return" : undefined;
    const missing = ([!market && "market", !horizon && "horizon", !objective && "objective", !riskPreference && "riskPreference"].filter(Boolean) as Array<"market" | "horizon" | "objective" | "riskPreference">);
    const intent = StrategyIntentSchema.parse({ intentId: `strategy-intent:${randomUUID()}`, conversationId: command.conversationId, turnId: command.idempotencyKey, market, horizon, objective, riskPreference, known: [market, horizon, objective, riskPreference].filter((x): x is string => Boolean(x)), missingFields: missing, assumptions: [], requiredCapabilities: market ? ["market-bars", "news"] : [], createdAt: now() });
    this.db.prepare("INSERT OR IGNORE INTO strategy_workbench_intents VALUES (?, ?, ?, ?, ?, ?)").run(intent.intentId, actorId, intent.conversationId, intent.turnId, JSON.stringify(intent), intent.createdAt);
    if (missing.length) {
      const result = { kind: "clarification" as const, intent, clarificationQuestions: missing.slice(0, 3).map((field) => ({ market: "交易市场或标的范围是什么？", horizon: "需要短、中、长哪些观察周期？", objective: "目标是趋势、收益还是回撤约束？", riskPreference: "可接受的风险偏好是什么？" })[field]), runtimeApplied: false as const, paperOnly: true as const, exchangeWriteAllowed: false as const };
      this.appendConversationReplay(actorId, command, result);
      return result;
    }
    const existing = this.db.prepare("SELECT recommendation_json FROM strategy_workbench_recommendations WHERE actor_id=? AND request_fingerprint=?").get(actorId, hash(command)) as { recommendation_json: string } | undefined;
    if (existing) return { kind: "recommendation" as const, intent, recommendation: StrategyRecommendationSchema.parse(JSON.parse(existing.recommendation_json)) };
    const pick = (category: AgentCategory) => this.agents.catalog(actorId, category)[0];
    const inputAgent = pick("input"), analysis = pick("analysis"), decision = pick("decision"), reflection = pick("reflection");
    if (!inputAgent || !analysis || !decision || !reflection) throw new StrategyWorkbenchError("PUBLISHED_CATALOG_INSUFFICIENT");
    const snapshot = hash([inputAgent, analysis, decision, reflection].map((x) => [x.version.versionId, x.version.fingerprint]));
    const business = (nodeId: string, label: string, entry: NonNullable<ReturnType<AgentDefinitionService["catalog"]>[number]>) => ({ nodeId, label, category: entry.definition.category, systemOwned: false, agentVersionId: entry.version.versionId, agentFingerprint: entry.version.fingerprint, ...(entry.version.payload.dataRef ? { dataRef: entry.version.payload.dataRef } : {}), ...(entry.version.payload.modelRef ? { modelRef: entry.version.payload.modelRef } : {}) });
    const nodes = [business("node.kline", "K-line input", inputAgent), business("node.news", "Financial news input", inputAgent), business("node.short", "Short horizon analysis", analysis), business("node.medium", "Medium horizon analysis", analysis), business("node.long", "Long horizon analysis", analysis), business("node.sentiment", "News sentiment", analysis), business("node.decision", "Decision", decision), { nodeId: "system.portfolio", label: "Portfolio", category: "portfolio", systemOwned: true }, { nodeId: "system.risk", label: "Risk Gate", category: "risk", systemOwned: true }, { nodeId: "system.paper", label: "Paper Execution · NOT_APPLIED", category: "paper_execution", systemOwned: true }, business("node.reflection", "Reflection", reflection)];
    const edges = [["node.kline","node.short"],["node.kline","node.medium"],["node.kline","node.long"],["node.news","node.sentiment"],["node.short","node.decision"],["node.medium","node.decision"],["node.long","node.decision"],["node.sentiment","node.decision"],["node.decision","system.portfolio"],["system.portfolio","system.risk"],["system.risk","system.paper"],["node.decision","node.reflection"]].map(([sourceNodeId,targetNodeId]) => ({ sourceNodeId, targetNodeId, artifactSchemaRef: "artifact-schema:analysis-assessment:v1" }));
    const candidate = { recommendationId: `strategy-recommendation:${randomUUID()}`, intentId: intent.intentId, conversationId: command.conversationId, createdAt: now(), status: "VALIDATED_RECOMMENDATION" as const, adapter: "DETERMINISTIC_STRUCTURED_ADAPTER" as const, catalogSnapshotFingerprint: snapshot, explanation: "Server-validated recommendation using only the current Published Agent Catalog.", reasons: ["Parallel multi-horizon and news inputs converge before Decision.", "Portfolio, Risk Gate, and Paper Execution are system locked."], assumptions: [], gaps: [], nodes, edges, runtimeApplied: false as const, paperOnly: true as const, exchangeWriteAllowed: false as const };
    const recommendation = StrategyRecommendationSchema.parse({ ...candidate, fingerprint: hash(candidate) });
    this.db.prepare("INSERT INTO strategy_workbench_recommendations VALUES (?, ?, ?, ?, ?, ?, ?)").run(recommendation.recommendationId, actorId, command.conversationId, intent.intentId, hash(command), JSON.stringify(recommendation), recommendation.createdAt);
    const result = { kind: "recommendation" as const, intent, recommendation };
    this.appendConversationReplay(actorId, command, result);
    return result;
  }

  apply(actorId: string, input: unknown) {
    const request = (awaitable: unknown) => awaitable as { recommendationId?: string; fingerprint?: string; idempotencyKey?: string };
    const body = request(input); if (!body || typeof body.recommendationId !== "string" || typeof body.fingerprint !== "string" || typeof body.idempotencyKey !== "string" || Object.keys(body).length !== 3) throw new StrategyWorkbenchError("REQUEST_CONTRACT_INVALID");
    const row = this.db.prepare("SELECT recommendation_json FROM strategy_workbench_recommendations WHERE actor_id=? AND recommendation_id=?").get(actorId, body.recommendationId) as { recommendation_json: string } | undefined;
    if (!row) throw new StrategyWorkbenchError("RECOMMENDATION_NOT_FOUND"); const recommendation = StrategyRecommendationSchema.parse(JSON.parse(row.recommendation_json));
    if (recommendation.fingerprint !== body.fingerprint) throw new StrategyWorkbenchError("STALE_RECOMMENDATION");
    const existing = this.db.prepare("SELECT draft_json FROM strategy_workbench_drafts WHERE actor_id=? AND recommendation_id=?").get(actorId, recommendation.recommendationId) as { draft_json: string } | undefined;
    if (existing) return StrategyDraftSchema.parse(JSON.parse(existing.draft_json));
    for (const node of recommendation.nodes.filter((node) => !node.systemOwned)) { const catalog = this.agents.catalog(actorId); const found = catalog.some((item) => item.version.versionId === node.agentVersionId && item.version.fingerprint === node.agentFingerprint); if (!found) throw new StrategyWorkbenchError("CATALOG_DRIFT"); }
    const candidate = { draftId: `strategy-draft:${randomUUID()}`, versionId: `strategy-draft-version:${randomUUID()}`, recommendationId: recommendation.recommendationId, intentId: recommendation.intentId, createdAt: now(), draftStatus: "NOT_VALIDATED" as const, runtimeApplied: false as const, paperOnly: true as const, exchangeWriteAllowed: false as const };
    const draft = StrategyDraftSchema.parse({ ...candidate, fingerprint: hash(candidate) }); this.db.prepare("INSERT INTO strategy_workbench_drafts VALUES (?, ?, ?, ?, ?, ?)").run(draft.draftId, actorId, recommendation.recommendationId, hash(body), JSON.stringify(draft), draft.createdAt);
    this.replay?.appendDraftReference(actorId, recommendation.conversationId, `workbench-apply:${recommendation.recommendationId}`, { draftId: draft.draftId, versionId: draft.versionId, fingerprint: draft.fingerprint });
    return draft;
  }

  history(actorId: string, conversationId: string) {
    const intents = this.db.prepare("SELECT intent_json, created_at FROM strategy_workbench_intents WHERE actor_id=? AND conversation_id=? ORDER BY created_at ASC, turn_id ASC").all(actorId, conversationId) as Array<{ intent_json: string; created_at: string }>;
    const recommendations = this.db.prepare("SELECT recommendation_json FROM strategy_workbench_recommendations WHERE actor_id=? AND conversation_id=?").all(actorId, conversationId) as Array<{ recommendation_json: string }>;
    const byIntent = new Map(recommendations.map((row) => {
      const recommendation = StrategyRecommendationSchema.parse(JSON.parse(row.recommendation_json));
      const draftRow = this.db.prepare("SELECT draft_json FROM strategy_workbench_drafts WHERE actor_id=? AND recommendation_id=?").get(actorId, recommendation.recommendationId) as { draft_json: string } | undefined;
      return [recommendation.intentId, { recommendation, ...(draftRow ? { draft: StrategyDraftSchema.parse(JSON.parse(draftRow.draft_json)) } : {}) }];
    }));
    return intents.map((row) => ({ intent: StrategyIntentSchema.parse(JSON.parse(row.intent_json)), ...(byIntent.get(StrategyIntentSchema.parse(JSON.parse(row.intent_json)).intentId) ?? {}) }));
  }

  private appendConversationReplay(actorId: string, command: z.infer<typeof StrategyWorkbenchCommandSchema>, result: { kind: "clarification"; intent: z.infer<typeof StrategyIntentSchema>; clarificationQuestions: string[]; runtimeApplied: false; paperOnly: true; exchangeWriteAllowed: false } | { kind: "recommendation"; intent: z.infer<typeof StrategyIntentSchema>; recommendation: z.infer<typeof StrategyRecommendationSchema> }) {
    if (!this.replay) return;
    const createdAt = result.intent.createdAt;
    const fingerprint = hash({ command, result: result.kind });
    this.replay.save({ actorId, conversationId: command.conversationId, idempotencyKey: command.idempotencyKey }, {
      command: { schemaVersion: "1.0.0", message: command.message, locale: command.locale, conversationId: command.conversationId, idempotencyKey: command.idempotencyKey },
      response: {
        schemaVersion: "1.0.0", responseId: `workbench-response:${command.idempotencyKey}`, conversationId: command.conversationId, idempotencyKey: command.idempotencyKey, humanVersion: "1", fingerprint, createdAt, lifecycleStatus: "completed", status: result.kind === "clarification" ? "unavailable" : "proposal",
        assistantMessage: result.kind === "clarification" ? "Clarification required before a strategy recommendation can be created." : "Structured recommendation validated; runtime remains unchanged.",
        context: { schemaVersion: "1.0.0", contextId: `workbench-context:${command.conversationId}`, conversationId: command.conversationId, humanVersion: "1", fingerprint, createdAt, lifecycleStatus: "active", actor: { actorId, roles: ["operator"] }, registry: { marketPackIds: [], dataSourceIds: [], agentTemplateIds: [], presetIds: [], toolIds: [] }, selected: { dataSourceIds: [] } },
        toolCalls: [], toolResults: [], validation: { schemaVersion: "1.0.0", validationId: `workbench-validation:${command.idempotencyKey}`, humanVersion: "1", fingerprint, createdAt, lifecycleStatus: "not_run", valid: false, issues: [], capabilities: [] },
        evidenceGates: { schemaVersion: "1.0.0", summaryId: `workbench-gates:${command.idempotencyKey}`, humanVersion: "1", fingerprint, createdAt, lifecycleStatus: "required", gates: (["contract_validation", "backtest", "walk_forward", "human_approval", "paper_running"] as const).map((gate) => ({ gate, status: gate === "contract_validation" ? "required" as const : "not_applied" as const })), nextGate: "contract_validation" }, runtimeApplied: false,
      },
    });
  }
}
