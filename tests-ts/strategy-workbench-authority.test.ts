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
    runtime.strategyWorkbenchService.recommend("actor:one", { ...complete("conversation:two", "turn:second"), message: "make a high return strategy" });
    const conversations = runtime.strategyWorkbenchService.listConversations("actor:one", { limit: 1 });
    assert.equal(conversations.items.length, 1);
    assert.throws(() => runtime.strategyWorkbenchService.listConversations("actor:two", { cursor: conversations.nextCursor, limit: 1 }), /CURSOR_INVALID/);
    const turns = runtime.strategyWorkbenchService.listTurns("actor:one", "conversation:one", { limit: 1 });
    assert.equal(turns.items.length, 1);
    assert.throws(() => runtime.strategyWorkbenchService.listTurns("actor:one", "conversation:other", { cursor: turns.nextCursor, limit: 1 }), /CURSOR_INVALID/);
    assert.throws(() => runtime.strategyWorkbenchService.apply("actor:one", { recommendationId: recommendation.recommendation.recommendationId, fingerprint: recommendation.recommendation.fingerprint, idempotencyKey: "bad key" }));
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

test("legacy provenance-free recommendation does not block same-actor history hydration", async () => {
  const runtime = createCurrentPipelineOrchestrationRuntime({ database: new DatabaseSync(":memory:") });
  try {
    publishCatalog(runtime, "actor:legacy");
    const result = runtime.strategyWorkbenchService.recommend("actor:legacy", complete("conversation:legacy", "turn:legacy"));
    assert.equal(result.kind, "recommendation");
    if (result.kind !== "recommendation") throw new Error("recommendation required");
    const legacy = structuredClone(result.recommendation) as Record<string, unknown>;
    delete legacy.provenance;
    runtime.database.prepare("DELETE FROM strategy_workbench_recommendations WHERE recommendation_id=?").run(result.recommendation.recommendationId);
    runtime.database.prepare("INSERT INTO strategy_workbench_recommendations VALUES (?, ?, ?, ?, ?, ?, ?)").run(result.recommendation.recommendationId, "actor:legacy", "conversation:legacy", result.recommendation.intentId, "test:legacy", JSON.stringify(legacy), result.recommendation.createdAt);

    const history = runtime.strategyWorkbenchService.history("actor:legacy", "conversation:legacy");
    assert.equal(history.length, 1);
    assert.equal((history[0]?.recommendation as { provenance?: unknown }).provenance, undefined);
  } finally { await runtime.close(); }
});

test("catalog retains the newest Published version when a later version is not published", async () => {
  const runtime = createCurrentPipelineOrchestrationRuntime({ database: new DatabaseSync(":memory:") });
  try {
    const created = runtime.agentDefinitionService.create("actor:catalog", "analysis", analysis("analysis"), "create:analysis");
    runtime.agentDefinitionService.transition("actor:catalog", created.definition.definitionId, { versionId: created.version.versionId, fingerprint: created.version.fingerprint, action: "validate" });
    runtime.agentDefinitionService.transition("actor:catalog", created.definition.definitionId, { versionId: created.version.versionId, fingerprint: created.version.fingerprint, action: "publish" });
    const laterDraft = { ...created.version, versionId: "agent-version:catalog-later-draft", versionIndex: 2, parentVersionId: created.version.versionId, fingerprint: "sha256:1111111111111111111111111111111111111111111111111111111111111111", payload: { ...created.version.payload, userInstructionPrompt: "A later draft." } };
    runtime.database.prepare("INSERT INTO agent_versions VALUES (?, ?, ?, ?, ?)").run(laterDraft.versionId, laterDraft.definitionId, laterDraft.versionIndex, laterDraft.fingerprint, JSON.stringify(laterDraft));

    const catalog = runtime.agentDefinitionService.catalog("actor:catalog", "analysis");
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0]?.version.versionId, created.version.versionId);
    assert.equal(catalog[0]?.lifecycle.status, "published");
  } finally { await runtime.close(); }
});

test("all four Published Catalog kinds, fingerprints, actor-bound cursors, and order recover across runtime restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-catalog-recovery-"));
  const databasePath = join(directory, "catalog.sqlite");
  let runtime = createCurrentPipelineOrchestrationRuntime({ databasePath });
  try {
    publishCatalog(runtime, "actor:catalog-recovery");
    const first = runtime.agentDefinitionService.catalog("actor:catalog-recovery");
    assert.deepEqual([...first.map((item) => item.definition.category)].sort(), ["analysis", "decision", "input", "reflection"]);
    const facts = first.map((item) => ({ definitionId: item.definition.definitionId, versionId: item.version.versionId, fingerprint: item.version.fingerprint, status: item.lifecycle.status }));
    assert.ok(facts.every((item) => item.status === "published"));
    const page = runtime.agentDefinitionService.list("actor:catalog-recovery", undefined, 1);
    assert.ok(page.nextCursor);
    assert.throws(() => runtime.agentDefinitionService.list("actor:other", undefined, 1, page.nextCursor), /CURSOR_INVALID/);
    await runtime.close();
    runtime = createCurrentPipelineOrchestrationRuntime({ databasePath });
    assert.deepEqual(runtime.agentDefinitionService.catalog("actor:catalog-recovery").map((item) => ({ definitionId: item.definition.definitionId, versionId: item.version.versionId, fingerprint: item.version.fingerprint, status: item.lifecycle.status })), facts);
    assert.deepEqual(runtime.agentDefinitionService.catalog("actor:other"), []);
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
