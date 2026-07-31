import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { deriveSemanticPipelinePreviewViewState } from "../apps/web/src/configurable-semantic-pipeline-view-state.js";
import { SemanticPipelinePreviewCommandSchema } from "../packages/contracts/src/index.js";
import {
  ConfigurableSemanticPipelineError,
  ConfigurableSemanticPipelineService,
  ConfigurationDraftService,
} from "../packages/core/src/index.js";
import {
  ConfigurationDraftHttpHandler,
  LocalBearerAuthenticator,
  SqliteConfigurationDraftRepository,
} from "../packages/runtime/src/index.js";

const fixedNow = () => new Date("2026-07-31T10:00:00.000Z");

function harness() {
  const database = new DatabaseSync(":memory:");
  const repository = new SqliteConfigurationDraftRepository(database);
  const configuration = new ConfigurationDraftService(
    repository,
    { snapshot: () => ({
      marketPackIds: ["market-pack.configurable"],
      dataSourceIds: ["data-source.registered"],
      agentTemplateIds: ["agent-template.decomposer", "agent-template.analysis"],
      allowedToolIds: ["tool:market-data:read"],
    }) },
    {
      pipelineDraftExists: (id) => id === "pipeline-draft.semantic",
      compilePipelineDraft: () => { throw new Error("NOT_USED"); },
    },
    fixedNow,
  );
  const registry = {
    marketPacks: new Map([["market-pack.configurable", { id: "market-pack.configurable", version: "v1", fingerprint: "sha256:" + "a".repeat(64) }]]),
    dataSources: new Map([["data-source.registered", { id: "data-source.registered", version: "v2", fingerprint: "sha256:" + "b".repeat(64), capabilityIds: ["capability.5m"] }]]),
    capabilities: new Map([["capability.5m", { id: "capability.5m", version: "v1", fingerprint: "sha256:" + "c".repeat(64), dataSourceId: "data-source.registered" }]]),
    agentTemplates: new Map([
      ["agent-template.decomposer", { id: "agent-template.decomposer", version: "v1", fingerprint: "sha256:" + "d".repeat(64) }],
      ["agent-template.analysis", { id: "agent-template.analysis", version: "v1", fingerprint: "sha256:" + "e".repeat(64) }],
    ]),
  };
  const service = new ConfigurableSemanticPipelineService(configuration, repository, registry, fixedNow);
  return { configuration, service };
}

function createStrategy(configuration: ConfigurationDraftService) {
  const prompt = configuration.create({
    schemaVersion: "1.0.0",
    humanVersion: "v1",
    payload: {
      kind: "prompt_policy",
      agentTemplateId: "agent-template.analysis",
      systemInstructions: "Analyze registered semantic observations only.",
      decisionRules: ["Never place orders."],
      parameters: {},
      allowedToolIds: ["tool:market-data:read"],
    },
  }, "actor.operator");
  const agentDraftIds = ["agent-template.decomposer", "agent-template.analysis"].map((agentTemplateId) => configuration.create({
    schemaVersion: "1.0.0",
    humanVersion: "v1",
    payload: {
      kind: "agent",
      marketPackId: "market-pack.configurable",
      agentTemplateId,
      dataSourceIds: ["data-source.registered"],
      observationWindows: [{ kind: "bar_interval", unit: "minute", value: 5 }],
      promptPolicyDraftId: prompt.draftId,
      parameters: {},
    },
  }, "actor.operator").draftId);
  return configuration.create({
    schemaVersion: "1.0.0",
    humanVersion: "v1",
    payload: {
      kind: "strategy",
      marketPackId: "market-pack.configurable",
      pipelineDraftId: "pipeline-draft.semantic",
      agentConfigurationDraftIds: agentDraftIds,
      promptPolicyDraftIds: [prompt.draftId],
      weights: { analysis: 1 },
      thresholds: { minimumConfidence: 0.6 },
    },
  }, "actor.operator");
}

test("semantic pipeline command rejects client execution injection", () => {
  assert.throws(() => SemanticPipelinePreviewCommandSchema.parse({
    schemaVersion: "1.0.0",
    configurationVersionId: "configuration-version.strategy",
    idempotencyKey: "preview.one",
    actorId: "attacker",
    runner: "arbitrary",
    code: "executeOrder()",
    url: "https://attacker.invalid",
    sql: "delete from trades",
    runtimeSymbols: ["BTCUSDT"],
  }));
});

test("registered strategy projects a market-agnostic multi-agent semantic topology", () => {
  const { configuration, service } = harness();
  const strategy = createStrategy(configuration);
  const response = service.preview({ schemaVersion: "1.0.0", configurationVersionId: strategy.versionId, idempotencyKey: "preview.semantic.one" }, "actor.operator");
  assert.equal(response.lifecycleStatus, "ready");
  assert.equal(response.agents.length, 2);
  assert.equal(response.agents[0]?.dataSourceRefs[0]?.capabilityRefs[0]?.id, "capability.5m");
  assert.equal(response.agents[0]?.observationWindows[0]?.kind, "bar_interval");
  assert.equal(response.nextGate, "registered_semantic_input_execution");
  assert.equal(response.decisionContextCreated, false);
  assert.equal(response.runtimeApplied, false);
  assert.equal(response.exchangeWriteAllowed, false);
});

test("semantic topology preview is idempotent and conflicts when a key changes scope", () => {
  const { configuration, service } = harness();
  const strategy = createStrategy(configuration);
  const command = { schemaVersion: "1.0.0", configurationVersionId: strategy.versionId, idempotencyKey: "preview.semantic.idempotent" } as const;
  assert.deepEqual(service.preview(command, "actor.operator"), service.preview(command, "actor.operator"));
  assert.throws(
    () => service.preview({ ...command, configurationVersionId: "configuration-version.other" }, "actor.operator"),
    (error) => error instanceof ConfigurableSemanticPipelineError && error.code === "SEMANTIC_PIPELINE_IDEMPOTENCY_CONFLICT",
  );
});

test("semantic pipeline HTTP derives actor and rejects unknown request fields", async () => {
  const { configuration, service } = harness();
  const strategy = createStrategy(configuration);
  const handler = new ConfigurationDraftHttpHandler(
    configuration,
    new LocalBearerAuthenticator([{ token: "operator-token", actor: { actorId: "actor.operator", displayName: "Operator", roles: ["operator"] } }]),
    undefined,
    service,
  );
  const url = "http://localhost/api/orchestration/configuration/semantic-pipeline/preview";
  assert.equal((await handler.handle(new Request(url, { method: "POST", body: "{}" }))).status, 401);
  const injected = await handler.handle(new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: "1.0.0", configurationVersionId: strategy.versionId, idempotencyKey: "preview.http", path: "/tmp/code", executionMode: "live" }),
  }));
  assert.equal(injected.status, 400);
  const accepted = await handler.handle(new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: "1.0.0", configurationVersionId: strategy.versionId, idempotencyKey: "preview.http" }),
  }));
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json() as { runtimeApplied: boolean }).runtimeApplied, false);
});

test("semantic pipeline web state distinguishes loading, validation, execution, and unavailable", () => {
  assert.equal(deriveSemanticPipelinePreviewViewState({ loading: true }), "loading");
  assert.equal(deriveSemanticPipelinePreviewViewState({ lifecycleStatus: "validation_failed" }), "validation_failed");
  assert.equal(deriveSemanticPipelinePreviewViewState({ lifecycleStatus: "ready", nextGate: "registered_semantic_input_execution" }), "execution_required");
  assert.equal(deriveSemanticPipelinePreviewViewState({ unavailable: true }), "unavailable");
});
