import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  AgentSemanticAssessmentSchema,
  DecisionSemanticContextSchema,
  MarketObservationArtifactSchema,
  ReflectionLessonCandidateSchema,
  SemanticDecisionArtifactSchema,
  type AgentSemanticAssessment,
  type MarketObservationArtifact,
  type SemanticArtifactReference,
  type SemanticObservationWindowReference,
} from "../packages/contracts/src/index.js";
import {
  GraphBacktestRunner,
  GraphEvidenceError,
  GraphWalkForwardRunner,
  RegisteredGraphHistoricalDatasetRegistry,
  RegisteredGraphStrategyProfileRegistry,
  RegisteredGraphWalkForwardPlanRegistry,
  createGraphEvidenceArtifact,
  createGraphHistoricalDatasetDefinition,
  createGraphStrategyProfileCandidateSet,
  createGraphStrategyProfileDefinition,
  createGraphWalkForwardPlanDefinition,
  verifyGraphEvidenceArtifact,
} from "../packages/core/src/index.js";
import {
  DurableGraphEvidenceJobService,
  GraphEvidenceJobError,
  SqliteGraphEvidenceJobRepository,
  createRegisteredGraphBacktestSessionFactory,
  type CurrentCryptoHistoricalExecutionPorts,
  type RegisteredGraphBacktestSessionProvider,
} from "../packages/runtime/src/index.js";

const fp = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const createdAt = "2026-01-01T00:00:00.000Z";
const marketPackRef = { id: "market-pack.crypto", version: "1.0.0", fingerprint: fp("a") };
const planId = (presetId: string) => `${presetId}:historical-plan:1.0.0`;
const currentPresetId = "preset.current-crypto-multi-agent";
const dailyPresetId = "preset.single-window-daily";
const eventPresetId = "preset.event-only-research";

function ref(value: { id: string; artifactType: string; fingerprint: string }): SemanticArtifactReference {
  return { artifactId: value.id, artifactType: value.artifactType, fingerprint: value.fingerprint };
}

function makeObservation(
  window: SemanticObservationWindowReference,
  asOf: string,
  sequence: number,
  future = false,
): MarketObservationArtifact {
  const knownAt = future
    ? new Date(Date.parse(asOf) + 60_000).toISOString()
    : new Date(Date.parse(asOf) - 60_000).toISOString();
  const common = {
    schemaVersion: "1.0.0" as const,
    id: `observation:${window.id}:${sequence}`,
    version: "1.0.0",
    fingerprint: fp(String((sequence % 9) + 1)),
    lifecycleStatus: "validated" as const,
    createdAt: asOf,
    marketPackRef,
    schemaRef: { schemaId: "schema.market-observation", schemaVersion: "1.0.0" },
    artifactType: "market_observation" as const,
    asOf,
    availableAt: knownAt,
    observationWindowRef: window,
    lineage: {
      lineageId: `lineage:${window.id}:${sequence}`,
      fingerprint: fp(String(((sequence + 3) % 9) + 1)),
      sourceDefinitionId: window.kind === "event_batch" ? "data-source.events" : "data-source.csv",
      sourceCapabilityId: `capability:${window.id}`,
      transformationVersion: "1.0.0",
      timezone: "UTC",
      tradingCalendarRef: "calendar.crypto.24x7",
    },
  };
  const raw = window.kind === "event_batch"
    ? {
        ...common,
        payload: {
          kind: "event_batch" as const,
          topic: "market-news",
          events: [{
            eventId: `event:${sequence}`,
            eventType: "market_news",
            occurredAt: new Date(Date.parse(asOf) - 120_000).toISOString(),
            availableAt: knownAt,
            headline: "Registered historical event",
            content: "Event content is closed before the requested historical cycle.",
            attributes: {},
          }],
        },
      }
    : {
        ...common,
        payload: {
          kind: "bar_interval" as const,
          symbol: "BTCUSDT",
          bars: [{
            openedAt: new Date(Date.parse(asOf) - 3_600_000).toISOString(),
            closedAt: new Date(Date.parse(asOf) - 120_000).toISOString(),
            availableAt: knownAt,
            open: 100,
            high: 110,
            low: 95,
            close: 106,
            volume: 100,
          }],
        },
      };
  return future ? (raw as MarketObservationArtifact) : MarketObservationArtifactSchema.parse(raw);
}

let assessmentSequence = 0;
function makeAssessment(
  source: MarketObservationArtifact | AgentSemanticAssessment,
  asOf: string,
  kind: "window_analysis" | "bull_case" | "bear_case" | "research_synthesis" | "position_monitor",
  direction: "bullish" | "bearish" | "neutral" = "bullish",
): AgentSemanticAssessment {
  const lineageFingerprint = "lineage" in source ? source.lineage.fingerprint : source.lineageFingerprint;
  assessmentSequence += 1;
  return AgentSemanticAssessmentSchema.parse({
    schemaVersion: "1.0.0",
    id: `assessment:${kind}:${assessmentSequence}`,
    version: "1.0.0",
    fingerprint: fp(String((assessmentSequence % 9) + 1)),
    lifecycleStatus: "validated",
    createdAt: asOf,
    marketPackRef,
    schemaRef: { schemaId: "schema.agent-semantic-assessment", schemaVersion: "1.0.0" },
    artifactType: "agent_semantic_assessment",
    assessmentKind: kind,
    agentConfigRef: { id: `agent:${kind}`, version: "1.0.0", fingerprint: fp("b") },
    observationWindowRef: kind === "window_analysis" && "observationWindowRef" in source
      ? source.observationWindowRef
      : undefined,
    direction,
    confidence: 0.7,
    regime: "trend",
    semanticThesis: `${kind} historical semantic assessment.`,
    supportingEvidence: [{
      evidenceId: `evidence:assessment:${assessmentSequence}`,
      sourceArtifactRef: ref(source),
      evidenceType: "agent_assessment",
      locator: "historical-fixture",
      summary: "Closed historical evidence supports the assessment.",
    }],
    invalidationConditions: ["The referenced closed evidence no longer holds."],
    riskFlags: [],
    sourceArtifactRefs: [ref(source)],
    lineageFingerprint,
  });
}

interface SessionAudit {
  sessionIds: string[];
  graphCycles: number;
  riskCalls: number;
  executionCalls: number;
  closeCalls: number;
}

function createSemanticSessionProvider(audit: SessionAudit): RegisteredGraphBacktestSessionProvider {
  return {
    create: async ({ sessionId, planId: requestedPlanId, profile }) => {
      audit.sessionIds.push(sessionId);
      let cycle = 0;
      let lastAsOf = createdAt;
      let currentEquity = 10_000;
      const increment = Number(profile.parameters.equityIncrement ?? 10);
      const future = profile.parameters.futureData === true;
      const ports: CurrentCryptoHistoricalExecutionPorts = {
        candidateSymbols: async () => ["BTCUSDT", "ETHUSDT"],
        selectSymbol: async (symbols) => symbols[0]!,
        loadObservations: async (_symbol, windows, asOf) => {
          lastAsOf = asOf;
          cycle += 1;
          audit.graphCycles += 1;
          return windows.map((window, index) => makeObservation(window, asOf, cycle * 10 + index, future));
        },
        analyzeObservation: async (observation) => makeAssessment(observation, lastAsOf, "window_analysis"),
        buildDirectionalCase: async (side, assessments) => makeAssessment(
          assessments[0]!,
          lastAsOf,
          side === "bull" ? "bull_case" : "bear_case",
          side === "bull" ? "bullish" : "bearish",
        ),
        monitorCurrentPosition: async (observations) => makeAssessment(observations[0]!, lastAsOf, "position_monitor", "neutral"),
        decide: async ({ observations, assessments, approvedLessons, asOf }) => {
          const context = DecisionSemanticContextSchema.parse({
            schemaVersion: "1.0.0",
            id: `decision-context:${sessionId}:${cycle}`,
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
            portfolioState: { asOf, baseCurrency: "USDT", equity: currentEquity, availableCash: currentEquity, openPositionRefs: [] },
            riskState: { asOf, riskProfileId: "risk-profile.backtest", newEntriesPaused: false, closeOnly: false, remainingRiskBudget: 100, activeFlags: [] },
            dataQuality: { status: "pass", issueCodes: [], checkedArtifactRefs: observations.map(ref) },
            lineageFingerprints: [...new Set([
              ...observations.map((item) => item.lineage.fingerprint),
              ...assessments.map((item) => item.lineageFingerprint),
            ])],
          });
          const decision = SemanticDecisionArtifactSchema.parse({
            schemaVersion: "1.0.0",
            id: `semantic-decision:${sessionId}:${cycle}`,
            version: "1.0.0",
            fingerprint: fp("e"),
            lifecycleStatus: "validated",
            createdAt: asOf,
            marketPackRef,
            schemaRef: { schemaId: "schema.semantic-decision", schemaVersion: "1.0.0" },
            artifactType: "semantic_decision",
            asOf,
            decisionAgentConfigRef: { id: "agent:decision", version: "1.0.0", fingerprint: fp("d") },
            decisionContextRef: ref(context),
            intent: "open_long",
            confidence: 0.7,
            semanticRationale: "Registered historical assessments support the bounded intent.",
            supportingEvidence: [{
              evidenceId: `evidence:decision:${sessionId}:${cycle}`,
              sourceArtifactRef: ref(assessments[0]!),
              evidenceType: "agent_assessment",
              locator: "assessments[0]",
              summary: "The first assessment anchors the fixture decision.",
            }],
            riskFlags: [],
            requiresPortfolioRiskChain: true,
          });
          return { context, decision };
        },
        applyPortfolio: async (decision) => ({ actionId: `action:${sessionId}:${cycle}`, intent: decision.intent, notional: 100 }),
        evaluateRisk: async (action) => {
          audit.riskCalls += 1;
          return { approved: true, reasonCodes: [], action };
        },
        simulateExecution: async (risk) => {
          audit.executionCalls += 1;
          return { status: "simulated_fill", fillId: `fill:${sessionId}:${cycle}`, actionId: risk.action.actionId };
        },
        reflect: async ({ decision }) => ReflectionLessonCandidateSchema.parse({
          schemaVersion: "1.0.0",
          id: `lesson-candidate:${sessionId}:${cycle}`,
          version: "1.0.0",
          fingerprint: fp("f"),
          lifecycleStatus: "candidate",
          createdAt: lastAsOf,
          marketPackRef,
          schemaRef: { schemaId: "schema.reflection-lesson-candidate", schemaVersion: "1.0.0" },
          artifactType: "reflection_lesson_candidate",
          reflectionAgentConfigRef: { id: "agent:reflection", version: "1.0.0", fingerprint: fp("1") },
          failedTradeRef: { tradeId: `trade:${sessionId}:${cycle}`, decisionArtifactRef: ref(decision) },
          semanticLesson: "Candidate remains unapproved and cannot change the next historical session.",
          failurePattern: "Historical fixture pattern.",
          applicableMarketPackIds: [marketPackRef.id],
          applicableRegimes: ["trend"],
          confidence: 0.5,
          supportingEvidence: [{
            evidenceId: `evidence:lesson:${sessionId}:${cycle}`,
            sourceArtifactRef: ref(decision),
            evidenceType: "lesson",
            locator: "decision",
            summary: "Reflection references the completed decision only.",
          }],
        }),
        synthesizeResearch: async (assessments, asOf) => makeAssessment(assessments[0]!, asOf, "research_synthesis", "neutral"),
        approvedLessons: async () => [],
      };
      return {
        ports,
        captureCycleOutcome: async (_asOf, result) => {
          if (requestedPlanId.includes("event-only")) {
            return {
              mode: "research" as const,
              assessmentArtifactCount: result.run.artifactRefs.filter((item) => item.artifactType === "agent_semantic_assessment").length,
            };
          }
          currentEquity += increment;
          return {
            mode: "trading" as const,
            equity: currentEquity,
            availableCash: currentEquity - 100,
            realizedPnl: currentEquity - 10_000,
            unrealizedPnl: 0,
            tradeCount: cycle,
            fillCount: cycle,
            riskRejectionCount: 0,
          };
        },
        close: async () => {
          audit.closeCalls += 1;
        },
      };
    },
  };
}

function makeDataset(count = 8) {
  const asOfSequence = Array.from({ length: count }, (_, index) =>
    new Date(Date.parse("2026-01-02T00:00:00.000Z") + index * 3_600_000).toISOString(),
  );
  return createGraphHistoricalDatasetDefinition({
    schemaVersion: "1.0.0",
    id: "dataset.registered.crypto-bars",
    version: "1.0.0",
    lifecycleStatus: "active",
    createdAt,
    marketPackRef,
    dataSourceRef: { id: "data-source.csv-historical", version: "1.0.0", fingerprint: fp("2") },
    timezone: "UTC",
    tradingCalendarRef: "calendar.crypto.24x7",
    asOfSequence,
  });
}

function makeProfile(id: string, presetIds: string[], equityIncrement: number, futureData = false) {
  return createGraphStrategyProfileDefinition({
    schemaVersion: "1.0.0",
    id,
    version: "1.0.0",
    lifecycleStatus: "active",
    createdAt,
    compatiblePresetIds: presetIds,
    parameters: { equityIncrement, futureData },
  });
}

function setupEvidence(count = 8) {
  const dataset = makeDataset(count);
  const profiles = [
    makeProfile("profile.current", [currentPresetId], 10),
    makeProfile("profile.daily", [dailyPresetId], 8),
    makeProfile("profile.event", [eventPresetId], 0),
    makeProfile("profile.slow", [currentPresetId], 5),
    makeProfile("profile.fast", [currentPresetId], 25),
    makeProfile("profile.future", [currentPresetId], 1, true),
  ];
  const candidateSet = createGraphStrategyProfileCandidateSet({
    schemaVersion: "1.0.0",
    id: "profile-set.registered.walk-forward",
    version: "1.0.0",
    lifecycleStatus: "active",
    createdAt,
    profileIds: ["profile.slow", "profile.fast"],
  });
  const walkPlan = createGraphWalkForwardPlanDefinition({
    schemaVersion: "1.0.0",
    id: "walk-plan.registered.3-2-2",
    version: "1.0.0",
    lifecycleStatus: "active",
    createdAt,
    trainingCycles: 3,
    validationCycles: 2,
    stepCycles: 2,
    objective: "total_return_pct",
  });
  const datasets = new RegisteredGraphHistoricalDatasetRegistry([dataset]);
  const profileRegistry = new RegisteredGraphStrategyProfileRegistry(profiles, [candidateSet]);
  const walkPlans = new RegisteredGraphWalkForwardPlanRegistry([walkPlan]);
  const audit: SessionAudit = { sessionIds: [], graphCycles: 0, riskCalls: 0, executionCalls: 0, closeCalls: 0 };
  const sessions = createRegisteredGraphBacktestSessionFactory(createSemanticSessionProvider(audit));
  const backtests = new GraphBacktestRunner(datasets, profileRegistry, sessions, () => new Date(createdAt));
  return { dataset, profiles, candidateSet, walkPlan, datasets, profileRegistry, walkPlans, audit, backtests };
}

function backtestRequest(dataset: ReturnType<typeof makeDataset>, profileId = "profile.current", requestedPlanId = planId(currentPresetId)) {
  return {
    schemaVersion: "1.0.0" as const,
    planId: requestedPlanId,
    datasetId: dataset.id,
    profileId,
    startAt: dataset.asOfSequence[0]!,
    endAt: dataset.asOfSequence.at(-1)!,
    idempotencyKey: `backtest-${profileId.replaceAll(".", "-")}-0001`,
  };
}

test("current Crypto Graph Backtest executes every registered asOf through the same M2 chain", async () => {
  const setup = setupEvidence(4);
  const run = await setup.backtests.run(backtestRequest(setup.dataset));
  assert.equal(run.cycles.length, 4);
  assert.equal(run.metrics.mode, "trading");
  assert.equal(run.metrics.cycleCount, 4);
  assert.equal(run.metrics.fillCount, 4);
  assert.equal(run.promotionEligible, true);
  assert.equal(setup.audit.sessionIds.length, 1);
  assert.equal(setup.audit.graphCycles, 4);
  assert.equal(setup.audit.riskCalls, 4);
  assert.equal(setup.audit.executionCalls, 4);
  assert.equal(setup.audit.closeCalls, 1);
  assert.ok(run.cycles.every((cycle) => cycle.nodeRunCount > 0 && cycle.lineageFingerprints.length > 0));
});

test("daily Graph uses the same Backtest runner while event-only produces research evidence without return metrics", async () => {
  const setup = setupEvidence(3);
  const daily = await setup.backtests.run(backtestRequest(setup.dataset, "profile.daily", planId(dailyPresetId)));
  const research = await setup.backtests.run(backtestRequest(setup.dataset, "profile.event", planId(eventPresetId)));
  assert.equal(daily.metrics.mode, "trading");
  assert.equal(daily.cycles.length, 3);
  assert.equal(research.metrics.mode, "research");
  assert.equal(research.promotionEligible, false);
  assert.equal("totalReturnPct" in research.metrics, false);
});

test("Dataset schedule is closed and future observations fail before evidence is produced", async () => {
  const dataset = makeDataset(3);
  const { fingerprint: _datasetFingerprint, ...datasetWithoutFingerprint } = dataset;
  assert.throws(
    () =>
      createGraphHistoricalDatasetDefinition({
        ...datasetWithoutFingerprint,
        asOfSequence: [...dataset.asOfSequence].reverse(),
      }),
  );
  assert.throws(
    () => new RegisteredGraphHistoricalDatasetRegistry([{ ...dataset, fingerprint: fp("9") }]),
    (error: unknown) => error instanceof GraphEvidenceError && error.code === "DATASET_FINGERPRINT_MISMATCH",
  );
  const setup = setupEvidence(3);
  await assert.rejects(
    setup.backtests.run(backtestRequest(setup.dataset, "profile.future")),
    (error: unknown) => error instanceof GraphEvidenceError && error.code === "GRAPH_CYCLE_FAILED",
  );
});

test("Backtest idempotency replays evidence and conflicting ranges are rejected with isolated Sessions", async () => {
  const setup = setupEvidence(4);
  const request = backtestRequest(setup.dataset);
  const first = await setup.backtests.run(request);
  const second = await setup.backtests.run(request);
  assert.deepEqual(second, first);
  assert.equal(setup.audit.sessionIds.length, 1);
  await assert.rejects(
    setup.backtests.run({ ...request, endAt: setup.dataset.asOfSequence[1] }),
    (error: unknown) => error instanceof GraphEvidenceError && error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("Walk-Forward selects only from training evidence and validates in fresh non-overlapping Sessions", async () => {
  const setup = setupEvidence(8);
  const resolvePlan = (requestedPlanId: string) => {
    const provider = createSemanticSessionProvider({ sessionIds: [], graphCycles: 0, riskCalls: 0, executionCalls: 0, closeCalls: 0 });
    void provider;
    const composition = createRegisteredGraphBacktestSessionFactory(createSemanticSessionProvider(setup.audit));
    void composition;
    const presetId = requestedPlanId.split(":historical-plan:")[0]!;
    const portsProvider = createSemanticSessionProvider({ sessionIds: [], graphCycles: 0, riskCalls: 0, executionCalls: 0, closeCalls: 0 });
    void portsProvider;
    return {
      schemaVersion: "1.0.0" as const,
      planId: requestedPlanId,
      version: "1.0.0",
      fingerprint: fp("7"),
      lifecycleStatus: "registered" as const,
      createdAt,
      presetRef: { id: presetId, version: "1.0.0", fingerprint: fp("8") },
      compiledGraphRef: { id: `graph:${presetId}`, version: "1.0.0", fingerprint: fp("6") },
      executionMode: "paper_capable" as const,
      marketPackRef,
      requiredCapabilityKinds: ["bar" as const],
      nodes: [{ index: 0, nodeId: "decision", role: "decision" as const, executorId: "executor:decision", authority: "decision_intent" as const, observationWindowIds: [], predecessorNodeIds: [], successorNodeIds: ["portfolio"], inputBindings: [], outputArtifactTypes: ["semantic_decision"] },
        { index: 1, nodeId: "portfolio", role: "portfolio" as const, executorId: "executor:portfolio", authority: "portfolio_action" as const, observationWindowIds: [], predecessorNodeIds: ["decision"], successorNodeIds: ["risk"], inputBindings: [], outputArtifactTypes: ["portfolio_action"] },
        { index: 2, nodeId: "risk", role: "risk" as const, executorId: "executor:risk", authority: "risk_gate" as const, observationWindowIds: [], predecessorNodeIds: ["portfolio"], successorNodeIds: ["execution"], inputBindings: [], outputArtifactTypes: ["risk_decision"] },
        { index: 3, nodeId: "execution", role: "execution" as const, executorId: "executor:execution", authority: "execution" as const, observationWindowIds: [], predecessorNodeIds: ["risk"], successorNodeIds: [], inputBindings: [], outputArtifactTypes: ["execution_result"] }],
      runtimeApplied: false as const,
    };
  };
  const walkForwards = new GraphWalkForwardRunner(
    setup.datasets,
    setup.profileRegistry,
    setup.walkPlans,
    setup.backtests,
    resolvePlan,
    () => new Date(createdAt),
  );
  const run = await walkForwards.run({
    schemaVersion: "1.0.0",
    planId: planId(currentPresetId),
    datasetId: setup.dataset.id,
    profileCandidateSetId: setup.candidateSet.id,
    walkForwardPlanId: setup.walkPlan.id,
    startAt: setup.dataset.asOfSequence[0],
    endAt: setup.dataset.asOfSequence.at(-1),
    idempotencyKey: "walk-forward-0001",
  });
  assert.equal(run.folds.length, 2);
  assert.ok(run.folds.every((fold) => fold.selectedProfileRef.id === "profile.fast"));
  assert.ok(run.folds.every((fold) => Date.parse(fold.trainingEndAt) < Date.parse(fold.validationStartAt)));
  assert.equal(new Set(setup.audit.sessionIds).size, setup.audit.sessionIds.length);
  assert.equal(setup.audit.sessionIds.length, 6);
  assert.equal(run.promotionEligible, true);
});

test("Evidence verification detects result, Dataset, Plan and Profile scope drift", async () => {
  const setup = setupEvidence(3);
  const run = await setup.backtests.run(backtestRequest(setup.dataset));
  const profile = setup.profileRegistry.require("profile.current");
  const evidence = createGraphEvidenceArtifact({
    kind: "graph_backtest",
    result: run,
    profileScopeRef: { id: profile.id, version: profile.version, fingerprint: profile.fingerprint },
    createdAt,
  });
  assert.equal(verifyGraphEvidenceArtifact(evidence, {
    planFingerprint: run.planRef.fingerprint,
    datasetFingerprint: setup.dataset.fingerprint,
    profileScopeFingerprint: profile.fingerprint,
  }).valid, true);
  const drift = verifyGraphEvidenceArtifact(
    { ...evidence, result: { ...run, promotionEligible: false } },
    { planFingerprint: fp("1"), datasetFingerprint: fp("2"), profileScopeFingerprint: fp("3") },
  );
  assert.equal(drift.valid, false);
  assert.ok(drift.issueCodes.includes("RESULT_FINGERPRINT_MISMATCH"));
  assert.ok(drift.issueCodes.includes("PLAN_FINGERPRINT_MISMATCH"));
  assert.ok(drift.issueCodes.includes("DATASET_FINGERPRINT_MISMATCH"));
  assert.ok(drift.issueCodes.includes("PROFILE_SCOPE_FINGERPRINT_MISMATCH"));
});

test("SQLite Graph Evidence Jobs are strict, idempotent, leased, recoverable and immutable", async () => {
  const setup = setupEvidence(3);
  const resolvePlan = () => ({
    schemaVersion: "1.0.0" as const,
    planId: planId(currentPresetId),
    version: "1.0.0",
    fingerprint: fp("7"),
    lifecycleStatus: "registered" as const,
    createdAt,
    presetRef: { id: currentPresetId, version: "1.0.0", fingerprint: fp("8") },
    compiledGraphRef: { id: "graph.current", version: "1.0.0", fingerprint: fp("6") },
    executionMode: "paper_capable" as const,
    marketPackRef,
    requiredCapabilityKinds: ["bar" as const],
    nodes: [
      { index: 0, nodeId: "decision", role: "decision" as const, executorId: "executor:decision", authority: "decision_intent" as const, observationWindowIds: [], predecessorNodeIds: [], successorNodeIds: [], inputBindings: [], outputArtifactTypes: ["semantic_decision"] },
      { index: 1, nodeId: "portfolio", role: "portfolio" as const, executorId: "executor:portfolio", authority: "portfolio_action" as const, observationWindowIds: [], predecessorNodeIds: [], successorNodeIds: [], inputBindings: [], outputArtifactTypes: ["portfolio_action"] },
      { index: 2, nodeId: "risk", role: "risk" as const, executorId: "executor:risk", authority: "risk_gate" as const, observationWindowIds: [], predecessorNodeIds: [], successorNodeIds: [], inputBindings: [], outputArtifactTypes: ["risk_decision"] },
      { index: 3, nodeId: "execution", role: "execution" as const, executorId: "executor:execution", authority: "execution" as const, observationWindowIds: [], predecessorNodeIds: [], successorNodeIds: [], inputBindings: [], outputArtifactTypes: ["execution_result"] },
    ],
    runtimeApplied: false as const,
  });
  const walkForwards = new GraphWalkForwardRunner(setup.datasets, setup.profileRegistry, setup.walkPlans, setup.backtests, resolvePlan);
  const path = join(mkdtempSync(join(tmpdir(), "tradebot-graph-evidence-")), "jobs.sqlite");
  const db = new DatabaseSync(path);
  const repository = new SqliteGraphEvidenceJobRepository(db);
  let nowMs = Date.parse("2026-02-01T00:00:00.000Z");
  const service = new DurableGraphEvidenceJobService(
    repository,
    setup.backtests,
    walkForwards,
    {
      backtest: (profileId) => setup.profileRegistry.require(profileId),
      walkForward: (candidateSetId) => setup.profileRegistry.requireCandidateSet(candidateSetId),
    },
    () => new Date(nowMs),
    1_000,
  );
  const request = { ...backtestRequest(setup.dataset), idempotencyKey: "durable-job-0001" };
  const submitted = service.submitBacktest(request);
  assert.deepEqual(service.submitBacktest(request), submitted);
  assert.throws(() => service.submitBacktest({ ...request, endAt: setup.dataset.asOfSequence[1] }), GraphEvidenceJobError);
  assert.throws(() => service.submitBacktest({ ...request, idempotencyKey: "injected-job-0001", actor: "client" }), zodErrorLike);

  repository.acquire(submitted.jobId, "worker:one", new Date(nowMs).toISOString(), new Date(nowMs + 1_000).toISOString());
  assert.throws(
    () => repository.acquire(submitted.jobId, "worker:two", new Date(nowMs).toISOString(), new Date(nowMs + 1_000).toISOString()),
    (error: unknown) => error instanceof GraphEvidenceJobError && error.code === "GRAPH_JOB_LEASE_HELD",
  );
  nowMs += 2_000;
  assert.equal(repository.recoverExpired(new Date(nowMs).toISOString()), 1);
  const completed = await service.run(submitted.jobId, "worker:two");
  assert.equal(completed.status, "succeeded");
  assert.ok(completed.evidence?.evidenceRef.startsWith("graph-evidence:"));
  assert.throws(
    () => db.prepare("UPDATE graph_evidence_jobs SET evidence_json = '{}' WHERE job_id = ?").run(submitted.jobId),
    /GRAPH_JOB_RESULT_IMMUTABLE/u,
  );
  db.close();

  const reopened = new DatabaseSync(path);
  const restored = new SqliteGraphEvidenceJobRepository(reopened).get(submitted.jobId);
  assert.equal(restored.evidence?.manifestFingerprint, completed.evidence?.manifestFingerprint);
  reopened.close();
});

function zodErrorLike(error: unknown): boolean {
  return error instanceof Error && error.name === "ZodError";
}
