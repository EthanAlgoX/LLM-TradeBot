import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createCurrentPipelineOrchestrationRuntime } from "../packages/runtime/src/index.js";

const input = { name: "Input", templateRef: "agent-template:input:v1", dataRef: "data-source:binance-futures-public:v1", upstreamArtifactSchemaRefs: [], userInstructionPrompt: "Normalize facts.", inputSchemaRef: "schema:market-observation-input:v1", budget: { maxTokens: 1000, maxCalls: 1, timeoutMs: 5000 } };
const analysis = (category: "analysis" | "decision" | "reflection") => ({ name: category, templateRef: `agent-template:${category}:v1`, upstreamArtifactSchemaRefs: ["artifact-schema:structured-observation:v1"], ...(category === "analysis" ? { modelRef: "model-connection:deepseek:default" } : {}), userInstructionPrompt: "Use registered facts only.", inputSchemaRef: "schema:analysis-input:v1", budget: { maxTokens: 1000, maxCalls: 1, timeoutMs: 5000 } });

test("workbench Apply compiles through the existing pipeline validator and creates configuration/pipeline authority drafts", async () => {
  const runtime = createCurrentPipelineOrchestrationRuntime({ database: new DatabaseSync(":memory:") });
  try {
    for (const category of ["input", "analysis", "decision", "reflection"] as const) {
      const created = runtime.agentDefinitionService.create("actor:workbench", category, category === "input" ? input : analysis(category), `create:${category}`);
      runtime.agentDefinitionService.transition("actor:workbench", created.definition.definitionId, { versionId: created.version.versionId, fingerprint: created.version.fingerprint, action: "validate" });
      runtime.agentDefinitionService.transition("actor:workbench", created.definition.definitionId, { versionId: created.version.versionId, fingerprint: created.version.fingerprint, action: "publish" });
    }
    const response = runtime.strategyWorkbenchService.recommend("actor:workbench", { schemaVersion: "1.0.0", conversationId: "conversation:workbench", message: "BTC crypto short medium long horizon trend return with bounded risk", locale: "en", idempotencyKey: "turn:complete" });
    assert.equal(response.kind, "recommendation");
    if (response.kind !== "recommendation") throw new Error("recommendation required");
    const draft = runtime.strategyWorkbenchService.apply("actor:workbench", { recommendationId: response.recommendation.recommendationId, fingerprint: response.recommendation.fingerprint, idempotencyKey: "apply:one" });
    assert.equal(draft.runtimeApplied, false);
    assert.equal(runtime.service.getDraft(draft.pipelineDraftId).runtimeApplied, false);
    assert.equal(runtime.productionStrategyOrchestration.configurationDraftService.get(draft.configurationVersionId).payload.kind, "strategy");
    assert.equal(runtime.strategyWorkbenchService.apply("actor:workbench", { recommendationId: response.recommendation.recommendationId, fingerprint: response.recommendation.fingerprint, idempotencyKey: "apply:two" }).draftId, draft.draftId);
    assert.throws(() => runtime.strategyWorkbenchService.apply("actor:workbench", { recommendationId: response.recommendation.recommendationId, fingerprint: "sha256:0000000000000000000000000000000000000000000000000000000000000000", idempotencyKey: "apply:two" }), /IDEMPOTENCY_CONFLICT/);
    assert.throws(() => runtime.strategyWorkbenchService.recommend("actor:workbench", { schemaVersion: "1.0.0", conversationId: "conversation:workbench", message: "different message", locale: "en", idempotencyKey: "turn:complete" }), /IDEMPOTENCY_CONFLICT/);
  } finally { await runtime.close(); }
});
