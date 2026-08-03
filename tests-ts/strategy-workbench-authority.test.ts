import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCurrentPipelineOrchestrationRuntime } from "../packages/runtime/src/index.js";

const input = { name: "Input", templateRef: "agent-template:input:v1", dataRef: "data-source:binance-futures-public:v1", upstreamArtifactSchemaRefs: [], userInstructionPrompt: "Normalize facts.", inputSchemaRef: "schema:market-observation-input:v1", budget: { maxTokens: 1000, maxCalls: 1, timeoutMs: 5000 } };
const analysis = (category: "analysis" | "decision" | "reflection") => ({ name: category, templateRef: `agent-template:${category}:v1`, upstreamArtifactSchemaRefs: ["artifact-schema:structured-observation:v1"], ...(category === "analysis" ? { modelRef: "model-connection:deepseek:default" } : {}), userInstructionPrompt: "Use registered facts only.", inputSchemaRef: "schema:analysis-input:v1", budget: { maxTokens: 1000, maxCalls: 1, timeoutMs: 5000 } });

function publishCatalog(runtime: ReturnType<typeof createCurrentPipelineOrchestrationRuntime>, actorId: string) {
  for (const category of ["input", "analysis", "decision", "reflection"] as const) {
    const created = runtime.agentDefinitionService.create(actorId, category, category === "input" ? input : analysis(category), `create:${category}`);
    runtime.agentDefinitionService.transition(actorId, created.definition.definitionId, { versionId: created.version.versionId, fingerprint: created.version.fingerprint, action: "validate" });
    runtime.agentDefinitionService.transition(actorId, created.definition.definitionId, { versionId: created.version.versionId, fingerprint: created.version.fingerprint, action: "publish" });
  }
}

const complete = (conversationId = "conversation:workbench", key = "turn:complete") => ({ schemaVersion: "1.0.0" as const, conversationId, message: "BTC crypto short medium long horizon trend return with bounded risk", locale: "en" as const, idempotencyKey: key });

test("workbench Apply compiles through the existing pipeline validator and creates configuration/pipeline authority drafts", async () => {
  const runtime = createCurrentPipelineOrchestrationRuntime({ database: new DatabaseSync(":memory:") });
  try {
    publishCatalog(runtime, "actor:workbench");
    const response = runtime.strategyWorkbenchService.recommend("actor:workbench", complete());
    assert.equal(response.kind, "recommendation");
    if (response.kind !== "recommendation") throw new Error("recommendation required");
    assert.deepEqual(response.recommendation.provenance, { provider: "registered", modelConnectionRef: "model-connection:deepseek:default", adapterMode: "DETERMINISTIC_STRUCTURED_ADAPTER", catalogSnapshotFingerprint: response.recommendation.catalogSnapshotFingerprint, generatedAt: response.recommendation.createdAt, fallbackUsed: false });
    const draft = runtime.strategyWorkbenchService.apply("actor:workbench", { recommendationId: response.recommendation.recommendationId, fingerprint: response.recommendation.fingerprint, idempotencyKey: "apply:one" });
    assert.equal(draft.runtimeApplied, false);
    assert.equal(runtime.service.getDraft(draft.pipelineDraftId).runtimeApplied, false);
    assert.equal(runtime.productionStrategyOrchestration.configurationDraftService.get(draft.configurationVersionId).payload.kind, "strategy");
    assert.equal(runtime.strategyWorkbenchService.apply("actor:workbench", { recommendationId: response.recommendation.recommendationId, fingerprint: response.recommendation.fingerprint, idempotencyKey: "apply:two" }).draftId, draft.draftId);
    assert.throws(() => runtime.strategyWorkbenchService.apply("actor:workbench", { recommendationId: response.recommendation.recommendationId, fingerprint: "sha256:0000000000000000000000000000000000000000000000000000000000000000", idempotencyKey: "apply:two" }), /IDEMPOTENCY_CONFLICT/);
    assert.throws(() => runtime.strategyWorkbenchService.recommend("actor:workbench", { schemaVersion: "1.0.0", conversationId: "conversation:workbench", message: "different message", locale: "en", idempotencyKey: "turn:complete" }), /IDEMPOTENCY_CONFLICT/);
  } finally { await runtime.close(); }
});

test("workbench cursor, actor isolation, negative input and durable restart all fail closed or recover authority", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-workbench-"));
  const databasePath = join(directory, "workbench.sqlite");
  let runtime = createCurrentPipelineOrchestrationRuntime({ databasePath });
  try {
    publishCatalog(runtime, "actor:one");
    publishCatalog(runtime, "actor:two");
    const clarification = runtime.strategyWorkbenchService.recommend("actor:one", { schemaVersion: "1.0.0", conversationId: "conversation:one", message: "make a high return strategy", locale: "en", idempotencyKey: "turn:clarify" });
    assert.equal(clarification.kind, "clarification");
    assert.throws(() => runtime.strategyWorkbenchService.recommend("actor:one", { ...complete("conversation:one", "turn:unsafe"), message: "https://bad.example" }), /UNSAFE_STRATEGY_REQUEST/);
    const recommendation = runtime.strategyWorkbenchService.recommend("actor:one", complete("conversation:one", "turn:recommend"));
    assert.equal(recommendation.kind, "recommendation");
    if (recommendation.kind !== "recommendation") throw new Error("recommendation required");
    const draft = runtime.strategyWorkbenchService.apply("actor:one", { recommendationId: recommendation.recommendation.recommendationId, fingerprint: recommendation.recommendation.fingerprint, idempotencyKey: "apply:one" });
    assert.throws(() => runtime.strategyWorkbenchService.apply("actor:two", { recommendationId: recommendation.recommendation.recommendationId, fingerprint: recommendation.recommendation.fingerprint, idempotencyKey: "apply:cross-actor" }), /RECOMMENDATION_NOT_FOUND/);
    const conversations = runtime.strategyWorkbenchService.listConversations("actor:one", { limit: 1 });
    assert.equal(conversations.items.length, 1);
    assert.throws(() => runtime.strategyWorkbenchService.listConversations("actor:two", { cursor: conversations.nextCursor, limit: 1 }), /CURSOR_INVALID/);
    const turns = runtime.strategyWorkbenchService.listTurns("actor:one", "conversation:one", { limit: 1 });
    assert.equal(turns.items.length, 1);
    assert.throws(() => runtime.strategyWorkbenchService.listTurns("actor:one", "conversation:other", { cursor: turns.nextCursor, limit: 1 }), /CURSOR_INVALID/);
    assert.throws(() => runtime.strategyWorkbenchService.apply("actor:one", { recommendationId: recommendation.recommendation.recommendationId, fingerprint: recommendation.recommendation.fingerprint, idempotencyKey: "bad key" }), /REQUEST_CONTRACT_INVALID/);
    assert.equal(draft.runtimeApplied, false);
  } finally { await runtime.close(); }
  runtime = createCurrentPipelineOrchestrationRuntime({ databasePath });
  try {
    const history = runtime.strategyWorkbenchService.history("actor:one", "conversation:one");
    assert.equal(history.length, 2);
    assert.ok(history.some((entry) => entry.draft?.draftStatus === "NOT_VALIDATED"));
    const replay = runtime.strategyWorkbenchService.recommend("actor:one", complete("conversation:one", "turn:recommend"));
    assert.equal(replay.kind, "recommendation");
  } finally { await runtime.close(); rmSync(directory, { recursive: true, force: true }); }
});
