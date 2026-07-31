import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentArtifactSchema,
  CycleRequestSchema,
  SingleTradeReviewSchema,
  type AgentArtifact,
  type AgentArtifactQuery,
  type PaperRuntimeCycleAudit,
  type PaperRuntimeRun,
  type StageEvent,
} from "../packages/contracts/src/index.js";
import { RuleReflectionAgent } from "../packages/agents/src/rule-reflection-agent.js";
import { SimulatedExecutionAgent } from "../packages/adapters/src/simulated-execution-agent.js";
import { SQLiteAgentArtifactLedger } from "../packages/adapters/src/sqlite-agent-artifact-ledger.js";
import { DecisionPipeline } from "../packages/core/src/trading-application.js";
import { CausalTradeReviewReadModelService } from "../packages/runtime/src/causal-trade-review-read-model.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entryAt = new Date("2026-07-27T09:00:00.000Z");
const exitAt = new Date("2026-07-27T10:00:00.000Z");

function executionEvidence(prefix: string) {
  return {
    executionArtifactId: `artifact:${prefix}:execution`,
    sourceArtifactIds: [
      `artifact:${prefix}:decision`,
      `artifact:${prefix}:portfolio`,
      `artifact:${prefix}:risk`,
    ],
    decisionArtifactId: `artifact:${prefix}:decision`,
    portfolioArtifactId: `artifact:${prefix}:portfolio`,
    riskArtifactId: `artifact:${prefix}:risk`,
  };
}

function decision(
  traceId: string,
  asOf: Date,
  action: "open_long" | "close_long",
  price: number,
) {
  return {
    schemaVersion: "v1" as const,
    traceId,
    asOf,
    symbol: "BTCUSDT",
    action,
    confidence: 82,
    reason: action === "open_long" ? "entry_fixture" : "stop_loss",
    evidence: [],
    missingConfirmations: [],
    orderIntent: {
      symbol: "BTCUSDT",
      action,
      entryPrice: price,
      notional: action === "open_long" ? 100 : 95,
      stopLoss: action === "open_long" ? 95 : 0,
      takeProfit: action === "open_long" ? 110 : 0,
      leverage: 1,
    },
  };
}

const risk = (traceId: string) => ({
  schemaVersion: "v1" as const,
  traceId,
  symbol: "BTCUSDT",
  passed: true,
  riskLevel: "safe" as const,
  corrections: {},
  warnings: [],
});

async function directTrade() {
  const executor = new SimulatedExecutionAgent({
    initialCash: 1_000,
    feeBps: 10,
    slippageBps: 0,
  });
  const opening = await executor.run({
    decision: decision("trace:entry", entryAt, "open_long", 100),
    risk: risk("trace:entry"),
    evidence: executionEvidence("entry"),
  });
  const closing = await executor.run({
    decision: decision("trace:exit", exitAt, "close_long", 95),
    risk: risk("trace:exit"),
    evidence: executionEvidence("exit"),
  });
  return { executor, opening, closing, state: executor.exportState() };
}

test("Trade lineage contracts are strict and reject executable injection", () => {
  const base = {
    schemaVersion: "1.0.0" as const,
    reviewId: "single-trade-review:trade:1",
    humanVersion: "1.0.0",
    fingerprint: `sha256:${"a".repeat(64)}`,
    createdAt: exitAt.toISOString(),
    lifecycleStatus: "closed_trade" as const,
    availability: "available" as const,
    runId: "run:1",
    cycle: 2,
    traceId: "trace:exit",
    tradeRef: "trade:1",
    tradeId: "trade:1",
    reflectionCandidateOnly: true as const,
    links: [],
    issues: [],
    marketPackRef: "market-pack:crypto:v1",
    dataSourceRef: "local_fixture",
    graphRef: "graph:crypto",
    schemaRefs: ["tradebot.single-trade-review.v1"],
    readOnly: true as const,
    runtimeApplied: false as const,
    exchangeWriteAllowed: false as const,
  };
  assert.equal(SingleTradeReviewSchema.safeParse(base).success, true);
  assert.equal(
    SingleTradeReviewSchema.safeParse({
      ...base,
      sql: "select * from paper_account_states",
    }).success,
    false,
  );
});

test("Paper execution persists stable Entry and Exit order, fill, and artifact references", async () => {
  const { opening, closing, state } = await directTrade();
  const trade = state.closedTrades[0]!;
  assert.equal(opening.tradeId, "trade:paper:1");
  assert.equal(opening.fillId, "fill:paper:1");
  assert.equal(trade.entryOrderId, "paper:1");
  assert.equal(trade.entryDecisionArtifactId, "artifact:entry:decision");
  assert.equal(trade.entryRiskArtifactId, "artifact:entry:risk");
  assert.equal(trade.entryExecutionArtifactId, "artifact:entry:execution");
  assert.equal(trade.exitOrderId, "paper:2");
  assert.equal(trade.exitDecisionArtifactId, "artifact:exit:decision");
  assert.equal(trade.exitRiskArtifactId, "artifact:exit:risk");
  assert.equal(trade.exitExecutionArtifactId, "artifact:exit:execution");
  assert.equal(closing.tradeId, opening.tradeId);
  assert.equal(state.orders[1]?.tradeId, opening.tradeId);
  assert.equal(trade.realizedPnl, -5);
  assert.equal(trade.fees, 0.195);
});

test("Reflection remains a candidate and explicitly records source Trade IDs", async () => {
  const { state } = await directTrade();
  const report = await new RuleReflectionAgent({
    minimumTrades: 1,
    intervalTrades: 1,
  }).run({ asOf: exitAt, trades: state.closedTrades });
  assert.deepEqual(report?.sourceTradeIds, ["trade:paper:1"]);
  assert.ok(report?.reflectionId);
});

test("SQLite Artifact Ledger queries the existing append-only facts by Trade ID", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-trade-lineage-"));
  const ledger = new SQLiteAgentArtifactLedger(join(directory, "artifacts.db"));
  try {
    await ledger.append(AgentArtifactSchema.parse({
      schemaVersion: "v1",
      artifactId: "artifact:execution",
      traceId: "trace:entry",
      asOf: entryAt,
      symbol: "BTCUSDT",
      stage: "execution",
      agent: "simulated_execution_agent",
      agentVersion: "v1",
      status: "success",
      startedAt: entryAt,
      completedAt: entryAt,
      durationMs: 0,
      input: {},
      output: { status: "filled" },
      orderId: "paper:1",
      tradeId: "trade:paper:1",
      sourceArtifactIds: ["artifact:risk"],
    }));
    const found = await ledger.query({
      tradeId: "trade:paper:1",
      limit: 10,
    });
    assert.equal(found[0]?.artifactId, "artifact:execution");
    assert.deepEqual(found[0]?.sourceArtifactIds, ["artifact:risk"]);
  } finally {
    ledger.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

async function pipelineScenario() {
  const artifacts: AgentArtifact[] = [];
  const executor = new SimulatedExecutionAgent({
    initialCash: 1_000,
    feeBps: 10,
    slippageBps: 0,
  });
  let cycleAt = entryAt;
  const pipeline = new DecisionPipeline({
    selector: {
      name: "selector",
      version: "v1",
      run: async ({ request }) => ({
        schemaVersion: "v1",
        traceId: request.traceId,
        asOf: request.asOf,
        candidates: [{
          symbol: "BTCUSDT",
          rank: 1,
          score: 100,
          tradable: true,
          selectedReasons: ["fixture"],
          rejectionReasons: [],
        }],
      }),
    },
    dataSync: {
      name: "data",
      version: "v1",
      run: async (input) => ({
        schemaVersion: "v1",
        traceId: input.traceId,
        asOf: input.asOf,
        symbol: input.symbol,
        stableBars: { "5m": [], "15m": [], "1h": [] },
        liveQuote: {
          price: cycleAt === entryAt ? 100 : 95,
          observedAt: input.asOf,
        },
        quality: {
          alignmentOk: true,
          missingTimeframes: [],
          warnings: [],
        },
      }),
    },
    analysis: {
      name: "analysis",
      version: "v1",
      run: async (snapshot) => ({
        schemaVersion: "v1",
        traceId: snapshot.traceId,
        asOf: snapshot.asOf,
        symbol: snapshot.symbol,
        regime: cycleAt === entryAt ? "trending_up" : "trending_down",
        trend: cycleAt === entryAt ? "long" : "short",
        setup: "ready",
        trigger: "confirmed",
        diagnostics: [],
      }),
    },
    bullCase: {
      name: "bull",
      version: "v1",
      run: async (analysis) => ({
        schemaVersion: "v1",
        traceId: analysis.traceId,
        symbol: analysis.symbol,
        side: "long",
        confidence: 90,
        evidence: [],
        invalidationConditions: [],
        veto: false,
      }),
    },
    bearCase: {
      name: "bear",
      version: "v1",
      run: async (analysis) => ({
        schemaVersion: "v1",
        traceId: analysis.traceId,
        symbol: analysis.symbol,
        side: "short",
        confidence: 10,
        evidence: [],
        invalidationConditions: [],
        veto: false,
      }),
    },
    decision: {
      name: "decision",
      version: "v1",
      run: async (input) =>
        decision(input.request.traceId, input.request.asOf, "open_long", 100),
    },
    positionMonitor: {
      name: "position-monitor",
      version: "v1",
      run: async (input) =>
        decision(input.request.traceId, input.request.asOf, "close_long", 95),
    },
    portfolio: {
      name: "portfolio",
      version: "v1",
      run: async (items) => [...items],
    },
    risk: {
      name: "risk",
      version: "v1",
      run: async ({ decision: value }) => risk(value.traceId),
    },
    execution: executor,
    positionState: executor,
    artifactLedger: {
      append: async (artifact) => {
        artifacts.push(AgentArtifactSchema.parse(artifact));
      },
      query: async (query: AgentArtifactQuery) =>
        artifacts.filter((artifact) =>
          (!query.traceId || artifact.traceId === query.traceId) &&
          (!query.orderId || artifact.orderId === query.orderId) &&
          (!query.tradeId || artifact.tradeId === query.tradeId)),
    },
    now: () => cycleAt,
  });
  await pipeline.runCycle(CycleRequestSchema.parse({
    schemaVersion: "v1",
    traceId: "trace:entry",
    runMode: "paper",
    asOf: entryAt,
    strategyId: "strategy:test",
    configVersion: "v1",
    symbols: ["BTCUSDT"],
    executionEnabled: true,
  }));
  cycleAt = exitAt;
  await pipeline.runCycle(CycleRequestSchema.parse({
    schemaVersion: "v1",
    traceId: "trace:exit",
    runMode: "paper",
    asOf: exitAt,
    strategyId: "strategy:test",
    configVersion: "v1",
    symbols: ["BTCUSDT"],
    executionEnabled: true,
  }));
  return { artifacts, state: executor.exportState() };
}

test("DecisionPipeline records explicit Decision to Portfolio to Risk to Execution and Position Monitor lineage", async () => {
  const { artifacts, state } = await pipelineScenario();
  const entryDecision = artifacts.find((item) =>
    item.traceId === "trace:entry" && item.stage === "decision")!;
  const entryPortfolio = artifacts.find((item) =>
    item.traceId === "trace:entry" && item.stage === "portfolio")!;
  const entryRisk = artifacts.find((item) =>
    item.traceId === "trace:entry" && item.stage === "risk")!;
  const entryExecution = artifacts.find((item) =>
    item.traceId === "trace:entry" && item.stage === "execution")!;
  const monitor = artifacts.find((item) =>
    item.traceId === "trace:exit" && item.stage === "position_monitor")!;
  assert.ok(entryPortfolio.sourceArtifactIds?.includes(entryDecision.artifactId));
  assert.ok(entryRisk.sourceArtifactIds?.includes(entryPortfolio.artifactId));
  assert.ok(entryExecution.sourceArtifactIds?.includes(entryRisk.artifactId));
  assert.ok(monitor.sourceArtifactIds?.includes(entryExecution.artifactId));
  assert.equal(state.positions.length, 0);
  assert.equal(state.closedTrades[0]?.entryExecutionArtifactId, entryExecution.artifactId);
  assert.equal(
    state.closedTrades[0]?.exitExecutionArtifactId,
    artifacts.find((item) =>
      item.traceId === "trace:exit" && item.stage === "execution")?.artifactId,
  );
});

test("Causal Single Trade Review uses Paper Account facts and keeps legacy gaps partial", async () => {
  const { artifacts, state } = await pipelineScenario();
  const report = await new RuleReflectionAgent({
    minimumTrades: 1,
    intervalTrades: 1,
  }).run({ asOf: exitAt, trades: state.closedTrades });
  const run: PaperRuntimeRun = {
    schemaVersion: "1.0.0",
    runId: "run:lineage",
    planId: "plan:lineage",
    planFingerprint: `sha256:${"b".repeat(64)}`,
    activationId: "activation:lineage",
    bindingId: "binding:lineage",
    paperAccountRef: "paper-account:test",
    strategyProfileRef: "graph:lineage",
    candidateSymbols: ["BTCUSDT"],
    requestedByActorId: "server:operator",
    status: "completed",
    plannedCycles: 2,
    processedCycles: 2,
    intervalMs: 1_000,
    lastControlMode: "normal",
    lastControlApplied: true,
    requestedAt: entryAt.toISOString(),
    startedAt: entryAt.toISOString(),
    finishedAt: exitAt.toISOString(),
    paperRuntimeApplied: true,
    exchangeWriteAllowed: false,
    clientRuntimeParametersAccepted: false,
  };
  const cycle: PaperRuntimeCycleAudit = {
    schemaVersion: "1.0.0",
    runId: run.runId,
    cycle: 2,
    traceId: "trace:exit",
    startedAt: exitAt.toISOString(),
    finishedAt: exitAt.toISOString(),
    status: "ok",
    controlMode: "normal",
    controlApplied: true,
    decisionCount: 1,
    riskDecisionCount: 1,
    executionCount: 1,
    safety: {
      consecutiveFailures: 0,
      updatedAt: exitAt.toISOString(),
    },
  };
  const traces: StageEvent[] = [{
    schemaVersion: "v1",
    traceId: "trace:exit",
    stage: "execution",
    agent: "simulated_execution_agent",
    phase: "end",
    at: exitAt,
    data: { status: "filled" },
  }];
  const reader = new CausalTradeReviewReadModelService(
    {
      paperAccountRef: "paper-account:test",
      accountId: "test",
      marketPackRef: "market-pack:crypto:v1",
      sourceMode: "local_fixture",
      candidateSymbols: ["BTCUSDT"],
      paperDatabasePath: "unused.sqlite",
    },
    {
      runs: {
        findLatestRun: () => run,
        getRun: (runId) => runId === run.runId ? run : undefined,
        getCycles: () => [cycle],
      },
      accounts: { load: async () => state },
      artifacts: {
        query: async (query) => artifacts.filter((artifact) =>
          (!query.traceId || artifact.traceId === query.traceId) &&
          (!query.orderId || artifact.orderId === query.orderId) &&
          (!query.tradeId || artifact.tradeId === query.tradeId)),
      },
      traces: { load: () => traces },
      reflections: { latest: async () => report },
    },
  );
  const tradeId = state.closedTrades[0]!.tradeId!;
  const value = await reader.readRun({
    runId: run.runId,
    cycle: 2,
    tradeRef: tradeId,
  });
  const single =
    value.selectedCycle?.tradeReviews[0]?.singleTradeReview;
  assert.equal(single?.lifecycleStatus, "closed_trade");
  assert.equal(single?.availability, "available");
  assert.equal(single?.realizedPnl, state.closedTrades[0]?.realizedPnl);
  assert.equal(single?.fees, state.closedTrades[0]?.fees);
  assert.equal(single?.reflectionId, report?.reflectionId);
  assert.equal(single?.runtimeApplied, false);
  assert.ok(single?.links.every((link) => link.causal));

  const legacyState = {
    ...state,
    positions: [],
    closedTrades: [{
      symbol: "ETHUSDT",
      side: "long" as const,
      qty: 1,
      entryPrice: 100,
      exitPrice: 90,
      openedAt: entryAt,
      closedAt: exitAt,
      exitReason: "stop_loss",
      realizedPnl: -10,
      fees: 1,
      exitOrderId: "paper:legacy",
      exitTraceId: "trace:exit",
    }],
    orders: [],
  };
  const partialReader = new CausalTradeReviewReadModelService(
    {
      paperAccountRef: "paper-account:test",
      accountId: "test",
      marketPackRef: "market-pack:crypto:v1",
      sourceMode: "local_fixture",
      candidateSymbols: ["ETHUSDT"],
      paperDatabasePath: "unused.sqlite",
    },
    {
      runs: {
        findLatestRun: () => run,
        getRun: () => run,
        getCycles: () => [cycle],
      },
      accounts: { load: async () => legacyState },
      artifacts: { query: async () => [] },
      traces: { load: () => traces },
    },
  );
  const partial = await partialReader.readRun({
    runId: run.runId,
    cycle: 2,
    tradeRef: "paper:legacy",
  });
  const partialSingle =
    partial.selectedCycle?.tradeReviews[0]?.singleTradeReview;
  assert.equal(partialSingle?.lifecycleStatus, "partial_evidence");
  assert.ok(partialSingle?.issues.some((issue) =>
    issue.code === "ENTRY_EVIDENCE_NOT_RECORDED"));
  assert.equal(partialSingle?.links.length, 0);
});
