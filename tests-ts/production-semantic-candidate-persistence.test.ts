import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SQLiteReflectionStore } from "../packages/adapters/src/sqlite-reflection-store.js";
import { RuleReflectionAgent } from "../packages/agents/src/rule-reflection-agent.js";
import {
  AgentArtifactSchema,
  ReflectionCandidateInspectionRequestSchema,
  ReflectionReportSchema,
} from "../packages/contracts/src/index.js";
import {
  ReflectionStoreCandidateReviewAdapter,
  ReflectionStoreSemanticLessonCandidateAdapter,
} from "../packages/runtime/src/production-comparative-trade-review.js";

const at = new Date("2026-07-31T10:00:00.000Z");
const marketPackRef = {
  id: "market-pack:crypto:v1",
  version: "1.0.0",
  fingerprint: `sha256:${"1".repeat(64)}` as const,
};
const reflectionAgentConfigRef = {
  id: "agent-config:rule-reflection:v1",
  version: "1.0.0",
  fingerprint: `sha256:${"2".repeat(64)}` as const,
};
const trade = {
  tradeId: "trade:semantic:1",
  positionId: "position:semantic:1",
  symbol: "BTCUSDT",
  side: "long" as const,
  qty: 1,
  entryPrice: 100,
  exitPrice: 95,
  openedAt: new Date("2026-07-31T09:00:00.000Z"),
  closedAt: at,
  exitReason: "stop_loss",
  realizedPnl: -5,
  fees: 0.2,
  entryConfidence: 80,
  entryTraceId: "trace:semantic:entry",
  entryDecisionArtifactId: "artifact:semantic:decision",
};
const decisionArtifact = AgentArtifactSchema.parse({
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
  input: { analysis: { regime: "trending_up" } },
  output: { action: "open_long", confidence: 80 },
  sourceArtifactIds: [],
});

function agent() {
  return new RuleReflectionAgent({
    minimumTrades: 1,
    intervalTrades: 1,
    semanticCandidate: { marketPackRef, reflectionAgentConfigRef },
  });
}

test("Reflection contracts reject unknown and client Candidate injection fields", () => {
  assert.equal(ReflectionReportSchema.safeParse({ unknown: true }).success, false);
  assert.equal(ReflectionCandidateInspectionRequestSchema.safeParse({
    selectedTradeId: trade.tradeId,
    candidate: { semanticLesson: "client supplied" },
  }).success, false);
});

test("Rule Reflection generates a semantic Candidate only with failed Trade and Decision lineage", async () => {
  const missingFacts = await agent().run({ asOf: at, trades: [trade] });
  assert.equal(missingFacts?.semanticLessonCandidates, undefined);
  const report = await agent().run({
    asOf: at,
    trades: [trade],
    sourceArtifacts: [decisionArtifact],
  });
  const candidate = report?.semanticLessonCandidates?.[0];
  assert.equal(candidate?.failedTradeRef.tradeId, trade.tradeId);
  assert.equal(candidate?.failedTradeRef.decisionArtifactRef.artifactId, decisionArtifact.artifactId);
  assert.equal(candidate?.applicableRegimes[0], "trending_up");
  assert.equal(candidate ? "runtimeApplied" in candidate : true, false);
});

test("SQLite Reflection Store persists Candidate append-only and restores it after restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-semantic-candidate-"));
  const path = join(directory, "reflection.sqlite");
  try {
    const report = await agent().run({ asOf: at, trades: [trade], sourceArtifacts: [decisionArtifact] });
    assert.ok(report);
    const first = new SQLiteReflectionStore(path);
    await first.save("paper:test", report);
    await first.save("paper:test", report);
    const before = await first.findCandidateBySourceTradeId("paper:test", trade.tradeId);
    first.close();
    const reopened = new SQLiteReflectionStore(path);
    const after = await reopened.findCandidateBySourceTradeId("paper:test", trade.tradeId);
    assert.deepEqual(after, before);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite Reflection Store rejects Candidate fingerprint drift", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-semantic-conflict-"));
  const path = join(directory, "reflection.sqlite");
  try {
    const report = await agent().run({ asOf: at, trades: [trade], sourceArtifacts: [decisionArtifact] });
    assert.ok(report?.semanticLessonCandidates?.[0]);
    const store = new SQLiteReflectionStore(path);
    await store.save("paper:test", report);
    const changed = {
      ...report,
      semanticLessonCandidates: [{
        ...report.semanticLessonCandidates[0],
        fingerprint: `sha256:${"f".repeat(64)}` as const,
      }],
    };
    await assert.rejects(
      store.save("paper:test", changed),
      /REFLECTION_LESSON_CANDIDATE_FINGERPRINT_CONFLICT/u,
    );
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Review and Materialization adapters restore the same persisted Candidate", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-semantic-shared-"));
  const path = join(directory, "reflection.sqlite");
  try {
    const report = await agent().run({ asOf: at, trades: [trade], sourceArtifacts: [decisionArtifact] });
    assert.ok(report);
    const store = new SQLiteReflectionStore(path);
    await store.save("paper:test", report);
    const review = new ReflectionStoreCandidateReviewAdapter(store, "paper:test");
    const materialization = new ReflectionStoreSemanticLessonCandidateAdapter(store, "paper:test");
    const reviewCandidate = await review.findBySourceTradeId(trade.tradeId);
    const semanticCandidate = await materialization.findBySourceTradeId(trade.tradeId);
    assert.equal(reviewCandidate?.candidateId, semanticCandidate?.id);
    assert.equal(reviewCandidate?.fingerprint, semanticCandidate?.fingerprint);
    const summary = await review.inspectBySourceTradeId(trade.tradeId);
    assert.equal(summary?.lineageStatus, "verified");
    assert.equal(summary?.semanticFactsAvailable, true);
    assert.equal(summary?.runtimeApplied, false);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
