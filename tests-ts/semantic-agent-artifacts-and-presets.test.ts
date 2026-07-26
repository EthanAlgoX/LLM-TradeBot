import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentSemanticAssessmentSchema,
  ApprovedReflectionLessonSchema,
  DecisionSemanticContextSchema,
  MarketObservationArtifactSchema,
  ReflectionLessonCandidateSchema,
  SemanticDecisionArtifactSchema,
  mapLegacyMultiTimeframeSnapshotToObservations,
  type AgentSemanticAssessment,
  type MarketObservationArtifact,
} from "../packages/contracts/src/index.js";
import { createRegisteredSemanticPipelinePresetCatalog } from "../packages/core/src/index.js";

const fp = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const at = "2026-01-01T01:00:00.000Z";
const marketPackRef = { id: "market-pack.crypto", version: "1.0.0", fingerprint: fp("a") };
const schemaRef = { schemaId: "schema.market-observation", schemaVersion: "1.0.0" };
const agentRef = { id: "agent.config.analysis", version: "1.0.0", fingerprint: fp("b") };
const decisionAgentRef = { id: "agent.config.decision", version: "1.0.0", fingerprint: fp("c") };
const reflectionAgentRef = { id: "agent.config.reflection", version: "1.0.0", fingerprint: fp("d") };

function bar(openedAt: string, closedAt: string) {
  return {
    openedAt,
    closedAt,
    availableAt: closedAt,
    open: 100,
    high: 110,
    low: 95,
    close: 105,
    volume: 42,
  };
}

function observation(windowId: string, lineageCharacter: string, artifactCharacter: string): MarketObservationArtifact {
  return MarketObservationArtifactSchema.parse({
    schemaVersion: "1.0.0",
    id: `observation:${windowId}`,
    version: "1.0.0",
    fingerprint: fp(artifactCharacter),
    lifecycleStatus: "validated",
    createdAt: at,
    marketPackRef,
    schemaRef,
    artifactType: "market_observation",
    asOf: at,
    availableAt: at,
    observationWindowRef: {
      id: windowId,
      version: "1.0.0",
      fingerprint: fp(artifactCharacter),
      kind: "bar_interval",
    },
    lineage: {
      lineageId: `lineage:${windowId}`,
      fingerprint: fp(lineageCharacter),
      sourceDefinitionId: "data-source.csv-historical",
      sourceCapabilityId: "capability.csv-bars",
      transformationVersion: "1.0.0",
      timezone: "UTC",
      tradingCalendarRef: "calendar.crypto.24x7",
    },
    payload: {
      kind: "bar_interval",
      symbol: "BTCUSDT",
      bars: [bar("2026-01-01T00:55:00.000Z", "2026-01-01T01:00:00.000Z")],
    },
  });
}

function assessment(
  source: MarketObservationArtifact,
  artifactCharacter: string,
  kind: "window_analysis" | "bull_case" | "bear_case" = "window_analysis",
): AgentSemanticAssessment {
  return AgentSemanticAssessmentSchema.parse({
    schemaVersion: "1.0.0",
    id: `assessment:${artifactCharacter}`,
    version: "1.0.0",
    fingerprint: fp(artifactCharacter),
    lifecycleStatus: "validated",
    createdAt: at,
    marketPackRef,
    schemaRef: { schemaId: "schema.agent-semantic-assessment", schemaVersion: "1.0.0" },
    artifactType: "agent_semantic_assessment",
    assessmentKind: kind,
    agentConfigRef: agentRef,
    observationWindowRef: kind === "window_analysis" ? source.observationWindowRef : undefined,
    direction: kind === "bear_case" ? "bearish" : "bullish",
    confidence: 0.72,
    regime: "trend",
    semanticThesis: `${source.observationWindowRef.id} maintains a constructive structure.`,
    supportingEvidence: [
      {
        evidenceId: `evidence:${artifactCharacter}`,
        sourceArtifactRef: {
          artifactId: source.id,
          artifactType: source.artifactType,
          fingerprint: source.fingerprint,
        },
        evidenceType: "price_structure",
        locator: "bars[-1]",
        summary: "The latest closed bar preserves higher support.",
      },
    ],
    invalidationConditions: ["A closed bar below the referenced support invalidates the thesis."],
    riskFlags: [],
    sourceArtifactRefs: [
      { artifactId: source.id, artifactType: source.artifactType, fingerprint: source.fingerprint },
    ],
    lineageFingerprint: source.lineage.fingerprint,
  });
}

function baseDecisionContext(observations: MarketObservationArtifact[], assessments: AgentSemanticAssessment[]) {
  return {
    schemaVersion: "1.0.0" as const,
    id: "decision-context:btc:20260101",
    version: "1.0.0",
    fingerprint: fp("9"),
    lifecycleStatus: "validated" as const,
    createdAt: at,
    marketPackRef,
    schemaRef: { schemaId: "schema.decision-semantic-context", schemaVersion: "1.0.0" },
    artifactType: "decision_semantic_context" as const,
    asOf: at,
    decisionAgentConfigRef: decisionAgentRef,
    observations,
    assessments,
    approvedLessons: [],
    portfolioState: {
      asOf: at,
      baseCurrency: "USDT",
      equity: 10_000,
      availableCash: 8_000,
      openPositionRefs: [],
    },
    riskState: {
      asOf: at,
      riskProfileId: "risk-profile.paper-default",
      newEntriesPaused: false,
      closeOnly: false,
      remainingRiskBudget: 100,
      activeFlags: [],
    },
    dataQuality: {
      status: "pass" as const,
      issueCodes: [],
      checkedArtifactRefs: observations.map((item) => ({
        artifactId: item.id,
        artifactType: item.artifactType,
        fingerprint: item.fingerprint,
      })),
    },
    lineageFingerprints: [...new Set(observations.map((item) => item.lineage.fingerprint))],
  };
}

test("legacy multi-timeframe snapshot maps complete 5m/15m/1h OHLCV into independent observations", () => {
  const observations = mapLegacyMultiTimeframeSnapshotToObservations(
    {
      snapshotId: "snapshot:btc:20260101",
      version: "1.0.0",
      createdAt: at,
      asOf: at,
      symbol: "BTCUSDT",
      marketPackRef,
      observationSchemaRef: schemaRef,
      windows: ["5m", "15m", "1h"].map((label, index) => ({
        windowRef: {
          id: `window.crypto.${label}`,
          version: "1.0.0",
          fingerprint: fp(String(index + 1)),
          kind: "bar_interval" as const,
        },
        lineage: {
          lineageId: `lineage:crypto:${label}`,
          fingerprint: fp(String(index + 4)),
          sourceDefinitionId: "data-source.csv-historical",
          sourceCapabilityId: `capability.csv.${label}`,
          transformationVersion: "1.0.0",
          timezone: "UTC",
          tradingCalendarRef: "calendar.crypto.24x7",
        },
        bars: [bar("2026-01-01T00:00:00.000Z", at)],
        availableAt: at,
      })),
    },
    (value) => fp(String((JSON.stringify(value).length % 9) + 1)),
  );

  assert.equal(observations.length, 3);
  assert.deepEqual(observations.map((item) => item.observationWindowRef.id), [
    "window.crypto.5m",
    "window.crypto.15m",
    "window.crypto.1h",
  ]);
  assert.ok(observations.every((item) => item.payload.kind === "bar_interval"));
});

test("event-only observations are expressible without K-line payloads", () => {
  const parsed = MarketObservationArtifactSchema.parse({
    schemaVersion: "1.0.0",
    id: "observation:event-batch:1",
    version: "1.0.0",
    fingerprint: fp("1"),
    lifecycleStatus: "validated",
    createdAt: at,
    marketPackRef,
    schemaRef,
    artifactType: "market_observation",
    asOf: at,
    availableAt: at,
    observationWindowRef: {
      id: "window.event.batch",
      version: "1.0.0",
      fingerprint: fp("2"),
      kind: "event_batch",
    },
    lineage: {
      lineageId: "lineage:event:1",
      fingerprint: fp("3"),
      sourceDefinitionId: "data-source.registered-events",
      sourceCapabilityId: "capability.registered-events",
      transformationVersion: "1.0.0",
      timezone: "UTC",
      tradingCalendarRef: "calendar.crypto.24x7",
    },
    payload: {
      kind: "event_batch",
      topic: "crypto-market-news",
      events: [
        {
          eventId: "event:1",
          eventType: "market_news",
          occurredAt: "2026-01-01T00:30:00.000Z",
          availableAt: "2026-01-01T00:31:00.000Z",
          headline: "Registered fixture event",
          content: "Structured event content used by the research-only fixture.",
          attributes: { severity: 2 },
        },
      ],
    },
  });
  assert.equal(parsed.payload.kind, "event_batch");
});

test("multi-window semantic assessments retain thesis, evidence, invalidation and lineage", () => {
  const observations = [
    observation("window.crypto.5m", "1", "4"),
    observation("window.crypto.15m", "2", "5"),
    observation("window.crypto.1h", "3", "6"),
  ];
  const assessments = observations.map((item, index) => assessment(item, String(index + 7)));
  const context = DecisionSemanticContextSchema.parse(baseDecisionContext(observations, assessments));
  assert.equal(context.assessments.length, 3);
  assert.ok(context.assessments.every((item) => item.semanticThesis.length > 0));
  assert.ok(context.assessments.every((item) => item.supportingEvidence.length === 1));
});

test("Bull and Bear semantic assessments can be aggregated by Decision", () => {
  const source = observation("window.crypto.1h", "1", "2");
  const context = DecisionSemanticContextSchema.parse(
    baseDecisionContext(source ? [source] : [], [
      assessment(source, "3", "bull_case"),
      assessment(source, "4", "bear_case"),
    ]),
  );
  assert.deepEqual(context.assessments.map((item) => item.assessmentKind), ["bull_case", "bear_case"]);
});

test("Reflection Lesson Candidate cannot be injected into Decision Context", () => {
  const source = observation("window.crypto.1h", "1", "2");
  const candidate = ReflectionLessonCandidateSchema.parse({
    schemaVersion: "1.0.0",
    id: "lesson-candidate:1",
    version: "1.0.0",
    fingerprint: fp("3"),
    lifecycleStatus: "candidate",
    createdAt: at,
    marketPackRef,
    schemaRef: { schemaId: "schema.reflection-lesson-candidate", schemaVersion: "1.0.0" },
    artifactType: "reflection_lesson_candidate",
    reflectionAgentConfigRef: reflectionAgentRef,
    failedTradeRef: {
      tradeId: "trade:failed:1",
      decisionArtifactRef: {
        artifactId: "decision:failed:1",
        artifactType: "semantic_decision",
        fingerprint: fp("4"),
      },
    },
    semanticLesson: "Do not enter after a failed breakout without renewed volume confirmation.",
    failurePattern: "Late breakout entry with declining volume.",
    applicableMarketPackIds: [marketPackRef.id],
    applicableRegimes: ["trend"],
    confidence: 0.8,
    supportingEvidence: [
      {
        evidenceId: "evidence:lesson:1",
        sourceArtifactRef: { artifactId: source.id, artifactType: source.artifactType, fingerprint: source.fingerprint },
        evidenceType: "lesson",
        locator: "failed-trade",
        summary: "The failed trade followed declining volume.",
      },
    ],
  });
  const invalid = { ...baseDecisionContext([source], [assessment(source, "5")]), lessonCandidates: [candidate] };
  assert.equal(DecisionSemanticContextSchema.safeParse(invalid).success, false);
});

test("human-approved Reflection Lesson enters Decision Context with provenance", () => {
  const source = observation("window.crypto.1h", "1", "2");
  const approved = ApprovedReflectionLessonSchema.parse({
    schemaVersion: "1.0.0",
    id: "approved-lesson:1",
    version: "1.0.0",
    fingerprint: fp("3"),
    lifecycleStatus: "approved",
    createdAt: at,
    marketPackRef,
    schemaRef: { schemaId: "schema.approved-reflection-lesson", schemaVersion: "1.0.0" },
    artifactType: "approved_reflection_lesson",
    candidateRef: { artifactId: "lesson-candidate:1", artifactType: "reflection_lesson_candidate", fingerprint: fp("4") },
    approval: { approvalId: "approval:lesson:1", approvedBy: "operator:human:1", approvedAt: at },
    failedTradeRef: {
      tradeId: "trade:failed:1",
      decisionArtifactRef: { artifactId: "decision:failed:1", artifactType: "semantic_decision", fingerprint: fp("5") },
    },
    semanticLesson: "Require renewed volume confirmation after a failed breakout.",
    failurePattern: "Late breakout entry with declining volume.",
    applicableMarketPackIds: [marketPackRef.id],
    applicableRegimes: ["trend"],
    confidence: 0.8,
    supportingEvidence: [
      {
        evidenceId: "evidence:approved-lesson:1",
        sourceArtifactRef: { artifactId: source.id, artifactType: source.artifactType, fingerprint: source.fingerprint },
        evidenceType: "lesson",
        locator: "failed-trade",
        summary: "Human-reviewed failed-trade evidence.",
      },
    ],
  });
  const input = { ...baseDecisionContext([source], [assessment(source, "6")]), approvedLessons: [approved] };
  const parsed = DecisionSemanticContextSchema.parse(input);
  assert.equal(parsed.approvedLessons[0]?.approval.approvedBy, "operator:human:1");
});

test("Decision Context fails closed when assessment lineage does not match source artifacts", () => {
  const source = observation("window.crypto.1h", "1", "2");
  const invalidAssessment = { ...assessment(source, "3"), lineageFingerprint: fp("8") };
  assert.equal(
    DecisionSemanticContextSchema.safeParse(
      baseDecisionContext([source], [invalidAssessment]),
    ).success,
    false,
  );
});

test("Semantic Decision remains an intent and requires Portfolio/Risk chain", () => {
  const parsed = SemanticDecisionArtifactSchema.parse({
    schemaVersion: "1.0.0",
    id: "semantic-decision:1",
    version: "1.0.0",
    fingerprint: fp("1"),
    lifecycleStatus: "validated",
    createdAt: at,
    marketPackRef,
    schemaRef: { schemaId: "schema.semantic-decision", schemaVersion: "1.0.0" },
    artifactType: "semantic_decision",
    asOf: at,
    decisionAgentConfigRef: decisionAgentRef,
    decisionContextRef: { artifactId: "decision-context:1", artifactType: "decision_semantic_context", fingerprint: fp("2") },
    intent: "hold",
    confidence: 0.6,
    semanticRationale: "The Agent assessments conflict, so the controlled intent is to hold.",
    supportingEvidence: [
      {
        evidenceId: "evidence:decision:1",
        sourceArtifactRef: { artifactId: "assessment:1", artifactType: "agent_semantic_assessment", fingerprint: fp("3") },
        evidenceType: "agent_assessment",
        locator: "assessments",
        summary: "Bull and Bear assessments remain balanced.",
      },
    ],
    riskFlags: ["conflicting_assessments"],
    requiresPortfolioRiskChain: true,
  });
  assert.equal(parsed.requiresPortfolioRiskChain, true);
  assert.equal("order" in parsed, false);
});

test("registered Preset Catalog contains current Crypto, daily and event-only baselines", () => {
  const catalog = createRegisteredSemanticPipelinePresetCatalog();
  const presets = catalog.list();
  assert.deepEqual(presets.map((preset) => preset.id), [
    "preset.current-crypto-multi-agent",
    "preset.single-window-daily",
    "preset.event-only-research",
  ]);
  assert.equal(catalog.require("preset.current-crypto-multi-agent").availability, "registered_available");
  assert.equal(catalog.require("preset.single-window-daily").observationWindows[0]?.unit, "day");
  assert.equal(catalog.require("preset.event-only-research").requiredCapabilityKinds[0], "event");
  assert.equal(catalog.require("preset.event-only-research").executionMode, "research_only");
});

test("current Crypto Preset preserves action boundary, Position Monitor and post-trade Reflection", () => {
  const preset = createRegisteredSemanticPipelinePresetCatalog().require("preset.current-crypto-multi-agent");
  assert.deepEqual(preset.observationWindows.map((window) => window.label), ["5m", "15m", "1h"]);
  assert.equal(preset.nodes.filter((node) => node.role === "window_analysis").length, 3);
  assert.ok(preset.nodes.some((node) => node.role === "position_monitor"));
  assert.ok(preset.nodes.some((node) => node.role === "reflection" && node.outputArtifactTypes.includes("reflection_lesson_candidate")));
  const actionChain = [
    ["decision", "portfolio"],
    ["portfolio", "risk"],
    ["risk", "execution"],
  ];
  for (const [sourceRole, targetRole] of actionChain) {
    const source = preset.nodes.find((node) => node.role === sourceRole);
    const target = preset.nodes.find((node) => node.role === targetRole);
    assert.ok(preset.edges.some((edge) => edge.sourceNodeId === source?.nodeId && edge.targetNodeId === target?.nodeId));
  }
  assert.ok(preset.edges.some((edge) => edge.sourceNodeId === "execution" && edge.targetNodeId === "reflection"));
});

test("Preset Catalog has no client registration surface and rejects unknown IDs stably", () => {
  const catalog = createRegisteredSemanticPipelinePresetCatalog();
  assert.equal("register" in catalog, false);
  assert.throws(
    () => catalog.require("preset.client-injected"),
    /SEMANTIC_PRESET_NOT_REGISTERED:preset\.client-injected/u,
  );
});
