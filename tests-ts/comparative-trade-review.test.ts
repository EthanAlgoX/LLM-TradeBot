import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ComparativeTradeEvidenceRequestSchema,
  LessonCandidateReviewCommandSchema,
  LessonCandidateReviewRecordSchema,
  TradeOutcomeEvidenceSchema,
  type ComparativeTradeEvidence,
  type LessonCandidateReviewRecord,
  type TradeOutcomeEvidence,
} from "../packages/contracts/src/index.js";
import {
  ComparativeTradeEvidenceService,
  LessonCandidateReviewService,
  type LessonCandidateReviewRepository,
} from "../packages/core/src/comparative-trade-review-service.js";
import { ComparativeTradeReviewHttpHandler } from "../packages/runtime/src/comparative-trade-review-http.js";
import { SQLiteLessonCandidateReviewRepository } from "../packages/runtime/src/sqlite-lesson-candidate-review-repository.js";

const fp = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;
const at = "2026-07-27T10:00:00.000Z";

function trade(input: {
  id: string;
  closedAt: string;
  pnl: number;
  fees?: number;
  graph?: string;
  market?: string;
  symbol?: string;
}): TradeOutcomeEvidence {
  return TradeOutcomeEvidenceSchema.parse({
    schemaVersion: "1.0.0",
    id: `trade-outcome:${input.id}`,
    humanVersion: "1.0.0",
    fingerprint: fp(input.id.slice(-1)),
    createdAt: input.closedAt,
    lifecycleStatus: "recorded",
    tradeId: input.id,
    runId: "paper-run:1",
    traceId: `trace:${input.id}`,
    symbol: input.symbol ?? "BTCUSDT",
    side: "long",
    openedAt: new Date(Date.parse(input.closedAt) - 60_000).toISOString(),
    closedAt: input.closedAt,
    entryPrice: 100,
    exitPrice: 101,
    quantity: 1,
    realizedPnl: input.pnl,
    fees: input.fees ?? 0.2,
    closeReason: "strategy_exit",
    marketPackRef: {
      id: input.market ?? "market-pack.crypto",
      version: "1.0.0",
      fingerprint: fp(input.market === "market-pack.other" ? "8" : "1"),
    },
    dataSourceRef: {
      id: "data-source.local",
      version: "1.0.0",
      fingerprint: fp("2"),
    },
    pipelineGraphRef: {
      id: "pipeline.current-crypto",
      version: "1.0.0",
      fingerprint: fp(input.graph ?? "3"),
    },
    schemaRef: {
      schemaId: "schema.trade-outcome-evidence",
      schemaVersion: "1.0.0",
    },
  });
}

class MemoryReviews implements LessonCandidateReviewRepository {
  public records: LessonCandidateReviewRecord[] = [];

  public async findByIdempotencyKey(key: string) {
    return this.records.find((record) => record.idempotencyKey === key);
  }

  public async append(record: LessonCandidateReviewRecord) {
    this.records.push(LessonCandidateReviewRecordSchema.parse(record));
  }
}

function comparisonFixture() {
  const selected = trade({
    id: "trade:4",
    closedAt: "2026-07-27T10:00:00.000Z",
    pnl: 3,
    fees: 0.4,
  });
  const matchingRecent = trade({
    id: "trade:3",
    closedAt: "2026-07-27T09:00:00.000Z",
    pnl: -2,
    fees: 0.1,
  });
  const matchingOld = trade({
    id: "trade:2",
    closedAt: "2026-07-27T08:00:00.000Z",
    pnl: 1,
  });
  const wrongGraph = trade({
    id: "trade:5",
    closedAt: "2026-07-27T09:30:00.000Z",
    pnl: 99,
    graph: "7",
  });
  const wrongSymbol = trade({
    id: "trade:6",
    closedAt: "2026-07-27T09:45:00.000Z",
    pnl: 99,
    symbol: "ETHUSDT",
  });
  const all = [selected, matchingRecent, matchingOld, wrongGraph, wrongSymbol];
  const service = new ComparativeTradeEvidenceService(
    {
      async requireTrade(tradeId) {
        const found = all.find((item) => item.tradeId === tradeId);
        if (!found) throw new Error("SELECTED_TRADE_NOT_REGISTERED");
        return found;
      },
      async listPriorClosedTrades() {
        return all;
      },
    },
    () => at,
  );
  return { service, selected, matchingRecent };
}

test("comparative contracts reject client policy and executable injection", () => {
  assert.equal(
    ComparativeTradeEvidenceRequestSchema.safeParse({
      selectedTradeId: "trade:4",
      policy: { sameSymbol: false },
    }).success,
    false,
  );
  assert.equal(
    LessonCandidateReviewCommandSchema.safeParse({
      candidateId: "lesson:1",
      candidateFingerprint: fp("4"),
      comparativeEvidenceId: "comparison:1",
      comparativeEvidenceFingerprint: fp("5"),
      decision: "accept_for_validation",
      rationale: "Evidence was reviewed by the operator.",
      idempotencyKey: "review:key:1",
      sql: "select * from trades",
      code: "process.exit()",
      path: "/tmp/secret",
      url: "https://example.invalid",
      actorId: "client",
      runner: "client",
      runtimeCycles: 999,
      riskBypass: true,
    }).success,
    false,
  );
});

test("comparison selects only the most recent prior same Graph Market and symbol", async () => {
  const { service, matchingRecent } = comparisonFixture();
  const evidence = await service.create("trade:4");
  assert.equal(evidence.lifecycleStatus, "available");
  assert.equal(evidence.baselineTradeId, matchingRecent.tradeId);
  assert.deepEqual(
    evidence.comparatorTrades.map((item) => item.tradeId),
    ["trade:3", "trade:2"],
  );
  assert.equal(evidence.policy.serverSelected, true);
  assert.equal(evidence.causalClaim, false);
});

test("comparison preserves raw Paper outcomes and deterministic deltas", async () => {
  const { service } = comparisonFixture();
  const evidence = await service.create("trade:4");
  assert.deepEqual(
    evidence.metrics.map((metric) => [
      metric.metric,
      metric.selectedValue,
      metric.baselineValue,
      metric.delta,
    ]),
    [
      ["realized_pnl", 3, -2, 5],
      ["fees", 0.4, 0.1, 0.30000000000000004],
      ["holding_duration_ms", 60_000, 60_000, 0],
    ],
  );
  assert.equal(evidence.runtimeApplied, false);
  assert.equal(evidence.exchangeWriteAllowed, false);
});

test("comparison remains insufficient when no registered comparator matches", async () => {
  const selected = trade({
    id: "trade:1",
    closedAt: "2026-07-27T10:00:00.000Z",
    pnl: 0,
  });
  const service = new ComparativeTradeEvidenceService({
    async requireTrade() {
      return selected;
    },
    async listPriorClosedTrades() {
      return [];
    },
  });
  const evidence = await service.create(selected.tradeId);
  assert.equal(evidence.lifecycleStatus, "insufficient_evidence");
  assert.deepEqual(evidence.issueCodes, ["COMPARATOR_NOT_AVAILABLE"]);
  assert.deepEqual(evidence.metrics, []);
});

function lessonFixture(
  evidence: ComparativeTradeEvidence,
  reviews: LessonCandidateReviewRepository = new MemoryReviews(),
) {
  const service = new LessonCandidateReviewService(
    {
      async requireCandidate(candidateId) {
        if (candidateId !== "lesson:1") throw new Error("CANDIDATE_NOT_REGISTERED");
        return {
          candidateId,
          fingerprint: fp("4"),
          sourceTradeId: evidence.selectedTrade.tradeId,
        };
      },
    },
    {
      async requireEvidence(evidenceId) {
        if (evidenceId !== evidence.id) throw new Error("EVIDENCE_NOT_REGISTERED");
        return evidence;
      },
    },
    reviews,
    () => at,
  );
  return { service, reviews };
}

function command(evidence: ComparativeTradeEvidence) {
  return {
    candidateId: "lesson:1",
    candidateFingerprint: fp("4"),
    comparativeEvidenceId: evidence.id,
    comparativeEvidenceFingerprint: evidence.fingerprint,
    decision: "accept_for_validation" as const,
    rationale: "The explicit comparison supports further controlled validation.",
    idempotencyKey: "lesson-review:key:1",
  };
}

test("accepted candidate is only accepted for validation and is idempotent", async () => {
  const evidence = await comparisonFixture().service.create("trade:4");
  const { service, reviews } = lessonFixture(evidence);
  const context = { actorId: "operator:1", role: "approver" as const, authenticatedAt: at };
  const first = await service.review(command(evidence), context);
  const replay = await service.review(command(evidence), context);
  assert.deepEqual(replay, first);
  assert.equal((reviews as MemoryReviews).records.length, 1);
  assert.equal(first.review.lifecycleStatus, "accepted_for_validation");
  assert.equal(first.review.approvedLessonCreated, false);
  assert.equal(first.review.strategyMutationCreated, false);
  assert.equal(first.review.runtimeApplied, false);
  assert.equal(first.nextGate, "contract_validation");
});

test("review fails closed on fingerprint drift idempotency conflict and missing comparison", async () => {
  const evidence = await comparisonFixture().service.create("trade:4");
  const { service } = lessonFixture(evidence);
  const context = { actorId: "operator:1", role: "approver" as const, authenticatedAt: at };
  await assert.rejects(
    service.review({ ...command(evidence), candidateFingerprint: fp("9") }, context),
    /LESSON_CANDIDATE_FINGERPRINT_MISMATCH/u,
  );
  await assert.rejects(
    service.review({ ...command(evidence), comparativeEvidenceFingerprint: fp("9") }, context),
    /COMPARATIVE_EVIDENCE_FINGERPRINT_MISMATCH/u,
  );
  await service.review(command(evidence), context);
  await assert.rejects(
    service.review({ ...command(evidence), decision: "reject" }, context),
    /LESSON_REVIEW_IDEMPOTENCY_CONFLICT/u,
  );

  const insufficient = await new ComparativeTradeEvidenceService({
    async requireTrade() {
      return evidence.selectedTrade;
    },
    async listPriorClosedTrades() {
      return [];
    },
  }).create(evidence.selectedTrade.tradeId);
  const insufficientService = lessonFixture(insufficient).service;
  await assert.rejects(
    insufficientService.review(command(insufficient), context),
    /LESSON_REVIEW_COMPARATIVE_EVIDENCE_REQUIRED/u,
  );
});

test("rejection is immutable and never creates an approved lesson or Runtime mutation", async () => {
  const evidence = await comparisonFixture().service.create("trade:4");
  const { service } = lessonFixture(evidence);
  const response = await service.review(
    { ...command(evidence), decision: "reject", rationale: "The evidence does not support this lesson." },
    { actorId: "operator:1", role: "approver", authenticatedAt: at },
  );
  assert.equal(response.review.lifecycleStatus, "rejected");
  assert.equal(response.review.approvedLessonCreated, false);
  assert.equal(response.review.strategyMutationCreated, false);
  assert.equal(response.nextGate, "candidate_closed");
});

test("HTTP derives reviewer from Bearer auth and rejects client-owned fields", async () => {
  const evidence = await comparisonFixture().service.create("trade:4");
  const { service } = lessonFixture(evidence);
  const handler = new ComparativeTradeReviewHttpHandler(
    comparisonFixture().service,
    service,
    {
      async authenticate(header) {
        if (header !== "Bearer server-token") throw new Error("UNAUTHENTICATED");
        return { actorId: "operator:server", role: "approver", authenticatedAt: at };
      },
    },
  );
  const unauthenticated = await handler.handle(
    new Request("http://localhost/api/orchestration/lesson-candidates/reviews", {
      method: "POST",
      body: JSON.stringify(command(evidence)),
      headers: { "content-type": "application/json" },
    }),
  );
  assert.equal(unauthenticated.status, 401);

  const injected = await handler.handle(
    new Request("http://localhost/api/orchestration/lesson-candidates/reviews", {
      method: "POST",
      body: JSON.stringify({ ...command(evidence), actorId: "client", role: "admin" }),
      headers: {
        authorization: "Bearer server-token",
        "content-type": "application/json",
      },
    }),
  );
  assert.equal(injected.status, 400);

  const accepted = await handler.handle(
    new Request("http://localhost/api/orchestration/lesson-candidates/reviews", {
      method: "POST",
      body: JSON.stringify(command(evidence)),
      headers: {
        authorization: "Bearer server-token",
        "content-type": "application/json",
      },
    }),
  );
  assert.equal(accepted.status, 200);
  const body = await accepted.json() as { review: { reviewer: { actorId: string } } };
  assert.equal(body.review.reviewer.actorId, "operator:server");
});

test("SQLite review repository restores the immutable idempotent record", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-lesson-review-"));
  const repository = new SQLiteLessonCandidateReviewRepository(
    join(directory, "reviews.sqlite"),
  );
  try {
    const evidence = await comparisonFixture().service.create("trade:4");
    const { service } = lessonFixture(evidence, repository);
    const response = await service.review(
      command(evidence),
      { actorId: "operator:1", role: "approver", authenticatedAt: at },
    );
    const restored = await repository.findByIdempotencyKey("lesson-review:key:1");
    assert.deepEqual(restored, response.review);
  } finally {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
