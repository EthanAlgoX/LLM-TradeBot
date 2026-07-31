import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SQLitePaperAccountStore } from "../packages/adapters/src/sqlite-paper-account-store.js";
import { SQLiteReflectionStore } from "../packages/adapters/src/sqlite-reflection-store.js";
import { RuleReflectionAgent } from "../packages/agents/src/rule-reflection-agent.js";
import {
  startCurrentPipelineOrchestrationServer,
} from "../packages/runtime/src/current-pipeline-orchestration-runtime.js";

const token = "main-server-comparative-review-token";
const baseTime = Date.parse("2026-07-29T08:00:00.000Z");

function closedTrade(index: number) {
  return {
    tradeId: `trade:main:${index}`,
    positionId: `position:main:${index}`,
    symbol: "BTCUSDT",
    side: "long" as const,
    qty: 0.1,
    entryPrice: 100 + index,
    exitPrice: 102 + index,
    openedAt: new Date(baseTime + index * 3_600_000),
    closedAt: new Date(baseTime + index * 3_600_000 + 1_800_000),
    exitReason: "take_profit",
    realizedPnl: index === 9 ? -2 : 2 + index,
    fees: 0.1 + index * 0.01,
    entryTraceId: `trace:main:${index}:entry`,
    entryDecisionArtifactId: `artifact:main:${index}:decision`,
    exitTraceId: `trace:main:${index}`,
  };
}

test("main server mounts authenticated comparative and human review routes", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-main-review-"));
  const paperPath = join(directory, "paper.sqlite");
  const reflectionPath = join(directory, "reflection.sqlite");
  const reviewPath = join(directory, "reviews.sqlite");
  const database = new DatabaseSync(":memory:");
  const trades = Array.from({ length: 10 }, (_, index) =>
    closedTrade(index));

  const paper = new SQLitePaperAccountStore(paperPath);
  const account = await paper.initialize("paper:main-review", 10_000);
  await paper.save("paper:main-review", {
    ...account,
    closedTrades: trades,
  });
  paper.close();

  const reflection = new SQLiteReflectionStore(reflectionPath);
  const report = await new RuleReflectionAgent({
    semanticCandidate: {
      marketPackRef: {
        id: "market-pack:crypto:v1",
        version: "1.0.0",
        fingerprint: "sha256:e0f5f3522ac99c6598eebc0693162aa62d9f5f674a590e9404c6c7118d15bdf7",
      },
      reflectionAgentConfigRef: {
        id: "agent-config:reflection:main",
        version: "1.0.0",
        fingerprint: `sha256:${"4".repeat(64)}`,
      },
    },
  }).run({
    trades,
    asOf: new Date(baseTime + 10_800_000),
    sourceArtifacts: trades.map((trade) => ({
      schemaVersion: "v1",
      artifactId: trade.entryDecisionArtifactId,
      traceId: trade.entryTraceId,
      asOf: trade.openedAt,
      symbol: trade.symbol,
      stage: "decision",
      agent: "rule_decision_agent",
      agentVersion: "v1",
      status: "success",
      startedAt: trade.openedAt,
      completedAt: trade.openedAt,
      durationMs: 0,
      input: { analysis: { regime: "trend" } },
      output: { action: "open_long" },
      sourceArtifactIds: [],
    })),
  });
  assert.ok(report);
  await reflection.save("paper:main-review", report);
  reflection.close();

  const runtime = await startCurrentPipelineOrchestrationServer({
    database,
    host: "127.0.0.1",
    port: 0,
    operatorToken: token,
    comparativeTradeReview: {
      accountId: "paper:main-review",
      paperDatabasePath: paperPath,
      reflectionDatabasePath: reflectionPath,
      reviewDatabasePath: reviewPath,
      marketPackRef: {
        id: "market-pack:crypto:v1",
        version: "1.0.0",
        fingerprint:
          "sha256:e0f5f3522ac99c6598eebc0693162aa62d9f5f674a590e9404c6c7118d15bdf7",
      },
      dataSourceRef: {
        id: "data-source:local-paper-fixture:v1",
        version: "1.0.0",
        fingerprint:
          "sha256:88c2c595d6c2be2cf8294997dbaefcfea6480f8b6934a5ec41a2e9126ebfea4e",
      },
      pipelineGraphRef: {
        id: "pipeline-graph:current-crypto-fixed",
        version: "1.0.0",
        fingerprint:
          "sha256:c4895c476fdebed86eb40014690cd5dc80fceb6bfc8118ca2df95d2df2a3ee38",
      },
      schemaRef: {
        schemaId: "tradebot.closed-trades.v1",
        schemaVersion: "1.0.0",
      },
    },
  });
  const address = runtime.server.address();
  assert.ok(address && typeof address === "object");
  context.after(async () => {
    await runtime.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const root = `http://127.0.0.1:${address.port}`;

  const unauthenticated = await fetch(
    `${root}/api/orchestration/trade-reviews/comparisons`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selectedTradeId: "trade:main:9" }),
    },
  );
  assert.equal(unauthenticated.status, 401);

  const injected = await fetch(
    `${root}/api/orchestration/trade-reviews/comparisons`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        selectedTradeId: "trade:main:9",
        actorId: "attacker",
        sql: "select * from trades",
        path: "/tmp/account.sqlite",
        runtimeSymbols: ["ETHUSDT"],
      }),
    },
  );
  assert.equal(injected.status, 400);

  const comparisonResponse = await fetch(
    `${root}/api/orchestration/trade-reviews/comparisons`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ selectedTradeId: "trade:main:9" }),
    },
  );
  assert.equal(comparisonResponse.status, 200);
  const comparison = await comparisonResponse.json() as {
    id: string;
    fingerprint: string;
    baselineTradeId: string;
    runtimeApplied: false;
    exchangeWriteAllowed: false;
    selectedTrade: {
      marketPackRef: { id: string };
      dataSourceRef: { id: string };
    };
  };
  assert.equal(comparison.baselineTradeId, "trade:main:8");
  assert.equal(comparison.runtimeApplied, false);
  assert.equal(comparison.exchangeWriteAllowed, false);
  assert.equal(
    comparison.selectedTrade.marketPackRef.id,
    "market-pack:crypto:v1",
  );
  assert.equal(
    comparison.selectedTrade.dataSourceRef.id,
    "data-source:local-paper-fixture:v1",
  );

  const candidateResponse = await fetch(
    `${root}/api/orchestration/lesson-candidates/inspect`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ selectedTradeId: "trade:main:9" }),
    },
  );
  assert.equal(candidateResponse.status, 200);
  const candidate = await candidateResponse.json() as {
    id: string;
    fingerprint: string;
  };
  const command = {
    candidateId: candidate.id,
    candidateFingerprint: candidate.fingerprint,
    comparativeEvidenceId: comparison.id,
    comparativeEvidenceFingerprint: comparison.fingerprint,
    decision: "accept_for_validation",
    rationale: "Advance this candidate to contract validation only.",
    idempotencyKey: "main-server-review-idempotency",
  };
  const reviewRequest = () => fetch(
    `${root}/api/orchestration/lesson-candidates/reviews`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    },
  );
  const first = await reviewRequest();
  const second = await reviewRequest();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const firstBody = await first.json() as {
    review: {
      id: string;
      reviewer: { actorId: string; role: string };
      approvedLessonCreated: false;
      strategyMutationCreated: false;
      runtimeApplied: false;
    };
    nextGate: string;
    runtimeApplied: false;
  };
  const secondBody = await second.json() as typeof firstBody;
  assert.equal(secondBody.review.id, firstBody.review.id);
  assert.equal(firstBody.review.reviewer.actorId, "local:operator");
  assert.equal(firstBody.review.reviewer.role, "approver");
  assert.equal(firstBody.review.approvedLessonCreated, false);
  assert.equal(firstBody.review.strategyMutationCreated, false);
  assert.equal(firstBody.review.runtimeApplied, false);
  assert.equal(firstBody.runtimeApplied, false);
  assert.equal(firstBody.nextGate, "contract_validation");

  const historyResponse = await fetch(
    `${root}/api/orchestration/lesson-candidates/reviews/history`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        selectedTradeId: "trade:main:9",
        limit: 10,
      }),
    },
  );
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json() as {
    records: Array<{ id: string; runtimeApplied: false }>;
    readOnly: true;
    runtimeApplied: false;
  };
  assert.equal(history.records[0]?.id, firstBody.review.id);
  assert.equal(history.records[0]?.runtimeApplied, false);
  assert.equal(history.readOnly, true);
  assert.equal(history.runtimeApplied, false);

});
