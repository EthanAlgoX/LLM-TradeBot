import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
  SemanticPipelineExecutionCommandSchema,
  type VersionedEntityReference,
} from "../packages/contracts/src/index.js";
import {
  ConfigurableSemanticPipelineService,
  ConfigurationDraftService,
} from "../packages/core/src/index.js";
import {
  ConfigurationDraftHttpHandler,
  LocalBearerAuthenticator,
  SqliteConfigurationDraftRepository,
  createRegisteredConfigurableSemanticPipelineExecution,
} from "../packages/runtime/src/index.js";
import {
  deriveSemanticPipelineExecutionViewState,
  renderSemanticPipelineExecutionSummary,
} from "../apps/web/src/semantic-pipeline-execution-view.js";

const now = () => new Date("2026-07-31T12:00:00.000Z");
const fp = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

function harness(withSnapshot = false) {
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
    now,
  );
  const registry = {
    marketPacks: new Map([["market-pack.configurable", { id: "market-pack.configurable", version: "v1", fingerprint: fp("a") }]]),
    dataSources: new Map([["data-source.registered", { id: "data-source.registered", version: "v1", fingerprint: fp("b"), capabilityIds: ["capability.registered"] }]]),
    capabilities: new Map([["capability.registered", { id: "capability.registered", version: "v1", fingerprint: fp("c"), dataSourceId: "data-source.registered" }]]),
    agentTemplates: new Map([
      ["agent-template.decomposer", { id: "agent-template.decomposer", version: "v1", fingerprint: fp("d") }],
      ["agent-template.analysis", { id: "agent-template.analysis", version: "v1", fingerprint: fp("e") }],
    ]),
  };
  const previews = new ConfigurableSemanticPipelineService(configuration, repository, registry, now);
  const decisionAgentConfigRef: VersionedEntityReference = { id: "agent-config.decision", version: "1.0.0", fingerprint: fp("f") };
  const execution = createRegisteredConfigurableSemanticPipelineExecution({
    database,
    configurations: configuration,
    configurationRepository: repository,
    previews,
    registry,
    now,
    ...(withSnapshot ? {
      snapshots: {
        load: async () => ({
          decisionAgentConfigRef,
          portfolioState: { asOf: now().toISOString(), baseCurrency: "USD", equity: 10_000, availableCash: 9_000, openPositionRefs: [] },
          riskState: { asOf: now().toISOString(), riskProfileId: "risk-profile.paper", newEntriesPaused: false, closeOnly: false, remainingRiskBudget: 100, activeFlags: [] },
          dataQuality: { status: "pass" as const, issueCodes: [] },
        }),
      },
    } : {}),
  });
  return { database, configuration, previews, execution };
}

function createStrategy(configuration: ConfigurationDraftService) {
  const prompt = configuration.create({
    schemaVersion: "1.0.0",
    humanVersion: "v1",
    payload: {
      kind: "prompt_policy",
      agentTemplateId: "agent-template.analysis",
      systemInstructions: "Use registered observations only.",
      decisionRules: ["Do not place orders."],
      parameters: {},
      allowedToolIds: ["tool:market-data:read"],
    },
  }, "actor.operator");
  const agentConfigurationDraftIds = ["agent-template.decomposer", "agent-template.analysis"].map((agentTemplateId) => configuration.create({
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
      agentConfigurationDraftIds,
      promptPolicyDraftIds: [prompt.draftId],
      weights: { analysis: 1 },
      thresholds: { minimumConfidence: 0.6 },
    },
  }, "actor.operator");
}

function previewCommand(configuration: ConfigurationDraftService, previews: ConfigurableSemanticPipelineService) {
  const strategy = createStrategy(configuration);
  const preview = previews.preview({ schemaVersion: "1.0.0", configurationVersionId: strategy.versionId, idempotencyKey: "preview.execution" }, "actor.operator");
  return { strategy, preview, command: { schemaVersion: "1.0.0", configurationVersionId: strategy.versionId, semanticPipelineFingerprint: preview.fingerprint, idempotencyKey: "semantic.execution.one" } as const };
}

test("semantic execution command rejects client facts, runner, code, URL, SQL, path, account, and Runtime injection", () => {
  assert.throws(() => SemanticPipelineExecutionCommandSchema.parse({
    schemaVersion: "1.0.0",
    configurationVersionId: "configuration-version.strategy",
    semanticPipelineFingerprint: fp("a"),
    idempotencyKey: "execution.injected",
    observations: [],
    runner: "dynamic",
    code: "executeOrder()",
    url: "https://attacker.invalid",
    sql: "delete from executions",
    path: "/tmp/module.js",
    exchangeAccount: "live",
    runtimeCycles: 999,
  }));
});

test("registered source and two registered agents persist immutable semantic artifacts idempotently", async () => {
  const { configuration, previews, execution } = harness();
  const { command } = previewCommand(configuration, previews);
  const first = await execution.service.execute(command, "actor.operator");
  const second = await execution.service.execute(command, "actor.operator");
  assert.deepEqual(second, first);
  assert.equal(first.lifecycleStatus, "decision_context_unavailable");
  assert.ok(first.observations.length >= 1);
  assert.ok(first.assessments.length >= 2);
  assert.deepEqual(first.issueCodes, ["DECISION_CONTEXT_SNAPSHOT_UNAVAILABLE"]);
  assert.equal(first.runtimeApplied, false);
  assert.equal(first.exchangeWriteAllowed, false);
});

test("complete server Portfolio Risk and Data Quality snapshots assemble the existing Decision Context", async () => {
  const { configuration, previews, execution } = harness(true);
  const { command } = previewCommand(configuration, previews);
  const result = await execution.service.execute(command, "actor.operator");
  assert.equal(result.lifecycleStatus, "decision_context_ready");
  assert.equal(result.decisionContext?.artifactType, "decision_semantic_context");
  assert.equal(result.nextGate, "historical_semantic_evaluation");
  assert.equal(result.decisionContextApplied, false);
});

test("preview fingerprint drift returns a persisted stale execution without loading facts", async () => {
  const { configuration, previews, execution } = harness();
  const { command } = previewCommand(configuration, previews);
  const stale = await execution.service.execute({ ...command, semanticPipelineFingerprint: fp("9"), idempotencyKey: "semantic.execution.stale" }, "actor.operator");
  assert.equal(stale.lifecycleStatus, "stale");
  assert.equal(stale.observations.length, 0);
  assert.deepEqual(stale.issueCodes, ["SEMANTIC_PIPELINE_FINGERPRINT_STALE"]);
});

test("Bearer HTTP derives actor and rejects executable fields before semantic execution", async () => {
  const { configuration, previews, execution } = harness();
  const { command } = previewCommand(configuration, previews);
  const handler = new ConfigurationDraftHttpHandler(
    configuration,
    new LocalBearerAuthenticator([{ token: "operator-token", actor: { actorId: "actor.operator", displayName: "Operator", roles: ["operator"] } }]),
    undefined,
    previews,
    execution.service,
  );
  const url = "http://localhost/api/orchestration/configuration/semantic-pipeline/execute";
  assert.equal((await handler.handle(new Request(url, { method: "POST", body: "{}" }))).status, 401);
  const rejected = await handler.handle(new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
    body: JSON.stringify({ ...command, actorId: "attacker", module: "./dynamic.js" }),
  }));
  assert.equal(rejected.status, 400);
  const accepted = await handler.handle(new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer operator-token", "content-type": "application/json" },
    body: JSON.stringify({ ...command, idempotencyKey: "semantic.execution.http" }),
  }));
  assert.equal(accepted.status, 201);
  assert.equal((await accepted.json() as { runtimeApplied: boolean }).runtimeApplied, false);
});

test("semantic execution Web summary distinguishes states and escapes stable issue codes", () => {
  assert.equal(deriveSemanticPipelineExecutionViewState({ loading: true }), "loading");
  assert.equal(deriveSemanticPipelineExecutionViewState({ lifecycleStatus: "stale" }), "stale");
  assert.equal(deriveSemanticPipelineExecutionViewState({ unavailable: true }), "unavailable");
  const html = renderSemanticPipelineExecutionSummary({ locale: "zh-CN", lifecycleStatus: "decision_context_unavailable", observationCount: 1, assessmentCount: 2, issueCodes: ["CODE_<unsafe>"] });
  assert.match(html, /注册语义输入执行/u);
  assert.match(html, /CODE_&lt;unsafe&gt;/u);
  assert.match(html, /runtimeApplied=false/u);
});
