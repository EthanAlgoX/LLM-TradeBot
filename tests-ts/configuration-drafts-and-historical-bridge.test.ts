import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { z } from "zod";

import type {
  AgentTemplate,
  HistoricalGraphExecutionPlan,
  PipelineGraphVersion,
} from "../packages/contracts/src/index.js";
import {
  ConfigurationDraftError,
  ConfigurationDraftService,
  ImmutablePipelineRegistry,
  PipelineGraphCompiler,
  PipelineGraphHistoricalBridge,
  PipelineGraphHistoricalBridgeError,
  RegisteredHistoricalArtifactSchemaRegistry,
  RegisteredHistoricalGraphPlanRegistry,
  RegisteredHistoricalNodeExecutorRegistry,
} from "../packages/core/src/index.js";
import { validatePipelineGraph } from "../packages/core/src/pipeline-graph-validator.js";
import {
  ConfigurationDraftHttpHandler,
  LocalBearerAuthenticator,
  SqliteConfigurationDraftRepository,
} from "../packages/runtime/src/index.js";
import {
  dailySingleWindowFixture,
  eventOnlyFixture,
  nativeThreeWindowFixture,
} from "./fixtures/pipeline-graph-fixtures.js";

const fixedNow = () => new Date("2026-07-26T08:00:00.000Z");

const historicalPlanStub = {
  schemaVersion: "1.0.0",
  planId: "historical-plan.configuration-test",
  version: "v1",
  fingerprint: "a".repeat(64),
  lifecycleStatus: "registered",
  createdAt: fixedNow().toISOString(),
  presetRef: {
    id: "pipeline-draft.current",
    version: "v1",
    fingerprint: "b".repeat(64),
  },
  compiledGraphRef: {
    id: "pipeline-graph.current",
    version: "v1",
    fingerprint: "c".repeat(64),
  },
  executionMode: "research_only",
  marketPackRef: {
    id: "market-pack.crypto",
    version: "v1",
    fingerprint: "d".repeat(64),
  },
  requiredCapabilityKinds: ["event"],
  nodes: [
    {
      index: 0,
      nodeId: "node.research",
      role: "research_synthesis",
      executorId: "executor.research",
      authority: "none",
      observationWindowIds: [],
      predecessorNodeIds: [],
      successorNodeIds: [],
      inputBindings: [],
      outputArtifactTypes: ["artifact.research"],
    },
  ],
  runtimeApplied: false,
} as HistoricalGraphExecutionPlan;

function createConfigurationHarness() {
  const database = new DatabaseSync(":memory:");
  const repository = new SqliteConfigurationDraftRepository(database);
  const service = new ConfigurationDraftService(
    repository,
    {
      snapshot: () => ({
        marketPackIds: ["market-pack.crypto"],
        dataSourceIds: ["data-source.csv-historical"],
        agentTemplateIds: ["agent-template.analysis"],
        allowedToolIds: ["tool.market-data"],
      }),
    },
    {
      pipelineDraftExists: (pipelineDraftId) => pipelineDraftId === "pipeline-draft.current",
      compilePipelineDraft: () => historicalPlanStub,
    },
    fixedNow,
  );
  return { database, repository, service };
}

function createPromptPolicy(service: ConfigurationDraftService) {
  return service.create(
    {
      schemaVersion: "1.0.0",
      humanVersion: "v1",
      payload: {
        kind: "prompt_policy",
        agentTemplateId: "agent-template.analysis",
        systemInstructions: "Analyze only registered market evidence and return a semantic assessment.",
        decisionRules: ["Do not place orders.", "Cite the observation window."],
        parameters: { temperature: 0.2 },
        allowedToolIds: ["tool.market-data"],
      },
    },
    "actor.operator",
  );
}

function createAgentConfiguration(service: ConfigurationDraftService, promptPolicyDraftId: string) {
  return service.create(
    {
      schemaVersion: "1.0.0",
      humanVersion: "v1",
      payload: {
        kind: "agent",
        marketPackId: "market-pack.crypto",
        agentTemplateId: "agent-template.analysis",
        dataSourceIds: ["data-source.csv-historical"],
        observationWindows: [{ kind: "bar_interval", unit: "day", value: 1 }],
        promptPolicyDraftId,
        parameters: { confidenceFloor: 0.55 },
      },
    },
    "actor.operator",
  );
}

function createStrategy(
  service: ConfigurationDraftService,
  agentConfigurationDraftId: string,
  promptPolicyDraftId: string,
) {
  return service.create(
    {
      schemaVersion: "1.0.0",
      humanVersion: "v1",
      payload: {
        kind: "strategy",
        marketPackId: "market-pack.crypto",
        pipelineDraftId: "pipeline-draft.current",
        agentConfigurationDraftIds: [agentConfigurationDraftId],
        promptPolicyDraftIds: [promptPolicyDraftId],
        weights: { analysis: 1 },
        thresholds: { minimumConfidence: 0.6 },
      },
    },
    "actor.operator",
  );
}

test("configuration drafts remain immutable and stale prior evidence after a strategy change", () => {
  const { service } = createConfigurationHarness();
  const prompt = createPromptPolicy(service);
  const agent = createAgentConfiguration(service, prompt.draftId);
  const strategy = createStrategy(service, agent.draftId, prompt.draftId);

  assert.equal(service.validate(strategy.versionId).valid, true);
  assert.equal(service.compileHistorical(strategy.versionId).runtimeApplied, false);

  const evidenced = service.recordEvidence(
    strategy.versionId,
    "evidence.backtest.configuration-test",
    "actor.operator",
  );
  assert.equal(evidenced.evidenceState.status, "current");

  const changed = service.createVersion(
    strategy.draftId,
    {
      schemaVersion: "1.0.0",
      parentFingerprint: evidenced.fingerprint,
      humanVersion: "v2",
      payload: {
        ...evidenced.payload,
        thresholds: { minimumConfidence: 0.7 },
      },
    },
    "actor.operator",
  );

  assert.equal(changed.versionIndex, evidenced.versionIndex + 1);
  assert.equal(changed.evidenceState.status, "stale");
  assert.equal(changed.evidenceState.staleReason, "configuration_changed");
  assert.deepEqual(service.get(evidenced.versionId).evidenceState.evidenceRefs, [
    "evidence.backtest.configuration-test",
  ]);
  assert.throws(
    () =>
      service.createVersion(
        strategy.draftId,
        {
          schemaVersion: "1.0.0",
          parentFingerprint: strategy.fingerprint,
          humanVersion: "v3",
          payload: changed.payload,
        },
        "actor.operator",
      ),
    (error) =>
      error instanceof ConfigurationDraftError && error.code === "CONFIGURATION_PARENT_CONFLICT",
  );
});

test("configuration validation reports catalog references and strict schemas reject code injection", () => {
  const { service } = createConfigurationHarness();
  const invalidMarket = service.create(
    {
      schemaVersion: "1.0.0",
      humanVersion: "v1",
      payload: {
        kind: "market",
        marketPackId: "market-pack.missing",
        dataSourceIds: ["data-source.missing"],
        observationWindows: [{ kind: "bar_interval", unit: "day", value: 1 }],
        timezone: "UTC",
        tradingCalendarRef: "calendar.24x7",
      },
    },
    "actor.operator",
  );
  const result = service.validate(invalidMarket.versionId);
  assert.equal(result.valid, false);
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set(["MARKET_PACK_NOT_REGISTERED", "DATA_SOURCE_NOT_REGISTERED"]),
  );

  assert.throws(() =>
    service.create(
      {
        schemaVersion: "1.0.0",
        humanVersion: "v1",
        actor: "attacker",
        payload: {
          kind: "prompt_policy",
          agentTemplateId: "agent-template.analysis",
          systemInstructions: "Attempt an unregistered implementation.",
          decisionRules: [],
          parameters: {},
          allowedToolIds: [],
          provider: "dynamic",
          module: "./arbitrary.js",
          code: "executeOrder()",
        },
      },
      "actor.operator",
    ),
  );
});

test("configuration HTTP handler derives the actor from Bearer auth and rejects injected fields", async () => {
  const { service } = createConfigurationHarness();
  const handler = new ConfigurationDraftHttpHandler(
    service,
    new LocalBearerAuthenticator([
      {
        token: "operator-token",
        actor: {
          actorId: "actor.operator",
          displayName: "Test Operator",
          roles: ["operator"],
        },
      },
    ]),
  );

  const unauthorized = await handler.handle(
    new Request("http://localhost/api/orchestration/configuration/catalog"),
  );
  assert.equal(unauthorized.status, 401);

  const catalog = await handler.handle(
    new Request("http://localhost/api/orchestration/configuration/catalog", {
      headers: { authorization: "Bearer operator-token" },
    }),
  );
  assert.equal(catalog.status, 200);

  const injected = await handler.handle(
    new Request("http://localhost/api/orchestration/configuration/drafts", {
      method: "POST",
      headers: {
        authorization: "Bearer operator-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        schemaVersion: "1.0.0",
        humanVersion: "v1",
        actorId: "actor.attacker",
        runtimeApplied: true,
        payload: {
          kind: "market",
          marketPackId: "market-pack.crypto",
          dataSourceIds: ["data-source.csv-historical"],
          observationWindows: [{ kind: "bar_interval", unit: "day", value: 1 }],
          timezone: "UTC",
          tradingCalendarRef: "calendar.24x7",
        },
      }),
    }),
  );
  assert.equal(injected.status, 400);
});

const historicalRoleByTemplateRole: Record<string, string> = {
  selector: "selector",
  data_sync: "data_sync",
  data_quality: "data_quality",
  processing: "data_quality",
  analysis: "window_analysis",
  context: "research_synthesis",
  bull_case: "bull_research",
  bear_case: "bear_research",
  decision: "decision",
  portfolio: "portfolio",
  risk: "risk",
  execution: "execution",
  position_monitor: "position_monitor",
  reflection: "reflection",
};

function topologicalSteps(graph: PipelineGraphVersion) {
  const predecessorIds = new Map(graph.nodes.map((node) => [node.nodeId, [] as string[]]));
  const successorIds = new Map(graph.nodes.map((node) => [node.nodeId, [] as string[]]));
  for (const edge of graph.edges.filter((candidate) => candidate.kind !== "feedback")) {
    predecessorIds.get(edge.toNodeId)?.push(edge.fromNodeId);
    successorIds.get(edge.fromNodeId)?.push(edge.toNodeId);
  }
  const remaining = new Set(graph.nodes.map((node) => node.nodeId));
  const ordered: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((nodeId) =>
      (predecessorIds.get(nodeId) ?? []).every((predecessorId) => !remaining.has(predecessorId)),
    );
    assert.ok(ready.length > 0, "fixture graph must be acyclic");
    for (const nodeId of ready.sort()) {
      remaining.delete(nodeId);
      ordered.push(nodeId);
    }
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  return ordered.map((nodeId, index) => ({
    index,
    nodeId,
    agentConfigId: nodeById.get(nodeId)?.agentConfigId,
    predecessorNodeIds: predecessorIds.get(nodeId) ?? [],
    successorNodeIds: successorIds.get(nodeId) ?? [],
  }));
}

function bridgeFixture(fixture: typeof nativeThreeWindowFixture) {
  const graph = fixture.graph;
  const context = fixture.context;
  const agentConfigs = [...context.agentConfigs];
  const templates = [...context.agentTemplates];
  const implementationBindings = agentConfigs.map((config) => ({
    agentConfigId: config.agentConfigId,
    implementationKey: `implementation.${config.agentConfigId}`,
  }));
  const registry = new ImmutablePipelineRegistry({
    marketPacks: context.marketPacks,
    dataSources: context.dataSources,
    capabilities: context.capabilities,
    agentTemplates: templates,
    agentConfigs,
    implementationBindings,
  });
  const compiled = new PipelineGraphCompiler(registry, (candidate) =>
    validatePipelineGraph(candidate, context),
  ).compile(graph);
  assert.deepEqual(
    compiled.steps.map((step) => step.nodeId),
    topologicalSteps(graph).map((step) => step.nodeId),
  );

  const templateById = new Map(templates.map((template) => [template.templateId, template]));
  const usedConfigs = graph.nodes.flatMap((node) => {
    const config = context.agentConfigs.find(
      (candidate) => candidate.agentConfigId === node.agentConfigId,
    );
    return config ? [config] : [];
  });
  const artifactTypes = new Set<string>();
  const executors = usedConfigs.map((config) => {
    const template = templateById.get(config.templateId) as AgentTemplate;
    const inputArtifactTypes = template.inputPorts.flatMap((port) => port.schemaRefs);
    const outputArtifactTypes = template.outputPorts.flatMap((port) => port.schemaRefs);
    inputArtifactTypes.forEach((artifactType) => artifactTypes.add(artifactType));
    outputArtifactTypes.forEach((artifactType) => artifactTypes.add(artifactType));
    return {
      executorId: `executor.${config.agentConfigId}`,
      role: historicalRoleByTemplateRole[template.role] as never,
      inputArtifactTypes,
      outputArtifactTypes,
      execute: async () => [],
    };
  });
  const nodeExecutorRegistry = new RegisteredHistoricalNodeExecutorRegistry(executors);
  const artifactSchemaRegistry = new RegisteredHistoricalArtifactSchemaRegistry(
    [...artifactTypes].map((artifactType) => ({
      artifactType,
      schemaRef: { schemaId: artifactType, schemaVersion: "1.0.0" },
      schema: z.unknown(),
    })),
  );
  const historicalPlanRegistry = new RegisteredHistoricalGraphPlanRegistry({
    presetCatalog: {} as never,
    executorRegistry: nodeExecutorRegistry,
    artifactSchemaRegistry,
    bindings: [],
    now: fixedNow,
  });
  const bridge = new PipelineGraphHistoricalBridge({
    registry,
    historicalPlanRegistry,
    nodeExecutorRegistry,
    artifactSchemaRegistry,
    executorBindings: implementationBindings.map((binding) => ({
      implementationKey: binding.implementationKey,
      executorId: `executor.${binding.agentConfigId}`,
    })),
    now: fixedNow,
  });
  return { bridge, compiled, graph, historicalPlanRegistry };
}

test("compiler bridge registers the current multi-window graph without applying runtime changes", () => {
  const { bridge, compiled, graph, historicalPlanRegistry } =
    bridgeFixture(nativeThreeWindowFixture);
  const plan = bridge.bridge(graph, compiled);

  assert.equal(plan.runtimeApplied, false);
  assert.equal(plan.executionMode, "paper_capable");
  assert.match(plan.compiledGraphRef.fingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(
    plan.nodes.map((node) => node.nodeId),
    compiled.steps.map((step) => step.nodeId),
  );
  assert.ok(plan.nodes.some((node) => node.role === "decision"));
  assert.ok(plan.nodes.some((node) => node.role === "risk"));
  assert.ok(plan.nodes.some((node) => node.role === "execution"));
  assert.equal(historicalPlanRegistry.require(plan.planId).fingerprint, plan.fingerprint);
});

test("compiler bridge represents daily-only and event-only historical plans", () => {
  const daily = bridgeFixture(dailySingleWindowFixture);
  const dailyPlan = daily.bridge.bridge(daily.graph, daily.compiled);
  assert.ok(dailyPlan.requiredCapabilityKinds.includes("bar"));

  const event = bridgeFixture(eventOnlyFixture);
  const eventPlan = event.bridge.bridge(event.graph, event.compiled);
  assert.deepEqual(eventPlan.requiredCapabilityKinds, ["event"]);
  assert.equal(eventPlan.requiredCapabilityKinds.includes("bar"), false);
});

test("compiler bridge rejects graph/compiler fingerprint drift", () => {
  const { bridge, compiled, graph } = bridgeFixture(nativeThreeWindowFixture);
  assert.throws(
    () => bridge.bridge(graph, { ...compiled, graphFingerprint: "0".repeat(64) }),
    (error) =>
      error instanceof PipelineGraphHistoricalBridgeError &&
      error.code === "COMPILER_GRAPH_FINGERPRINT_MISMATCH",
  );
});
