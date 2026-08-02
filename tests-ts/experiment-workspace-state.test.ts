import assert from "node:assert/strict";
import test from "node:test";
import {
  ExperimentCatalogSchema,
  ExperimentSchema,
  type Experiment,
} from "../packages/contracts/src/index.js";
import { graphEvidenceFingerprint } from "../packages/core/src/index.js";
import {
  acceptsExperimentResponse,
  boundedSeries,
  buildExperimentCreateRequest,
  createExperimentFormState,
  experimentActionEnabled,
  mergeExperimentList,
} from "../apps/web/src/experiment-workspace-state.js";

const fp = (name: string) => graphEvidenceFingerprint({ name });
const ref = (id: string) => ({ id, version: "v1", fingerprint: fp(id) });
const time = "2026-08-01T00:00:00.000Z";

const catalog = ExperimentCatalogSchema.parse({
  participants: ["one", "two"].map((suffix) => ({
    versionId: `strategy:${suffix}`,
    draftId: `draft:${suffix}`,
    fingerprint: fp(`strategy:${suffix}`),
    label: suffix,
    eligibility: "eligible",
    issueCodes: [],
    runtimeApplied: false,
  })),
  datasets: ["one", "two"].map((suffix) => ({
    id: `dataset:${suffix}`,
    version: "v1",
    fingerprint: fp(`dataset:${suffix}`),
    startAt: time,
    endAt: "2026-08-02T00:00:00.000Z",
    timezone: "UTC",
    tradingCalendarRef: "calendar:crypto-24x7",
  })),
  walkForwardPlans: ["one", "two"].map((suffix) => ({
    id: `plan:${suffix}`,
    version: "v1",
    fingerprint: fp(`plan:${suffix}`),
  })),
  supportedComparisonModes: ["STRATEGY_COMPARISON", "OPEN_CLASS"],
  runtimeApplied: false,
  exchangeWriteAllowed: false,
});

function record(id: string, status: Experiment["lifecycleStatus"]): Experiment {
  const participant = (suffix: string) => ({
    participantId: `participant:${suffix}`,
    label: suffix,
    strategyVersionRef: ref(`strategy:${suffix}`),
    strategyFingerprint: fp(`strategy:${suffix}`),
    executableFingerprint: fp(`executable:${suffix}`),
    historicalPlanRef: ref("historical-plan:one"),
    marketPackRef: ref("market-pack:one"),
    baseProfileRef: ref("profile:base"),
    profileRef: ref(`profile:${suffix}`),
    candidateSetRef: ref(`set:${suffix}`),
    agentConfigurationRefs: [ref(`agent:${suffix}`)],
    promptPolicyRefs: [],
    configProjection: {
      marketPackId: "market-pack:one",
      modelMode: "rule",
      executionFingerprint: fp("execution"),
      riskFingerprint: fp("risk"),
      modelFingerprint: fp("model"),
      promptSetFingerprint: fp("prompt"),
      graphFingerprint: fp("graph"),
      agentGraphFingerprint: fp("agent-graph"),
      effectiveParameters: {},
    },
    constraintResults: [],
    issueCodes: [],
  });
  return ExperimentSchema.parse({
    schemaVersion: "1.0.0",
    experimentId: id,
    fingerprint: fp(id),
    createdAt: time,
    actorId: "actor:one",
    lifecycleStatus: status,
    comparability: { status: "CONTROLLED", requestedMode: "STRATEGY_COMPARISON", changedDimensions: ["strategy"], lockedDimensions: ["dataset"], issueCodes: [] },
    lock: {
      dataset: { datasetRef: ref("dataset:one"), marketPackRef: ref("market-pack:one"), dataSourceRef: ref("data-source:one"), timezone: "UTC", tradingCalendarRef: "calendar:crypto-24x7", startAt: time, endAt: "2026-08-02T00:00:00.000Z" },
      walkForwardPlanRef: ref("plan:one"),
      objective: { kind: "maximize_total_return" },
      constraints: {},
      execution: { model: "graph_trading", parameters: {}, fingerprint: fp("execution-lock"), unavailableFields: ["initial_capital", "fee_bps", "slippage_bps"] },
      risk: { parameters: {}, fingerprint: fp("risk-lock") },
      modelPrompt: { modelMode: "rule", modelFingerprint: fp("model"), promptRefs: [], promptSetFingerprint: fp("prompt") },
      failurePolicy: "fail_closed",
      runtimeApplied: false,
      exchangeWriteAllowed: false,
    },
    participants: [participant("one"), participant("two")],
    configurationDiff: [],
  });
}

test("experiment form preserves non-default server selections across renders", () => {
  const initial = createExperimentFormState(catalog, "idempotency:first");
  const changed = createExperimentFormState(catalog, "idempotency:ignored", {
    ...initial,
    datasetId: "dataset:two",
    walkForwardPlanId: "plan:two",
    comparisonMode: "OPEN_CLASS",
    minimumTradeCount: 5,
    runtimeFailureCountEqZero: true,
  });
  const request = buildExperimentCreateRequest(catalog, changed, ["strategy:one", "strategy:two"]);
  assert.equal(request.datasetId, "dataset:two");
  assert.equal(request.walkForwardPlanId, "plan:two");
  assert.equal(request.comparisonMode, "OPEN_CLASS");
  assert.deepEqual(request.constraints, { minimumTradeCount: 5, runtimeFailureCountEqZero: true });
  assert.equal(request.idempotencyKey, "idempotency:first");
});

test("experiment actions are gated by lifecycle and comparability", () => {
  assert.equal(experimentActionEnabled(record("experiment:draft", "draft"), "backtest"), true);
  assert.equal(experimentActionEnabled(record("experiment:draft", "draft"), "walk-forward"), false);
  assert.equal(experimentActionEnabled(record("experiment:backtest", "backtest_complete"), "walk-forward"), true);
  assert.equal(experimentActionEnabled(record("experiment:evidence", "evidence_complete"), "candidate"), true);
  assert.equal(experimentActionEnabled(record("experiment:evidence", "evidence_complete"), "replay"), true);
});

test("experiment list merges authority by id and stale action responses are rejected", () => {
  const draft = record("experiment:one", "draft");
  const complete = record("experiment:one", "evidence_complete");
  const other = record("experiment:two", "draft");
  const merged = mergeExperimentList([draft], [complete, other]);
  assert.equal(merged.find((item) => item.experimentId === draft.experimentId)?.lifecycleStatus, "evidence_complete");
  assert.equal(acceptsExperimentResponse({ currentEpoch: 3, responseEpoch: 2, selectedExperimentId: "experiment:one", requestedExperimentId: "experiment:one" }), false);
  assert.equal(acceptsExperimentResponse({ currentEpoch: 3, responseEpoch: 3, selectedExperimentId: "experiment:two", requestedExperimentId: "experiment:one" }), false);
  assert.equal(acceptsExperimentResponse({ currentEpoch: 3, responseEpoch: 3, selectedExperimentId: "experiment:one", requestedExperimentId: "experiment:one" }), true);
});

test("equity series is bounded while preserving both endpoints", () => {
  const points = Array.from({ length: 1_118 }, (_, index) => index);
  const sampled = boundedSeries(points);
  assert.equal(sampled.length, 120);
  assert.equal(sampled[0], 0);
  assert.equal(sampled.at(-1), 1_117);
  assert.deepEqual(boundedSeries([1, 2, 3]), [1, 2, 3]);
});
