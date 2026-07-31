import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovedLessonMaterializationCommandSchema,
  ApprovedReflectionLessonSchema,
  ReflectionLessonCandidateSchema,
  type LessonHumanApprovalResponse,
  type LessonEvidenceGateProjection,
} from "../packages/contracts/src/index.js";
import { ApprovedLessonMaterializationService } from "../packages/core/src/approved-lesson-materialization-service.js";
import { ComparativeTradeReviewHttpHandler } from "../packages/runtime/src/comparative-trade-review-http.js";

const fp = (value: string): `sha256:${string}` => `sha256:${value.repeat(64).slice(0, 64)}`;
const at = "2026-07-31T00:00:00.000Z";
const context = { actorId: "actor:test", role: "approver" as const, authenticatedAt: at };
const marketPackRef = { id: "market:test", version: "v1", fingerprint: fp("1") };

function candidate() {
  return ReflectionLessonCandidateSchema.parse({
    schemaVersion: "1.0.0",
    id: "candidate:test",
    version: "1.0.0",
    fingerprint: fp("2"),
    lifecycleStatus: "candidate",
    createdAt: at,
    marketPackRef,
    schemaRef: { schemaId: "schema.reflection-lesson-candidate", schemaVersion: "1.0.0" },
    artifactType: "reflection_lesson_candidate",
    reflectionAgentConfigRef: { id: "agent:reflection", version: "v1", fingerprint: fp("3") },
    failedTradeRef: { tradeId: "trade:test", decisionArtifactRef: { artifactId: "decision:test", artifactType: "semantic_decision", fingerprint: fp("4") } },
    semanticLesson: "Require renewed confirmation after a failed breakout.",
    failurePattern: "Late breakout entry with declining confirmation.",
    applicableMarketPackIds: [marketPackRef.id],
    applicableRegimes: ["trend"],
    confidence: 0.8,
    supportingEvidence: [{ evidenceId: "evidence:reflection:test", sourceArtifactRef: { artifactId: "decision:test", artifactType: "semantic_decision", fingerprint: fp("4") }, evidenceType: "lesson", locator: "failed-trade", summary: "The failed trade lost confirmation." }],
  });
}

function approval(input: { lifecycle?: "approved" | "rejected"; expiresAt?: string; revoked?: boolean } = {}): LessonHumanApprovalResponse {
  const lifecycle = input.lifecycle ?? "approved";
  const approvedLesson = lifecycle === "approved" ? {
    schemaVersion: "1.0.0", lessonId: "approved-lesson:test", versionId: "approved-lesson:test:version:1", versionIndex: 1, humanVersion: "1.0.0", fingerprint: fp("5"), lifecycleStatus: "approved", createdAt: at, sourceTradeId: "trade:test",
    candidateRef: { id: "candidate:test", fingerprint: fp("2") }, reviewRef: { id: "review:test", fingerprint: fp("6") }, comparativeEvidenceRef: { id: "comparison:test", fingerprint: fp("7") },
    validationBindingRef: { id: "validation:test", versionId: "validation:test:version:1", fingerprint: fp("8") }, strategyEvidenceBindingRef: { id: "strategy-evidence:test", versionId: "strategy-evidence:test:v3", fingerprint: fp("9") },
    backtestEvidenceRef: { jobId: "job:backtest", fingerprint: fp("a") }, walkForwardEvidenceRef: { jobId: "job:walk-forward", fingerprint: fp("b") }, approvalRef: { approvalId: "approval:test", actorId: "actor:test", fingerprint: fp("c") },
    scope: { marketPackRef, pipelineGraphRef: { id: "graph:test", version: "v1", fingerprint: fp("d") }, configurationRef: { versionId: "configuration:test:version:1", versionFingerprint: fp("e"), payloadFingerprint: fp("f") }, dataSourceRef: { id: "source:test", version: "v1", fingerprint: fp("0") }, datasetRef: { id: "dataset:test", version: "v1", fingerprint: fp("a") }, backtestProfileRef: { id: "profile:test", version: "v1", fingerprint: fp("b") }, walkForwardCandidateSetRef: { id: "candidate-set:test", version: "v1", fingerprint: fp("c") }, walkForwardPlanRef: { id: "walk-plan:test", version: "v1", fingerprint: fp("d") }, historicalRange: { startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-01-31T00:00:00.000Z" }, applicableRegimes: ["unclassified"], validFrom: at, expiresAt: input.expiresAt ?? "2026-08-30T00:00:00.000Z", revocationStatus: input.revoked ? "revoked" : "active" },
    decisionContextMaterializationStatus: "pending", decisionContextApplied: false, strategyMutationCreated: false, runtimeApplied: false, exchangeWriteAllowed: false,
  } : undefined;
  return { approval: { schemaVersion: "1.0.0", approvalId: "approval:test", versionId: "approval:test:version:1", versionIndex: 1, humanVersion: "1.0.0", fingerprint: fp("e"), createdAt: at, lifecycleStatus: lifecycle, selectedTradeId: "trade:test", decision: lifecycle === "approved" ? "approve" : "reject", rationale: "human reviewed rationale", approver: context, evidenceGateRef: { id: "gate:test", versionId: "gate:test:version:1", fingerprint: fp("f"), lifecycleStatus: "approval_required" }, ...(approvedLesson ? { approvedLessonRef: { lessonId: approvedLesson.lessonId, versionId: approvedLesson.versionId, fingerprint: approvedLesson.fingerprint } } : {}), idempotencyKey: "approval:test:key", decisionContextApplied: false, strategyMutationCreated: false, runtimeApplied: false, exchangeWriteAllowed: false }, evidenceGate: {} as LessonEvidenceGateProjection, ...(approvedLesson ? { approvedLesson } : {}), nextGate: approvedLesson ? "decision_context_materialization" : "candidate_closed", approvedLessonCreated: Boolean(approvedLesson), decisionContextApplied: false, strategyMutationCreated: false, runtimeApplied: false, exchangeWriteAllowed: false } as LessonHumanApprovalResponse;
}

function gate(fingerprint = fp("f")): LessonEvidenceGateProjection {
  return { lifecycleStatus: "approval_required", fingerprint, validationBindingRef: { fingerprint: fp("8") }, strategyEvidenceBindingRef: { fingerprint: fp("9") } } as LessonEvidenceGateProjection;
}

function service(input: { approval?: LessonHumanApprovalResponse; candidate?: ReturnType<typeof candidate>; gate?: LessonEvidenceGateProjection } = {}) {
  return new ApprovedLessonMaterializationService(
    { inspect: () => input.approval },
    { execute: async () => input.gate ?? gate() },
    { findBySourceTradeId: async () => input.candidate },
    undefined,
    () => "2026-08-01T00:00:00.000Z",
  );
}

test("Materialization command rejects semantic Lesson, Evidence, confidence, regime, Market, Graph, Actor, Role, and Runtime injection", () => {
  for (const field of ["lesson", "semanticLesson", "failurePattern", "evidence", "confidence", "regime", "market", "graph", "actorId", "role", "symbols", "cycles", "executionMode"]) {
    assert.equal(ApprovedLessonMaterializationCommandSchema.safeParse({ selectedTradeId: "trade:test", idempotencyKey: "materialize:test:key", [field]: "injected" }).success, false, field);
  }
});

test("missing approval and missing Reflection semantic facts remain unavailable", async () => {
  const missingApproval = await service().materialize({ selectedTradeId: "trade:test", idempotencyKey: "materialize:test:key" }, context);
  assert.equal(missingApproval.lifecycleStatus, "not_approved");
  const missingFacts = await service({ approval: approval() }).materialize({ selectedTradeId: "trade:test", idempotencyKey: "materialize:facts:key" }, context);
  assert.equal(missingFacts.lifecycleStatus, "semantic_facts_unavailable");
  assert.equal(missingFacts.issueCodes[0], "REFLECTION_SEMANTIC_CANDIDATE_UNAVAILABLE");
});

test("server Reflection facts materialize the existing ApprovedReflectionLesson contract", async () => {
  const result = await service({ approval: approval(), candidate: candidate() }).materialize({ selectedTradeId: "trade:test", idempotencyKey: "materialize:test:key" }, context);
  assert.equal(result.lifecycleStatus, "materialized");
  assert.equal(ApprovedReflectionLessonSchema.safeParse(result.approvedLesson).success, true);
  assert.equal(result.approvedLesson?.semanticLesson, candidate().semanticLesson);
  assert.equal(result.shadowDecisionContext.lifecycleStatus, "unavailable");
  assert.equal(result.decisionContextApplied, false);
  assert.equal(result.runtimeApplied, false);
});

test("Candidate and Evidence fingerprint drift fail closed as stale", async () => {
  const staleCandidate = ReflectionLessonCandidateSchema.parse({ ...candidate(), fingerprint: fp("0") });
  const candidateResult = await service({ approval: approval(), candidate: staleCandidate }).materialize({ selectedTradeId: "trade:test", idempotencyKey: "materialize:candidate:key" }, context);
  assert.equal(candidateResult.lifecycleStatus, "stale");
  const evidenceResult = await service({ approval: approval(), candidate: candidate(), gate: gate(fp("0")) }).materialize({ selectedTradeId: "trade:test", idempotencyKey: "materialize:evidence:key" }, context);
  assert.equal(evidenceResult.lifecycleStatus, "stale");
});

test("expired and revoked Approved Lesson Artifacts cannot materialize", async () => {
  const expired = await service({ approval: approval({ expiresAt: "2026-07-31T12:00:00.000Z" }), candidate: candidate() }).materialize({ selectedTradeId: "trade:test", idempotencyKey: "materialize:expired:key" }, context);
  assert.equal(expired.lifecycleStatus, "expired");
  const revoked = await service({ approval: approval({ revoked: true }), candidate: candidate() }).materialize({ selectedTradeId: "trade:test", idempotencyKey: "materialize:revoked:key" }, context);
  assert.equal(revoked.lifecycleStatus, "revoked");
});

test("Materialization HTTP derives Bearer actor and rejects client semantic payload", async () => {
  const materialization = service({ approval: approval(), candidate: candidate() });
  const handler = new ComparativeTradeReviewHttpHandler({ create: async () => { throw new Error("unused"); } }, {} as never, { authenticate: async (authorization) => { if (authorization !== "Bearer server-token") throw new Error("UNAUTHENTICATED"); return context; } }, undefined, undefined, undefined, undefined, undefined, undefined, materialization);
  const injected = await handler.handle(new Request("http://localhost/api/orchestration/lesson-candidates/materializations", { method: "POST", headers: { authorization: "Bearer server-token", "content-type": "application/json" }, body: JSON.stringify({ selectedTradeId: "trade:test", idempotencyKey: "materialize:http:key", semanticLesson: "client" }) }));
  assert.equal(injected.status, 400);
  const accepted = await handler.handle(new Request("http://localhost/api/orchestration/lesson-candidates/materializations", { method: "POST", headers: { authorization: "Bearer server-token", "content-type": "application/json" }, body: JSON.stringify({ selectedTradeId: "trade:test", idempotencyKey: "materialize:http:key" }) }));
  assert.equal(accepted.status, 200);
  const body = await accepted.json() as { materializedByActorId: string; decisionContextApplied: boolean };
  assert.equal(body.materializedByActorId, "actor:test");
  assert.equal(body.decisionContextApplied, false);
});
