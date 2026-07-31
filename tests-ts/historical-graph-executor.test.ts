import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  AgentSemanticAssessmentSchema,
  DecisionSemanticContextSchema,
  MarketObservationArtifactSchema,
  ReflectionLessonCandidateSchema,
  SemanticDecisionArtifactSchema,
  SemanticPipelinePresetDefinitionSchema,
  type AgentSemanticAssessment,
  type MarketObservationArtifact,
  type SemanticArtifactReference,
  type SemanticObservationWindowReference,
} from "../packages/contracts/src/index.js";
import {
  HistoricalGraphExecutionError,
  HistoricalGraphExecutor,
  RegisteredHistoricalArtifactSchemaRegistry,
  RegisteredHistoricalGraphPlanRegistry,
  RegisteredHistoricalNodeExecutorRegistry,
  type HistoricalGraphArtifactDraft,
  type RegisteredHistoricalNodeExecutor,
} from "../packages/core/src/index.js";
import {
  createRegisteredSemanticHistoricalExecution,
  type CurrentCryptoHistoricalExecutionPorts,
} from "../packages/runtime/src/index.js";

const fp = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const asOf = "2026-01-02T01:00:00.000Z";
const marketPackRef = { id: "market-pack.crypto", version: "1.0.0", fingerprint: fp("a") };
const artifactRef = (artifact: { id: string; artifactType: string; fingerprint: string }): SemanticArtifactReference => ({
  artifactId: artifact.id,
  artifactType: artifact.artifactType,
  fingerprint: artifact.fingerprint,
});

function observation(
  window: SemanticObservationWindowReference,
  index: number,
  requestedAsOf = asOf,
): MarketObservationArtifact {
  const common = {
    schemaVersion: "1.0.0" as const,
    id: `observation:${window.id}:${index}`,
    version: "1.0.0",
    fingerprint: fp(String((index % 9) + 1)),
    lifecycleStatus: "validated" as const,
    createdAt: requestedAsOf,
    marketPackRef,
    schemaRef: { schemaId: "schema.market-observation", schemaVersion: "1.0.0" },
    artifactType: "market_observation" as const,
    asOf: requestedAsOf,
    availableAt: requestedAsOf,
    observationWindowRef: window,
    lineage: {
      lineageId: `lineage:${window.id}:${index}`,
      fingerprint: fp(String(((index + 3) % 9) + 1)),
      sourceDefinitionId: window.kind === "event_batch" ? "data-source.registered-events" : "data-source.csv-historical",
      sourceCapabilityId: `capability:${window.id}`,
      transformationVersion: "1.0.0",
      timezone: "UTC",
      tradingCalendarRef: "calendar.crypto.24x7",
    },
  };
  if (window.kind === "event_batch") {
    return MarketObservationArtifactSchema.parse({
      ...common,
      payload: {
        kind: "event_batch",
        topic: "registered-events",
        events: [{
          eventId: `event:${index}`,
          eventType: "market_news",
          occurredAt: "2026-01-02T00:30:00.000Z",
          availableAt: "2026-01-02T00:31:00.000Z",
          headline: "Historical fixture event",
          content: "An event known before the historical asOf.",
          attributes: {},
        }],
      },
    });
  }
  return MarketObservationArtifactSchema.parse({
    ...common,
    payload: {
      kind: "bar_interval",
      symbol: "BTCUSDT",
      bars: [{
        openedAt: "2026-01-02T00:00:00.000Z",
        closedAt: "2026-01-02T00:55:00.000Z",
        availableAt: "2026-01-02T00:55:00.000Z",
        open: 100,
        high: 110,
        low: 95,
        close: 106,
        volume: 100,
      }],
    },
  });
}

function assessmentFrom(
  source: MarketObservationArtifact | AgentSemanticAssessment,
  id: string,
  kind: "window_analysis" | "bull_case" | "bear_case" | "research_synthesis" | "position_monitor",
  direction: "bullish" | "bearish" | "neutral" = "bullish",
): AgentSemanticAssessment {
  const sourceLineage = "lineage" in source ? source.lineage.fingerprint : source.lineageFingerprint;
  return AgentSemanticAssessmentSchema.parse({
    schemaVersion: "1.0.0",
    id,
    version: "1.0.0",
    fingerprint: fp(String((id.length % 9) + 1)),
    lifecycleStatus: "validated",
    createdAt: asOf,
    marketPackRef,
    schemaRef: { schemaId: "schema.agent-semantic-assessment", schemaVersion: "1.0.0" },
    artifactType: "agent_semantic_assessment",
    assessmentKind: kind,
    agentConfigRef: { id: `agent:${kind}`, version: "1.0.0", fingerprint: fp("b") },
    observationWindowRef: kind === "window_analysis" && "observationWindowRef" in source ? source.observationWindowRef : undefined,
    direction,
    confidence: 0.7,
    regime: "trend",
    semanticThesis: `${kind} semantic thesis for the historical fixture.`,
    supportingEvidence: [{
      evidenceId: `evidence:${id}`,
      sourceArtifactRef: artifactRef(source),
      evidenceType: "agent_assessment",
      locator: "fixture",
      summary: "Registered historical evidence.",
    }],
    invalidationConditions: ["The referenced evidence no longer holds."],
    riskFlags: [],
    sourceArtifactRefs: [artifactRef(source)],
    lineageFingerprint: sourceLineage,
  });
}

interface PortCounters {
  portfolio: number;
  risk: number;
  execution: number;
  positionMonitor: number;
  reflection: number;
}

function createPorts(overrides: Partial<CurrentCryptoHistoricalExecutionPorts> = {}) {
  const counters: PortCounters = { portfolio: 0, risk: 0, execution: 0, positionMonitor: 0, reflection: 0 };
  let assessmentSequence = 0;
  const ports: CurrentCryptoHistoricalExecutionPorts = {
    candidateSymbols: async () => ["BTCUSDT", "ETHUSDT"],
    selectSymbol: async (candidates) => candidates[0] ?? "BTCUSDT",
    loadObservations: async (_symbol, windows, requestedAsOf) =>
      windows.map((window, index) => observation(window, index, requestedAsOf)),
    analyzeObservation: async (item) =>
      assessmentFrom(item, `assessment:window:${assessmentSequence++}`, "window_analysis"),
    buildDirectionalCase: async (side, assessments) =>
      assessmentFrom(
        assessments[0]!,
        `assessment:${side}:${assessmentSequence++}`,
        side === "bull" ? "bull_case" : "bear_case",
        side === "bull" ? "bullish" : "bearish",
      ),
    monitorCurrentPosition: async (observations) => {
      counters.positionMonitor += 1;
      return assessmentFrom(
        observations[0]!,
        `assessment:position:${assessmentSequence++}`,
        "position_monitor",
        "neutral",
      );
    },
    decide: async ({ observations, assessments, approvedLessons }) => {
      const context = DecisionSemanticContextSchema.parse({
        schemaVersion: "1.0.0",
        id: "decision-context:historical:1",
        version: "1.0.0",
        fingerprint: fp("c"),
        lifecycleStatus: "validated",
        createdAt: asOf,
        marketPackRef,
        schemaRef: { schemaId: "schema.decision-semantic-context", schemaVersion: "1.0.0" },
        artifactType: "decision_semantic_context",
        asOf,
        decisionAgentConfigRef: { id: "agent:decision", version: "1.0.0", fingerprint: fp("d") },
        observations,
        assessments,
        approvedLessons,
        portfolioState: { asOf, baseCurrency: "USDT", equity: 10_000, availableCash: 9_000, openPositionRefs: [] },
        riskState: { asOf, riskProfileId: "risk-profile.paper", newEntriesPaused: false, closeOnly: false, remainingRiskBudget: 100, activeFlags: [] },
        dataQuality: { status: "pass", issueCodes: [], checkedArtifactRefs: observations.map(artifactRef) },
        lineageFingerprints: [...new Set([
          ...observations.map((item) => item.lineage.fingerprint),
          ...assessments.map((item) => item.lineageFingerprint),
        ])],
      });
      const decision = SemanticDecisionArtifactSchema.parse({
        schemaVersion: "1.0.0",
        id: "semantic-decision:historical:1",
        version: "1.0.0",
        fingerprint: fp("e"),
        lifecycleStatus: "validated",
        createdAt: asOf,
        marketPackRef,
        schemaRef: { schemaId: "schema.semantic-decision", schemaVersion: "1.0.0" },
        artifactType: "semantic_decision",
        asOf,
        decisionAgentConfigRef: { id: "agent:decision", version: "1.0.0", fingerprint: fp("d") },
        decisionContextRef: artifactRef(context),
        intent: "hold",
        confidence: 0.6,
        semanticRationale: "Historical assessments are balanced, so the intent remains hold.",
        supportingEvidence: [{
          evidenceId: "evidence:decision:1",
          sourceArtifactRef: artifactRef(assessments[0]!),
          evidenceType: "agent_assessment",
          locator: "assessments[0]",
          summary: "The first registered assessment anchors the decision.",
        }],
        riskFlags: [],
        requiresPortfolioRiskChain: true,
      });
      return { context, decision };
    },
    applyPortfolio: async (decision) => {
      counters.portfolio += 1;
      return { actionId: "portfolio-action:1", intent: decision.intent, notional: 0 };
    },
    evaluateRisk: async (action) => {
      counters.risk += 1;
      return { approved: true, reasonCodes: [], action };
    },
    simulateExecution: async (risk) => {
      counters.execution += 1;
      return { status: "not_executed", actionId: risk.action.actionId };
    },
    reflect: async ({ decision }) => {
      counters.reflection += 1;
      return ReflectionLessonCandidateSchema.parse({
        schemaVersion: "1.0.0",
        id: "lesson-candidate:historical:1",
        version: "1.0.0",
        fingerprint: fp("f"),
        lifecycleStatus: "candidate",
        createdAt: asOf,
        marketPackRef,
        schemaRef: { schemaId: "schema.reflection-lesson-candidate", schemaVersion: "1.0.0" },
        artifactType: "reflection_lesson_candidate",
        reflectionAgentConfigRef: { id: "agent:reflection", version: "1.0.0", fingerprint: fp("1") },
        failedTradeRef: { tradeId: "trade:historical:1", decisionArtifactRef: artifactRef(decision) },
        semanticLesson: "Retain the hold decision when directional evidence remains balanced.",
        failurePattern: "Conflicting multi-window evidence.",
        applicableMarketPackIds: [marketPackRef.id],
        applicableRegimes: ["trend"],
        confidence: 0.6,
        supportingEvidence: [{
          evidenceId: "evidence:lesson:historical:1",
          sourceArtifactRef: artifactRef(decision),
          evidenceType: "lesson",
          locator: "decision",
          summary: "The historical decision retained balanced evidence.",
        }],
      });
    },
    synthesizeResearch: async (assessments) =>
      assessmentFrom(assessments[0]!, `assessment:synthesis:${assessmentSequence++}`, "research_synthesis", "neutral"),
    approvedLessons: async () => [],
    ...overrides,
  };
  return { ports, counters };
}

test("current Crypto historical plan executes 5m/15m/1h through Position Monitor, Portfolio, Risk, Execution and Reflection", async () => {
  const { ports, counters } = createPorts();
  const composition = createRegisteredSemanticHistoricalExecution(ports, { authorizedCapabilityKinds: ["bar"] });
  const plan = composition.planRegistry.compileAndRegisterPreset("preset.current-crypto-multi-agent");
  const result = await composition.executor.execute({ planId: plan.planId, idempotencyKey: "crypto-cycle-0001", asOf });

  assert.equal(result.run.status, "succeeded");
  assert.equal(result.run.nodeRuns.filter((item) => item.status === "succeeded").length, plan.nodes.length);
  assert.equal(plan.nodes.filter((item) => item.role === "window_analysis").length, 3);
  assert.deepEqual(counters, { portfolio: 1, risk: 1, execution: 1, positionMonitor: 1, reflection: 1 });
  assert.ok(result.run.artifactRefs.some((item) => item.artifactType === "decision_semantic_context"));
  assert.ok(result.run.artifactRefs.some((item) => item.artifactType === "reflection_lesson_candidate"));
  const actionRoles = result.run.nodeRuns
    .map((nodeRun) => plan.nodes.find((node) => node.nodeId === nodeRun.nodeId)?.role)
    .filter((role) => ["decision", "portfolio", "risk", "execution"].includes(role ?? ""));
  assert.deepEqual(actionRoles, ["decision", "portfolio", "risk", "execution"]);
});

test("same plan and idempotency key replays the same immutable run", async () => {
  const { ports, counters } = createPorts();
  const composition = createRegisteredSemanticHistoricalExecution(ports);
  const plan = composition.planRegistry.compileAndRegisterPreset("preset.current-crypto-multi-agent");
  const request = { planId: plan.planId, idempotencyKey: "crypto-idempotent-01", asOf };
  const first = await composition.executor.execute(request);
  const second = await composition.executor.execute(request);
  assert.deepEqual(second, first);
  assert.equal(counters.execution, 1);
  await assert.rejects(
    composition.executor.execute({ ...request, asOf: "2026-01-02T02:00:00.000Z" }),
    (error: unknown) => error instanceof HistoricalGraphExecutionError && error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("single-window daily Preset compiles and executes through the same controlled action boundary", async () => {
  const { ports, counters } = createPorts();
  const composition = createRegisteredSemanticHistoricalExecution(ports, { authorizedCapabilityKinds: ["bar"] });
  const plan = composition.planRegistry.compileAndRegisterPreset("preset.single-window-daily");
  const result = await composition.executor.execute({ planId: plan.planId, idempotencyKey: "daily-cycle-0001", asOf });
  assert.equal(result.run.status, "succeeded");
  assert.equal(counters.risk, 1);
  assert.equal(plan.nodes.filter((node) => node.role === "window_analysis").length, 1);
});

test("event-only research Preset executes without Portfolio, Risk or Execution authority", async () => {
  const { ports, counters } = createPorts();
  const composition = createRegisteredSemanticHistoricalExecution(ports, { authorizedCapabilityKinds: ["bar", "event"] });
  const plan = composition.planRegistry.compileAndRegisterPreset("preset.event-only-research");
  const result = await composition.executor.execute({ planId: plan.planId, idempotencyKey: "event-cycle-0001", asOf });
  assert.equal(result.run.status, "succeeded");
  assert.equal(plan.executionMode, "research_only");
  assert.equal(plan.nodes.some((node) => node.authority !== "none"), false);
  assert.deepEqual(counters, { portfolio: 0, risk: 0, execution: 0, positionMonitor: 0, reflection: 0 });
});

function testDraft(
  artifactType: string,
  value: unknown,
  context: { asOf: string; executionLineageFingerprint: string; inputs: readonly { artifactId: string; artifactType: string; fingerprint: string; lineageFingerprints: readonly string[] }[] },
  lineage = context.inputs.flatMap((item) => item.lineageFingerprints),
): HistoricalGraphArtifactDraft {
  return {
    artifactType,
    payload: value,
    asOf: context.asOf,
    sourceArtifactRefs: context.inputs.map((item) => ({ artifactId: item.artifactId, artifactType: item.artifactType, fingerprint: item.fingerprint })),
    lineageFingerprints: lineage.length > 0 ? lineage : [context.executionLineageFingerprint],
  };
}

function createFallbackHarness(options: { invalidSinkSchema?: boolean; invalidSinkLineage?: boolean; futureSource?: boolean } = {}) {
  const type = "test.semantic.value.v1";
  const preset = SemanticPipelinePresetDefinitionSchema.parse({
    schemaVersion: "1.0.0",
    id: "preset.test-fallback",
    version: "1.0.0",
    displayName: "Fallback test",
    description: "Backend-only fallback execution fixture.",
    fingerprint: fp("2"),
    lifecycleStatus: "draft",
    createdAt: asOf,
    availability: "capability_required",
    executionMode: "research_only",
    marketPackRefs: [marketPackRef],
    defaultDataSourceIds: [],
    requiredCapabilityKinds: ["event"],
    graphVersionRef: { id: "graph.test-fallback", version: "1.0.0", fingerprint: fp("3") },
    observationWindows: [{ id: "window.test.event", kind: "event_batch", label: "event", unit: "hour", value: 1, capabilityMode: "required" }],
    nodes: [
      { nodeId: "primary", role: "data_sync", agentTemplateId: "agent.test.primary", observationWindowIds: ["window.test.event"], authority: "none", inputArtifactTypes: [], outputArtifactTypes: [type] },
      { nodeId: "fallback", role: "data_sync", agentTemplateId: "agent.test.fallback", observationWindowIds: ["window.test.event"], authority: "none", inputArtifactTypes: [], outputArtifactTypes: [type] },
      { nodeId: "optional", role: "data_sync", agentTemplateId: "agent.test.optional", observationWindowIds: ["window.test.event"], authority: "none", inputArtifactTypes: [], outputArtifactTypes: [type] },
      { nodeId: "sink", role: "research_synthesis", agentTemplateId: "agent.test.sink", observationWindowIds: [], authority: "none", inputArtifactTypes: [type], outputArtifactTypes: [type] },
    ],
    edges: [
      { edgeId: "primary-sink", sourceNodeId: "primary", targetNodeId: "sink", artifactType: type, policy: "required" },
      { edgeId: "fallback-sink", sourceNodeId: "fallback", targetNodeId: "sink", artifactType: type, policy: "fallback", fallbackForEdgeId: "primary-sink" },
      { edgeId: "optional-sink", sourceNodeId: "optional", targetNodeId: "sink", artifactType: type, policy: "optional" },
    ],
    compatibilityTarget: { kind: "contract_template", reference: "test-fallback" },
  });
  const source = (executorId: string, mode: "fail" | "success"): RegisteredHistoricalNodeExecutor => ({
    executorId,
    role: "data_sync",
    inputArtifactTypes: [],
    outputArtifactTypes: [type],
    execute: async (context) => {
      if (mode === "fail") throw new Error("registered_fixture_failure");
      return [
        testDraft(
          type,
          { value: 1 },
          options.futureSource
            ? { ...context, asOf: "2026-01-03T00:00:00.000Z" }
            : context,
        ),
      ];
    },
  });
  const sink: RegisteredHistoricalNodeExecutor = {
    executorId: "executor.test.sink",
    role: "research_synthesis",
    inputArtifactTypes: [type],
    outputArtifactTypes: [type],
    execute: async (context) => [
      testDraft(
        type,
        options.invalidSinkSchema ? { value: "invalid" } : { value: 2 },
        context,
        options.invalidSinkLineage ? [fp("9")] : undefined,
      ),
    ],
  };
  const executorRegistry = new RegisteredHistoricalNodeExecutorRegistry([
    source("executor.test.primary", "fail"),
    source("executor.test.fallback", "success"),
    source("executor.test.optional", "fail"),
    sink,
  ]);
  const artifactSchemaRegistry = new RegisteredHistoricalArtifactSchemaRegistry([{
    artifactType: type,
    schemaRef: { schemaId: type, schemaVersion: "1.0.0" },
    schema: z.object({ value: z.number() }).strict(),
  }]);
  const catalog = {
    list: () => [preset],
    get: (id: string) => id === preset.id ? preset : undefined,
    require: (id: string) => {
      if (id !== preset.id) throw new Error("missing");
      return preset;
    },
  };
  const planRegistry = new RegisteredHistoricalGraphPlanRegistry({
    presetCatalog: catalog,
    executorRegistry,
    artifactSchemaRegistry,
    bindings: [
      { agentTemplateId: "agent.test.primary", executorId: "executor.test.primary" },
      { agentTemplateId: "agent.test.fallback", executorId: "executor.test.fallback" },
      { agentTemplateId: "agent.test.optional", executorId: "executor.test.optional" },
      { agentTemplateId: "agent.test.sink", executorId: "executor.test.sink" },
    ],
  });
  const plan = planRegistry.compileAndRegisterPreset(preset.id);
  const executor = new HistoricalGraphExecutor({
    planRegistry,
    executorRegistry,
    artifactSchemaRegistry,
    authorizedCapabilityKinds: ["event"],
  });
  return { plan, executor, planRegistry };
}

test("Required failure uses only its declared Fallback while Optional failure remains a warning", async () => {
  const { plan, executor } = createFallbackHarness();
  const result = await executor.execute({ planId: plan.planId, idempotencyKey: "fallback-cycle-01", asOf });
  assert.equal(result.run.status, "completed_with_warnings");
  const sink = result.run.nodeRuns.find((item) => item.nodeId === "sink");
  assert.equal(sink?.status, "fallback_succeeded");
  assert.deepEqual(sink?.usedFallbackEdgeIds, ["fallback-sink"]);
});

test("output Schema, lineage and historical asOf violations fail closed with stable codes", async () => {
  for (const [options, expected] of [
    [{ invalidSinkSchema: true }, "OUTPUT_SCHEMA_INCOMPATIBLE"],
    [{ invalidSinkLineage: true }, "LINEAGE_MISMATCH"],
    [{ futureSource: true }, "FUTURE_DATA_DETECTED"],
  ] as const) {
    const { plan, executor } = createFallbackHarness(options);
    const result = await executor.execute({ planId: plan.planId, idempotencyKey: `failure-${expected}`, asOf });
    assert.equal(result.run.status, "failed");
    assert.ok(result.run.errorCodes.includes(expected));
  }
});

test("raw plan injection and unregistered plan or executor are rejected before execution", async () => {
  const { plan, executor, planRegistry } = createFallbackHarness();
  const clone = planRegistry.require(plan.planId) as { fingerprint: string };
  clone.fingerprint = fp("8");
  const result = await executor.execute({ planId: plan.planId, idempotencyKey: "registered-plan-01", asOf });
  assert.notEqual(result.run.planRef.fingerprint, fp("8"));
  await assert.rejects(
    executor.execute({ planId: "plan.client-injected", idempotencyKey: "unknown-plan-01", asOf }),
    (error: unknown) => error instanceof HistoricalGraphExecutionError && error.code === "PLAN_NOT_REGISTERED",
  );
  await assert.rejects(
    executor.execute({ planId: plan.planId, idempotencyKey: "raw-plan-injection", asOf, plan: {} }),
    z.ZodError,
  );
});
