import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { StrategyDraftSchema, StrategyIntentSchema, StrategyRecommendationSchema, StrategyWorkbenchCommandSchema, type AgentCategory } from "../../contracts/src/index.js";
import type { AgentDefinitionService } from "./agent-definition-service.js";
import type { ConversationReplayRepository } from "../../core/src/orchestration-copilot-service.js";
import type { PipelineOrchestrationService } from "../../core/src/pipeline-orchestration.js";
import type { ConfigurationDraftService } from "../../core/src/configuration-draft-service.js";
import type { PipelineGraphVersion } from "../../contracts/src/index.js";
import { CURRENT_CRYPTO_PIPELINE_GRAPH } from "../../core/src/current-crypto-pipeline-graph.js";

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
    private readonly pipelines?: PipelineOrchestrationService,
    private readonly configurations?: ConfigurationDraftService,
    private readonly validateGraph?: (graph: PipelineGraphVersion) => { valid: boolean },
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS strategy_workbench_intents (intent_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, conversation_id TEXT NOT NULL, turn_id TEXT NOT NULL, intent_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(actor_id, conversation_id, turn_id));
CREATE TABLE IF NOT EXISTS strategy_workbench_recommendations (recommendation_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, conversation_id TEXT NOT NULL, intent_id TEXT NOT NULL, request_fingerprint TEXT NOT NULL, recommendation_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(actor_id, request_fingerprint));
CREATE TABLE IF NOT EXISTS strategy_workbench_drafts (draft_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, recommendation_id TEXT NOT NULL, request_fingerprint TEXT NOT NULL, draft_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(actor_id, recommendation_id));
CREATE TABLE IF NOT EXISTS strategy_workbench_turn_replays (actor_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_fingerprint TEXT NOT NULL, result_json TEXT NOT NULL, PRIMARY KEY(actor_id, idempotency_key));
CREATE TABLE IF NOT EXISTS strategy_workbench_apply_replays (actor_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_fingerprint TEXT NOT NULL, draft_json TEXT NOT NULL, PRIMARY KEY(actor_id, idempotency_key));
CREATE TRIGGER IF NOT EXISTS strategy_workbench_intents_no_update BEFORE UPDATE ON strategy_workbench_intents BEGIN SELECT RAISE(ABORT, 'WORKBENCH_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS strategy_workbench_recommendations_no_update BEFORE UPDATE ON strategy_workbench_recommendations BEGIN SELECT RAISE(ABORT, 'WORKBENCH_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS strategy_workbench_drafts_no_update BEFORE UPDATE ON strategy_workbench_drafts BEGIN SELECT RAISE(ABORT, 'WORKBENCH_IMMUTABLE'); END;`);
  }

  recommend(actorId: string, input: unknown) {
    const command = StrategyWorkbenchCommandSchema.parse(input);
    const commandFingerprint = hash(command);
    const turnReplay = this.db.prepare("SELECT request_fingerprint, result_json FROM strategy_workbench_turn_replays WHERE actor_id=? AND idempotency_key=?").get(actorId, command.idempotencyKey) as { request_fingerprint: string; result_json: string } | undefined;
    if (turnReplay) { if (turnReplay.request_fingerprint !== commandFingerprint) throw new StrategyWorkbenchError("IDEMPOTENCY_CONFLICT"); return JSON.parse(turnReplay.result_json) as never; }
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
      this.saveTurnReplay(actorId, command, commandFingerprint, result);
      return result;
    }
    const existing = this.db.prepare("SELECT recommendation_json FROM strategy_workbench_recommendations WHERE actor_id=? AND request_fingerprint=?").get(actorId, hash(command)) as { recommendation_json: string } | undefined;
    if (existing) { const result = { kind: "recommendation" as const, intent, recommendation: StrategyRecommendationSchema.parse(JSON.parse(existing.recommendation_json)) }; this.saveTurnReplay(actorId, command, commandFingerprint, result); return result; }
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
    this.saveTurnReplay(actorId, command, commandFingerprint, result);
    return result;
  }

  apply(actorId: string, input: unknown) {
    const request = (awaitable: unknown) => awaitable as { recommendationId?: string; fingerprint?: string; idempotencyKey?: string };
    const body = request(input); if (!body || typeof body.recommendationId !== "string" || typeof body.fingerprint !== "string" || typeof body.idempotencyKey !== "string" || Object.keys(body).length !== 3) throw new StrategyWorkbenchError("REQUEST_CONTRACT_INVALID");
    const requestFingerprint = hash(body);
    const applyReplay = this.db.prepare("SELECT request_fingerprint, draft_json FROM strategy_workbench_apply_replays WHERE actor_id=? AND idempotency_key=?").get(actorId, body.idempotencyKey) as { request_fingerprint: string; draft_json: string } | undefined;
    if (applyReplay) { if (applyReplay.request_fingerprint !== requestFingerprint) throw new StrategyWorkbenchError("IDEMPOTENCY_CONFLICT"); return StrategyDraftSchema.parse(JSON.parse(applyReplay.draft_json)); }
    const row = this.db.prepare("SELECT recommendation_json FROM strategy_workbench_recommendations WHERE actor_id=? AND recommendation_id=?").get(actorId, body.recommendationId) as { recommendation_json: string } | undefined;
    if (!row) throw new StrategyWorkbenchError("RECOMMENDATION_NOT_FOUND"); const recommendation = StrategyRecommendationSchema.parse(JSON.parse(row.recommendation_json));
    if (recommendation.fingerprint !== body.fingerprint) throw new StrategyWorkbenchError("STALE_RECOMMENDATION");
    const existing = this.db.prepare("SELECT draft_json FROM strategy_workbench_drafts WHERE actor_id=? AND recommendation_id=?").get(actorId, recommendation.recommendationId) as { draft_json: string } | undefined;
    if (existing) { const draft = StrategyDraftSchema.parse(JSON.parse(existing.draft_json)); this.saveApplyReplay(actorId, body.idempotencyKey, requestFingerprint, draft); return draft; }
    for (const node of recommendation.nodes.filter((node) => !node.systemOwned)) { const catalog = this.agents.catalog(actorId); const found = catalog.some((item) => item.version.versionId === node.agentVersionId && item.version.fingerprint === node.agentFingerprint); if (!found) throw new StrategyWorkbenchError("CATALOG_DRIFT"); }
    if (!this.pipelines || !this.configurations) throw new StrategyWorkbenchError("DRAFT_AUTHORITY_UNAVAILABLE");
    // Compile the recommendation to the pre-existing typed pipeline graph and
    // run its validator before either authoritative draft is persisted.
    const graph = this.compileRecommendation(recommendation);
    const prePersistenceValidation = this.validateGraph?.(graph);
    if (!prePersistenceValidation?.valid) throw new StrategyWorkbenchError(`RECOMMENDATION_GRAPH_INVALID:${(prePersistenceValidation as { issues?: Array<{ code?: string }> } | undefined)?.issues?.map((issue) => issue.code).join(",") ?? "VALIDATOR_UNAVAILABLE"}`);
    // createDraft is the existing pipeline-draft authority. Its repository
    // stores immutable graph snapshots, so this is the only graph persistence.
    const pipelineDraft = this.pipelines.createDraft(graph);
    const pipelineValidation = this.pipelines.validateDraft(pipelineDraft.draftId);
    if (!pipelineValidation.valid) throw new StrategyWorkbenchError("RECOMMENDATION_GRAPH_INVALID");
    const configuration = this.configurations.create({ schemaVersion: "1.0.0", humanVersion: "workbench-apply-v1", payload: { kind: "strategy", marketPackId: graph.marketPackRef, pipelineDraftId: pipelineDraft.draftId, agentConfigurationDraftIds: recommendation.nodes.filter((node) => !node.systemOwned).map((node) => node.agentVersionId!).slice(0, 20), promptPolicyDraftIds: [], weights: {}, thresholds: {} } }, actorId);
    const candidate = { draftId: configuration.draftId, versionId: configuration.versionId, fingerprint: configuration.fingerprint, recommendationId: recommendation.recommendationId, intentId: recommendation.intentId, pipelineDraftId: pipelineDraft.draftId, pipelineFingerprint: pipelineDraft.contentFingerprint, configurationDraftId: configuration.draftId, configurationVersionId: configuration.versionId, createdAt: configuration.createdAt, draftStatus: "NOT_VALIDATED" as const, runtimeApplied: false as const, paperOnly: true as const, exchangeWriteAllowed: false as const };
    const draft = StrategyDraftSchema.parse(candidate); this.db.prepare("INSERT INTO strategy_workbench_drafts VALUES (?, ?, ?, ?, ?, ?)").run(draft.draftId, actorId, recommendation.recommendationId, hash(body), JSON.stringify(draft), draft.createdAt);
    this.replay?.appendDraftReference(actorId, recommendation.conversationId, `workbench-apply:${recommendation.recommendationId}`, { draftId: draft.draftId, versionId: draft.versionId, fingerprint: draft.fingerprint });
    this.saveApplyReplay(actorId, body.idempotencyKey, requestFingerprint, draft);
    return draft;
  }

  private saveTurnReplay(actorId: string, command: z.infer<typeof StrategyWorkbenchCommandSchema>, requestFingerprint: string, result: unknown) {
    this.db.prepare("INSERT INTO strategy_workbench_turn_replays VALUES (?, ?, ?, ?)").run(actorId, command.idempotencyKey, requestFingerprint, JSON.stringify(result));
  }

  private saveApplyReplay(actorId: string, idempotencyKey: string, requestFingerprint: string, draft: z.infer<typeof StrategyDraftSchema>) {
    this.db.prepare("INSERT INTO strategy_workbench_apply_replays VALUES (?, ?, ?, ?)").run(actorId, idempotencyKey, requestFingerprint, JSON.stringify(draft));
  }

  /**
   * This is deliberately a compiler, not a second graph validator. Published
   * Agent Center versions stay as the recommendation authority; the compiled
   * graph maps their allowed categories onto the existing registered runtime
   * contracts solely so the established validator checks ports, schemas,
   * capabilities, topology and the locked execution boundary.
   */
  private compileRecommendation(recommendation: z.infer<typeof StrategyRecommendationSchema>): PipelineGraphVersion {
    const configFor = (node: z.infer<typeof StrategyRecommendationSchema>["nodes"][number]) => ({ input: "agent-config:data-sync:v1", analysis: "agent-config:analysis:v1", decision: "agent-config:decision:v1", reflection: "agent-config:reflection:v1", portfolio: "agent-config:portfolio:v1", risk: "agent-config:risk:v1", paper_execution: "agent-config:execution:v1" } as Record<string, string>)[node.category];
    if (recommendation.nodes.some((node) => !configFor(node))) throw new StrategyWorkbenchError("RECOMMENDATION_CATEGORY_INVALID");
    const nodes = [
      { nodeId: "system.selector", displayName: "System selector", agentConfigId: "agent-config:selector:v1", required: true, failurePolicy: { mode: "required" as const, onFailure: "block_openings" as const } },
      { nodeId: "system.bull-case", displayName: "System bull case", agentConfigId: "agent-config:bull-case:v1", required: true, failurePolicy: { mode: "required" as const, onFailure: "block_openings" as const } },
      { nodeId: "system.bear-case", displayName: "System bear case", agentConfigId: "agent-config:bear-case:v1", required: true, failurePolicy: { mode: "required" as const, onFailure: "block_openings" as const } },
      ...recommendation.nodes.filter((node) => node.category !== "reflection").map((node) => ({ nodeId: node.nodeId, displayName: node.label, agentConfigId: configFor(node)!, required: true, failurePolicy: { mode: "required" as const, onFailure: "block_openings" as const } })),
      ...recommendation.nodes.filter((node) => node.category === "reflection").map((node) => ({ nodeId: node.nodeId, displayName: node.label, agentConfigId: configFor(node)!, required: false, failurePolicy: { mode: "optional" as const, onFailure: "continue_degraded" as const } })),
    ];
    const byCategory = (category: string) => recommendation.nodes.filter((node) => node.category === category);
    const inputs = byCategory("input"), analyses = byCategory("analysis"), decision = byCategory("decision")[0], portfolio = byCategory("portfolio")[0], risk = byCategory("risk")[0], paper = byCategory("paper_execution")[0], reflection = byCategory("reflection")[0];
    if (!inputs.length || !analyses.length || !decision || !portfolio || !risk || !paper || !reflection) throw new StrategyWorkbenchError("RECOMMENDATION_TOPOLOGY_INVALID");
    const edges = [
      ...inputs.flatMap((node) => [{ fromNodeId: "system.selector", fromPort: "universe", toNodeId: node.nodeId, toPort: "universe" }, { fromNodeId: node.nodeId, fromPort: "snapshot", toNodeId: analyses[0]!.nodeId, toPort: "snapshot" }]),
      ...analyses.slice(1).flatMap((node, index) => [{ fromNodeId: inputs[index % inputs.length]!.nodeId, fromPort: "snapshot", toNodeId: node.nodeId, toPort: "snapshot" }]),
      ...analyses.map((node) => ({ fromNodeId: node.nodeId, fromPort: "analysis", toNodeId: decision.nodeId, toPort: "analysis" })),
      { fromNodeId: inputs[0]!.nodeId, fromPort: "snapshot", toNodeId: decision.nodeId, toPort: "snapshot" },
      { fromNodeId: analyses[0]!.nodeId, fromPort: "analysis", toNodeId: "system.bull-case", toPort: "analysis" },
      { fromNodeId: analyses[0]!.nodeId, fromPort: "analysis", toNodeId: "system.bear-case", toPort: "analysis" },
      { fromNodeId: "system.bull-case", fromPort: "case", toNodeId: decision.nodeId, toPort: "bull_case" },
      { fromNodeId: "system.bear-case", fromPort: "case", toNodeId: decision.nodeId, toPort: "bear_case" },
      { fromNodeId: decision.nodeId, fromPort: "decision", toNodeId: portfolio.nodeId, toPort: "proposals" },
      { fromNodeId: portfolio.nodeId, fromPort: "decision", toNodeId: risk.nodeId, toPort: "decision" },
      { fromNodeId: portfolio.nodeId, fromPort: "decision", toNodeId: paper.nodeId, toPort: "decision" },
      { fromNodeId: risk.nodeId, fromPort: "risk", toNodeId: paper.nodeId, toPort: "risk" },
      { fromNodeId: paper.nodeId, fromPort: "result", toNodeId: reflection.nodeId, toPort: "execution", kind: "post_process" as const },
    ].map((edge, index) => ({ edgeId: `workbench-edge:${index}`, kind: "data" as const, required: true, ...edge }));
    return { ...CURRENT_CRYPTO_PIPELINE_GRAPH, pipelineGraphId: `pipeline-graph:workbench:${recommendation.recommendationId}`, name: "Workbench compiled recommendation", humanReadableVersion: "1.0.0", fingerprint: hash(recommendation), createdAt: new Date(recommendation.createdAt), nodes, edges, entryNodeIds: ["system.selector"], terminalNodeIds: [paper.nodeId, reflection.nodeId] };
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
