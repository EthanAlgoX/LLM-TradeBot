import assert from "node:assert/strict";
import test from "node:test";
import {
  LessonCandidateValidationHandoffRequestSchema,
  LessonCandidateValidationHandoffResponseSchema,
  type LessonCandidateReviewRecord,
  type LessonCandidateValidationBindingReference,
  type PipelineValidationResult,
} from "../packages/contracts/src/index.js";
import {
  LessonCandidateValidationHandoffService,
  type LessonCandidateContractValidationFact,
} from "../packages/core/src/lesson-candidate-validation-handoff-service.js";
import { ComparativeTradeReviewHttpHandler } from "../packages/runtime/src/comparative-trade-review-http.js";
import { deriveLessonCandidateValidationViewState } from "../apps/web/src/lesson-candidate-validation-view-state.js";

const fp = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;
const at = "2026-07-29T08:00:00.000Z";

function review(
  lifecycleStatus: "accepted_for_validation" | "rejected" =
    "accepted_for_validation",
  candidateFingerprint = fp("a"),
  evidenceFingerprint = fp("b"),
): LessonCandidateReviewRecord {
  return {
    schemaVersion: "1.0.0",
    id: "lesson-review:current",
    humanVersion: "1.0.0",
    fingerprint: fp("c"),
    createdAt: at,
    lifecycleStatus,
    candidateId: "lesson-candidate:current",
    candidateFingerprint,
    comparativeEvidenceId: "trade-comparison:current",
    comparativeEvidenceFingerprint: evidenceFingerprint,
    sourceTradeId: "trade:closed",
    decision: lifecycleStatus === "rejected" ? "reject" : "accept_for_validation",
    rationale: "Bounded human review rationale.",
    reviewer: {
      actorId: "local:approver",
      role: "approver",
      authenticatedAt: at,
    },
    idempotencyKey: "review:current",
    approvedLessonCreated: false,
    strategyMutationCreated: false,
    readOnlyEvidence: true,
    runtimeApplied: false,
    exchangeWriteAllowed: false,
  };
}

function binding(): LessonCandidateValidationBindingReference {
  return {
    reviewFingerprint: fp("c"),
    candidateFingerprint: fp("a"),
    comparativeEvidenceFingerprint: fp("b"),
    configurationRef: {
      draftId: "configuration:strategy",
      versionId: "configuration:strategy:v2",
      versionFingerprint: fp("d"),
      payloadFingerprint: fp("e"),
    },
    pipelineGraphRef: {
      id: "pipeline:crypto",
      version: "2.0.0",
      fingerprint: fp("f"),
    },
  };
}

function validation(valid: boolean): PipelineValidationResult {
  return {
    schemaVersion: "v1",
    pipelineGraphId: "pipeline:crypto",
    graphVersion: "2.0.0",
    valid,
    issues: valid
      ? []
      : [{
          issueId: "issue:window",
          code: "OBSERVATION_WINDOW_UNSUPPORTED",
          severity: "error",
          entityType: "agent_config",
          entityId: "agent:trigger",
          path: ["observationRequests", 0, "window"],
          details: {},
        }],
    summary: {
      errorCount: valid ? 0 : 1,
      warningCount: 0,
    },
  };
}

function service(options: {
  records?: LessonCandidateReviewRecord[];
  candidateFingerprint?: string;
  evidenceFingerprint?: `sha256:${string}`;
  validationFact?: LessonCandidateContractValidationFact;
} = {}) {
  return new LessonCandidateValidationHandoffService(
    {
      async requireCandidate() {
        throw new Error("unused");
      },
      async findBySourceTradeId() {
        return {
          candidateId: "lesson-candidate:current",
          fingerprint: options.candidateFingerprint ?? fp("a"),
          sourceTradeId: "trade:closed",
        };
      },
    },
    {
      async listByCandidateId() {
        return { records: options.records ?? [] };
      },
    },
    {
      async create() {
        return {
          id: "trade-comparison:current",
          fingerprint: options.evidenceFingerprint ?? fp("b"),
        };
      },
    },
    options.validationFact
      ? {
          async findForAcceptedReview() {
            return options.validationFact;
          },
        }
      : undefined,
    () => at,
  );
}

test("validation handoff contracts reject unknown fields and impossible passed claims", () => {
  assert.equal(
    LessonCandidateValidationHandoffRequestSchema.safeParse({
      selectedTradeId: "trade:closed",
      draftId: "client:injected",
    }).success,
    false,
  );
  const validUnavailable = {
    schemaVersion: "1.0.0",
    id: "lesson-validation-handoff:test",
    humanVersion: "1.0.0",
    fingerprint: fp("a"),
    createdAt: at,
    lifecycleStatus: "validation_unavailable",
    selectedTradeId: "trade:closed",
    candidateRef: { id: "lesson-candidate:current", fingerprint: fp("b") },
    contractValidation: {
      gate: "contract_validation",
      status: "unavailable",
      issueCodes: ["VALIDATION_DRAFT_BINDING_NOT_AVAILABLE"],
      errorCount: 0,
      warningCount: 0,
    },
    nextGate: "draft_binding_required",
    readOnly: true,
    approvedLessonCreated: false,
    strategyMutationCreated: false,
    runtimeApplied: false,
    exchangeWriteAllowed: false,
  };
  assert.equal(
    LessonCandidateValidationHandoffResponseSchema.safeParse(validUnavailable)
      .success,
    true,
  );
  assert.equal(
    LessonCandidateValidationHandoffResponseSchema.safeParse({
      ...validUnavailable,
      lifecycleStatus: "validation_passed",
      contractValidation: {
        ...validUnavailable.contractValidation,
        status: "passed",
        issueCodes: [],
        validatedAt: at,
      },
      nextGate: "backtest",
    }).success,
    false,
  );
  assert.equal(
    LessonCandidateValidationHandoffResponseSchema.safeParse({
      ...validUnavailable,
      unknown: true,
    }).success,
    false,
  );
});

test("handoff distinguishes not reviewed, rejected, and accepted without a server binding", async () => {
  const notReviewed = await service().inspect({ selectedTradeId: "trade:closed" });
  const rejected = await service({
    records: [review("rejected")],
  }).inspect({ selectedTradeId: "trade:closed" });
  const unavailable = await service({
    records: [review()],
  }).inspect({ selectedTradeId: "trade:closed" });
  assert.equal(notReviewed.lifecycleStatus, "not_reviewed");
  assert.equal(rejected.lifecycleStatus, "candidate_closed");
  assert.equal(unavailable.lifecycleStatus, "validation_unavailable");
  assert.deepEqual(unavailable.contractValidation.issueCodes, [
    "VALIDATION_DRAFT_BINDING_NOT_AVAILABLE",
  ]);
  assert.equal(unavailable.runtimeApplied, false);
});

test("candidate and comparative evidence fingerprint changes fail closed as stale", async () => {
  const candidateStale = await service({
    records: [review()],
    candidateFingerprint: fp("d"),
  }).inspect({ selectedTradeId: "trade:closed" });
  const evidenceStale = await service({
    records: [review()],
    evidenceFingerprint: fp("e"),
  }).inspect({ selectedTradeId: "trade:closed" });
  assert.deepEqual(candidateStale.contractValidation.issueCodes, [
    "LESSON_CANDIDATE_FINGERPRINT_CHANGED",
  ]);
  assert.deepEqual(evidenceStale.contractValidation.issueCodes, [
    "COMPARATIVE_EVIDENCE_FINGERPRINT_CHANGED",
  ]);
  assert.equal(candidateStale.lifecycleStatus, "stale");
  assert.equal(evidenceStale.lifecycleStatus, "stale");
});

test("only a scope-matched real validator result can fail or pass contract validation", async () => {
  const failed = await service({
    records: [review()],
    validationFact: {
      binding: binding(),
      validation: validation(false),
      validatedAt: at,
    },
  }).inspect({ selectedTradeId: "trade:closed" });
  const passed = await service({
    records: [review()],
    validationFact: {
      binding: binding(),
      validation: validation(true),
      validatedAt: at,
    },
  }).inspect({ selectedTradeId: "trade:closed" });
  const staleBinding = binding();
  staleBinding.reviewFingerprint = fp("0");
  const stale = await service({
    records: [review()],
    validationFact: {
      binding: staleBinding,
      validation: validation(true),
      validatedAt: at,
    },
  }).inspect({ selectedTradeId: "trade:closed" });
  assert.equal(failed.lifecycleStatus, "validation_failed");
  assert.deepEqual(failed.contractValidation.issueCodes, [
    "OBSERVATION_WINDOW_UNSUPPORTED",
  ]);
  assert.equal(passed.lifecycleStatus, "validation_passed");
  assert.equal(passed.nextGate, "backtest");
  assert.equal(stale.lifecycleStatus, "stale");
  assert.deepEqual(stale.contractValidation.issueCodes, [
    "VALIDATION_BINDING_SCOPE_MISMATCH",
  ]);
});

test("validation handoff HTTP derives the actor and rejects client-controlled scope", async () => {
  let authentications = 0;
  const handler = new ComparativeTradeReviewHttpHandler(
    { async create() { throw new Error("unused"); } },
    { async review() { throw new Error("unused"); } } as never,
    {
      async authenticate(header) {
        authentications += 1;
        if (header !== "Bearer handoff") throw new Error("UNAUTHENTICATED");
        return {
          actorId: "server:approver",
          role: "approver",
          authenticatedAt: at,
        };
      },
    },
    undefined,
    undefined,
    service({ records: [review()] }),
  );
  const request = (body: object, authorization = "Bearer handoff") =>
    handler.handle(new Request(
      "http://local/api/orchestration/lesson-candidates/validation-handoff",
      {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    ));
  const unauthenticated = await request(
    { selectedTradeId: "trade:closed" },
    "Bearer wrong",
  );
  const injected = await request({
    selectedTradeId: "trade:closed",
    actorId: "client:actor",
    reviewId: "review:injected",
    evidenceId: "evidence:injected",
    draftId: "draft:injected",
    graphId: "graph:injected",
    runner: "shell",
    code: "process.exit()",
    path: "/tmp/secret",
    url: "https://example.invalid",
    sql: "DROP TABLE reviews",
    symbols: ["BTCUSDT"],
    cycles: 999,
    intervalMs: 1,
    executionMode: "live",
  });
  const response = await request({ selectedTradeId: "trade:closed" });
  const body = await response.json() as { lifecycleStatus: string; runtimeApplied: boolean };
  assert.equal(unauthenticated.status, 401);
  assert.equal(injected.status, 400);
  assert.equal(response.status, 200);
  assert.equal(body.lifecycleStatus, "validation_unavailable");
  assert.equal(body.runtimeApplied, false);
  assert.equal(authentications, 3);
});

test("web validation view state keeps only passed validation eligible for backtest", () => {
  const modes = [
    "not_reviewed",
    "candidate_closed",
    "accepted_for_validation",
    "validation_unavailable",
    "validation_failed",
    "validation_passed",
    "stale",
  ] as const;
  for (const lifecycleStatus of modes) {
    const state = deriveLessonCandidateValidationViewState({ lifecycleStatus });
    assert.equal(
      state.backtestAvailable,
      lifecycleStatus === "validation_passed",
    );
    assert.equal(state.runtimeApplied, false);
    assert.equal(state.exchangeWriteAllowed, false);
  }
  assert.equal(deriveLessonCandidateValidationViewState().mode, "unavailable");
});
