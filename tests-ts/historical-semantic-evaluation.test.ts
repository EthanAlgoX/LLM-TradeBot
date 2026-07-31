import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HistoricalSemanticEvaluationCommandSchema,
  SemanticPipelineExecutionRecordSchema,
  type OrchestrationActor,
  type SemanticPipelineExecutionRecord,
  type StrategyEvidenceBinding,
} from "../packages/contracts/src/index.js";
import {
  HistoricalSemanticEvaluationError,
  HistoricalSemanticEvaluationService,
  type ExistingStrategyEvidenceGateway,
  type HistoricalSemanticExecutionVerifier,
  type HistoricalSemanticEvaluationScopeResolver,
  type SemanticPipelineExecutionRepository,
} from "../packages/core/src/index.js";
import {
  HistoricalSemanticEvaluationHttpHandler,
  LocalBearerAuthenticator,
} from "../packages/runtime/src/index.js";
import { deriveHistoricalSemanticEvaluationViewState } from "../apps/web/src/historical-semantic-evaluation-view-state.js";

const asOf = "2026-07-31T08:00:00.000Z";
const fp = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const operator: OrchestrationActor = { actorId: "actor.operator", displayName: "Operator", roles: ["operator"] };
const approver: OrchestrationActor = { actorId: "actor.approver", displayName: "Approver", roles: ["approver"] };

function execution(kind: "bar_interval" | "event_batch" = "bar_interval", sourceDefinitionId = "data-source.registered", timestamp = asOf): SemanticPipelineExecutionRecord {
  const windowRef = { id: `window:${kind}`, version: "1.0.0", fingerprint: fp("1"), kind } as const;
  const payload = kind === "bar_interval"
    ? { kind, symbol: "GENERIC", bars: [{ openedAt: "2026-07-31T07:55:00.000Z", closedAt: timestamp, availableAt: timestamp, open: 100, high: 102, low: 99, close: 101, volume: 10 }] }
    : { kind, topic: "generic", events: [{ eventId: "event.generic", eventType: "fact", occurredAt: timestamp, availableAt: timestamp, headline: "Generic fact", content: "Registered event fact.", attributes: {} }] };
  const observation = {
    schemaVersion: "1.0.0", id: `observation.${kind}`, version: "1.0.0", fingerprint: fp("2"), lifecycleStatus: "validated", createdAt: timestamp,
    marketPackRef: { id: "market-pack.generic", version: "1.0.0", fingerprint: fp("3") },
    schemaRef: { schemaId: "schema.observation", schemaVersion: "1.0.0" }, artifactType: "market_observation", asOf: timestamp, availableAt: timestamp,
    observationWindowRef: windowRef,
    lineage: { lineageId: `lineage.${kind}`, fingerprint: fp("4"), sourceDefinitionId, sourceCapabilityId: "capability.registered", transformationVersion: "1.0.0", timezone: "UTC", tradingCalendarRef: "calendar.generic" },
    payload,
  } as const;
  const assessments = ["5", "6"].map((character, index) => ({
    schemaVersion: "1.0.0", id: `assessment.${kind}.${index}`, version: "1.0.0", fingerprint: fp(character), lifecycleStatus: "validated", createdAt: timestamp,
    marketPackRef: observation.marketPackRef, schemaRef: { schemaId: "schema.assessment", schemaVersion: "1.0.0" }, artifactType: "agent_semantic_assessment",
    assessmentKind: "window_analysis", agentConfigRef: { id: `agent-config.${index}`, version: "1.0.0", fingerprint: fp(index === 0 ? "7" : "8") }, observationWindowRef: windowRef,
    direction: index === 0 ? "bullish" : "bearish", confidence: 0.6, regime: "generic", semanticThesis: "Registered historical semantic assessment.",
    supportingEvidence: [{ evidenceId: `evidence.${index}`, sourceArtifactRef: { artifactId: observation.id, artifactType: observation.artifactType, fingerprint: observation.fingerprint }, evidenceType: kind === "event_batch" ? "event" : "price_structure", locator: "registered", summary: "Registered source fact." }],
    invalidationConditions: ["Source lineage changes."], riskFlags: [], sourceArtifactRefs: [{ artifactId: observation.id, artifactType: observation.artifactType, fingerprint: observation.fingerprint }], lineageFingerprint: observation.lineage.fingerprint,
  }));
  return SemanticPipelineExecutionRecordSchema.parse({
    schemaVersion: "1.0.0", executionId: `semantic-execution.${kind}`, humanVersion: "v1", fingerprint: fp("9"), createdAt: timestamp,
    lifecycleStatus: "decision_context_unavailable", actorId: "actor.operator", idempotencyKey: `execution.${kind}`,
    configurationRef: { id: "configuration-version.strategy", humanVersion: "v1", fingerprint: fp("a") }, semanticPipelineRef: { previewId: "semantic-preview.generic", fingerprint: fp("b") },
    observations: [observation], assessments, issueCodes: ["DECISION_CONTEXT_SNAPSHOT_UNAVAILABLE"], nextGate: "decision_context_snapshot", sourceMode: "server_registered",
    decisionContextApplied: false, runtimeApplied: false, exchangeWriteAllowed: false,
  });
}

class MemoryExecutions implements SemanticPipelineExecutionRepository {
  constructor(private readonly value: SemanticPipelineExecutionRecord) {}
  findByIdempotency(): SemanticPipelineExecutionRecord | undefined { return undefined; }
  get(executionId: string): SemanticPipelineExecutionRecord {
    if (executionId !== this.value.executionId) throw new Error("SEMANTIC_PIPELINE_EXECUTION_NOT_FOUND");
    return this.value;
  }
  save(): void { throw new Error("READ_ONLY"); }
}

class FakeEvidence implements ExistingStrategyEvidenceGateway {
  binding: StrategyEvidenceBinding | undefined;
  findByConfigurationVersionId(): StrategyEvidenceBinding | undefined { return this.binding; }
  createBinding(_request: unknown, actor: OrchestrationActor): StrategyEvidenceBinding {
    if (!actor.roles.includes("operator")) throw new Error("STRATEGY_EVIDENCE_ACTOR_ROLE_REQUIRED");
    if (!this.binding) this.binding = this.makeBinding();
    return this.binding;
  }
  async runBacktest(_id: string, _request: unknown, actor: OrchestrationActor): Promise<StrategyEvidenceBinding> {
    if (!actor.roles.includes("operator")) throw new Error("STRATEGY_EVIDENCE_ACTOR_ROLE_REQUIRED");
    this.binding = { ...this.binding!, lifecycleStatus: "partial_evidence", backtestJob: { jobId: "job.backtest", status: "succeeded", evidenceRef: "evidence.backtest", evidenceFingerprint: fp("c") } };
    return this.binding;
  }
  async runWalkForward(_id: string, _request: unknown, actor: OrchestrationActor): Promise<StrategyEvidenceBinding> {
    if (!actor.roles.includes("operator")) throw new Error("STRATEGY_EVIDENCE_ACTOR_ROLE_REQUIRED");
    if (!this.binding?.backtestJob) throw new Error("STRATEGY_EVIDENCE_NOT_READY");
    this.binding = { ...this.binding, lifecycleStatus: "evidence_ready", walkForwardJob: { jobId: "job.walk-forward", status: "succeeded", evidenceRef: "evidence.walk-forward", evidenceFingerprint: fp("d") } };
    return this.binding;
  }
  approve(_id: string, _request: unknown, actor: OrchestrationActor): unknown {
    if (!actor.roles.includes("approver")) throw new Error("STRATEGY_EVIDENCE_ACTOR_ROLE_REQUIRED");
    if (!this.binding?.backtestJob || !this.binding.walkForwardJob) throw new Error("STRATEGY_EVIDENCE_NOT_READY");
    this.binding = { ...this.binding, lifecycleStatus: "approved", approval: { approvalId: "approval.generic", actorId: actor.actorId, actorDisplayName: actor.displayName, approvedAt: asOf, evidenceFingerprints: [fp("c"), fp("d")] }, approvedPaperPlanId: "paper-plan.generic" };
    return {};
  }
  get(): StrategyEvidenceBinding { return this.binding!; }
  private makeBinding(): StrategyEvidenceBinding {
    return { schemaVersion: "1.0.0", bindingId: "binding.generic", versionId: "binding-version.generic", versionIndex: 1, fingerprint: fp("e"), lifecycleStatus: "draft", createdAt: asOf, updatedAt: asOf, createdByActorId: "actor.operator", configurationRef: { draftId: "draft.strategy", versionId: "configuration-version.strategy", versionFingerprint: fp("a"), payloadFingerprint: fp("f") }, historicalPlanRef: { id: "plan.generic", version: "v1", fingerprint: fp("1") }, compiledGraphRef: { id: "graph.generic", version: "v1", fingerprint: fp("2") }, marketPackRef: { id: "market-pack.generic", version: "v1", fingerprint: fp("3") }, datasetRef: { id: "dataset.generic", version: "v1", fingerprint: fp("4") }, dataSourceRef: { id: "data-source.registered", version: "v1", fingerprint: fp("5") }, backtestProfileRef: { id: "profile.generic", version: "v1", fingerprint: fp("6") }, walkForwardCandidateSetRef: { id: "candidate-set.generic", version: "v1", fingerprint: fp("7") }, walkForwardPlanRef: { id: "walk-forward.generic", version: "v1", fingerprint: fp("8") }, startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-01-03T00:00:00.000Z", runtimeApplied: false };
  }
}

const scope: HistoricalSemanticEvaluationScopeResolver = { resolve: () => ({ datasetId: "dataset.generic", dataSourceId: "data-source.registered", backtestProfileId: "profile.generic", walkForwardCandidateSetId: "candidate-set.generic", walkForwardPlanId: "walk-forward.generic", startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-01-03T00:00:00.000Z" }) };
const validVerifier: HistoricalSemanticExecutionVerifier = { verify: () => [] };
const fixedNow = () => new Date("2026-07-31T12:00:00.000Z");

function service(record = execution(), verifier = validVerifier, evidence = new FakeEvidence()) {
  return { evidence, service: new HistoricalSemanticEvaluationService(new MemoryExecutions(record), verifier, scope, evidence, fixedNow) };
}

test("historical semantic command rejects Dataset Runner Profile Graph Evidence Actor time range and Runtime injection", () => {
  assert.throws(() => HistoricalSemanticEvaluationCommandSchema.parse({ schemaVersion: "1.0.0", executionId: "semantic-execution.bar_interval", action: "create_binding", idempotencyKey: "evaluation.one", datasetId: "attacker", runner: "dynamic", profileId: "attacker", graphId: "attacker", evidenceId: "attacker", actorId: "attacker", startAt: asOf, runtimeApplied: true }));
});

test("bar and event semantic inputs create existing Strategy Evidence bindings", async () => {
  for (const kind of ["bar_interval", "event_batch"] as const) {
    const record = execution(kind);
    const result = await service(record).service.execute({ schemaVersion: "1.0.0", executionId: record.executionId, action: "create_binding", idempotencyKey: `binding.${kind}` }, operator);
    assert.equal(result.lifecycleStatus, "contract_validated");
    assert.deepEqual(result.inputKinds, [kind]);
    assert.equal(result.historicalEngine, "existing_graph_evidence");
  }
});

test("existing Backtest Walk-Forward and Human Approval gates remain ordered", async () => {
  const record = execution();
  const harness = service(record);
  await assert.rejects(harness.service.execute({ schemaVersion: "1.0.0", executionId: record.executionId, action: "submit_approval", idempotencyKey: "approval.blocked" }, approver), (error) => error instanceof HistoricalSemanticEvaluationError && error.code === "SEMANTIC_EVIDENCE_BINDING_REQUIRED");
  const backtest = await harness.service.execute({ schemaVersion: "1.0.0", executionId: record.executionId, action: "run_backtest", idempotencyKey: "backtest.generic" }, operator);
  assert.equal(backtest.gates.backtest, "passed");
  const walkForward = await harness.service.execute({ schemaVersion: "1.0.0", executionId: record.executionId, action: "run_walk_forward", idempotencyKey: "walk-forward.generic" }, operator);
  assert.equal(walkForward.lifecycleStatus, "approval_ready");
  const approved = await harness.service.execute({ schemaVersion: "1.0.0", executionId: record.executionId, action: "submit_approval", idempotencyKey: "approval.generic" }, approver);
  assert.equal(approved.lifecycleStatus, "approved_not_applied");
  assert.equal(approved.runtimeApplied, false);
});

test("future facts capability scope mismatch and Agent Adapter drift fail closed before Evidence", async () => {
  const future = execution("event_batch", "data-source.registered", "2026-08-01T00:00:00.000Z");
  assert.deepEqual((await service(future).service.execute({ schemaVersion: "1.0.0", executionId: future.executionId, action: "create_binding", idempotencyKey: "future.generic" }, operator)).issueCodes, ["SEMANTIC_EXECUTION_FUTURE_DATA"]);
  const mismatch = execution("bar_interval", "data-source.other");
  assert.deepEqual((await service(mismatch).service.execute({ schemaVersion: "1.0.0", executionId: mismatch.executionId, action: "create_binding", idempotencyKey: "capability.mismatch" }, operator)).issueCodes, ["SEMANTIC_EXECUTION_CAPABILITY_SCOPE_MISMATCH"]);
  const drift = service(execution(), { verify: () => ["SEMANTIC_PIPELINE_OR_AGENT_ADAPTER_STALE"] });
  assert.deepEqual((await drift.service.execute({ schemaVersion: "1.0.0", executionId: "semantic-execution.bar_interval", action: "create_binding", idempotencyKey: "adapter.drift" }, operator)).issueCodes, ["SEMANTIC_PIPELINE_OR_AGENT_ADAPTER_STALE"]);
});

test("historical semantic HTTP derives Bearer actor and rejects scope injection", async () => {
  const record = execution();
  const handler = new HistoricalSemanticEvaluationHttpHandler(service(record).service, new LocalBearerAuthenticator([{ token: "operator-token", actor: operator }]));
  const url = "http://localhost/api/orchestration/semantic-evaluation/actions";
  assert.equal((await handler.handle(new Request(url, { method: "POST", body: "{}" }))).status, 401);
  const rejected = await handler.handle(new Request(url, { method: "POST", headers: { authorization: "Bearer operator-token", "content-type": "application/json" }, body: JSON.stringify({ schemaVersion: "1.0.0", executionId: record.executionId, action: "create_binding", idempotencyKey: "http.inject", runner: "dynamic" }) }));
  assert.equal(rejected.status, 400);
  const accepted = await handler.handle(new Request(url, { method: "POST", headers: { authorization: "Bearer operator-token", "content-type": "application/json" }, body: JSON.stringify({ schemaVersion: "1.0.0", executionId: record.executionId, action: "create_binding", idempotencyKey: "http.accepted" }) }));
  assert.equal(accepted.status, 201);
});

test("historical semantic Web state distinguishes full Evidence lifecycle", () => {
  assert.equal(deriveHistoricalSemanticEvaluationViewState({ loading: true }), "loading");
  assert.equal(deriveHistoricalSemanticEvaluationViewState({ lifecycleStatus: "approval_ready" }), "approval_ready");
  assert.equal(deriveHistoricalSemanticEvaluationViewState({ lifecycleStatus: "approved_not_applied" }), "approved_not_applied");
  assert.equal(deriveHistoricalSemanticEvaluationViewState({ unavailable: true }), "unavailable");
});
