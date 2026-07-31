import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  LessonEvidenceGateProjectionSchema,
  LessonHumanApprovalCommandSchema,
  StrategyEvidenceBindingSchema,
  type LessonEvidenceGateProjection,
  type StrategyEvidenceBinding,
} from "../packages/contracts/src/index.js";
import {
  LessonHumanApprovalError,
  LessonHumanApprovalService,
} from "../packages/core/src/lesson-human-approval-service.js";
import { ComparativeTradeReviewHttpHandler } from "../packages/runtime/src/comparative-trade-review-http.js";
import { SQLiteLessonHumanApprovalRepository } from "../packages/runtime/src/sqlite-lesson-human-approval-repository.js";

const fp = (value: string): `sha256:${string}` =>
  `sha256:${value.repeat(64).slice(0, 64)}`;
const at = "2026-07-31T00:00:00.000Z";

function projection(lifecycleStatus: "approval_required" | "walk_forward_required" = "approval_required"): LessonEvidenceGateProjection {
  const ready = lifecycleStatus === "approval_required";
  return LessonEvidenceGateProjectionSchema.parse({
    schemaVersion: "1.0.0",
    id: "lesson-evidence-gate:test",
    versionId: "lesson-evidence-gate:test:version:1",
    humanVersion: "1.0.0",
    fingerprint: fp("a"),
    createdAt: at,
    lifecycleStatus,
    selectedTradeId: "trade:test",
    validationBindingRef: {
      bindingId: "validation:test",
      versionId: "validation:test:version:1",
      versionIndex: 1,
      fingerprint: fp("b"),
      lifecycleStatus: "validation_passed",
      configurationVersionId: "configuration:test:version:1",
      configurationFingerprint: fp("c"),
      pipelineGraphRef: { id: "graph:test", version: "v1", fingerprint: fp("d") },
      candidateRef: { id: "candidate:test", fingerprint: fp("e") },
      reviewRef: { id: "review:test", fingerprint: fp("f") },
      comparativeEvidenceRef: { id: "comparison:test", fingerprint: fp("1") },
    },
    strategyEvidenceBindingRef: {
      bindingId: "strategy-evidence:test",
      versionId: "strategy-evidence:test:v3",
      versionIndex: 3,
      fingerprint: fp("2"),
      lifecycleStatus: "evidence_ready",
      configurationRef: { versionId: "configuration:test:version:1", versionFingerprint: fp("c"), payloadFingerprint: fp("3") },
      datasetRef: { id: "dataset:test", version: "v1", fingerprint: fp("4") },
      backtestProfileRef: { id: "profile:test", version: "v1", fingerprint: fp("5") },
      walkForwardCandidateSetRef: { id: "candidate-set:test", version: "v1", fingerprint: fp("6") },
      walkForwardPlanRef: { id: "walk-plan:test", version: "v1", fingerprint: fp("7") },
      marketPackRef: { id: "market:test", version: "v1", fingerprint: fp("8") },
      dataSourceRef: { id: "source:test", version: "v1", fingerprint: fp("9") },
      startAt: "2026-01-01T00:00:00.000Z",
      endAt: "2026-01-31T00:00:00.000Z",
    },
    backtest: ready
      ? { gate: "backtest", status: "passed", jobId: "job:backtest", evidenceFingerprint: fp("0") }
      : { gate: "backtest", status: "passed", jobId: "job:backtest", evidenceFingerprint: fp("0") },
    walkForward: ready
      ? { gate: "walk_forward", status: "passed", jobId: "job:walk-forward", evidenceFingerprint: fp("a") }
      : { gate: "walk_forward", status: "required" },
    approval: { gate: "human_approval", status: ready ? "ready" : "blocked", approvalExecuted: false },
    issueCodes: [],
    nextGate: ready ? "human_approval" : "walk_forward",
    allowedAction: ready ? "none" : "run_walk_forward",
    readOnlyProjection: true,
    approvedLessonCreated: false,
    strategyMutationCreated: false,
    runtimeApplied: false,
    exchangeWriteAllowed: false,
  });
}

function evidenceBinding(): StrategyEvidenceBinding {
  return StrategyEvidenceBindingSchema.parse({
    schemaVersion: "1.0.0",
    bindingId: "strategy-evidence:test",
    versionId: "strategy-evidence:test:v3",
    versionIndex: 3,
    parentFingerprint: fp("1"),
    fingerprint: fp("2"),
    lifecycleStatus: "evidence_ready",
    createdAt: at,
    updatedAt: at,
    createdByActorId: "actor:test",
    configurationRef: { draftId: "configuration:test", versionId: "configuration:test:version:1", versionFingerprint: fp("c"), payloadFingerprint: fp("3") },
    historicalPlanRef: { id: "plan:test", version: "v1", fingerprint: fp("b") },
    compiledGraphRef: { id: "graph:test", version: "v1", fingerprint: fp("d") },
    marketPackRef: { id: "market:test", version: "v1", fingerprint: fp("8") },
    datasetRef: { id: "dataset:test", version: "v1", fingerprint: fp("4") },
    dataSourceRef: { id: "source:test", version: "v1", fingerprint: fp("9") },
    backtestProfileRef: { id: "profile:test", version: "v1", fingerprint: fp("5") },
    walkForwardCandidateSetRef: { id: "candidate-set:test", version: "v1", fingerprint: fp("6") },
    walkForwardPlanRef: { id: "walk-plan:test", version: "v1", fingerprint: fp("7") },
    startAt: "2026-01-01T00:00:00.000Z",
    endAt: "2026-01-31T00:00:00.000Z",
    backtestJob: { jobId: "job:backtest", status: "succeeded", evidenceRef: "evidence:backtest", evidenceFingerprint: fp("0") },
    walkForwardJob: { jobId: "job:walk-forward", status: "succeeded", evidenceRef: "evidence:walk-forward", evidenceFingerprint: fp("a") },
    runtimeApplied: false,
  });
}

const context = { actorId: "actor:test", role: "approver" as const, authenticatedAt: at };

function fixture(gate = projection(), current = evidenceBinding()) {
  const repository = new SQLiteLessonHumanApprovalRepository(":memory:");
  const service = new LessonHumanApprovalService(
    { execute: async () => gate },
    { findApprovalReadyForConfiguration: () => current },
    repository,
    () => at,
  );
  return { repository, service };
}

test("Lesson Approval command rejects Evidence, scope, payload, actor, role, Draft, Graph, Runner, URL, SQL, path, and Runtime injection", () => {
  const fields = ["evidenceId", "scope", "lesson", "actorId", "role", "draft", "graph", "runner", "url", "sql", "path", "symbols", "cycles", "interval", "executionMode"];
  for (const field of fields) {
    assert.equal(LessonHumanApprovalCommandSchema.safeParse({ selectedTradeId: "trade:test", decision: "approve", rationale: "human rationale", idempotencyKey: "approval:test:key", [field]: "injected" }).success, false, field);
  }
});

test("Evidence must be genuinely dual-passed before Lesson Approval", async () => {
  const item = fixture(projection("walk_forward_required"));
  await assert.rejects(
    item.service.decide({ selectedTradeId: "trade:test", decision: "approve", rationale: "approve after evidence", idempotencyKey: "approval:test:key" }, context),
    (error) => error instanceof LessonHumanApprovalError && error.code === "LESSON_APPROVAL_EVIDENCE_NOT_READY",
  );
  item.repository.close();
});

test("Approve creates a scoped Approved Lesson without Decision Context or Runtime application", async () => {
  const item = fixture();
  const response = await item.service.decide({ selectedTradeId: "trade:test", decision: "approve", rationale: "evidence supports approval", idempotencyKey: "approval:test:key" }, context);
  assert.equal(response.approval.approver.actorId, "actor:test");
  assert.equal(response.approvedLesson?.scope.marketPackRef.id, "market:test");
  assert.deepEqual(response.approvedLesson?.scope.applicableRegimes, ["unclassified"]);
  assert.equal(response.approvedLesson?.decisionContextMaterializationStatus, "pending");
  assert.equal(response.decisionContextApplied, false);
  assert.equal(response.runtimeApplied, false);
  item.repository.close();
});

test("Reject closes approval without deleting Candidate or creating an Approved Lesson", async () => {
  const item = fixture();
  const response = await item.service.decide({ selectedTradeId: "trade:test", decision: "reject", rationale: "evidence scope is insufficient", idempotencyKey: "approval:reject:key" }, context);
  assert.equal(response.approval.lifecycleStatus, "rejected");
  assert.equal(response.approvedLessonCreated, false);
  assert.equal(response.approvedLesson, undefined);
  assert.equal(response.nextGate, "candidate_closed");
  item.repository.close();
});

test("Approval replay is idempotent and conflicting later decisions fail closed", async () => {
  const item = fixture();
  const command = { selectedTradeId: "trade:test", decision: "approve" as const, rationale: "evidence supports approval", idempotencyKey: "approval:test:key" };
  const first = await item.service.decide(command, context);
  const replay = await item.service.decide(command, context);
  assert.equal(replay.approval.fingerprint, first.approval.fingerprint);
  await assert.rejects(
    item.service.decide({ ...command, decision: "reject", rationale: "later rejection", idempotencyKey: "approval:other:key" }, context),
    (error) => error instanceof LessonHumanApprovalError && error.code === "LESSON_APPROVAL_ALREADY_DECIDED",
  );
  item.repository.close();
});

test("Evidence binding fingerprint drift fails closed before persistence", async () => {
  const drifted = StrategyEvidenceBindingSchema.parse({ ...evidenceBinding(), fingerprint: fp("f") });
  const item = fixture(projection(), drifted);
  await assert.rejects(
    item.service.decide({ selectedTradeId: "trade:test", decision: "approve", rationale: "evidence supports approval", idempotencyKey: "approval:test:key" }, context),
    (error) => error instanceof LessonHumanApprovalError && error.code === "LESSON_APPROVAL_SCOPE_STALE",
  );
  assert.equal(item.service.inspect("trade:test"), undefined);
  item.repository.close();
});

test("SQLite Lesson Approval records are append-only", async () => {
  const item = fixture();
  const response = await item.service.decide({ selectedTradeId: "trade:test", decision: "approve", rationale: "evidence supports approval", idempotencyKey: "approval:test:key" }, context);
  const database = new DatabaseSync(":memory:");
  database.close();
  assert.equal(item.repository.get(response.approval.approvalId).approval.fingerprint, response.approval.fingerprint);
  assert.equal(item.repository.listVersions(response.approval.approvalId).length, 1);
  assert.throws(() => (item.repository as unknown as { database: DatabaseSync }).database.exec("UPDATE lesson_human_approval_records SET lifecycle_status = 'rejected'"), /LESSON_HUMAN_APPROVAL_IMMUTABLE/u);
  item.repository.close();
});

test("Lesson Approval HTTP derives Bearer actor and rejects client scope injection", async () => {
  const item = fixture();
  const handler = new ComparativeTradeReviewHttpHandler(
    { create: async () => { throw new Error("unused"); } },
    {} as never,
    { authenticate: async (authorization) => {
      if (authorization !== "Bearer server-token") throw new Error("UNAUTHENTICATED");
      return context;
    } },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    item.service,
  );
  const injected = await handler.handle(new Request("http://localhost/api/orchestration/lesson-candidates/approvals", { method: "POST", headers: { authorization: "Bearer server-token", "content-type": "application/json" }, body: JSON.stringify({ selectedTradeId: "trade:test", decision: "approve", rationale: "evidence supports approval", idempotencyKey: "approval:http:key", scope: { market: "client" } }) }));
  assert.equal(injected.status, 400);
  const accepted = await handler.handle(new Request("http://localhost/api/orchestration/lesson-candidates/approvals", { method: "POST", headers: { authorization: "Bearer server-token", "content-type": "application/json" }, body: JSON.stringify({ selectedTradeId: "trade:test", decision: "approve", rationale: "evidence supports approval", idempotencyKey: "approval:http:key" }) }));
  assert.equal(accepted.status, 200);
  const body = await accepted.json() as { approval: { approver: { actorId: string } }; runtimeApplied: boolean };
  assert.equal(body.approval.approver.actorId, "actor:test");
  assert.equal(body.runtimeApplied, false);
  item.repository.close();
});
