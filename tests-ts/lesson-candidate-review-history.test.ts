import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LessonCandidateReviewHistoryRequestSchema,
  LessonCandidateReviewHistoryResponseSchema,
  LessonCandidateReviewRecordSchema,
  type LessonCandidateReviewRecord,
} from "../packages/contracts/src/index.js";
import { ComparativeTradeReviewHttpHandler } from "../packages/runtime/src/comparative-trade-review-http.js";
import { SQLiteLessonCandidateReviewRepository } from "../packages/runtime/src/sqlite-lesson-candidate-review-repository.js";

const fp = (value: string) => `sha256:${value.repeat(64)}` as const;

function record(index: number): LessonCandidateReviewRecord {
  return LessonCandidateReviewRecordSchema.parse({
    schemaVersion: "1.0.0",
    id: `lesson-review:history:${index}`,
    humanVersion: "1.0.0",
    fingerprint: fp(String(index + 1)),
    createdAt: `2026-07-29T08:0${index}:00.000Z`,
    lifecycleStatus:
      index % 2 === 0 ? "accepted_for_validation" : "rejected",
    candidateId: "candidate:history",
    candidateFingerprint: fp("a"),
    comparativeEvidenceId: `comparison:history:${index}`,
    comparativeEvidenceFingerprint: fp("b"),
    sourceTradeId: "trade:history",
    decision: index % 2 === 0 ? "accept_for_validation" : "reject",
    rationale: `Review rationale ${index}`,
    reviewer: {
      actorId: "operator:history",
      role: "approver",
      authenticatedAt: "2026-07-29T08:00:00.000Z",
    },
    idempotencyKey: `history:${index}`,
    approvedLessonCreated: false,
    strategyMutationCreated: false,
    readOnlyEvidence: true,
    runtimeApplied: false,
    exchangeWriteAllowed: false,
  });
}

test("history contracts are strict and bounded", () => {
  assert.equal(
    LessonCandidateReviewHistoryRequestSchema.safeParse({
      selectedTradeId: "trade:history",
      limit: 21,
    }).success,
    false,
  );
  assert.equal(
    LessonCandidateReviewHistoryRequestSchema.safeParse({
      selectedTradeId: "trade:history",
      actorId: "attacker",
      sql: "select * from lesson_candidate_reviews",
    }).success,
    false,
  );
});

test("SQLite review history is newest-first cursor-paginated and persistent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-review-history-"));
  const path = join(directory, "reviews.sqlite");
  const repository = new SQLiteLessonCandidateReviewRepository(path);
  for (let index = 0; index < 4; index += 1) {
    await repository.append(record(index));
  }
  const first = await repository.listByCandidateId({
    candidateId: "candidate:history",
    limit: 2,
  });
  assert.deepEqual(
    first.records.map((item) => item.id),
    ["lesson-review:history:3", "lesson-review:history:2"],
  );
  assert.ok(first.nextCursor);
  repository.close();

  const reopened = new SQLiteLessonCandidateReviewRepository(path);
  const second = await reopened.listByCandidateId({
    candidateId: "candidate:history",
    cursor: first.nextCursor,
    limit: 2,
  });
  assert.deepEqual(
    second.records.map((item) => item.id),
    ["lesson-review:history:1", "lesson-review:history:0"],
  );
  assert.equal(second.nextCursor, undefined);
  await assert.rejects(
    reopened.listByCandidateId({
      candidateId: "candidate:history",
      cursor: "not-a-valid-cursor",
      limit: 2,
    }),
    /LESSON_REVIEW_HISTORY_CURSOR_INVALID/u,
  );
  reopened.close();
  rmSync(directory, { recursive: true, force: true });
});

test("history HTTP derives identity and rejects client selectors", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-review-http-"));
  const repository = new SQLiteLessonCandidateReviewRepository(
    join(directory, "reviews.sqlite"),
  );
  await repository.append(record(0));
  const handler = new ComparativeTradeReviewHttpHandler(
    { async create() { throw new Error("unused"); } },
    { async review() { throw new Error("unused"); } } as never,
    {
      async authenticate(header) {
        if (header !== "Bearer history") throw new Error("UNAUTHENTICATED");
        return {
          actorId: "operator:history",
          role: "approver",
          authenticatedAt: "2026-07-29T08:10:00.000Z",
        };
      },
    },
    {
      async requireCandidate() {
        throw new Error("unused");
      },
      async findBySourceTradeId(tradeId) {
        return tradeId === "trade:history"
          ? {
              candidateId: "candidate:history",
              fingerprint: fp("a"),
              sourceTradeId: tradeId,
            }
          : undefined;
      },
    },
    repository,
  );
  const request = (body: object, authorization = "Bearer history") =>
    handler.handle(new Request(
      "http://local/api/orchestration/lesson-candidates/reviews/history",
      {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    ));
  assert.equal(
    (await request({ selectedTradeId: "trade:history" }, "")).status,
    401,
  );
  assert.equal(
    (await request({
      selectedTradeId: "trade:history",
      path: "/tmp/reviews.sqlite",
      url: "https://attacker.invalid",
      code: "return process.env",
    })).status,
    400,
  );
  const response = await request({
    selectedTradeId: "trade:history",
    limit: 10,
  });
  assert.equal(response.status, 200);
  const history = LessonCandidateReviewHistoryResponseSchema.parse(
    await response.json(),
  );
  assert.equal(history.records.length, 1);
  assert.equal(history.readOnly, true);
  assert.equal(history.runtimeApplied, false);
  assert.equal(history.exchangeWriteAllowed, false);
  repository.close();
  rmSync(directory, { recursive: true, force: true });
});

