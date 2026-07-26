import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ActionSchema,
  CycleRequestSchema,
  MultiTimeframeSnapshotSchema,
  SCHEMA_VERSION,
  type DecisionBundle,
  type CycleRequest,
  type ClosedTrade,
  type ExecutionResult,
  type RiskDecision,
  type UniverseSet,
} from "../packages/contracts/src/index.js";
import { DecisionPipeline } from "../packages/core/src/index.js";
import { buildWalkForwardWindows, DeterministicGridSearch, DeterministicWalkForwardValidator, enumerateGrid, PipelineBacktestService } from "../packages/backtest/src/index.js";
import { buildRuntimeDashboard, buildTradeReview, filterTraceEvents, PaperSafetyGuard, renderRuntimeDashboard, renderTradeReview, SequentialCycleRunner, summarizeTrace } from "../packages/runtime/src/index.js";
import { ReconciliationService } from "../packages/runtime/src/index.js";
import { createRunManifest, DEFAULT_STRATEGY_PROFILE, inspectStrategyProfile, resolveStrategyProfile, sha256File, strategyProfileFingerprint, validateOptimizationGrid, validateOptimizationParameters } from "../packages/config/src/index.js";
import {
  HistoricalDataSyncAgent,
  InMemoryHistoricalCandleSource,
  InMemorySelectorMetricsPort,
  MarketOpportunitySelectorAgent,
  SimulatedExecutionAgent,
  SQLiteTraceSink,
  SQLitePaperAccountStore,
  PersistentPaperExecutionAgent,
  PositionReconciler,
  OrderReconciler,
  BinanceApiError,
  BinanceFuturesReadClient,
  SQLiteReflectionStore,
  DeepSeekStructuredLlmClient,
  DeepSeekApiError,
  BinanceFuturesMarketDataSource,
  SQLiteRuntimeSafetyStore,
  SQLitePaperCycleJournal,
  SQLiteAgentArtifactLedger,
} from "../packages/adapters/src/index.js";
import { createDirectionalCaseAgents } from "../packages/agents/src/index.js";
import {
  MultiPeriodParserAgent,
  RuleQuantAnalystAgent,
  RuleRegimeAgent,
  RuleSetupAgent,
  RuleTrendAgent,
  RuleTriggerAgent,
  RuleBearCaseAgent,
  RuleBullCaseAgent,
  RuleDecisionAgent,
  RuleRiskAgent,
  RulePositionMonitorAgent,
  SingleBestPortfolioAgent,
  RuleReflectionAgent,
  LlmReflectionAgent,
  RuleDataQualityGate,
  RulePortfolioRiskGuard,
} from "../packages/agents/src/index.js";

const asOf = new Date("2026-07-25T00:00:00.000Z");
const traceId = "fixture:1";

test("contracts reject unrecognized actions", () => {
  assert.throws(() => ActionSchema.parse("buy"));
  assert.equal(ActionSchema.parse("open_long"), "open_long");
});

test("pipeline validates contracts and executes only risk-approved intents", async () => {
  const universe: UniverseSet = {
    schemaVersion: SCHEMA_VERSION,
    traceId,
    asOf,
    candidates: [{ symbol: "BTCUSDT", rank: 1, score: 99, tradable: true, selectedReasons: ["fixture"], rejectionReasons: [] }],
  };
  const snapshot = MultiTimeframeSnapshotSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    traceId,
    asOf,
    symbol: "BTCUSDT",
    stableBars: { "5m": [], "15m": [], "1h": [] },
    liveQuote: { price: 100, observedAt: asOf },
    quality: { alignmentOk: true, missingTimeframes: [], warnings: [] },
  });
  const decision: DecisionBundle = {
    schemaVersion: SCHEMA_VERSION,
    traceId,
    asOf,
    symbol: "BTCUSDT",
    action: "open_long",
    confidence: 75,
    reason: "fixture decision",
    evidence: ["fixture"],
    missingConfirmations: [],
    orderIntent: { symbol: "BTCUSDT", action: "open_long", entryPrice: 100, notional: 100, stopLoss: 98, takeProfit: 103, leverage: 1 },
  };
  const risk: RiskDecision = { schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", passed: true, riskLevel: "safe", corrections: {}, warnings: [] };
  const execution: ExecutionResult = { schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", action: "open_long", status: "filled", message: "fixture", fillPrice: 100, fee: 0, realizedPnl: 0 };
  const events: string[] = [];
  const artifacts: { stage: string; symbol?: string; orderId?: string }[] = [];
  const pipeline = new DecisionPipeline({
    selector: { name: "selector", version: "test", run: async () => universe },
    dataSync: { name: "data", version: "test", run: async () => snapshot },
    analysis: { name: "analysis", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", regime: "trending_up", trend: "long", setup: "ready", trigger: "confirmed", diagnostics: [] }) },
    bullCase: { name: "bull", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", side: "long", confidence: 90, evidence: [], invalidationConditions: [], veto: false }) },
    bearCase: { name: "bear", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", side: "short", confidence: 0, evidence: [], invalidationConditions: [], veto: false }) },
    decision: { name: "decision", version: "test", run: async () => decision },
    portfolio: { name: "portfolio", version: "test", run: async (decisions) => [...decisions] },
    risk: { name: "risk", version: "test", run: async () => risk },
    execution: { name: "execution", version: "test", run: async () => execution },
    traceSink: { append: async (event) => { events.push(`${event.stage}:${event.phase}`); } },
    artifactLedger: { append: async (artifact) => { artifacts.push({ stage: artifact.stage, symbol: artifact.symbol, orderId: artifact.orderId }); }, query: async () => [] },
    now: () => asOf,
  });
  const request = CycleRequestSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, runMode: "backtest", asOf, strategyId: "fixture", configVersion: "v1", executionEnabled: true });
  const result = await pipeline.runCycle(request);

  assert.equal(result.executions.length, 1);
  assert.equal(result.executions[0]?.status, "filled");
  assert.deepEqual(artifacts.map((artifact) => artifact.stage), ["selector", "data", "analysis", "bull_case", "bear_case", "decision", "portfolio", "risk", "execution"]);
  assert.equal(artifacts.find((artifact) => artifact.stage === "execution")?.symbol, "BTCUSDT");
  assert.deepEqual(events, ["selector:start", "selector:end", "data:start", "data:end", "analysis:start", "analysis:end", "directional_cases:start", "directional_cases:end", "decision:start", "decision:end", "portfolio:start", "portfolio:end", "risk:start", "risk:end", "execution:start", "execution:end"]);
});

test("backtest invokes the same trading application at each historical asOf", async () => {
  const calls: CycleRequest[] = [];
  const application = {
    runCycle: async (request: CycleRequest) => {
      calls.push(request);
      return {
        schemaVersion: SCHEMA_VERSION,
        traceId: request.traceId,
        asOf: request.asOf,
        universe: { schemaVersion: SCHEMA_VERSION, traceId: request.traceId, asOf: request.asOf, candidates: [] },
        decisions: [], riskDecisions: [], executions: [], markPrices: {}, status: "blocked" as const,
      };
    },
  };
  const service = new PipelineBacktestService(application);
  const report = await service.run({
    schemaVersion: SCHEMA_VERSION,
    runId: "backtest:fixture",
    datasetId: "fixture.csv",
    strategyId: "fixture",
    configVersion: "v1",
    asOf: [asOf, new Date("2026-07-25T00:05:00.000Z")],
    executionEnabled: true,
    initialCash: 10_000,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.runMode, "backtest");
  assert.equal(report.diagnostics.blockedCycleCount, 2);
  assert.equal(report.performance.finalCash, 10_000);
});

test("deterministic grid search enumerates combinations, isolates trials, and compares a baseline", async () => {
  const calls: string[] = [];
  const reportFor = (value: number) => ({
    schemaVersion: SCHEMA_VERSION, runId: `run:${value}`, datasetId: "fixture", strategyId: "fixture", configVersion: "v1", cycles: [{ executions: value === 1 ? [{ status: "rejected" }] : [] }],
    diagnostics: { cycleCount: 1, decisionCount: 2, filledOrderCount: 0, blockedCycleCount: 0 },
    performance: { initialCash: 100, finalCash: 100 + value, realizedPnl: value, fees: 1, totalReturnPct: value, unrealizedPnl: 0, maxDrawdownPct: value === 1 ? 1 : 2 },
    equityCurve: [], trades: [], tradeStatistics: { closedTradeCount: value, winRatePct: 50, averageWin: 1, averageLoss: 1, profitFactor: 1 },
  }) as unknown as import("../packages/contracts/src/index.js").BacktestReport;
  const search = new DeterministicGridSearch(async (parameters, trialId) => {
    calls.push(trialId);
    return reportFor(parameters.value as number);
  });
  const report = await search.run({ schemaVersion: SCHEMA_VERSION, experimentId: "fixture", datasetId: "fixture", strategyId: "fixture", configFingerprint: "base", grid: { value: [1, 2] }, baseline: { value: 1 } });

  assert.deepEqual(enumerateGrid({ b: [true, false], a: [1] }), [{ a: 1, b: true }, { a: 1, b: false }]);
  assert.deepEqual(calls, ["trial:1", "trial:2", "baseline"]);
  assert.equal(report.trials[0]?.parameters.value, 2);
  assert.equal(report.trials[0]?.baselineDelta?.totalReturnPct, 1);
  assert.equal(report.trials.find((trial) => trial.parameters.value === 1)?.rejectedActionRatePct, 50);
});

test("grid search rejects oversized or invalid parameter grids before running", async () => {
  const search = new DeterministicGridSearch(async () => { throw new Error("must not run"); }, 2);
  await assert.rejects(() => search.run({ schemaVersion: SCHEMA_VERSION, experimentId: "fixture", datasetId: "fixture", strategyId: "fixture", configFingerprint: "base", grid: { left: [1, 2], right: [1, 2] } }), /limit is 2/);
});

test("walk-forward folds do not overlap training and validation, and select only from training", async () => {
  const timeline = Array.from({ length: 9 }, (_, index) => new Date(Date.UTC(2026, 0, 1, 0, index)));
  const calls: { trialId: string; asOf: readonly Date[] }[] = [];
  const reportFor = (value: number) => ({
    schemaVersion: SCHEMA_VERSION, runId: "fixture", datasetId: "fixture", strategyId: "fixture", configVersion: "v1", cycles: [],
    diagnostics: { cycleCount: 1, decisionCount: 1, filledOrderCount: 0, blockedCycleCount: 0 },
    performance: { initialCash: 100, finalCash: 100 + value, realizedPnl: value, fees: 0, totalReturnPct: value, unrealizedPnl: 0, maxDrawdownPct: 1 },
    equityCurve: [], trades: [], tradeStatistics: { closedTradeCount: 1, winRatePct: 50, averageWin: 1, averageLoss: 1, profitFactor: 1 },
  }) as unknown as import("../packages/contracts/src/index.js").BacktestReport;
  const validator = new DeterministicWalkForwardValidator(async (parameters, trialId, asOf) => {
    calls.push({ trialId, asOf });
    return reportFor(parameters.value as number);
  });
  const report = await validator.run({ schemaVersion: SCHEMA_VERSION, runId: "wf", datasetId: "fixture", strategyId: "fixture", configFingerprint: "base", asOf: timeline, grid: { value: [1, 2] }, plan: { mode: "rolling", trainingCycles: 3, validationCycles: 2, stepCycles: 2 } });

  assert.deepEqual(buildWalkForwardWindows(9, { mode: "expanding", trainingCycles: 3, validationCycles: 2, stepCycles: 2 }), [
    { trainingStart: 0, trainingEnd: 3, validationStart: 3, validationEnd: 5 },
    { trainingStart: 0, trainingEnd: 5, validationStart: 5, validationEnd: 7 },
    { trainingStart: 0, trainingEnd: 7, validationStart: 7, validationEnd: 9 },
  ]);
  assert.equal(report.folds.length, 3);
  assert.ok(report.folds.every((fold) => fold.trainingEnd < fold.validationStart));
  assert.ok(report.folds.every((fold) => fold.selected.parameters.value === 2));
  assert.deepEqual(calls.filter((call) => call.trialId.includes("validation")).map((call) => call.asOf.length), [2, 2, 2]);
  assert.equal(report.parameterStability.distinctParameterCount, 1);
});

test("walk-forward rejects plans without a complete validation window", async () => {
  const validator = new DeterministicWalkForwardValidator(async () => { throw new Error("must not run"); });
  await assert.rejects(() => validator.run({ schemaVersion: SCHEMA_VERSION, runId: "wf", datasetId: "fixture", strategyId: "fixture", configFingerprint: "base", asOf: [asOf], grid: { value: [1] }, plan: { mode: "rolling", trainingCycles: 1, validationCycles: 1, stepCycles: 1 } }), /no complete validation fold/);
});

test("historical data sync excludes bars that were not closed at asOf", async () => {
  const closed = { openTime: new Date("2026-07-24T23:55:00.000Z"), closeTime: asOf, open: 99, high: 101, low: 98, close: 100, volume: 20 };
  const future = { ...closed, openTime: new Date("2026-07-25T00:00:00.000Z"), closeTime: new Date("2026-07-25T00:05:00.000Z"), close: 200 };
  const source = new InMemoryHistoricalCandleSource(new Map([["BTCUSDT", new Map([["5m", [closed, future]], ["15m", [closed]], ["1h", [closed]]])]]));
  const agent = new HistoricalDataSyncAgent(source);
  const snapshot = await agent.run({ traceId, asOf, symbol: "BTCUSDT", timeframes: ["5m", "15m", "1h"] });

  assert.equal(snapshot.stableBars["5m"].length, 1);
  assert.equal(snapshot.liveQuote.price, 100);
});

test("data quality gate rejects missing, insufficient, misaligned, and stale market data", async () => {
  const gate = new RuleDataQualityGate({ minBars5m: 2, minBars15m: 1, minBars1h: 1, maxQuoteAgeMs: 1_000 });
  const stale = MultiTimeframeSnapshotSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", stableBars: { "5m": [{ openTime: asOf, closeTime: asOf, open: 100, high: 101, low: 99, close: 100, volume: 1 }], "15m": [], "1h": [] }, liveQuote: { price: 100, observedAt: new Date(asOf.getTime() - 2_000) }, quality: { alignmentOk: false, missingTimeframes: ["15m", "1h"], warnings: [] } });
  const result = await gate.run(stale);
  assert.equal(result.passed, false);
  assert.equal(result.reasons.length, 5);
});

test("data quality gate blocks pipeline before analysis and execution", async () => {
  let analysisCalls = 0;
  let executionCalls = 0;
  const snapshot = MultiTimeframeSnapshotSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", stableBars: { "5m": [], "15m": [], "1h": [] }, liveQuote: { price: 100, observedAt: asOf }, quality: { alignmentOk: false, missingTimeframes: ["5m"], warnings: [] } });
  const pipeline = new DecisionPipeline({
    selector: { name: "selector", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, asOf, candidates: [{ symbol: "BTCUSDT", rank: 1, score: 1, tradable: true, selectedReasons: [], rejectionReasons: [] }] }) }, dataSync: { name: "data", version: "test", run: async () => snapshot }, dataQuality: new RuleDataQualityGate({ minBars5m: 1, minBars15m: 1, minBars1h: 1 }),
    analysis: { name: "analysis", version: "test", run: async () => { analysisCalls += 1; throw new Error("must not analyze invalid data"); } }, bullCase: { name: "bull", version: "test", run: async () => { throw new Error("must not run"); } }, bearCase: { name: "bear", version: "test", run: async () => { throw new Error("must not run"); } }, decision: { name: "decision", version: "test", run: async () => { throw new Error("must not run"); } }, portfolio: { name: "portfolio", version: "test", run: async () => [] }, risk: { name: "risk", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", passed: true, riskLevel: "safe", corrections: {}, warnings: [] }) }, execution: { name: "execution", version: "test", run: async () => { executionCalls += 1; throw new Error("must not execute"); } },
  });
  const result = await pipeline.runCycle(CycleRequestSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, runMode: "paper", asOf, strategyId: "fixture", configVersion: "v1", executionEnabled: true }));
  assert.equal(result.status, "blocked");
  assert.equal(analysisCalls, 0);
  assert.equal(executionCalls, 0);
});

test("selector rejects illiquid candidates and returns ranked tradable symbols", async () => {
  const agent = new MarketOpportunitySelectorAgent(
    new InMemorySelectorMetricsPort([
      { symbol: "BTCUSDT", quoteVolume24h: 100_000_000, price: 100, momentum30mPct: 2, trendStrength: 40, volatilityPct: 3 },
      { symbol: "ILLQUSDT", quoteVolume24h: 10, price: 1, momentum30mPct: 10, trendStrength: 50, volatilityPct: 2 },
    ]),
    { candidates: ["BTCUSDT", "ILLQUSDT"], topN: 1 },
  );
  const request = CycleRequestSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, runMode: "backtest", asOf, strategyId: "fixture", configVersion: "v1", executionEnabled: false });
  const universe = await agent.run({ request });

  assert.deepEqual(universe.candidates.filter((candidate) => candidate.tradable).map((candidate) => candidate.symbol), ["BTCUSDT"]);
  assert.match(universe.candidates.find((candidate) => candidate.symbol === "ILLQUSDT")?.rejectionReasons.join(" ") ?? "", /volume/);
});

test("pipeline analyzes only the Selector winner from a larger request universe", async () => {
  const analyzed: string[] = [];
  const makeSnapshot = (symbol: string) => MultiTimeframeSnapshotSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    traceId,
    asOf,
    symbol,
    stableBars: { "5m": [], "15m": [], "1h": [] },
    liveQuote: { price: 100, observedAt: asOf },
    quality: { alignmentOk: true, missingTimeframes: [], warnings: [] },
  });
  const pipeline = new DecisionPipeline({
    selector: {
      name: "selector",
      version: "test",
      run: async () => ({
        schemaVersion: SCHEMA_VERSION,
        traceId,
        asOf,
        candidates: [
          { symbol: "BTCUSDT", rank: 1, score: 91, tradable: true, selectedReasons: ["winner"], rejectionReasons: [] },
          { symbol: "ETHUSDT", rank: 0, score: 82, tradable: false, selectedReasons: [], rejectionReasons: ["outside top 1 opportunity ranking"] },
          { symbol: "SOLUSDT", rank: 0, score: 74, tradable: false, selectedReasons: [], rejectionReasons: ["outside top 1 opportunity ranking"] },
        ],
      }),
    },
    dataSync: { name: "data", version: "test", run: async ({ symbol }) => makeSnapshot(symbol) },
    analysis: {
      name: "analysis",
      version: "test",
      run: async (snapshot) => {
        analyzed.push(snapshot.symbol);
        return { schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: snapshot.symbol, regime: "choppy", trend: "neutral", setup: "wait", trigger: "waiting", diagnostics: [] };
      },
    },
    bullCase: { name: "bull", version: "test", run: async (analysis) => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: analysis.symbol, side: "long", confidence: 30, evidence: [], invalidationConditions: [], veto: false }) },
    bearCase: { name: "bear", version: "test", run: async (analysis) => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: analysis.symbol, side: "short", confidence: 25, evidence: [], invalidationConditions: [], veto: false }) },
    decision: { name: "decision", version: "test", run: async (input) => ({ schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: input.snapshot.symbol, action: "wait", confidence: 30, reason: "fixture", evidence: [], missingConfirmations: [] }) },
    portfolio: { name: "portfolio", version: "test", run: async (decisions) => [...decisions] },
    risk: { name: "risk", version: "test", run: async ({ decision }) => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: decision.symbol, passed: true, riskLevel: "safe", corrections: {}, warnings: [] }) },
    execution: { name: "execution", version: "test", run: async () => { throw new Error("must not execute"); } },
  });

  const result = await pipeline.runCycle(CycleRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    traceId,
    runMode: "paper",
    asOf,
    strategyId: "fixture",
    configVersion: "v1",
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    executionEnabled: false,
  }));

  assert.deepEqual(analyzed, ["BTCUSDT"]);
  assert.deepEqual(result.decisions.map((decision) => decision.symbol), ["BTCUSDT"]);
});

test("rule agents produce a multi-period analysis bundle", async () => {
  const bars = Array.from({ length: 70 }, (_, index) => ({
    openTime: new Date(Date.UTC(2026, 6, 20, 0, index * 5)),
    closeTime: new Date(Date.UTC(2026, 6, 20, 0, index * 5 + 4)),
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: 100 + index,
  }));
  const snapshot = MultiTimeframeSnapshotSchema.parse({
    schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT",
    stableBars: { "5m": bars, "15m": bars, "1h": bars },
    liveQuote: { price: 170, observedAt: asOf },
    quality: { alignmentOk: true, missingTimeframes: [], warnings: [] },
  });
  const quant = await new RuleQuantAnalystAgent().run(snapshot);
  const regime = await new RuleRegimeAgent().run(quant);
  const trend = await new RuleTrendAgent().run({ quant, regime });
  const setup = await new RuleSetupAgent().run({ quant, trend });
  const trigger = await new RuleTriggerAgent().run({ snapshot, quant, trend, setup });
  const bundle = await new MultiPeriodParserAgent().run({ quant, regime, trend, setup, trigger });

  assert.equal(bundle.regime, "trending_up");
  assert.equal(bundle.trend, "long");
  assert.ok(bundle.diagnostics.length >= 6);
});

test("directional cases, decision, portfolio and risk create one bounded opening", async () => {
  const analysis = { schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", regime: "trending_up" as const, trend: "long" as const, setup: "ready" as const, trigger: "confirmed" as const, diagnostics: [] };
  const bullCase = await new RuleBullCaseAgent().run(analysis);
  const bearCase = await new RuleBearCaseAgent().run(analysis);
  const snapshot = MultiTimeframeSnapshotSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", stableBars: { "5m": [], "15m": [], "1h": [] }, liveQuote: { price: 100, observedAt: asOf }, quality: { alignmentOk: true, missingTimeframes: [], warnings: [] } });
  const request = CycleRequestSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, runMode: "backtest", asOf, strategyId: "fixture", configVersion: "v1", executionEnabled: false });
  const decision = await new RuleDecisionAgent().run({ request, snapshot, analysis, bullCase, bearCase });
  const selected = await new SingleBestPortfolioAgent().run([decision]);
  const risk = await new RuleRiskAgent().run({ decision: selected[0]! });

  assert.equal(decision.action, "open_long");
  assert.equal(selected.length, 1);
  assert.equal(risk.passed, true);
});

test("portfolio risk guard limits open positions, margin, and order size but permits closing", async () => {
  const guard = new RulePortfolioRiskGuard({ maxOpenPositions: 1, maxUsedMarginPct: 20, maxOrderNotional: 100 });
  const opening = { schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", action: "open_long" as const, confidence: 80, reason: "fixture", evidence: [], missingConfirmations: [], orderIntent: { symbol: "BTCUSDT", action: "open_long" as const, entryPrice: 100, notional: 200, stopLoss: 98, takeProfit: 103, leverage: 1 } };
  const state = { cash: 900, usedMargin: 100, equity: 1_000, realizedPnl: 0, unrealizedPnl: 0, fees: 0, positions: [{ symbol: "ETHUSDT", side: "long" as const, qty: 1, entryPrice: 100, leverage: 1, margin: 100, stopLoss: 98, takeProfit: 103, openedAt: asOf, openingFee: 0 }] };
  const rejected = await guard.run({ decision: opening, state });
  const closing = { ...opening, action: "close_long" as const, orderIntent: { ...opening.orderIntent, action: "close_long" as const } };
  const allowed = await guard.run({ decision: closing, state });
  assert.equal(rejected.passed, false);
  assert.equal(rejected.reasons.length, 3);
  assert.equal(allowed.passed, true);
});

test("portfolio loss circuit breakers block new openings but never block a close", async () => {
  const guard = new RulePortfolioRiskGuard({ maxOpenPositions: 5, maxUsedMarginPct: 90, maxOrderNotional: 1_000, maxCumulativeRealizedLoss: 50, maxEquityLossPct: 5 });
  const opening = { schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", action: "open_long" as const, confidence: 80, reason: "fixture", evidence: [], missingConfirmations: [], orderIntent: { symbol: "BTCUSDT", action: "open_long" as const, entryPrice: 100, notional: 100, stopLoss: 98, takeProfit: 103, leverage: 1 } };
  const state = { cash: 900, usedMargin: 0, equity: 900, realizedPnl: -60, unrealizedPnl: 0, fees: 2, positions: [] };
  const blocked = await guard.run({ decision: opening, state });
  assert.equal(blocked.passed, false);
  assert.equal(blocked.cumulativeRealizedLoss, 62);
  assert.ok(blocked.equityLossPct! >= 5);
  assert.match(blocked.reasons.join(" "), /circuit breaker/);
  const closing = { ...opening, action: "close_long" as const, orderIntent: { ...opening.orderIntent, action: "close_long" as const } };
  assert.equal((await guard.run({ decision: closing, state })).passed, true);
});

test("portfolio risk rejection prevents execution and is traced", async () => {
  let executionCalls = 0;
  const events: string[] = [];
  const snapshot = MultiTimeframeSnapshotSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", stableBars: { "5m": [], "15m": [], "1h": [] }, liveQuote: { price: 100, observedAt: asOf }, quality: { alignmentOk: true, missingTimeframes: [], warnings: [] } });
  const decision = { schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", action: "open_long" as const, confidence: 80, reason: "fixture", evidence: [], missingConfirmations: [], orderIntent: { symbol: "BTCUSDT", action: "open_long" as const, entryPrice: 100, notional: 100, stopLoss: 98, takeProfit: 103, leverage: 1 } };
  const pipeline = new DecisionPipeline({
    selector: { name: "selector", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, asOf, candidates: [{ symbol: "BTCUSDT", rank: 1, score: 1, tradable: true, selectedReasons: [], rejectionReasons: [] }] }) }, dataSync: { name: "data", version: "test", run: async () => snapshot }, analysis: { name: "analysis", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", regime: "trending_up", trend: "long", setup: "ready", trigger: "confirmed", diagnostics: [] }) }, bullCase: { name: "bull", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", side: "long", confidence: 80, evidence: [], invalidationConditions: [], veto: false }) }, bearCase: { name: "bear", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", side: "short", confidence: 0, evidence: [], invalidationConditions: [], veto: false }) }, decision: { name: "decision", version: "test", run: async () => decision }, portfolio: { name: "portfolio", version: "test", run: async (items) => [...items] }, risk: { name: "risk", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", passed: true, riskLevel: "safe", corrections: {}, warnings: [] }) }, portfolioState: { markToMarket: () => ({ cash: 900, usedMargin: 100, equity: 1_000, realizedPnl: 0, unrealizedPnl: 0, fees: 0, positions: [{ symbol: "ETHUSDT", side: "long", qty: 1, entryPrice: 100, leverage: 1, margin: 100, stopLoss: 98, takeProfit: 103, openedAt: asOf, openingFee: 0 }] }) }, portfolioRisk: new RulePortfolioRiskGuard({ maxOpenPositions: 1, maxUsedMarginPct: 50, maxOrderNotional: 1_000 }), execution: { name: "execution", version: "test", run: async () => { executionCalls += 1; throw new Error("must not execute"); } }, traceSink: { append: async (event) => { events.push(`${event.stage}:${event.phase}`); } },
  });
  await pipeline.runCycle(CycleRequestSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, runMode: "paper", asOf, strategyId: "fixture", configVersion: "v1", executionEnabled: true }));
  assert.equal(executionCalls, 0);
  assert.ok(events.includes("portfolio_risk:end"));
});

test("simulated execution applies fees, slippage, margin and realized PnL", async () => {
  const executor = new SimulatedExecutionAgent({ initialCash: 1_000, feeBps: 10, slippageBps: 0 });
  const openDecision = { schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", action: "open_long" as const, confidence: 80, reason: "open", evidence: [], missingConfirmations: [], orderIntent: { symbol: "BTCUSDT", action: "open_long" as const, entryPrice: 100, notional: 100, stopLoss: 98, takeProfit: 103, leverage: 2 } };
  const risk = { schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", passed: true, riskLevel: "safe" as const, corrections: {}, warnings: [] };
  const opening = await executor.run({ decision: openDecision, risk });
  const closeDecision = { ...openDecision, action: "close_long" as const, orderIntent: { ...openDecision.orderIntent, action: "close_long" as const, entryPrice: 110 } };
  const closing = await executor.run({ decision: closeDecision, risk });

  assert.equal(opening.fee, 0.1);
  assert.equal(closing.realizedPnl, 10);
  assert.equal(executor.markToMarket({}).positions.length, 0);
  assert.equal(executor.markToMarket({}).cash, 1009.79);
});

test("position monitor exits for stop, take-profit, reversal, and max holding time", async () => {
  const position = { symbol: "BTCUSDT", side: "long" as const, qty: 1, entryPrice: 100, leverage: 1, margin: 100, stopLoss: 98, takeProfit: 103, openedAt: new Date("2026-07-24T00:00:00.000Z"), openingFee: 0 };
  const baseAnalysis = { schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", regime: "trending_up" as const, trend: "long" as const, setup: "ready" as const, trigger: "confirmed" as const, diagnostics: [] };
  const request = CycleRequestSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, runMode: "backtest", asOf, strategyId: "fixture", configVersion: "v1", executionEnabled: true });
  const monitor = new RulePositionMonitorAgent({ maxHoldingMs: Number.MAX_SAFE_INTEGER });
  const snapshotAt = (price: number) => MultiTimeframeSnapshotSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", stableBars: { "5m": [], "15m": [], "1h": [] }, liveQuote: { price, observedAt: asOf }, quality: { alignmentOk: true, missingTimeframes: [], warnings: [] } });

  assert.equal((await monitor.run({ request, snapshot: snapshotAt(97), analysis: baseAnalysis, position }))?.reason, "stop_loss");
  assert.equal((await monitor.run({ request, snapshot: snapshotAt(104), analysis: baseAnalysis, position }))?.reason, "take_profit");
  assert.equal((await monitor.run({ request, snapshot: snapshotAt(100), analysis: { ...baseAnalysis, trend: "short" }, position }))?.reason, "trend_reversal");
  const timedMonitor = new RulePositionMonitorAgent({ maxHoldingMs: 1 });
  assert.equal((await timedMonitor.run({ request, snapshot: snapshotAt(100), analysis: { ...baseAnalysis, trigger: "waiting" }, position }))?.reason, "max_holding_time");
});

test("backtest marks equity and force-closes remaining positions at the final price", async () => {
  const executor = new SimulatedExecutionAgent({ initialCash: 1_000, feeBps: 0, slippageBps: 0 });
  const risk = { schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", passed: true, riskLevel: "safe" as const, corrections: {}, warnings: [] };
  const opening = { schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", action: "open_long" as const, confidence: 80, reason: "open", evidence: [], missingConfirmations: [], orderIntent: { symbol: "BTCUSDT", action: "open_long" as const, entryPrice: 100, notional: 100, stopLoss: 98, takeProfit: 103, leverage: 1 } };
  await executor.run({ decision: opening, risk });
  const application = { runCycle: async (request: CycleRequest) => ({ schemaVersion: SCHEMA_VERSION, traceId: request.traceId, asOf: request.asOf, universe: { schemaVersion: SCHEMA_VERSION, traceId: request.traceId, asOf: request.asOf, candidates: [] }, decisions: [], riskDecisions: [], executions: [], markPrices: { BTCUSDT: 110 }, status: "ok" as const }) };
  const report = await new PipelineBacktestService(application, executor).run({ schemaVersion: SCHEMA_VERSION, runId: "force-close", datasetId: "fixture", strategyId: "fixture", configVersion: "v1", asOf: [asOf], executionEnabled: true, initialCash: 1_000 });

  assert.equal(report.trades.length, 1);
  assert.equal(report.trades[0]?.exitReason, "backtest_end_force_close");
  assert.equal(report.performance.finalCash, 1010);
  assert.equal(report.equityCurve.length, 2);
});

test("pipeline evaluates an existing position exit before new directional cases", async () => {
  let directionalCalls = 0;
  const position = { symbol: "BTCUSDT", side: "long" as const, qty: 1, entryPrice: 100, leverage: 1, margin: 100, stopLoss: 98, takeProfit: 103, openedAt: asOf, openingFee: 0 };
  const snapshot = MultiTimeframeSnapshotSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", stableBars: { "5m": [], "15m": [], "1h": [] }, liveQuote: { price: 97, observedAt: asOf }, quality: { alignmentOk: true, missingTimeframes: [], warnings: [] } });
  const exit = { schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", action: "close_long" as const, confidence: 100, reason: "stop_loss", evidence: [], missingConfirmations: [], orderIntent: { symbol: "BTCUSDT", action: "close_long" as const, entryPrice: 97, notional: 97, stopLoss: 0, takeProfit: 0, leverage: 1 } };
  const pipeline = new DecisionPipeline({
    selector: { name: "selector", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, asOf, candidates: [] }) },
    dataSync: { name: "data", version: "test", run: async () => snapshot },
    analysis: { name: "analysis", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", regime: "trending_down", trend: "short", setup: "ready", trigger: "confirmed", diagnostics: [] }) },
    bullCase: { name: "bull", version: "test", run: async () => { directionalCalls += 1; throw new Error("must not run for an existing position"); } },
    bearCase: { name: "bear", version: "test", run: async () => { directionalCalls += 1; throw new Error("must not run for an existing position"); } },
    decision: { name: "decision", version: "test", run: async () => { throw new Error("must not open a duplicate position"); } },
    portfolio: { name: "portfolio", version: "test", run: async (decisions) => [...decisions] },
    risk: { name: "risk", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", passed: true, riskLevel: "safe", corrections: {}, warnings: [] }) },
    execution: { name: "execution", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", action: "close_long", status: "filled", message: "closed", fee: 0, realizedPnl: -3 }) },
    positionState: { getOpenPositions: async () => [position] },
    positionMonitor: { name: "monitor", version: "test", run: async () => exit },
  });
  const result = await pipeline.runCycle(CycleRequestSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, runMode: "backtest", asOf, strategyId: "fixture", configVersion: "v1", symbols: ["BTCUSDT"], executionEnabled: true }));

  assert.equal(directionalCalls, 0);
  assert.equal(result.executions[0]?.action, "close_long");
});

test("SQLite trace sink persists replayable ordered events", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tradebot-trace-"));
  const sink = new SQLiteTraceSink(join(directory, "trace.db"));
  try {
    await sink.append({ schemaVersion: SCHEMA_VERSION, traceId, stage: "data", agent: "fixture", phase: "start", at: asOf, data: { symbol: "BTCUSDT" } });
    await sink.append({ schemaVersion: SCHEMA_VERSION, traceId, stage: "data", agent: "fixture", phase: "end", at: asOf, data: {} });
    assert.equal(sink.latestTraceId(), traceId);
    assert.deepEqual(sink.load(traceId).map((event) => event.phase), ["start", "end"]);
  } finally {
    sink.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("paper cycle journal persists records per account", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tradebot-journal-"));
  const journal = new SQLitePaperCycleJournal(join(directory, "journal.db"));
  try {
    await journal.append({ recordId: "one", accountId: "paper:a", traceId: "trace:one", asOf, status: "ok", executionEnabled: false, strategyId: "rule", profileVersion: "v2", configVersion: "abc", dataSource: { kind: "binance_futures_public", identifier: "binance", observedAt: asOf }, decisionCount: 1, riskDecisionCount: 1, executionCount: 0 });
    await journal.append({ recordId: "two", accountId: "paper:b", traceId: "trace:two", asOf, status: "blocked", executionEnabled: false, decisionCount: 0, riskDecisionCount: 0, executionCount: 0 });
    assert.equal((await journal.latest("paper:a"))[0]?.dataSource?.kind, "binance_futures_public");
    assert.equal((await journal.latest("paper:b"))[0]?.status, "blocked");
    assert.deepEqual(await journal.latest("paper:missing"), []);
  } finally { journal.close(); await rm(directory, { recursive: true, force: true }); }
});

test("artifact ledger preserves ordered sanitized agent evidence and filters it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tradebot-artifacts-"));
  const ledger = new SQLiteAgentArtifactLedger(join(directory, "artifacts.db"));
  try {
    await ledger.append({ schemaVersion: SCHEMA_VERSION, artifactId: "a1", traceId, asOf, symbol: "BTCUSDT", stage: "analysis", agent: "rule", agentVersion: "v1", status: "success", startedAt: asOf, completedAt: asOf, durationMs: 0, input: { bars: 50 }, output: { trend: "long" } });
    await ledger.append({ schemaVersion: SCHEMA_VERSION, artifactId: "a2", traceId, asOf, symbol: "ETHUSDT", stage: "decision", agent: "rule", agentVersion: "v1", status: "error", startedAt: asOf, completedAt: asOf, durationMs: 0, input: { safe: true }, error: "fixture failure", orderId: "paper:2" });
    assert.deepEqual((await ledger.query({ traceId, symbol: "BTCUSDT", limit: 10 })).map((item) => item.artifactId), ["a1"]);
    const all = await ledger.query({ traceId, limit: 10 });
    assert.deepEqual(all.map((item) => item.artifactId), ["a1", "a2"]);
    assert.equal(all[1]?.status, "error");
    assert.deepEqual((await ledger.query({ orderId: "paper:2", limit: 10 })).map((item) => item.artifactId), ["a2"]);
  } finally { ledger.close(); await rm(directory, { recursive: true, force: true }); }
});

test("review presenter orders agent evidence and surfaces decision, risk, execution and errors", () => {
  const artifacts = [
    { schemaVersion: SCHEMA_VERSION, artifactId: "3", traceId, asOf, symbol: "BTCUSDT", stage: "execution", agent: "execution", agentVersion: "v1", status: "success" as const, startedAt: new Date(asOf.getTime() + 2), completedAt: new Date(asOf.getTime() + 2), durationMs: 0, input: {}, output: { status: "filled", message: "opened" }, orderId: "paper:1" },
    { schemaVersion: SCHEMA_VERSION, artifactId: "1", traceId, asOf, symbol: "BTCUSDT", stage: "decision", agent: "decision", agentVersion: "v1", status: "success" as const, startedAt: asOf, completedAt: asOf, durationMs: 0, input: {}, output: { action: "open_long", confidence: 80 } },
    { schemaVersion: SCHEMA_VERSION, artifactId: "2", traceId, asOf, symbol: "BTCUSDT", stage: "risk", agent: "risk", agentVersion: "v1", status: "fallback" as const, startedAt: new Date(asOf.getTime() + 1), completedAt: new Date(asOf.getTime() + 1), durationMs: 0, input: {}, output: { passed: true } },
  ];
  const review = buildTradeReview(artifacts, "paper:1");
  assert.equal(review?.decision?.action, "open_long");
  assert.equal(review?.risk?.passed, true);
  assert.equal(review?.execution?.status, "filled");
  assert.equal(review?.fallbackCount, 1);
  assert.deepEqual(review?.timeline.map((item) => item.artifactId), ["1", "2", "3"]);
  assert.match(renderTradeReview(review), /Decision: open_long/);
  assert.equal(buildTradeReview([]), undefined);
});

test("trace summary groups stages and reports risk/execution signals", () => {
  const events = [
    { schemaVersion: SCHEMA_VERSION, traceId, stage: "risk", agent: "risk", phase: "start" as const, at: asOf, data: {} },
    { schemaVersion: SCHEMA_VERSION, traceId, stage: "risk", agent: "risk", phase: "end" as const, at: asOf, data: { passed: false } },
    { schemaVersion: SCHEMA_VERSION, traceId, stage: "execution", agent: "execution", phase: "start" as const, at: asOf, data: { action: "open_long" } },
    { schemaVersion: SCHEMA_VERSION, traceId, stage: "execution", agent: "execution", phase: "end" as const, at: asOf, data: {} },
  ];
  const summary = summarizeTrace(events);
  assert.equal(summary.riskRejectedCount, 1);
  assert.deepEqual(summary.executionActions, ["open_long"]);
  assert.deepEqual(filterTraceEvents(events, "risk").map((event) => event.phase), ["start", "end"]);
});

test("dashboard presenter combines account, trace, reflection, and renders stable CUI text", () => {
  const dashboard = buildRuntimeDashboard({
    accountId: "paper:main",
    account: { schemaVersion: SCHEMA_VERSION, cash: 900, realizedPnl: 12, fees: 1, positions: [{ symbol: "BTCUSDT", side: "long", qty: 1, entryPrice: 100, leverage: 1, margin: 100, stopLoss: 98, takeProfit: 103, openedAt: asOf, openingFee: 0 }], closedTrades: [], orders: [] },
    events: [{ schemaVersion: SCHEMA_VERSION, traceId, stage: "risk", agent: "risk", phase: "end", at: asOf, data: { passed: false } }],
    reflection: { reflectionId: "reflection:1", asOf, sampleSize: 3, winRatePct: 50, averageWin: 1, averageLoss: 2, longTradeCount: 2, shortTradeCount: 1, confidenceCalibration: "aligned", recommendations: ["review entries"], adjustments: [], llmAudit: { provider: "deepseek", model: "fixture", fallbackUsed: true, errorCategory: "timeout" } },
    safety: { consecutiveFailures: 2, cooldownUntil: new Date(asOf.getTime() + 60_000), lastFailure: "data unavailable", updatedAt: asOf },
    latestCycle: { recordId: "cycle:1", accountId: "paper:main", traceId, asOf, status: "ok", executionEnabled: false, strategyId: "rule", profileVersion: "v2", configVersion: "abc", dataSource: { kind: "binance_futures_public", identifier: "binance", observedAt: asOf }, decisionCount: 1, riskDecisionCount: 1, executionCount: 0 },
    now: () => asOf,
  });
  assert.equal(dashboard.account.equity, 1_000);
  assert.equal(dashboard.trace.riskRejectedCount, 1);
  assert.equal(dashboard.reflection.fallbackUsed, true);
  assert.equal(dashboard.safety.consecutiveFailures, 2);
  assert.match(renderRuntimeDashboard(dashboard), /TradeBot Dashboard · paper:main/);
  assert.match(renderRuntimeDashboard(dashboard), /recommendations: review entries/);
  assert.match(renderRuntimeDashboard(dashboard), /Safety: consecutiveFailures=2/);
  assert.match(renderRuntimeDashboard(dashboard), /profile=rule@v2 config=abc source=binance_futures_public/);
});

test("dashboard presenter keeps absent local state explicitly unavailable", () => {
  const dashboard = buildRuntimeDashboard({ accountId: "missing", now: () => asOf });
  assert.equal(dashboard.account.status, "unavailable");
  assert.equal(dashboard.trace.status, "unavailable");
  assert.equal(dashboard.reflection.status, "unavailable");
  assert.equal(dashboard.safety.status, "unavailable");
});

test("sequential cycle runner executes bounded cycles without overlap", async () => {
  const order: string[] = [];
  let active = 0;
  const runner = new SequentialCycleRunner({ now: () => asOf, sleep: async (milliseconds) => { order.push(`sleep:${milliseconds}`); } });
  const report = await runner.run({ cycles: 3, intervalMs: 10, executionEnabled: false, continueOnError: false }, async (index) => {
    active += 1;
    assert.equal(active, 1);
    order.push(`start:${index}`);
    await Promise.resolve();
    order.push(`end:${index}`);
    active -= 1;
  });
  assert.equal(report.successCount, 3);
  assert.equal(report.stoppedEarly, false);
  assert.deepEqual(order, ["start:1", "end:1", "sleep:10", "start:2", "end:2", "sleep:10", "start:3", "end:3"]);
});

test("sequential cycle runner stops on error by default and can continue explicitly", async () => {
  const runner = new SequentialCycleRunner({ now: () => asOf, sleep: async () => undefined });
  const stopped = await runner.run({ cycles: 3, intervalMs: 0, executionEnabled: false, continueOnError: false }, async (index) => { if (index === 2) throw new Error("fixture failure"); });
  const continued = await runner.run({ cycles: 3, intervalMs: 0, executionEnabled: false, continueOnError: true }, async (index) => { if (index === 2) throw new Error("fixture failure"); });
  assert.deepEqual(stopped.cycles.map((cycle) => cycle.status), ["ok", "error"]);
  assert.equal(stopped.stoppedEarly, true);
  assert.deepEqual(continued.cycles.map((cycle) => cycle.status), ["ok", "error", "ok"]);
  assert.equal(continued.errorCount, 1);
});

test("sequential cycle runner rejects unbounded or invalid cycle plans", async () => {
  const runner = new SequentialCycleRunner();
  await assert.rejects(() => runner.run({ cycles: 0, intervalMs: 0, executionEnabled: false, continueOnError: false }, async () => undefined));
});

test("paper safety guard blocks before a market cycle after consecutive failures and resets on success", async () => {
  let now = asOf.getTime();
  const states = new Map<string, import("../packages/contracts/src/index.js").RuntimeSafetyState>();
  const store = { load: async (scope: string) => states.get(scope), save: async (scope: string, state: import("../packages/contracts/src/index.js").RuntimeSafetyState) => { states.set(scope, state); } };
  const guard = new PaperSafetyGuard("paper:main", store, { maxConsecutiveFailures: 2, cooldownMs: 1_000 }, () => new Date(now));
  assert.equal((await guard.beforeCycle()).allowed, true);
  await guard.recordFailure(new Error("data unavailable"));
  assert.equal((await guard.beforeCycle()).allowed, true);
  await guard.recordFailure(new Error("data unavailable"));
  assert.equal((await guard.beforeCycle()).allowed, false);
  now += 1_001;
  assert.equal((await guard.beforeCycle()).allowed, true);
  await guard.recordSuccess();
  assert.equal(states.get("paper:main")?.consecutiveFailures, 0);
});

test("SQLite runtime safety store restores cooldown across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tradebot-safety-"));
  const path = join(directory, "safety.db");
  const first = new SQLiteRuntimeSafetyStore(path);
  try {
    const guard = new PaperSafetyGuard("paper:main", first, { maxConsecutiveFailures: 1, cooldownMs: 1_000 }, () => asOf);
    await guard.recordFailure(new Error("fixture"));
  } finally { first.close(); }
  const restarted = new SQLiteRuntimeSafetyStore(path);
  try {
    const guard = new PaperSafetyGuard("paper:main", restarted, { maxConsecutiveFailures: 1, cooldownMs: 1_000 }, () => asOf);
    assert.equal((await guard.beforeCycle()).allowed, false);
  } finally {
    restarted.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("persistent paper execution restores an open position after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tradebot-paper-"));
  const store = new SQLitePaperAccountStore(join(directory, "paper.db"));
  const risk = { schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", passed: true, riskLevel: "safe" as const, corrections: {}, warnings: [] };
  const opening = { schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", action: "open_long" as const, confidence: 80, reason: "open", evidence: [], missingConfirmations: [], orderIntent: { symbol: "BTCUSDT", action: "open_long" as const, entryPrice: 100, notional: 100, stopLoss: 98, takeProfit: 103, leverage: 1 } };
  try {
    const first = await PersistentPaperExecutionAgent.open("paper:main", store, { initialCash: 1_000, feeBps: 0, slippageBps: 0 });
    await first.run({ decision: opening, risk });
    const restarted = await PersistentPaperExecutionAgent.open("paper:main", store, { initialCash: 1, feeBps: 0, slippageBps: 0 });
    assert.equal((await restarted.getOpenPositions()).length, 1);
    assert.equal(restarted.getOrderJournal().length, 1);
    assert.equal(restarted.markToMarket({ BTCUSDT: 110 }).equity, 1_010);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("position reconciler reports local-only, remote-only, and quantity mismatches without repair", () => {
  const local = [
    { symbol: "BTCUSDT", side: "long" as const, qty: 1, entryPrice: 100, leverage: 1, margin: 100, stopLoss: 98, takeProfit: 103, openedAt: asOf, openingFee: 0 },
    { symbol: "ETHUSDT", side: "short" as const, qty: 2, entryPrice: 20, leverage: 1, margin: 40, stopLoss: 21, takeProfit: 18, openedAt: asOf, openingFee: 0 },
  ];
  const remote = [
    { symbol: "BTCUSDT", side: "long" as const, qty: 1.5, entryPrice: 100 },
    { symbol: "SOLUSDT", side: "long" as const, qty: 3, entryPrice: 10 },
  ];
  const report = new PositionReconciler().reconcile("paper:main", local, remote, asOf);
  assert.deepEqual(report.onlyLocal.map((position) => position.symbol), ["ETHUSDT"]);
  assert.deepEqual(report.onlyRemote.map((position) => position.symbol), ["SOLUSDT"]);
  assert.match(report.mismatches[0]?.reason ?? "", /quantity/);
  assert.equal(report.matchedCount, 0);
});

test("Binance read client maps public and signed private responses without mutation", async () => {
  const calls: { url: string; headers?: Readonly<Record<string, string>> }[] = [];
  const transport = { get: async (url: string, headers?: Readonly<Record<string, string>>) => {
    calls.push({ url, headers });
    if (url.includes("/klines")) return { status: 200, body: [[0, "100", "101", "99", "100.5", "2", 299_999]] };
    if (url.includes("positionRisk")) return { status: 200, body: [{ symbol: "BTCUSDT", positionAmt: "2", entryPrice: "100" }, { symbol: "ETHUSDT", positionAmt: "0", entryPrice: "20" }] };
    if (url.includes("openOrders")) return { status: 200, body: [{ orderId: 7, symbol: "BTCUSDT", side: "SELL", status: "NEW", origQty: "2", executedQty: "0", price: "110", reduceOnly: true }] };
    return { status: 200, body: { updateTime: 0, totalWalletBalance: "1000", availableBalance: "900" } };
  } };
  const client = new BinanceFuturesReadClient(transport, { apiKey: "key", apiSecret: "secret" }, "https://test.binance");
  const klines = await client.getKlines("BTCUSDT", "5m", 1);
  const account = await client.getAccountSnapshot();
  const signedCall = calls.find((call) => call.url.includes("/fapi/v2/account"))!;
  const query = new URL(signedCall.url).searchParams;
  const timestamp = query.get("timestamp")!;

  assert.equal(klines[0]?.close, 100.5);
  assert.equal(account.positions[0]?.qty, 2);
  assert.equal(account.openOrders[0]?.reduceOnly, true);
  assert.equal(signedCall.headers?.["X-MBX-APIKEY"], "key");
  assert.equal(query.get("signature"), createHmac("sha256", "secret").update(`timestamp=${timestamp}`).digest("hex"));
});

test("Binance market data source maps public ticker and multi-timeframe candles into selector inputs", async () => {
  const transport = { get: async (url: string) => {
    if (url.includes("ticker/24hr")) return { status: 200, body: [{ symbol: "BTCUSDT", lastPrice: "105", quoteVolume: "123456", priceChangePercent: "2" }] };
    const now = Date.now();
    return { status: 200, body: Array.from({ length: 8 }, (_, index) => [now - (8 - index) * 300_000, String(100 + index), String(101 + index), String(99 + index), String(100 + index), "2", now - (7 - index) * 300_000]) };
  } };
  const source = new BinanceFuturesMarketDataSource(new BinanceFuturesReadClient(transport, undefined, "https://test.binance"), { candleLimit: 8 });
  const metrics = await source.getMetrics(asOf, ["BTCUSDT"]);
  const bars = await source.loadBars("BTCUSDT", "15m");

  assert.equal(metrics[0]?.quoteVolume24h, 123456);
  assert.equal(metrics[0]?.price, 105);
  assert.equal(bars.length, 8);
});

test("Binance market data source caches valid candles and discards only invalid OHLC rows", async () => {
  let calls = 0;
  let now = asOf.getTime();
  const client = new BinanceFuturesReadClient({ get: async () => {
    calls += 1;
    return { status: 200, body: [
      [0, "100", "102", "99", "101", "1", 299_999],
      [300_000, "100", "99", "98", "101", "1", 599_999],
    ] };
  } }, undefined, "https://test.binance");
  const source = new BinanceFuturesMarketDataSource(client, { cacheTtlMs: 10_000, now: () => new Date(now) });
  assert.equal((await source.loadBars("BTCUSDT", "5m")).length, 1);
  await source.loadBars("BTCUSDT", "5m");
  assert.equal(calls, 1);
  now += 10_001;
  await source.loadBars("BTCUSDT", "5m");
  assert.equal(calls, 2);
});

test("pipeline does not invoke execution when executionEnabled is false", async () => {
  let executions = 0;
  const snapshot = MultiTimeframeSnapshotSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", stableBars: { "5m": [], "15m": [], "1h": [] }, liveQuote: { price: 100, observedAt: asOf }, quality: { alignmentOk: true, missingTimeframes: [], warnings: [] } });
  const decision = { schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", action: "open_long" as const, confidence: 80, reason: "fixture", evidence: [], missingConfirmations: [], orderIntent: { symbol: "BTCUSDT", action: "open_long" as const, entryPrice: 100, notional: 100, stopLoss: 98, takeProfit: 103, leverage: 1 } };
  const pipeline = new DecisionPipeline({
    selector: { name: "selector", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, asOf, candidates: [{ symbol: "BTCUSDT", rank: 1, score: 1, tradable: true, selectedReasons: [], rejectionReasons: [] }] }) }, dataSync: { name: "data", version: "test", run: async () => snapshot },
    analysis: { name: "analysis", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", regime: "trending_up", trend: "long", setup: "ready", trigger: "confirmed", diagnostics: [] }) }, bullCase: { name: "bull", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", side: "long", confidence: 80, evidence: [], invalidationConditions: [], veto: false }) }, bearCase: { name: "bear", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", side: "short", confidence: 0, evidence: [], invalidationConditions: [], veto: false }) },
    decision: { name: "decision", version: "test", run: async () => decision }, portfolio: { name: "portfolio", version: "test", run: async (items) => [...items] }, risk: { name: "risk", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", passed: true, riskLevel: "safe", corrections: {}, warnings: [] }) }, execution: { name: "execution", version: "test", run: async () => { executions += 1; return { schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", action: "open_long", status: "filled", message: "unexpected", fee: 0, realizedPnl: 0 }; } },
  });
  const result = await pipeline.runCycle(CycleRequestSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, runMode: "paper", asOf, strategyId: "fixture", configVersion: "v1", executionEnabled: false }));
  assert.equal(executions, 0);
  assert.equal(result.executions.length, 0);
});

test("Binance read client surfaces HTTP exchange errors", async () => {
  const client = new BinanceFuturesReadClient({ get: async () => ({ status: 429, body: { code: -1003, msg: "too many requests" } }) }, undefined, "https://test.binance");
  await assert.rejects(() => client.getKlines("BTCUSDT", "5m"), (error: unknown) => error instanceof BinanceApiError && error.status === 429 && error.code === -1003);
});

test("order reconciler matches client ids and reports only-local, only-remote, and mismatch orders", () => {
  const local = [
    { localOrderId: "l1", clientOrderId: "client-1", symbol: "BTCUSDT", action: "open_long" as const, status: "submitted" as const, requestedQty: 1, executedQty: 0, requestedPrice: 100, createdAt: asOf },
    { localOrderId: "l2", symbol: "ETHUSDT", action: "open_short" as const, status: "pending" as const, requestedQty: 2, executedQty: 0, requestedPrice: 20, createdAt: asOf },
    { localOrderId: "filled", symbol: "SOLUSDT", action: "open_long" as const, status: "filled" as const, requestedQty: 1, executedQty: 1, requestedPrice: 10, createdAt: asOf },
  ];
  const remote = [
    { orderId: "r1", clientOrderId: "client-1", symbol: "BTCUSDT", side: "buy" as const, status: "NEW", originalQty: 1, executedQty: 0, price: 100, reduceOnly: false },
    { orderId: "r2", symbol: "XRPUSDT", side: "buy" as const, status: "NEW", originalQty: 1, executedQty: 0, price: 1, reduceOnly: false },
    { orderId: "r3", symbol: "ETHUSDT", side: "sell" as const, status: "NEW", originalQty: 3, executedQty: 0, price: 20, reduceOnly: false },
  ];
  const report = new OrderReconciler().reconcile("paper:main", local, remote, asOf);
  assert.equal(report.matchedCount, 1);
  assert.deepEqual(report.onlyLocal.map((order) => order.localOrderId), ["l2"]);
  assert.deepEqual(report.onlyRemote.map((order) => order.orderId), ["r2", "r3"]);

  const matchedByOrderId = new OrderReconciler().reconcile("paper:main", [{ ...local[1]!, exchangeOrderId: "r3" }], [remote[2]!], asOf);
  assert.match(matchedByOrderId.mismatches[0]?.reason ?? "", /quantity/);
});

test("reconciliation service combines remote position and order drift without repair", async () => {
  const local = { schemaVersion: SCHEMA_VERSION, cash: 900, realizedPnl: 0, fees: 0, positions: [{ symbol: "BTCUSDT", side: "long" as const, qty: 1, entryPrice: 100, leverage: 1, margin: 100, stopLoss: 98, takeProfit: 103, openedAt: asOf, openingFee: 0 }], closedTrades: [], orders: [{ localOrderId: "local", clientOrderId: "client", symbol: "ETHUSDT", action: "open_long" as const, status: "submitted" as const, requestedQty: 1, executedQty: 0, requestedPrice: 20, createdAt: asOf }] };
  const remote = { getAccountSnapshot: async () => ({ asOf, totalWalletBalance: 1_000, availableBalance: 900, positions: [{ symbol: "BTCUSDT", side: "long" as const, qty: 2, entryPrice: 100 }], openOrders: [{ orderId: "remote", symbol: "SOLUSDT", side: "buy" as const, status: "NEW", originalQty: 1, executedQty: 0, price: 10, reduceOnly: false }] }) };
  const report = await new ReconciliationService().reconcile("paper:main", local, remote, asOf);
  assert.equal(report.hasDrift, true);
  assert.match(report.positions.mismatches[0]?.reason ?? "", /quantity/);
  assert.deepEqual(report.orders.onlyLocal.map((order) => order.localOrderId), ["local"]);
  assert.deepEqual(report.orders.onlyRemote.map((order) => order.orderId), ["remote"]);
});

test("LLM directional case agent accepts only valid matching structured output", async () => {
  const analysis = { schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", regime: "trending_up" as const, trend: "long" as const, setup: "ready" as const, trigger: "confirmed" as const, diagnostics: [] };
  const agents = createDirectionalCaseAgents({ llm: { bullCaseEnabled: true, bearCaseEnabled: false, reflectionEnabled: false, timeoutMs: 100, fallbackToRules: true } }, { complete: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", side: "long", confidence: 88, evidence: ["structured"], invalidationConditions: ["reverse"], veto: false }) });
  const result = await agents.bullCase.run(analysis);
  assert.equal(result.confidence, 88);
  assert.deepEqual(result.evidence, ["structured"]);
});

test("LLM directional case agent falls back on timeout and invalid JSON", async () => {
  const analysis = { schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", regime: "trending_up" as const, trend: "long" as const, setup: "ready" as const, trigger: "confirmed" as const, diagnostics: [] };
  const timeoutAgents = createDirectionalCaseAgents({ llm: { bullCaseEnabled: true, bearCaseEnabled: false, reflectionEnabled: false, timeoutMs: 1, fallbackToRules: true } }, { complete: async () => new Promise(() => undefined) });
  const invalidAgents = createDirectionalCaseAgents({ llm: { bullCaseEnabled: true, bearCaseEnabled: false, reflectionEnabled: false, timeoutMs: 100, fallbackToRules: true } }, { complete: async () => ({ invalid: true }) });
  assert.equal((await timeoutAgents.bullCase.run(analysis)).side, "long");
  assert.equal((await invalidAgents.bullCase.run(analysis)).side, "long");
});

test("DeepSeek structured adapter sends JSON mode and parses the completion", async () => {
  const calls: { url: string; headers: Readonly<Record<string, string>>; body: unknown }[] = [];
  const client = new DeepSeekStructuredLlmClient({ apiKey: "secret", model: "fixture-model" }, { post: async (url, headers, body) => {
    calls.push({ url, headers, body });
    return { status: 200, body: { choices: [{ message: { content: '{"ok":true}' } }] } };
  } });
  const output = await client.complete({ systemPrompt: "Return json", userPrompt: "{}", responseSchemaName: "Fixture", responseSchema: ActionSchema });

  assert.deepEqual(output, { ok: true });
  assert.equal(calls[0]?.url, "https://api.deepseek.com/chat/completions");
  assert.equal(calls[0]?.headers.Authorization, "Bearer secret");
  assert.deepEqual((calls[0]?.body as { response_format: unknown }).response_format, { type: "json_object" });
});

test("DeepSeek structured adapter surfaces non-success responses", async () => {
  const client = new DeepSeekStructuredLlmClient({ apiKey: "secret" }, { post: async () => ({ status: 429, body: { error: "rate limited" } }) });
  await assert.rejects(() => client.complete({ systemPrompt: "Return json", userPrompt: "{}", responseSchemaName: "Fixture", responseSchema: ActionSchema }), (error: unknown) => error instanceof DeepSeekApiError && error.status === 429);
});

const reflectionTrades: readonly ClosedTrade[] = [
  { symbol: "BTCUSDT", side: "long", qty: 1, entryPrice: 100, exitPrice: 102, openedAt: new Date("2026-07-24T00:00:00.000Z"), closedAt: new Date("2026-07-24T01:00:00.000Z"), exitReason: "take_profit", realizedPnl: 2, fees: 0.1, entryConfidence: 40 },
  { symbol: "ETHUSDT", side: "short", qty: 1, entryPrice: 50, exitPrice: 53, openedAt: new Date("2026-07-24T02:00:00.000Z"), closedAt: new Date("2026-07-24T03:00:00.000Z"), exitReason: "stop_loss", realizedPnl: -3, fees: 0.1, entryConfidence: 90 },
  { symbol: "BTCUSDT", side: "long", qty: 1, entryPrice: 100, exitPrice: 97, openedAt: new Date("2026-07-24T04:00:00.000Z"), closedAt: new Date("2026-07-24T05:00:00.000Z"), exitReason: "stop_loss", realizedPnl: -3, fees: 0.1, entryConfidence: 90 },
  { symbol: "SOLUSDT", side: "long", qty: 1, entryPrice: 20, exitPrice: 17, openedAt: new Date("2026-07-24T06:00:00.000Z"), closedAt: new Date("2026-07-24T07:00:00.000Z"), exitReason: "stop_loss", realizedPnl: -3, fees: 0.1, entryConfidence: 90 },
];

test("rule reflection waits for sufficient samples and emits bounded loss-streak adjustments", async () => {
  const agent = new RuleReflectionAgent({ minimumTrades: 3, intervalTrades: 3, adjustmentDurationMs: 60_000 });
  assert.equal(await agent.run({ asOf, trades: reflectionTrades.slice(0, 2) }), undefined);
  const report = await agent.run({ asOf, trades: reflectionTrades });

  assert.equal(report?.sampleSize, 4);
  assert.equal(report?.confidenceCalibration, "overconfident_losses");
  assert.equal(report?.adjustments.length, 2);
  assert.equal(report?.adjustments[0]?.scope, "entry_confidence_min");
  assert.equal(report?.adjustments[0]?.expiresAt.getTime(), asOf.getTime() + 60_000);
  assert.equal(await agent.run({ asOf, trades: reflectionTrades }), undefined);
});

test("LLM reflection augments a rule report only with bounded suggestions", async () => {
  const agent = new LlmReflectionAgent(
    new RuleReflectionAgent({ minimumTrades: 3, intervalTrades: 1 }),
    { complete: async () => ({ recommendations: ["Review entry timing."], adjustments: [{ scope: "leverage_cap", value: 1, reason: "recent volatility" }] }) },
    { llm: { bullCaseEnabled: false, bearCaseEnabled: false, reflectionEnabled: true, timeoutMs: 100, fallbackToRules: true } },
    { provider: "deepseek", model: "fixture" },
  );
  const report = await agent.run({ asOf, trades: reflectionTrades });

  assert.equal(report?.llmAudit?.fallbackUsed, false);
  assert.ok(report?.recommendations.includes("Review entry timing."));
  assert.equal(report?.adjustments.at(-1)?.maxValue, 1.5);
  assert.equal(report?.adjustments.at(-1)?.expiresAt.getTime(), asOf.getTime() + 12 * 60 * 60 * 1_000);
});

test("LLM reflection falls back to the rule report on timeout or invalid output", async () => {
  const timeout = new LlmReflectionAgent(
    new RuleReflectionAgent({ minimumTrades: 3, intervalTrades: 1 }),
    { complete: async () => new Promise(() => undefined) },
    { llm: { bullCaseEnabled: false, bearCaseEnabled: false, reflectionEnabled: true, timeoutMs: 1, fallbackToRules: true } },
    { provider: "deepseek", model: "fixture" },
  );
  const invalid = new LlmReflectionAgent(
    new RuleReflectionAgent({ minimumTrades: 3, intervalTrades: 1 }),
    { complete: async () => ({ recommendations: [], adjustments: [{ scope: "leverage_cap", value: 99, reason: "unsafe" }] }) },
    { llm: { bullCaseEnabled: false, bearCaseEnabled: false, reflectionEnabled: true, timeoutMs: 100, fallbackToRules: true } },
    { provider: "deepseek", model: "fixture" },
  );

  assert.equal((await timeout.run({ asOf, trades: reflectionTrades }))?.llmAudit?.errorCategory, "timeout");
  assert.equal((await invalid.run({ asOf, trades: reflectionTrades }))?.llmAudit?.errorCategory, "invalid_output");
});

test("SQLite reflection store restores the latest structured report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tradebot-reflection-"));
  const store = new SQLiteReflectionStore(join(directory, "reflection.db"));
  try {
    const report = await new RuleReflectionAgent({ minimumTrades: 3, intervalTrades: 1 }).run({ asOf, trades: reflectionTrades });
    assert.ok(report);
    await store.save("paper:main", report);
    const restored = await store.latest("paper:main");
    assert.equal(restored?.reflectionId, report.reflectionId);
    assert.equal(restored?.adjustments[1]?.scope, "leverage_cap");
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("pipeline traces and persists optional reflection after execution", async () => {
  const events: { label: string; data: Record<string, unknown> }[] = [];
  const saved: string[] = [];
  const snapshot = MultiTimeframeSnapshotSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", stableBars: { "5m": [], "15m": [], "1h": [] }, liveQuote: { price: 100, observedAt: asOf }, quality: { alignmentOk: true, missingTimeframes: [], warnings: [] } });
  const pipeline = new DecisionPipeline({
    selector: { name: "selector", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, asOf, candidates: [] }) },
    dataSync: { name: "data", version: "test", run: async () => snapshot },
    analysis: { name: "analysis", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", regime: "choppy", trend: "neutral", setup: "wait", trigger: "waiting", diagnostics: [] }) },
    bullCase: { name: "bull", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", side: "long", confidence: 0, evidence: [], invalidationConditions: [], veto: false }) },
    bearCase: { name: "bear", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", side: "short", confidence: 0, evidence: [], invalidationConditions: [], veto: false }) },
    decision: { name: "decision", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, asOf, symbol: "BTCUSDT", action: "wait", confidence: 0, reason: "no trade", evidence: [], missingConfirmations: [] }) },
    portfolio: { name: "portfolio", version: "test", run: async () => [] },
    risk: { name: "risk", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", passed: true, riskLevel: "safe", corrections: {}, warnings: [] }) },
    execution: { name: "execution", version: "test", run: async () => ({ schemaVersion: SCHEMA_VERSION, traceId, symbol: "BTCUSDT", action: "wait", status: "skipped", message: "no trade", fee: 0, realizedPnl: 0 }) },
    reflection: new LlmReflectionAgent(new RuleReflectionAgent({ minimumTrades: 3, intervalTrades: 1 }), { complete: async () => ({ recommendations: [], adjustments: [] }) }, { llm: { bullCaseEnabled: false, bearCaseEnabled: false, reflectionEnabled: true, timeoutMs: 100, fallbackToRules: true } }, { provider: "deepseek", model: "fixture" }),
    tradeHistory: { getClosedTrades: () => reflectionTrades },
    reflectionAccountId: "paper:main",
    reflectionStore: { save: async (_accountId, report) => { saved.push(report.reflectionId); }, latest: async () => undefined },
    traceSink: { append: async (event) => { events.push({ label: `${event.stage}:${event.phase}`, data: event.data }); } },
  });
  await pipeline.runCycle(CycleRequestSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId, runMode: "backtest", asOf, strategyId: "fixture", configVersion: "v1", symbols: ["BTCUSDT"], executionEnabled: false }));

  assert.equal(saved.length, 1);
  assert.ok(events.some((event) => event.label === "reflection:start"));
  assert.equal(events.find((event) => event.label === "reflection:end")?.data.provider, "deepseek");
  assert.equal(events.find((event) => event.label === "reflection:end")?.data.fallbackUsed, false);
});

test("strategy profiles validate nested overrides and fingerprint resolved policy deterministically", () => {
  const adjusted = resolveStrategyProfile({ profileId: "conservative", profileVersion: "v2", decision: { perTradeNotional: 250 }, accountRisk: { maxOpenPositions: 2 } });
  assert.equal(adjusted.decision.perTradeNotional, 250);
  assert.equal(adjusted.decision.leverage, DEFAULT_STRATEGY_PROFILE.decision.leverage);
  assert.equal(adjusted.accountRisk.maxOpenPositions, 2);
  assert.equal(strategyProfileFingerprint(adjusted), strategyProfileFingerprint(resolveStrategyProfile({ accountRisk: { maxOpenPositions: 2 }, decision: { perTradeNotional: 250 }, profileVersion: "v2", profileId: "conservative" })));
  assert.throws(() => resolveStrategyProfile({ decision: { perTradeNotional: -1 } }), /greater than 0/);
});

test("optimization inputs are constrained to explicitly approved numeric knobs", () => {
  assert.deepEqual(validateOptimizationGrid({ perTradeNotional: [250, 500], feeBps: [1, 3] }), { perTradeNotional: [250, 500], feeBps: [1, 3] });
  assert.deepEqual(validateOptimizationParameters({ minTrendStrength: 25 }), { minTrendStrength: 25 });
  assert.throws(() => validateOptimizationGrid({ maxLeverage: [1, 2] }), /not allowed/);
  assert.throws(() => validateOptimizationParameters({ perTradeNotional: "500" }), /finite number/);
});

test("run manifests bind a CSV content hash and retain only safe provenance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tradebot-manifest-"));
  const csv = join(directory, "bars.csv");
  try {
    await writeFile(csv, "one");
    const first = await sha256File(csv);
    await writeFile(csv, "two");
    const second = await sha256File(csv);
    assert.notEqual(first, second);
    const manifest = createRunManifest({ runId: "run:1", runMode: "backtest", createdAt: asOf, strategyId: "fixture", configFingerprint: "abc", dataSource: { kind: "csv", identifier: "bars.csv", contentFingerprint: second }, symbols: ["BTCUSDT"], timeRange: { start: asOf, end: asOf } });
    assert.equal(manifest.dataSource.contentFingerprint, second);
    assert.equal(manifest.dataSource.kind, "csv");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("profile inspection is pure and exposes LLM authorization plus disabled loss guards", () => {
  const llmProfile = resolveStrategyProfile({ llm: { enabled: true } });
  const warning = inspectStrategyProfile(llmProfile, false);
  assert.equal(warning.llm.enabled, true);
  assert.equal(warning.llm.explicitlyAuthorized, false);
  assert.match(warning.warnings[0] ?? "", /not explicitly authorized/);
  const defaultInspection = inspectStrategyProfile(DEFAULT_STRATEGY_PROFILE, false);
  assert.equal(defaultInspection.riskGuards.maxCumulativeRealizedLoss, null);
  assert.equal(defaultInspection.riskGuards.maxEquityLossPct, null);
});
