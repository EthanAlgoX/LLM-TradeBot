import assert from "node:assert/strict";
import test from "node:test";

import {
  LessonCandidateValidationBindingSchema,
  LessonEvidenceGateCommandSchema,
  StrategyEvidenceBindingSchema,
  type LessonCandidateValidationBinding,
  type OrchestrationActor,
  type StrategyEvidenceBinding,
} from "../packages/contracts/src/index.js";
import {
  LessonEvidenceGateProjectionError,
  LessonEvidenceGateProjectionService,
  type LessonEvidenceValidationEligibility,
} from "../packages/core/src/lesson-evidence-gate-service.js";
import { ComparativeTradeReviewHttpHandler } from "../packages/runtime/src/comparative-trade-review-http.js";

const fp = (value: string): `sha256:${string}` =>
  `sha256:${value.repeat(64).slice(0, 64)}`;

function validationBinding(
  lifecycleStatus: "validation_passed" | "validation_failed" = "validation_passed",
): LessonCandidateValidationBinding {
  const valid = lifecycleStatus === "validation_passed";
  return LessonCandidateValidationBindingSchema.parse({
    schemaVersion: "1.0.0",
    bindingId: "lesson-validation-binding:test",
    versionId: "lesson-validation-binding:test:version:1",
    versionIndex: 1,
    humanVersion: "1.0.0",
    fingerprint: fp("a"),
    createdAt: "2026-07-31T00:00:00.000Z",
    createdByActorId: "actor:test",
    lifecycleStatus,
    sourceTradeId: "trade:test",
    candidateRef: { id: "candidate:test", fingerprint: fp("b") },
    reviewRef: { id: "review:test", fingerprint: fp("c") },
    comparativeEvidenceRef: { id: "comparison:test", fingerprint: fp("d") },
    configurationRef: {
      draftId: "configuration:test",
      versionId: "configuration:test:version:1",
      versionFingerprint: fp("e"),
      payloadFingerprint: fp("f"),
    },
    pipelineGraphRef: { id: "graph:test", version: "v1", fingerprint: fp("1") },
    contractValidation: {
      configuration: { valid, checkedFingerprint: fp("e"), issueCodes: valid ? [] : ["DRAFT_KIND_MISMATCH"] },
      pipeline: { valid, checkedFingerprint: fp("1"), issueCodes: valid ? [] : ["INVALID_GRAPH_CONTRACT"], errorCount: valid ? 0 : 1, warningCount: 0 },
      valid,
    },
    readOnly: true,
    approvedLessonCreated: false,
    strategyMutationCreated: false,
    runtimeApplied: false,
    exchangeWriteAllowed: false,
  });
}

function strategyBinding(input: {
  backtest?: boolean;
  walkForward?: boolean;
  version?: number;
} = {}): StrategyEvidenceBinding {
  const version = input.version ?? 1;
  return StrategyEvidenceBindingSchema.parse({
    schemaVersion: "1.0.0",
    bindingId: "strategy-evidence:test",
    versionId: `strategy-evidence:test:v${version}`,
    versionIndex: version,
    ...(version > 1 ? { parentFingerprint: fp(String(version - 1)) } : {}),
    fingerprint: fp(String(version)),
    lifecycleStatus: input.backtest && input.walkForward
      ? "evidence_ready"
      : input.backtest || input.walkForward
        ? "partial_evidence"
        : "draft",
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: `2026-07-31T00:00:0${version}.000Z`,
    createdByActorId: "actor:test",
    configurationRef: {
      draftId: "configuration:test",
      versionId: "configuration:test:version:1",
      versionFingerprint: fp("e"),
      payloadFingerprint: fp("f"),
    },
    historicalPlanRef: { id: "plan:test", version: "v1", fingerprint: fp("2") },
    compiledGraphRef: { id: "graph:test", version: "v1", fingerprint: fp("1") },
    marketPackRef: { id: "market:test", version: "v1", fingerprint: fp("3") },
    datasetRef: { id: "dataset:test", version: "v1", fingerprint: fp("4") },
    dataSourceRef: { id: "source:test", version: "v1", fingerprint: fp("5") },
    backtestProfileRef: { id: "profile:test", version: "v1", fingerprint: fp("6") },
    walkForwardCandidateSetRef: { id: "candidate-set:test", version: "v1", fingerprint: fp("7") },
    walkForwardPlanRef: { id: "walk-plan:test", version: "v1", fingerprint: fp("8") },
    startAt: "2026-01-01T00:00:00.000Z",
    endAt: "2026-01-31T00:00:00.000Z",
    ...(input.backtest ? { backtestJob: { jobId: "job:backtest", status: "succeeded", evidenceRef: "evidence:backtest", evidenceFingerprint: fp("9") } } : {}),
    ...(input.walkForward ? { walkForwardJob: { jobId: "job:walk-forward", status: "succeeded", evidenceRef: "evidence:walk-forward", evidenceFingerprint: fp("0") } } : {}),
    runtimeApplied: false,
  });
}

class FakeStrategyEvidence {
  public binding: StrategyEvidenceBinding | undefined;
  public createCount = 0;
  public actor: OrchestrationActor | undefined;
  public createRequest: unknown;

  findCurrentForConfiguration(): StrategyEvidenceBinding | undefined {
    return this.binding;
  }

  createBinding(request: unknown, actor: OrchestrationActor): StrategyEvidenceBinding {
    this.createCount += 1;
    this.createRequest = request;
    this.actor = actor;
    this.binding = strategyBinding();
    return this.binding;
  }

  async runBacktest(): Promise<StrategyEvidenceBinding> {
    this.binding = strategyBinding({ backtest: true, version: 2 });
    return this.binding;
  }

  async runWalkForward(): Promise<StrategyEvidenceBinding> {
    this.binding = strategyBinding({ backtest: true, walkForward: true, version: 3 });
    return this.binding;
  }
}

const context = {
  actorId: "actor:test",
  role: "approver" as const,
  authenticatedAt: "2026-07-31T00:00:00.000Z",
};
const scope = {
  datasetId: "dataset:test",
  backtestProfileId: "profile:test",
  walkForwardCandidateSetId: "candidate-set:test",
  walkForwardPlanId: "walk-plan:test",
  startAt: "2026-01-01T00:00:00.000Z",
  endAt: "2026-01-31T00:00:00.000Z",
};

function service(
  eligibility: LessonEvidenceValidationEligibility,
  strategy = new FakeStrategyEvidence(),
  scopes = [scope],
) {
  return {
    strategy,
    service: new LessonEvidenceGateProjectionService(
      { resolveEvidenceEligibility: async () => eligibility },
      strategy,
      { resolve: () => scopes },
      (reviewContext) => ({
        actorId: reviewContext.actorId,
        displayName: "Server Derived Operator",
        roles: ["operator"],
      }),
      () => "2026-07-31T00:00:00.000Z",
    ),
  };
}

test("lesson evidence contracts reject client evidence, runner, approval, draft, graph, URL, SQL, path, and runtime injection", () => {
  const forbidden = ["datasetId", "profileId", "candidateSetId", "walkForwardPlanId", "runner", "evidenceId", "approvalId", "draft", "graph", "fingerprint", "url", "sql", "path", "symbols", "cycles", "interval", "executionMode"];
  for (const field of forbidden) {
    assert.equal(LessonEvidenceGateCommandSchema.safeParse({
      selectedTradeId: "trade:test",
      idempotencyKey: "evidence:test:key",
      action: "inspect",
      [field]: "injected",
    }).success, false, field);
  }
});

test("missing validation binding returns binding_required and never applies runtime", async () => {
  const fixture = service({ status: "missing" });
  const result = await fixture.service.execute({ selectedTradeId: "trade:test", idempotencyKey: "evidence:test:key", action: "inspect" }, context);
  assert.equal(result.lifecycleStatus, "binding_required");
  assert.equal(result.runtimeApplied, false);
  assert.equal(result.approvedLessonCreated, false);
  assert.equal(fixture.strategy.createCount, 0);
});

test("non-passed validation binding is rejected", async () => {
  const fixture = service({ status: "not_passed", binding: validationBinding("validation_failed") });
  await assert.rejects(
    fixture.service.execute({ selectedTradeId: "trade:test", idempotencyKey: "evidence:test:key", action: "inspect" }, context),
    (error) => error instanceof LessonEvidenceGateProjectionError && error.code === "LESSON_EVIDENCE_VALIDATION_NOT_PASSED",
  );
});

test("server resolves one evidence scope, derives operator actor, and reuses the existing binding", async () => {
  const fixture = service({ status: "current", binding: validationBinding() });
  const first = await fixture.service.execute({ selectedTradeId: "trade:test", idempotencyKey: "evidence:create:key", action: "inspect" }, context);
  const replay = await fixture.service.execute({ selectedTradeId: "trade:test", idempotencyKey: "evidence:other:key", action: "inspect" }, context);
  assert.equal(first.lifecycleStatus, "backtest_required");
  assert.equal(replay.strategyEvidenceBindingRef?.bindingId, first.strategyEvidenceBindingRef?.bindingId);
  assert.equal(fixture.strategy.createCount, 1);
  assert.deepEqual(fixture.strategy.actor?.roles, ["operator"]);
  assert.deepEqual(fixture.strategy.createRequest, {
    schemaVersion: "1.0.0",
    strategyConfigurationVersionId: "configuration:test:version:1",
    ...scope,
    idempotencyKey: "evidence:create:key:binding",
  });
});

test("zero or ambiguous server scopes fail closed as evidence_unavailable", async () => {
  for (const scopes of [[], [scope, { ...scope, datasetId: "dataset:other" }]]) {
    const fixture = service({ status: "current", binding: validationBinding() }, new FakeStrategyEvidence(), scopes);
    const result = await fixture.service.execute({ selectedTradeId: "trade:test", idempotencyKey: "evidence:scope:key", action: "inspect" }, context);
    assert.equal(result.lifecycleStatus, "evidence_unavailable");
    assert.equal(result.allowedAction, "none");
  }
});

test("Backtest and Walk-Forward execute in order before approval becomes ready", async () => {
  const fixture = service({ status: "current", binding: validationBinding() });
  await assert.rejects(
    fixture.service.execute({ selectedTradeId: "trade:test", idempotencyKey: "evidence:walk:key", action: "run_walk_forward" }, context),
    (error) => error instanceof LessonEvidenceGateProjectionError && error.code === "LESSON_EVIDENCE_BACKTEST_REQUIRED",
  );
  const backtest = await fixture.service.execute({ selectedTradeId: "trade:test", idempotencyKey: "evidence:back:key", action: "run_backtest" }, context);
  assert.equal(backtest.lifecycleStatus, "walk_forward_required");
  assert.equal(backtest.approval.status, "blocked");
  const walkForward = await fixture.service.execute({ selectedTradeId: "trade:test", idempotencyKey: "evidence:walk:key", action: "run_walk_forward" }, context);
  assert.equal(walkForward.lifecycleStatus, "approval_required");
  assert.equal(walkForward.approval.status, "ready");
  assert.equal(walkForward.approval.approvalExecuted, false);
  assert.equal(walkForward.runtimeApplied, false);
});

test("validation or evidence scope drift projects stale and exposes no action", async () => {
  const fixture = service({ status: "stale", binding: validationBinding() });
  const result = await fixture.service.execute({ selectedTradeId: "trade:test", idempotencyKey: "evidence:stale:key", action: "inspect" }, context);
  assert.equal(result.lifecycleStatus, "stale");
  assert.equal(result.allowedAction, "none");
  assert.equal(result.issueCodes[0], "LESSON_EVIDENCE_SCOPE_STALE");
});

test("evidence gate HTTP requires Bearer auth, derives actor, and rejects client scope injection", async () => {
  const fixture = service({ status: "current", binding: validationBinding() });
  const handler = new ComparativeTradeReviewHttpHandler(
    { create: async () => { throw new Error("unused"); } },
    {} as never,
    {
      authenticate: async (authorization) => {
        if (authorization !== "Bearer server-token") throw new Error("UNAUTHENTICATED");
        return context;
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    fixture.service,
  );
  const unauthenticated = await handler.handle(new Request("http://localhost/api/orchestration/lesson-candidates/evidence-gates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ selectedTradeId: "trade:test", idempotencyKey: "evidence:http:key", action: "inspect" }) }));
  assert.equal(unauthenticated.status, 401);
  const injected = await handler.handle(new Request("http://localhost/api/orchestration/lesson-candidates/evidence-gates", { method: "POST", headers: { authorization: "Bearer server-token", "content-type": "application/json" }, body: JSON.stringify({ selectedTradeId: "trade:test", idempotencyKey: "evidence:http:key", action: "inspect", datasetId: "client-controlled" }) }));
  assert.equal(injected.status, 400);
  const accepted = await handler.handle(new Request("http://localhost/api/orchestration/lesson-candidates/evidence-gates", { method: "POST", headers: { authorization: "Bearer server-token", "content-type": "application/json" }, body: JSON.stringify({ selectedTradeId: "trade:test", idempotencyKey: "evidence:http:key", action: "inspect" }) }));
  assert.equal(accepted.status, 200);
  assert.equal(fixture.strategy.actor?.actorId, "actor:test");
});
