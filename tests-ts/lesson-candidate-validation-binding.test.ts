import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  CreateLessonCandidateValidationBindingCommandSchema,
  LessonCandidateValidationBindingSchema,
  type ComparativeTradeEvidence,
  type ConfigurationDraftVersion,
  type LessonCandidateReviewRecord,
  type PipelineValidationResult,
} from "../packages/contracts/src/index.js";
import {
  LessonCandidateValidationBindingError,
  LessonCandidateValidationBindingService,
} from "../packages/core/src/lesson-candidate-validation-binding-service.js";
import { ComparativeTradeReviewHttpHandler } from "../packages/runtime/src/comparative-trade-review-http.js";
import { SqliteLessonCandidateValidationBindingRepository } from "../packages/runtime/src/sqlite-lesson-candidate-validation-binding-repository.js";

const fp = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;
const at = "2026-07-31T08:00:00.000Z";
const pipelineDraftId = "pipeline:crypto@1.0.0";

function candidateReview(
  lifecycleStatus: "accepted_for_validation" | "rejected" =
    "accepted_for_validation",
): LessonCandidateReviewRecord {
  return {
    schemaVersion: "1.0.0",
    id: "lesson-review:binding",
    humanVersion: "1.0.0",
    fingerprint: fp("c"),
    createdAt: at,
    lifecycleStatus,
    candidateId: "lesson-candidate:binding",
    candidateFingerprint: fp("a"),
    comparativeEvidenceId: "trade-comparison:binding",
    comparativeEvidenceFingerprint: fp("b"),
    sourceTradeId: "trade:binding",
    decision: lifecycleStatus === "rejected" ? "reject" : "accept_for_validation",
    rationale: "Accepted only for bounded validation.",
    reviewer: {
      actorId: "server:approver",
      role: "approver",
      authenticatedAt: at,
    },
    idempotencyKey: "review:binding",
    approvedLessonCreated: false,
    strategyMutationCreated: false,
    readOnlyEvidence: true,
    runtimeApplied: false,
    exchangeWriteAllowed: false,
  };
}

function configuration(fingerprint = fp("d")): ConfigurationDraftVersion {
  return {
    schemaVersion: "1.0.0",
    draftId: "configuration-draft:strategy",
    versionId: "configuration-draft:strategy:version:1",
    versionIndex: 1,
    humanVersion: "1.0.0",
    fingerprint,
    lifecycleStatus: "draft",
    createdAt: at,
    createdByActorId: "server:operator",
    payload: {
      kind: "strategy",
      marketPackId: "market-pack:crypto:v1",
      pipelineDraftId,
      agentConfigurationDraftIds: ["configuration-draft:agent"],
      promptPolicyDraftIds: [],
      weights: {},
      thresholds: {},
    },
    evidenceState: { status: "none", evidenceRefs: [] },
    runtimeApplied: false,
  };
}

function evidence(): ComparativeTradeEvidence {
  return {
    id: "trade-comparison:binding",
    fingerprint: fp("b"),
    selectedTrade: {
      pipelineGraphRef: {
        id: "pipeline:crypto",
        version: "1.0.0",
        fingerprint: fp("e"),
      },
      marketPackRef: {
        id: "market-pack:crypto:v1",
        version: "1.0.0",
        fingerprint: fp("f"),
      },
      dataSourceRef: {
        id: "data-source:crypto",
        version: "1.0.0",
        fingerprint: fp("0"),
      },
    },
  } as ComparativeTradeEvidence;
}

function graphValidation(valid = true): PipelineValidationResult {
  return {
    schemaVersion: "v1",
    pipelineGraphId: "pipeline:crypto",
    graphVersion: "1.0.0",
    valid,
    issues: valid ? [] : [{
      issueId: "issue:risk",
      code: "RISK_BOUNDARY_BYPASSED",
      severity: "error",
      entityType: "graph",
      path: [],
      details: {},
    }],
    summary: { errorCount: valid ? 0 : 1, warningCount: 0 },
  };
}

function fixture(options: {
  review?: LessonCandidateReviewRecord;
  configurations?: ConfigurationDraftVersion[];
  configurationValid?: boolean;
  pipelineValid?: boolean;
  latestFingerprint?: `sha256:${string}`;
} = {}) {
  const database = new DatabaseSync(":memory:");
  const repository = new SqliteLessonCandidateValidationBindingRepository(database);
  const draft = configuration();
  const reviews = options.review === undefined
    ? [candidateReview()]
    : [options.review];
  const configs = options.configurations ?? [draft];
  const service = new LessonCandidateValidationBindingService(
    {
      async requireCandidate() { throw new Error("unused"); },
      async findBySourceTradeId() {
        return {
          candidateId: "lesson-candidate:binding",
          fingerprint: fp("a"),
          sourceTradeId: "trade:binding",
        };
      },
    },
    {
      async listByCandidateId() { return { records: reviews }; },
    },
    { async create() { return evidence(); } },
    {
      get() { return draft; },
      getLatest() {
        return configuration(
          options.latestFingerprint ?? draft.fingerprint as `sha256:${string}`,
        );
      },
      validate() {
        const valid = options.configurationValid ?? true;
        return {
          valid,
          checkedFingerprint: draft.fingerprint,
          issues: valid ? [] : [{
            issueId: "configuration-issue:pipeline",
            code: "PIPELINE_DRAFT_NOT_FOUND",
            entityType: "pipeline",
            entityId: pipelineDraftId,
            path: ["payload", "pipelineDraftId"],
            details: { reference: pipelineDraftId },
          }],
        };
      },
    },
    {
      findLatestStrategyVersionsByPipelineDraftId() { return configs; },
    },
    {
      getDraft() {
        return {
          draftId: pipelineDraftId,
          graphId: "pipeline:crypto",
          humanVersion: "1.0.0",
          graph: {
            pipelineGraphId: "pipeline:crypto",
            humanReadableVersion: "1.0.0",
            fingerprint: fp("e"),
            marketPackRef: "market-pack:crypto:v1",
            dataSourceRefs: ["data-source:crypto"],
          },
        };
      },
      validateDraft() { return graphValidation(options.pipelineValid ?? true); },
    },
    repository,
    () => at,
  );
  return { database, repository, service };
}

test("binding command and record contracts reject client scope and unknown fields", () => {
  assert.equal(CreateLessonCandidateValidationBindingCommandSchema.safeParse({
    selectedTradeId: "trade:binding",
    idempotencyKey: "binding:idempotency",
    draftId: "client:draft",
  }).success, false);
  assert.equal(LessonCandidateValidationBindingSchema.safeParse({
    runtimeApplied: true,
  }).success, false);
});

test("accepted review resolves one server strategy draft and persists an immutable passed binding", async () => {
  const { database, repository, service } = fixture();
  const command = {
    selectedTradeId: "trade:binding",
    idempotencyKey: "binding:idempotency",
  };
  const context = {
    actorId: "server:approver",
    role: "approver" as const,
    authenticatedAt: at,
  };
  const first = await service.create(command, context);
  const replay = await service.create(command, context);
  assert.deepEqual(replay, first);
  assert.equal(first.binding.lifecycleStatus, "validation_passed");
  assert.equal(first.nextGate, "backtest");
  assert.equal(first.runtimeApplied, false);
  assert.equal(repository.listVersions(first.binding.bindingId).length, 1);
  assert.throws(() => database.exec(
    "UPDATE lesson_candidate_validation_binding_versions SET source_trade_id = 'trade:other'",
  ), /LESSON_VALIDATION_BINDING_IMMUTABLE/);
  database.close();
});

test("configuration and graph failures preserve existing validation issue codes", async () => {
  const { database, service } = fixture({
    configurationValid: false,
    pipelineValid: false,
  });
  const result = await service.create({
    selectedTradeId: "trade:binding",
    idempotencyKey: "binding:failed",
  }, {
    actorId: "server:approver",
    role: "approver",
    authenticatedAt: at,
  });
  assert.equal(result.binding.lifecycleStatus, "validation_failed");
  assert.deepEqual(result.binding.contractValidation.configuration.issueCodes, [
    "PIPELINE_DRAFT_NOT_FOUND",
  ]);
  assert.deepEqual(result.binding.contractValidation.pipeline.issueCodes, [
    "RISK_BOUNDARY_BYPASSED",
  ]);
  assert.equal(result.nextGate, "contract_validation");
  assert.equal(result.approvedLessonCreated, false);
  database.close();
});

test("rejected and ambiguous server resolution fail with stable codes", async () => {
  const rejected = fixture({ review: candidateReview("rejected") });
  await assert.rejects(
    rejected.service.create({
      selectedTradeId: "trade:binding",
      idempotencyKey: "binding:rejected",
    }, {
      actorId: "server:approver",
      role: "approver",
      authenticatedAt: at,
    }),
    (error) => error instanceof LessonCandidateValidationBindingError &&
      error.code === "LESSON_VALIDATION_REVIEW_REJECTED",
  );
  rejected.database.close();
  const ambiguous = fixture({
    configurations: [configuration(), {
      ...configuration(fp("1")),
      draftId: "configuration-draft:second",
      versionId: "configuration-draft:second:version:1",
    }],
  });
  await assert.rejects(
    ambiguous.service.create({
      selectedTradeId: "trade:binding",
      idempotencyKey: "binding:ambiguous",
    }, {
      actorId: "server:approver",
      role: "approver",
      authenticatedAt: at,
    }),
    (error) => error instanceof LessonCandidateValidationBindingError &&
      error.code === "LESSON_VALIDATION_CONFIGURATION_AMBIGUOUS",
  );
  ambiguous.database.close();
});

test("a newer configuration fingerprint makes the persisted binding stale", async () => {
  const { database, service } = fixture({ latestFingerprint: fp("2") });
  const result = await service.create({
    selectedTradeId: "trade:binding",
    idempotencyKey: "binding:stale",
  }, {
    actorId: "server:approver",
    role: "approver",
    authenticatedAt: at,
  });
  const fact = await service.findForAcceptedReview(candidateReview());
  assert.equal(result.binding.lifecycleStatus, "validation_passed");
  assert.equal(fact?.scopeCurrent, false);
  database.close();
});

test("binding HTTP derives the actor and rejects Draft Graph code SQL URL path and Runtime injection", async () => {
  const { database, service } = fixture();
  const handler = new ComparativeTradeReviewHttpHandler(
    { async create() { return evidence(); } },
    { async review() { throw new Error("unused"); } } as never,
    {
      async authenticate(header) {
        if (header !== "Bearer binding") throw new Error("UNAUTHENTICATED");
        return {
          actorId: "server:approver",
          role: "approver",
          authenticatedAt: at,
        };
      },
    },
    undefined,
    undefined,
    undefined,
    service,
  );
  const send = (body: object, token = "Bearer binding") => handler.handle(
    new Request("http://local/api/orchestration/lesson-candidates/validation-bindings", {
      method: "POST",
      headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  assert.equal((await send({
    selectedTradeId: "trade:binding",
    idempotencyKey: "binding:injected",
    actorId: "client:actor",
    draftId: "client:draft",
    graphId: "client:graph",
    fingerprint: fp("3"),
    runner: "shell",
    code: "process.exit()",
    sql: "DROP TABLE bindings",
    url: "https://example.invalid",
    path: "/tmp/secret",
    symbols: ["BTCUSDT"],
    cycles: 99,
    intervalMs: 1,
    executionMode: "live",
  })).status, 400);
  assert.equal((await send({
    selectedTradeId: "trade:binding",
    idempotencyKey: "binding:http",
  }, "Bearer wrong")).status, 401);
  const response = await send({
    selectedTradeId: "trade:binding",
    idempotencyKey: "binding:http",
  });
  const body = await response.json() as { runtimeApplied: boolean };
  assert.equal(response.status, 200);
  assert.equal(body.runtimeApplied, false);
  database.close();
});
