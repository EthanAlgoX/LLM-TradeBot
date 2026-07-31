import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SQLitePaperAccountStore } from "../packages/adapters/src/sqlite-paper-account-store.js";
import { SQLiteReflectionStore } from "../packages/adapters/src/sqlite-reflection-store.js";
import { RuleReflectionAgent } from "../packages/agents/src/rule-reflection-agent.js";
import {
  PaperAccountTradeOutcomeEvidenceAdapter,
  ProductionComparativeTradeReviewComposition,
  ReflectionStoreCandidateReviewAdapter,
} from "../packages/runtime/src/production-comparative-trade-review.js";

const fp = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;
const at = "2026-07-27T10:00:00.000Z";
const references = {
  marketPackRef: {
    id: "market-pack.crypto",
    version: "1.0.0",
    fingerprint: fp("1"),
  },
  dataSourceRef: {
    id: "data-source.local-paper",
    version: "1.0.0",
    fingerprint: fp("2"),
  },
  pipelineGraphRef: {
    id: "pipeline.current-crypto",
    version: "1.0.0",
    fingerprint: fp("3"),
  },
  schemaRef: {
    schemaId: "schema.trade-outcome-evidence",
    schemaVersion: "1.0.0",
  },
};

function closedTrade(index: number, overrides: Record<string, unknown> = {}) {
  const closedAt = new Date(Date.parse(at) - (9 - index) * 3_600_000);
  const openedAt = new Date(closedAt.getTime() - 60_000);
  return {
    tradeId: `trade:paper:${index}`,
    positionId: `position:paper:${index}`,
    symbol: "BTCUSDT",
    side: "long" as const,
    qty: 0.25,
    entryPrice: 100,
    exitPrice: 101,
    openedAt,
    closedAt,
    exitReason: "strategy_exit" as const,
    realizedPnl: index === 9 ? -2 : index - 5,
    fees: index / 10,
    entryConfidence: 60,
    entryOrderId: `paper:${index}:entry`,
    entryTraceId: `paper-runtime-run:test:cycle:${index}:entry`,
    entryDecisionArtifactId: `artifact:${index}:entry:decision`,
    entryPortfolioArtifactId: `artifact:${index}:entry:portfolio`,
    entryRiskArtifactId: `artifact:${index}:entry:risk`,
    entryExecutionArtifactId: `artifact:${index}:entry:execution`,
    entryFillId: `fill:paper:${index}:entry`,
    exitOrderId: `paper:${index}:exit`,
    exitTraceId: `paper-runtime-run:test:cycle:${index}`,
    exitDecisionArtifactId: `artifact:${index}:exit:decision`,
    exitPortfolioArtifactId: `artifact:${index}:exit:portfolio`,
    exitRiskArtifactId: `artifact:${index}:exit:risk`,
    exitExecutionArtifactId: `artifact:${index}:exit:execution`,
    exitFillId: `fill:paper:${index}:exit`,
    ...overrides,
  };
}

async function seed(directory: string) {
  const paperPath = join(directory, "paper.sqlite");
  const reflectionPath = join(directory, "reflection.sqlite");
  const paper = new SQLitePaperAccountStore(paperPath);
  const account = await paper.initialize("paper:review", 10_000);
  const trades = Array.from({ length: 10 }, (_, index) => closedTrade(index));
  await paper.save("paper:review", { ...account, closedTrades: trades });
  paper.close();

  const reflection = new SQLiteReflectionStore(reflectionPath);
  const sourceArtifacts = trades.map((trade) => ({
    schemaVersion: "v1" as const,
    artifactId: trade.entryDecisionArtifactId,
    traceId: trade.entryTraceId,
    asOf: trade.openedAt,
    symbol: trade.symbol,
    stage: "decision",
    agent: "rule_decision_agent",
    agentVersion: "v1",
    status: "success" as const,
    startedAt: trade.openedAt,
    completedAt: trade.openedAt,
    durationMs: 0,
    input: { analysis: { regime: "trend" } },
    output: { action: "open_long" },
    sourceArtifactIds: [],
  }));
  const report = await new RuleReflectionAgent({
    semanticCandidate: {
      marketPackRef: references.marketPackRef,
      reflectionAgentConfigRef: {
        id: "agent-config:reflection:test",
        version: "1.0.0",
        fingerprint: fp("4"),
      },
    },
  }).run({
    trades,
    asOf: new Date(at),
    sourceArtifacts,
  });
  assert.ok(report);
  await reflection.save("paper:review", report);
  reflection.close();
  return { paperPath, reflectionPath, trades, report };
}

test("production Paper adapter preserves real SQLite PnL fees and server references", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-production-review-"));
  try {
    const { paperPath, trades } = await seed(directory);
    const paper = new SQLitePaperAccountStore(paperPath);
    const adapter = new PaperAccountTradeOutcomeEvidenceAdapter(
      paper,
      "paper:review",
      references,
    );
    const outcome = await adapter.requireTrade("trade:paper:9");
    assert.equal(outcome.realizedPnl, trades[9]?.realizedPnl);
    assert.equal(outcome.fees, trades[9]?.fees);
    assert.equal(outcome.quantity, trades[9]?.qty);
    assert.deepEqual(outcome.marketPackRef, references.marketPackRef);
    assert.deepEqual(outcome.dataSourceRef, references.dataSourceRef);
    assert.deepEqual(outcome.pipelineGraphRef, references.pipelineGraphRef);
    paper.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production Paper adapter rejects unknown and lineage-incomplete Trades", async () => {
  const valid = closedTrade(1);
  const adapter = new PaperAccountTradeOutcomeEvidenceAdapter(
    {
      async load() {
        return {
          closedTrades: [
            valid,
            closedTrade(2, { tradeId: undefined, exitTraceId: undefined }),
          ],
        };
      },
    },
    "paper:review",
    references,
  );
  await assert.rejects(
    adapter.requireTrade("trade:missing"),
    /SELECTED_TRADE_NOT_REGISTERED/u,
  );
  await assert.rejects(
    adapter.listPriorClosedTrades({ closedBefore: at, maximum: 10 }),
    /TRADE_LINEAGE_INCOMPLETE/u,
  );
});

test("Reflection adapter requires a persisted semantic Candidate and returns its stable identity", async () => {
  const unavailable = new ReflectionStoreCandidateReviewAdapter(
    {
      async latest() { return undefined; },
      async getCandidate() { return undefined; },
      async findCandidateBySourceTradeId() { return undefined; },
    },
    "paper:review",
  );
  assert.equal(
    await unavailable.findBySourceTradeId("trade:paper:9"),
    undefined,
  );

  const directory = mkdtempSync(join(tmpdir(), "tradebot-reflection-adapter-"));
  const seeded = await seed(directory);
  const store = new SQLiteReflectionStore(seeded.reflectionPath);
  const adapter = new ReflectionStoreCandidateReviewAdapter(
    store,
    "paper:review",
  );
  const first = await adapter.inspectBySourceTradeId("trade:paper:9");
  const second = await adapter.inspectBySourceTradeId("trade:paper:9");
  assert.deepEqual(second, first);
  assert.equal(first?.lifecycleStatus, "candidate");
  assert.equal(first?.semanticFactsAvailable, true);
  assert.equal(first?.lineageStatus, "verified");
  assert.equal(first?.runtimeApplied, false);
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

test("production composition serves authenticated comparison inspection and review", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-production-review-"));
  const { paperPath, reflectionPath } = await seed(directory);
  const composition = new ProductionComparativeTradeReviewComposition({
    accountId: "paper:review",
    paperDatabasePath: paperPath,
    reflectionDatabasePath: reflectionPath,
    reviewDatabasePath: join(directory, "reviews.sqlite"),
    authenticator: {
      async authenticate(header) {
        if (header !== "Bearer production-token") {
          throw new Error("UNAUTHENTICATED");
        }
        return {
          actorId: "operator:production",
          role: "approver",
          authenticatedAt: at,
        };
      },
    },
    now: () => at,
    ...references,
  });
  const request = (path: string, body: unknown, authenticated = true) =>
    composition.handler.handle(
      new Request(`http://localhost${path}`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          ...(authenticated ? { authorization: "Bearer production-token" } : {}),
          "content-type": "application/json",
        },
      }),
    );
  try {
    const denied = await request(
      "/api/orchestration/lesson-candidates/inspect",
      { selectedTradeId: "trade:paper:9" },
      false,
    );
    assert.equal(denied.status, 401);

    const injected = await request(
      "/api/orchestration/lesson-candidates/inspect",
      { selectedTradeId: "trade:paper:9", actorId: "client", sql: "select 1" },
    );
    assert.equal(injected.status, 400);

    const comparisonResponse = await request(
      "/api/orchestration/trade-reviews/comparisons",
      { selectedTradeId: "trade:paper:9" },
    );
    assert.equal(comparisonResponse.status, 200);
    const comparison = await comparisonResponse.json() as {
      id: string;
      fingerprint: string;
      lifecycleStatus: string;
      runtimeApplied: false;
    };
    assert.equal(comparison.lifecycleStatus, "available");
    assert.equal(comparison.runtimeApplied, false);

    const candidateResponse = await request(
      "/api/orchestration/lesson-candidates/inspect",
      { selectedTradeId: "trade:paper:9" },
    );
    assert.equal(candidateResponse.status, 200);
    const candidate = await candidateResponse.json() as {
      id: string;
      fingerprint: string;
    };

    const reviewResponse = await request(
      "/api/orchestration/lesson-candidates/reviews",
      {
        candidateId: candidate.id,
        candidateFingerprint: candidate.fingerprint,
        comparativeEvidenceId: comparison.id,
        comparativeEvidenceFingerprint: comparison.fingerprint,
        decision: "accept_for_validation",
        rationale: "The operator accepted this candidate for controlled validation.",
        idempotencyKey: "production-review:key:1",
      },
    );
    assert.equal(reviewResponse.status, 200);
    const review = await reviewResponse.json() as {
      review: {
        lifecycleStatus: string;
        approvedLessonCreated: false;
        runtimeApplied: false;
      };
    };
    assert.equal(review.review.lifecycleStatus, "accepted_for_validation");
    assert.equal(review.review.approvedLessonCreated, false);
    assert.equal(review.review.runtimeApplied, false);
  } finally {
    composition.close();
    const reopened = new SQLitePaperAccountStore(paperPath);
    assert.ok(await reopened.load("paper:review"));
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
