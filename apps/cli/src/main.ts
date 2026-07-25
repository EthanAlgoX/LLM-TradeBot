import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import process from "node:process";
import { DeterministicGridSearch, DeterministicWalkForwardValidator, PipelineBacktestService, stableFingerprint } from "../../../packages/backtest/src/index.js";
import {
  CsvHistoricalCandleSource,
  HistoricalDataSyncAgent,
  HistoricalSelectorMetricsPort,
  MarketOpportunitySelectorAgent,
  SimulatedExecutionAgent,
  SQLiteTraceSink,
  SQLitePaperAccountStore,
  BinanceFuturesReadClient,
  BinanceFuturesMarketDataSource,
  PersistentPaperExecutionAgent,
  SQLiteReflectionStore,
  SQLiteRuntimeSafetyStore,
  SQLitePaperCycleJournal,
  SQLiteAgentArtifactLedger,
  createDeepSeekStructuredLlmFromEnv,
} from "../../../packages/adapters/src/index.js";
import {
  RuleAnalysisPipelineAgent,
  RuleBearCaseAgent,
  RuleBullCaseAgent,
  RuleDecisionAgent,
  RuleRiskAgent,
  RulePositionMonitorAgent,
  SingleBestPortfolioAgent,
  createDirectionalCaseAgents,
  LlmReflectionAgent,
  RuleReflectionAgent,
  RuleDataQualityGate,
  RulePortfolioRiskGuard,
} from "../../../packages/agents/src/index.js";
import { DecisionPipeline } from "../../../packages/core/src/index.js";
import { buildRuntimeDashboard, buildTradeReview, filterTraceEvents, PaperSafetyGuard, renderRuntimeDashboard, renderTradeReview, SequentialCycleRunner, summarizeTrace } from "../../../packages/runtime/src/index.js";
import { ReconciliationService } from "../../../packages/runtime/src/index.js";
import { ExperimentParametersSchema, ParameterGridSchema, type ExperimentParameters } from "../../../packages/contracts/src/index.js";
import { createRunManifest, experimentBaseFromProfile, inspectStrategyProfile, loadStrategyProfile, resolveStrategyProfile, sha256File, strategyProfileFingerprint, validateOptimizationGrid, validateOptimizationParameters, type StrategyProfileOverride } from "../../../packages/config/src/index.js";

type Args = Record<string, string | boolean>;

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) args[key] = true;
    else { args[key] = value; index += 1; }
  }
  return args;
}

function usage(): never {
  console.error("Usage:\n  npm run backtest:ts -- profile [--profile profile.json] [--llm deepseek] [profile overrides]\n  npm run backtest:ts -- backtest --csv bars.csv --symbols BTCUSDT,ETHUSDT [--profile profile.json] [--artifact-db data/artifacts.db] [--llm deepseek] [--trace-db data/tradebot.db] [--output report.json]\n  npm run backtest:ts -- experiment --csv bars.csv --symbols BTCUSDT --grid '{\"perTradeNotional\":[500,1000]}' [--profile profile.json] [--baseline '{\"perTradeNotional\":1000}'] [--output report.json]\n  npm run backtest:ts -- walk-forward --csv bars.csv --symbols BTCUSDT --grid '{\"perTradeNotional\":[500,1000]}' --train-cycles 200 --validation-cycles 50 --step-cycles 50 [--profile profile.json] [--window rolling] [--output report.json]\n  npm run backtest:ts -- paper-cycle --symbols BTCUSDT,ETHUSDT --paper-db data/paper.db --account-id paper:main [--profile profile.json] [--artifact-db data/artifacts.db] [--execution-enabled] [--llm deepseek]\n  npm run backtest:ts -- artifacts --artifact-db data/artifacts.db --trace-id ID [--symbol BTCUSDT] [--stage decision] [--limit 100]\n  npm run backtest:ts -- review --artifact-db data/artifacts.db (--trace-id ID | --order-id ID) [--symbol BTCUSDT] [--json]\n  npm run backtest:ts -- preflight --symbols BTCUSDT --paper-db data/paper.db --account-id paper:main [--profile profile.json]\n  npm run backtest:ts -- paper-watch --symbols BTCUSDT --paper-db data/paper.db --account-id paper:main --cycles 3 [--profile profile.json] [--interval-seconds 60] [--continue-on-error] [--execution-enabled]\n  npm run backtest:ts -- dashboard --paper-db data/paper.db --account-id paper:main [--trace-db data/tradebot.db] [--reflection-db data/reflection.db] [--json]\n  npm run backtest:ts -- dashboard-watch --paper-db data/paper.db --account-id paper:main --cycles 3 [--interval-seconds 5] [--clear] [--json]\n  npm run backtest:ts -- journal --paper-db data/paper.db --account-id paper:main [--limit 20]\n  npm run backtest:ts -- doctor [--paper-db data/paper.db] [--json]\n  npm run backtest:ts -- trace --trace-db data/tradebot.db [--trace-id ID] [--stage risk]\n  npm run backtest:ts -- status --trace-db data/tradebot.db\n  npm run backtest:ts -- reconcile --paper-db data/paper.db --account-id paper:main [--fail-on-drift]");
  process.exit(2);
}

function numberArg(args: Args, name: string, fallback: number): number {
  const raw = args[name];
  if (typeof raw !== "string") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number`);
  return parsed;
}

function json(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }

function parseJsonArg(args: Args, name: string): unknown {
  const raw = args[name];
  if (typeof raw !== "string") throw new Error(`--${name} is required and must be JSON`);
  try { return JSON.parse(raw) as unknown; }
  catch { throw new Error(`--${name} must be valid JSON`); }
}

function experimentNumber(parameters: ExperimentParameters, name: string, fallback: number): number {
  const value = parameters[name];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`experiment parameter ${name} must be a finite number`);
  return value;
}

function presentNumber(args: Args, key: string): number | undefined {
  return typeof args[key] === "string" ? numberArg(args, key, 0) : undefined;
}

async function effectiveProfile(args: Args) {
  const loaded = await loadStrategyProfile(typeof args.profile === "string" ? args.profile : undefined);
  const override: StrategyProfileOverride = {
    selector: { topN: presentNumber(args, "top-n"), minQuoteVolume24h: presentNumber(args, "min-quote-volume"), minPrice: presentNumber(args, "min-price"), minTrendStrength: presentNumber(args, "min-trend-strength"), minVolatilityPct: presentNumber(args, "min-volatility-pct"), maxVolatilityPct: presentNumber(args, "max-volatility-pct") },
    dataQuality: { minBars5m: presentNumber(args, "min-bars-5m"), minBars15m: presentNumber(args, "min-bars-15m"), minBars1h: presentNumber(args, "min-bars-1h"), maxQuoteAgeMs: presentNumber(args, "max-quote-age-seconds") === undefined ? undefined : presentNumber(args, "max-quote-age-seconds")! * 1_000 },
    decision: { perTradeNotional: presentNumber(args, "per-trade-notional"), leverage: presentNumber(args, "leverage"), minimumConfidence: presentNumber(args, "minimum-confidence") },
    risk: { maxLeverage: presentNumber(args, "max-leverage"), maxNotional: presentNumber(args, "max-notional") },
    accountRisk: { maxOpenPositions: presentNumber(args, "max-open-positions"), maxUsedMarginPct: presentNumber(args, "max-used-margin-pct"), maxOrderNotional: presentNumber(args, "max-order-notional"), maxCumulativeRealizedLoss: presentNumber(args, "max-cumulative-realized-loss"), maxEquityLossPct: presentNumber(args, "max-equity-loss-pct") },
    execution: { initialCash: presentNumber(args, "initial-cash"), feeBps: presentNumber(args, "fee-bps"), slippageBps: presentNumber(args, "slippage-bps"), maxExecutionsPerCycle: presentNumber(args, "max-executions-per-cycle") },
    llm: { enabled: args.llm === "deepseek" ? true : undefined, timeoutMs: presentNumber(args, "llm-timeout-ms") },
  };
  return resolveStrategyProfile({ ...loaded, ...override, selector: { ...loaded.selector, ...override.selector }, dataQuality: { ...loaded.dataQuality, ...override.dataQuality }, decision: { ...loaded.decision, ...override.decision }, risk: { ...loaded.risk, ...override.risk }, accountRisk: { ...loaded.accountRisk, ...override.accountRisk }, execution: { ...loaded.execution, ...override.execution }, llm: { ...loaded.llm, ...override.llm } });
}

async function runBacktest(args: Args): Promise<void> {
  const csv = args.csv;
  const symbolArg = args.symbols;
  if (typeof csv !== "string" || typeof symbolArg !== "string") usage();
  const symbols = symbolArg.split(",").map((symbol) => symbol.trim()).filter(Boolean);
  if (symbols.length === 0) usage();
  const profile = typeof args.profile === "string" ? await effectiveProfile(args) : undefined;
  const start = typeof args.start === "string" ? new Date(args.start) : undefined;
  const end = typeof args.end === "string" ? new Date(args.end) : undefined;
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) throw new Error("--start and --end must be ISO timestamps");
  const initialCash = profile?.execution.initialCash ?? numberArg(args, "initial-cash", 10_000);
  const feeBps = profile?.execution.feeBps ?? numberArg(args, "fee-bps", 3);
  const slippageBps = profile?.execution.slippageBps ?? numberArg(args, "slippage-bps", 1);
  const csvFingerprint = await sha256File(csv);
  const source = await CsvHistoricalCandleSource.fromFile(csv);
  const timelineBars = await source.loadBars(symbols[0]!, "5m");
  if (timelineBars.length === 0) throw new Error("CSV must contain 5m candles for the first selected symbol (use a timeframe column)");
  const asOf = timelineBars.map((bar) => bar.closeTime).filter((time) => (!start || time >= start) && (!end || time <= end));
  if (asOf.length === 0) throw new Error("no 5m candles fall within the requested time range");

  const simulatedExecution = new SimulatedExecutionAgent({ initialCash, feeBps, slippageBps });
  const traceSink = typeof args["trace-db"] === "string" ? new SQLiteTraceSink(args["trace-db"]) : undefined;
  const artifactLedger = typeof args["artifact-db"] === "string" ? new SQLiteAgentArtifactLedger(args["artifact-db"]) : undefined;
  const llm = args.llm;
  if (llm !== undefined && llm !== "deepseek") throw new Error("--llm currently supports only deepseek");
  const deepseek = llm === "deepseek" ? createDeepSeekStructuredLlmFromEnv() ?? (() => { throw new Error("DEEPSEEK_API_KEY is required when --llm deepseek is enabled"); })() : undefined;
  if (profile?.llm.enabled && llm !== "deepseek") throw new Error("profile enables LLM; pass --llm deepseek to explicitly authorize provider use");
  const llmRuntime = { llm: { bullCaseEnabled: llm === "deepseek", bearCaseEnabled: llm === "deepseek", reflectionEnabled: llm === "deepseek", timeoutMs: profile?.llm.timeoutMs ?? numberArg(args, "llm-timeout-ms", 15_000), fallbackToRules: profile?.llm.fallbackToRules ?? true } };
  const directionalCases = deepseek
    ? createDirectionalCaseAgents(llmRuntime, deepseek)
    : { bullCase: new RuleBullCaseAgent(), bearCase: new RuleBearCaseAgent() };
  const ruleReflection = new RuleReflectionAgent();
  const reflection = deepseek ? new LlmReflectionAgent(ruleReflection, deepseek, llmRuntime, { provider: deepseek.provider, model: deepseek.modelName }) : ruleReflection;
  const application = new DecisionPipeline({
    selector: new MarketOpportunitySelectorAgent(new HistoricalSelectorMetricsPort(source), { candidates: symbols, ...(profile?.selector ?? { topN: 1, minQuoteVolume24h: numberArg(args, "min-quote-volume", 0), minPrice: numberArg(args, "min-price", 0.00000001), minTrendStrength: numberArg(args, "min-trend-strength", 0), minVolatilityPct: 0, maxVolatilityPct: numberArg(args, "max-volatility-pct", 100) }) }),
    dataSync: new HistoricalDataSyncAgent(source), dataQuality: profile ? new RuleDataQualityGate(profile.dataQuality) : undefined, analysis: new RuleAnalysisPipelineAgent(), bullCase: directionalCases.bullCase, bearCase: directionalCases.bearCase,
    decision: new RuleDecisionAgent(profile?.decision ?? { perTradeNotional: numberArg(args, "per-trade-notional", 1_000) }), portfolio: new SingleBestPortfolioAgent(), risk: new RuleRiskAgent(profile?.risk), execution: simulatedExecution,
    positionState: simulatedExecution, positionMonitor: new RulePositionMonitorAgent(), reflection, tradeHistory: simulatedExecution, traceSink, artifactLedger,
  });
  try {
    const runId = `backtest:${new Date().toISOString()}`;
    const configVersion = profile ? strategyProfileFingerprint(profile) : "v1";
    const report = await new PipelineBacktestService(application, simulatedExecution).run({ schemaVersion: "v1", runId, datasetId: csv, strategyId: profile?.profileId ?? "rule-multi-agent-v1", configVersion, asOf, symbols, executionEnabled: true, initialCash });
    const manifest = createRunManifest({ runId, runMode: "backtest", createdAt: new Date(), strategyId: report.strategyId, profileVersion: profile?.profileVersion, configFingerprint: configVersion, dataSource: { kind: "csv", identifier: csv, contentFingerprint: csvFingerprint }, symbols, timeRange: { start: asOf[0], end: asOf.at(-1) } });
    const payload = { manifest, report, account: simulatedExecution.markToMarket({}) };
    const output = JSON.stringify(payload, null, 2);
    if (typeof args.output === "string") await writeFile(args.output, output);
    else console.log(output);
  } finally { artifactLedger?.close(); traceSink?.close(); }
}

async function runExperiment(args: Args): Promise<void> {
  if (args.llm !== undefined) throw new Error("experiment intentionally runs rule-only; omit --llm to prevent API-cost and non-determinism");
  const profile = typeof args.profile === "string" ? await effectiveProfile(args) : undefined;
  if (profile?.llm.enabled) throw new Error("experiment intentionally runs rule-only; profile.llm.enabled must be false");
  const csv = args.csv;
  const symbolArg = args.symbols;
  if (typeof csv !== "string" || typeof symbolArg !== "string") usage();
  const symbols = symbolArg.split(",").map((symbol) => symbol.trim()).filter(Boolean);
  if (symbols.length === 0) usage();
  const csvFingerprint = await sha256File(csv);
  const source = await CsvHistoricalCandleSource.fromFile(csv);
  const timelineBars = await source.loadBars(symbols[0]!, "5m");
  if (timelineBars.length === 0) throw new Error("CSV must contain 5m candles for the first selected symbol");
  const initialCash = profile?.execution.initialCash ?? numberArg(args, "initial-cash", 10_000);
  const base: Record<string, number> = profile ? experimentBaseFromProfile(profile) : {
    initialCash,
    feeBps: numberArg(args, "fee-bps", 3),
    slippageBps: numberArg(args, "slippage-bps", 1),
    perTradeNotional: numberArg(args, "per-trade-notional", 1_000),
    minQuoteVolume: numberArg(args, "min-quote-volume", 0),
    minPrice: numberArg(args, "min-price", 0.00000001),
    minTrendStrength: numberArg(args, "min-trend-strength", 0),
    maxVolatilityPct: numberArg(args, "max-volatility-pct", 100),
  };
  const grid = validateOptimizationGrid(parseJsonArg(args, "grid"));
  const baseline = args.baseline === undefined ? undefined : validateOptimizationParameters(parseJsonArg(args, "baseline"));
  const experimentId = typeof args["experiment-id"] === "string" ? args["experiment-id"] : `experiment:${new Date().toISOString()}`;
  const runner = new DeterministicGridSearch(async (parameters, trialId) => {
    const merged = { ...base, ...parameters };
    const trialInitialCash = experimentNumber(merged, "initialCash", initialCash);
    const executor = new SimulatedExecutionAgent({ initialCash: trialInitialCash, feeBps: experimentNumber(merged, "feeBps", base.feeBps), slippageBps: experimentNumber(merged, "slippageBps", base.slippageBps) });
    const application = new DecisionPipeline({
      selector: new MarketOpportunitySelectorAgent(new HistoricalSelectorMetricsPort(source), { candidates: symbols, ...(profile?.selector ?? { topN: 1, minQuoteVolume24h: 0, minPrice: 0.00000001, minTrendStrength: 0, minVolatilityPct: 0, maxVolatilityPct: 100 }), minQuoteVolume24h: experimentNumber(merged, "minQuoteVolume", base.minQuoteVolume), minPrice: experimentNumber(merged, "minPrice", base.minPrice), minTrendStrength: experimentNumber(merged, "minTrendStrength", base.minTrendStrength), maxVolatilityPct: experimentNumber(merged, "maxVolatilityPct", base.maxVolatilityPct) }),
      dataSync: new HistoricalDataSyncAgent(source), dataQuality: profile ? new RuleDataQualityGate(profile.dataQuality) : undefined, analysis: new RuleAnalysisPipelineAgent(), bullCase: new RuleBullCaseAgent(), bearCase: new RuleBearCaseAgent(),
      decision: new RuleDecisionAgent({ ...(profile?.decision ?? {}), perTradeNotional: experimentNumber(merged, "perTradeNotional", base.perTradeNotional) }), portfolio: new SingleBestPortfolioAgent(), risk: new RuleRiskAgent(profile?.risk), execution: executor,
      positionState: executor, positionMonitor: new RulePositionMonitorAgent(), reflection: new RuleReflectionAgent(), tradeHistory: executor,
    });
    return new PipelineBacktestService(application, executor).run({ schemaVersion: "v1", runId: `${experimentId}:${trialId}`, datasetId: csv, strategyId: profile?.profileId ?? "rule-multi-agent-v1", configVersion: `${profile ? strategyProfileFingerprint(profile) : "legacy"}:${stableFingerprint(merged)}`, asOf: timelineBars.map((bar) => bar.closeTime), symbols, executionEnabled: true, initialCash: trialInitialCash });
  });
  const report = await runner.run({ schemaVersion: "v1", experimentId, datasetId: csv, strategyId: profile?.profileId ?? "rule-multi-agent-v1", configFingerprint: `${profile ? strategyProfileFingerprint(profile) : "legacy"}:${stableFingerprint(base)}`, profileVersion: profile?.profileVersion, grid, baseline });
  const manifest = createRunManifest({ runId: experimentId, runMode: "backtest", createdAt: new Date(), strategyId: report.strategyId, profileVersion: profile?.profileVersion, configFingerprint: report.configFingerprint, dataSource: { kind: "csv", identifier: csv, contentFingerprint: csvFingerprint }, symbols, timeRange: { start: timelineBars[0]?.closeTime, end: timelineBars.at(-1)?.closeTime } });
  if (typeof args.output === "string") await writeFile(args.output, JSON.stringify({ manifest, report }, null, 2));
  else json({ manifest, report });
}

async function runWalkForward(args: Args): Promise<void> {
  if (args.llm !== undefined) throw new Error("walk-forward intentionally runs rule-only; omit --llm to prevent API-cost and non-determinism");
  const profile = typeof args.profile === "string" ? await effectiveProfile(args) : undefined;
  if (profile?.llm.enabled) throw new Error("walk-forward intentionally runs rule-only; profile.llm.enabled must be false");
  const csv = args.csv;
  const symbolArg = args.symbols;
  if (typeof csv !== "string" || typeof symbolArg !== "string") usage();
  const symbols = symbolArg.split(",").map((symbol) => symbol.trim()).filter(Boolean);
  if (symbols.length === 0) usage();
  const csvFingerprint = await sha256File(csv);
  const source = await CsvHistoricalCandleSource.fromFile(csv);
  const timelineBars = await source.loadBars(symbols[0]!, "5m");
  if (timelineBars.length === 0) throw new Error("CSV must contain 5m candles for the first selected symbol");
  const base: Record<string, number> = profile ? experimentBaseFromProfile(profile) : {
    initialCash: numberArg(args, "initial-cash", 10_000), feeBps: numberArg(args, "fee-bps", 3), slippageBps: numberArg(args, "slippage-bps", 1), perTradeNotional: numberArg(args, "per-trade-notional", 1_000),
    minQuoteVolume: numberArg(args, "min-quote-volume", 0), minPrice: numberArg(args, "min-price", 0.00000001), minTrendStrength: numberArg(args, "min-trend-strength", 0), maxVolatilityPct: numberArg(args, "max-volatility-pct", 100),
  };
  const grid = validateOptimizationGrid(parseJsonArg(args, "grid"));
  const mode = args.window === undefined ? "rolling" : args.window;
  if (mode !== "rolling" && mode !== "expanding") throw new Error("--window must be rolling or expanding");
  const runId = typeof args["run-id"] === "string" ? args["run-id"] : `walk-forward:${new Date().toISOString()}`;
  const validator = new DeterministicWalkForwardValidator(async (parameters, trialId, asOf) => {
    const merged = { ...base, ...parameters };
    const initialCash = experimentNumber(merged, "initialCash", base.initialCash);
    const executor = new SimulatedExecutionAgent({ initialCash, feeBps: experimentNumber(merged, "feeBps", base.feeBps), slippageBps: experimentNumber(merged, "slippageBps", base.slippageBps) });
    const application = new DecisionPipeline({
      selector: new MarketOpportunitySelectorAgent(new HistoricalSelectorMetricsPort(source), { candidates: symbols, ...(profile?.selector ?? { topN: 1, minQuoteVolume24h: 0, minPrice: 0.00000001, minTrendStrength: 0, minVolatilityPct: 0, maxVolatilityPct: 100 }), minQuoteVolume24h: experimentNumber(merged, "minQuoteVolume", base.minQuoteVolume), minPrice: experimentNumber(merged, "minPrice", base.minPrice), minTrendStrength: experimentNumber(merged, "minTrendStrength", base.minTrendStrength), maxVolatilityPct: experimentNumber(merged, "maxVolatilityPct", base.maxVolatilityPct) }),
      dataSync: new HistoricalDataSyncAgent(source), dataQuality: profile ? new RuleDataQualityGate(profile.dataQuality) : undefined, analysis: new RuleAnalysisPipelineAgent(), bullCase: new RuleBullCaseAgent(), bearCase: new RuleBearCaseAgent(),
      decision: new RuleDecisionAgent({ ...(profile?.decision ?? {}), perTradeNotional: experimentNumber(merged, "perTradeNotional", base.perTradeNotional) }), portfolio: new SingleBestPortfolioAgent(), risk: new RuleRiskAgent(profile?.risk), execution: executor,
      positionState: executor, positionMonitor: new RulePositionMonitorAgent(), reflection: new RuleReflectionAgent(), tradeHistory: executor,
    });
    return new PipelineBacktestService(application, executor).run({ schemaVersion: "v1", runId: `${runId}:${trialId}`, datasetId: csv, strategyId: profile?.profileId ?? "rule-multi-agent-v1", configVersion: `${profile ? strategyProfileFingerprint(profile) : "legacy"}:${stableFingerprint(merged)}`, asOf: [...asOf], symbols, executionEnabled: true, initialCash });
  });
  const report = await validator.run({ schemaVersion: "v1", runId, datasetId: csv, strategyId: profile?.profileId ?? "rule-multi-agent-v1", configFingerprint: `${profile ? strategyProfileFingerprint(profile) : "legacy"}:${stableFingerprint(base)}`, profileVersion: profile?.profileVersion, asOf: timelineBars.map((bar) => bar.closeTime), grid, plan: { mode, trainingCycles: numberArg(args, "train-cycles", 200), validationCycles: numberArg(args, "validation-cycles", 50), stepCycles: numberArg(args, "step-cycles", 50) } });
  const manifest = createRunManifest({ runId, runMode: "backtest", createdAt: new Date(), strategyId: report.strategyId, profileVersion: profile?.profileVersion, configFingerprint: report.configFingerprint, dataSource: { kind: "csv", identifier: csv, contentFingerprint: csvFingerprint }, symbols, timeRange: { start: timelineBars[0]?.closeTime, end: timelineBars.at(-1)?.closeTime } });
  if (typeof args.output === "string") await writeFile(args.output, JSON.stringify({ manifest, report }, null, 2));
  else json({ manifest, report });
}

async function runPaperCycle(args: Args): Promise<void> {
  const symbolArg = args.symbols;
  const paperDb = args["paper-db"];
  const accountId = args["account-id"];
  if (typeof symbolArg !== "string" || typeof paperDb !== "string" || typeof accountId !== "string") usage();
  const symbols = symbolArg.split(",").map((symbol) => symbol.trim()).filter(Boolean);
  if (symbols.length === 0) usage();
  const profile = await effectiveProfile(args);
  const executionEnabled = args["execution-enabled"] === true;
  const paperStore = new SQLitePaperAccountStore(paperDb);
  const reflectionStore = new SQLiteReflectionStore(typeof args["reflection-db"] === "string" ? args["reflection-db"] : `${paperDb}.reflection.db`);
  const traceSink = typeof args["trace-db"] === "string" ? new SQLiteTraceSink(args["trace-db"]) : undefined;
  const artifactLedger = typeof args["artifact-db"] === "string" ? new SQLiteAgentArtifactLedger(args["artifact-db"]) : undefined;
  const journal = new SQLitePaperCycleJournal(typeof args["journal-db"] === "string" ? args["journal-db"] : `${paperDb}.journal.db`);
  try {
    const executor = await PersistentPaperExecutionAgent.open(accountId, paperStore, { initialCash: profile.execution.initialCash, feeBps: profile.execution.feeBps, slippageBps: profile.execution.slippageBps });
    const market = new BinanceFuturesMarketDataSource(new BinanceFuturesReadClient());
    const llm = args.llm;
    if (llm !== undefined && llm !== "deepseek") throw new Error("--llm currently supports only deepseek");
    const deepseek = llm === "deepseek" ? createDeepSeekStructuredLlmFromEnv() ?? (() => { throw new Error("DEEPSEEK_API_KEY is required when --llm deepseek is enabled"); })() : undefined;
    if (profile.llm.enabled && llm !== "deepseek") throw new Error("profile enables LLM; pass --llm deepseek to explicitly authorize provider use");
    const llmRuntime = { llm: { bullCaseEnabled: llm === "deepseek", bearCaseEnabled: llm === "deepseek", reflectionEnabled: llm === "deepseek", timeoutMs: profile.llm.timeoutMs, fallbackToRules: profile.llm.fallbackToRules } };
    const directionalCases = deepseek ? createDirectionalCaseAgents(llmRuntime, deepseek) : { bullCase: new RuleBullCaseAgent(), bearCase: new RuleBearCaseAgent() };
    const ruleReflection = new RuleReflectionAgent();
    const reflection = deepseek ? new LlmReflectionAgent(ruleReflection, deepseek, llmRuntime, { provider: deepseek.provider, model: deepseek.modelName }) : ruleReflection;
    const application = new DecisionPipeline({
      selector: new MarketOpportunitySelectorAgent(market, { candidates: symbols, ...profile.selector }),
      dataSync: new HistoricalDataSyncAgent(market), dataQuality: new RuleDataQualityGate(profile.dataQuality), analysis: new RuleAnalysisPipelineAgent(), bullCase: directionalCases.bullCase, bearCase: directionalCases.bearCase,
      decision: new RuleDecisionAgent(profile.decision), portfolio: new SingleBestPortfolioAgent(), risk: new RuleRiskAgent(profile.risk), execution: executor,
      positionState: executor, portfolioState: executor, portfolioRisk: new RulePortfolioRiskGuard(profile.accountRisk), positionMonitor: new RulePositionMonitorAgent(), reflection, tradeHistory: executor, reflectionStore, reflectionAccountId: accountId, traceSink, artifactLedger, maxExecutionsPerCycle: profile.execution.maxExecutionsPerCycle,
    });
    const asOf = new Date();
    const configVersion = strategyProfileFingerprint(profile);
    const traceId = `paper:${accountId}:${asOf.toISOString()}`;
    const manifest = createRunManifest({ runId: traceId, runMode: "paper", createdAt: asOf, strategyId: profile.profileId, profileVersion: profile.profileVersion, configFingerprint: configVersion, dataSource: { kind: "binance_futures_public", identifier: "binance-futures-public", observedAt: asOf }, symbols, timeRange: { end: asOf } });
    const cycle = await application.runCycle({ schemaVersion: "v1", traceId, runMode: "paper", asOf, strategyId: profile.profileId, configVersion, symbols, executionEnabled });
    await traceSink?.append({ schemaVersion: "v1", traceId, stage: "manifest", agent: "cli_run_manifest", phase: "end", at: new Date(), data: { runMode: manifest.runMode, strategyId: manifest.strategyId, profileVersion: manifest.profileVersion, configFingerprint: manifest.configFingerprint, dataSource: manifest.dataSource.kind, symbols: manifest.symbols } });
    await journal.append({ recordId: `cycle:${cycle.traceId}`, accountId, traceId: cycle.traceId, asOf, status: cycle.status, executionEnabled, strategyId: profile.profileId, profileVersion: profile.profileVersion, configVersion, dataSource: manifest.dataSource, decisionCount: cycle.decisions.length, riskDecisionCount: cycle.riskDecisions.length, executionCount: cycle.executions.length });
    json({ mode: "paper", executionEnabled, manifest, profile: { id: profile.profileId, version: profile.profileVersion, fingerprint: configVersion }, cycle, account: executor.markToMarket(cycle.markPrices), reflection: await reflectionStore.latest(accountId) });
  } finally {
    journal.close();
    artifactLedger?.close();
    traceSink?.close();
    reflectionStore.close();
    paperStore.close();
  }
}

async function runDashboard(args: Args): Promise<void> {
  const paperDb = args["paper-db"];
  const accountId = args["account-id"];
  if (typeof paperDb !== "string" || typeof accountId !== "string") usage();
  const paperStore = new SQLitePaperAccountStore(paperDb);
  const traceSink = typeof args["trace-db"] === "string" ? new SQLiteTraceSink(args["trace-db"]) : undefined;
  const reflectionStore = typeof args["reflection-db"] === "string" ? new SQLiteReflectionStore(args["reflection-db"]) : undefined;
  const requestedSafetyDb = typeof args["safety-db"] === "string" ? args["safety-db"] : `${paperDb}.safety.db`;
  const safetyStore = existsSync(requestedSafetyDb) ? new SQLiteRuntimeSafetyStore(requestedSafetyDb) : undefined;
  const requestedJournalDb = typeof args["journal-db"] === "string" ? args["journal-db"] : `${paperDb}.journal.db`;
  const journal = existsSync(requestedJournalDb) ? new SQLitePaperCycleJournal(requestedJournalDb) : undefined;
  try {
    const traceId = traceSink?.latestTraceId();
    const dashboard = buildRuntimeDashboard({ accountId, account: await paperStore.load(accountId), events: traceId ? traceSink?.load(traceId) : undefined, reflection: reflectionStore ? await reflectionStore.latest(accountId) : undefined, safety: safetyStore ? await safetyStore.load(accountId) : undefined, latestCycle: (await journal?.latest(accountId, 1))?.[0] });
    if (args.json === true) json(dashboard);
    else console.log(renderRuntimeDashboard(dashboard));
  } finally {
    journal?.close();
    safetyStore?.close();
    reflectionStore?.close();
    traceSink?.close();
    paperStore.close();
  }
}

async function runDashboardWatch(args: Args): Promise<void> {
  if (args.cycles === undefined) throw new Error("--cycles is required for dashboard-watch; bounded display is mandatory");
  const cycles = numberArg(args, "cycles", 0);
  const intervalSeconds = numberArg(args, "interval-seconds", 5);
  const report = await new SequentialCycleRunner().run({ cycles, intervalMs: intervalSeconds * 1_000, executionEnabled: false, continueOnError: true }, async () => {
    if (args.clear === true && process.stdout.isTTY) process.stdout.write("\x1Bc");
    await runDashboard(args);
  });
  if (args.json !== true) json(report);
}

async function runJournal(args: Args): Promise<void> {
  const paperDb = args["paper-db"];
  const accountId = args["account-id"];
  if (typeof paperDb !== "string" || typeof accountId !== "string") usage();
  const limit = numberArg(args, "limit", 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("--limit must be an integer between 1 and 200");
  const path = typeof args["journal-db"] === "string" ? args["journal-db"] : `${paperDb}.journal.db`;
  if (!existsSync(path)) { json([]); return; }
  const journal = new SQLitePaperCycleJournal(path);
  try { json(await journal.latest(accountId, limit)); }
  finally { journal.close(); }
}

async function runDoctor(args: Args): Promise<void> {
  const paperDb = typeof args["paper-db"] === "string" ? args["paper-db"] : "data/paper.db";
  const traceDb = typeof args["trace-db"] === "string" ? args["trace-db"] : "data/tradebot.db";
  const reflectionDb = typeof args["reflection-db"] === "string" ? args["reflection-db"] : `${paperDb}.reflection.db`;
  const safetyDb = typeof args["safety-db"] === "string" ? args["safety-db"] : `${paperDb}.safety.db`;
  const journalDb = typeof args["journal-db"] === "string" ? args["journal-db"] : `${paperDb}.journal.db`;
  const report = { mode: "read_only_doctor", databases: { paper: existsSync(paperDb), trace: existsSync(traceDb), reflection: existsSync(reflectionDb), safety: existsSync(safetyDb), journal: existsSync(journalDb) }, credentials: { deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY), binanceConfigured: Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) } };
  if (args.json === true) json(report);
  else console.log(`TradeBot Doctor\nDatabases: ${Object.entries(report.databases).map(([name, ready]) => `${name}=${ready ? "ready" : "missing"}`).join(" ")}\nCredentials: deepseek=${report.credentials.deepseekConfigured ? "configured" : "not_configured"} binance=${report.credentials.binanceConfigured ? "configured" : "not_configured"}`);
}

/** Loads only local profile JSON and prints the exact effective configuration; it opens no runtime adapter. */
async function runProfile(args: Args): Promise<void> {
  if (args.llm !== undefined && args.llm !== "deepseek") throw new Error("--llm currently supports only deepseek");
  const profile = await effectiveProfile(args);
  json(inspectStrategyProfile(profile, args.llm === "deepseek"));
}

async function runArtifacts(args: Args): Promise<void> {
  const path = args["artifact-db"];
  const traceId = args["trace-id"];
  if (typeof path !== "string" || typeof traceId !== "string") throw new Error("--artifact-db and --trace-id are required");
  const limit = numberArg(args, "limit", 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("--limit must be an integer between 1 and 500");
  const ledger = new SQLiteAgentArtifactLedger(path);
  try { json(await ledger.query({ traceId, symbol: typeof args.symbol === "string" ? args.symbol : undefined, stage: typeof args.stage === "string" ? args.stage : undefined, limit })); }
  finally { ledger.close(); }
}

async function runReview(args: Args): Promise<void> {
  const path = args["artifact-db"]; const traceId = typeof args["trace-id"] === "string" ? args["trace-id"] : undefined; const orderId = typeof args["order-id"] === "string" ? args["order-id"] : undefined;
  if (typeof path !== "string" || (!traceId && !orderId)) throw new Error("--artifact-db and either --trace-id or --order-id are required");
  const ledger = new SQLiteAgentArtifactLedger(path);
  try {
    const initial = await ledger.query({ traceId, orderId, limit: 500 });
    const resolvedTraceId = traceId ?? initial[0]?.traceId;
    const artifacts = resolvedTraceId ? await ledger.query({ traceId: resolvedTraceId, symbol: typeof args.symbol === "string" ? args.symbol : undefined, limit: 500 }) : [];
    const review = buildTradeReview(artifacts, orderId);
    if (args.json === true) json(review ?? { status: "not_found", orderId, traceId }); else console.log(renderTradeReview(review));
  } finally { ledger.close(); }
}

async function runPreflight(args: Args): Promise<void> {
  const paperDb = args["paper-db"];
  const accountId = args["account-id"];
  if (typeof paperDb !== "string" || typeof accountId !== "string") usage();
  const safetyPath = typeof args["safety-db"] === "string" ? args["safety-db"] : `${paperDb}.safety.db`;
  if (existsSync(safetyPath)) {
    const store = new SQLiteRuntimeSafetyStore(safetyPath);
    try {
      const state = await store.load(accountId);
      if (state?.cooldownUntil && state.cooldownUntil.getTime() > Date.now()) {
        json({ allowed: false, reason: "safety_cooldown", cooldownUntil: state.cooldownUntil });
        return;
      }
    } finally { store.close(); }
  }
  console.log("Preflight: running read-only data-quality and decision pipeline.");
  await runPaperCycle({ ...args, "execution-enabled": false });
}

async function runPaperWatch(args: Args): Promise<void> {
  if (args.cycles === undefined) throw new Error("--cycles is required for paper-watch; bounded runs are mandatory");
  const cycles = numberArg(args, "cycles", 0);
  const intervalSeconds = numberArg(args, "interval-seconds", 60);
  const paperDb = args["paper-db"];
  const accountId = args["account-id"];
  if (typeof paperDb !== "string" || typeof accountId !== "string") usage();
  const safetyStore = new SQLiteRuntimeSafetyStore(typeof args["safety-db"] === "string" ? args["safety-db"] : `${paperDb}.safety.db`);
  const guard = new PaperSafetyGuard(accountId, safetyStore, { maxConsecutiveFailures: numberArg(args, "max-consecutive-failures", 3), cooldownMs: numberArg(args, "cooldown-seconds", 300) * 1_000, maxExecutionsPerCycle: numberArg(args, "max-executions-per-cycle", 1) });
  try {
    const report = await new SequentialCycleRunner().run({ cycles, intervalMs: intervalSeconds * 1_000, executionEnabled: args["execution-enabled"] === true, continueOnError: args["continue-on-error"] === true }, async () => {
      const decision = await guard.beforeCycle();
      if (!decision.allowed) throw new Error(`safety blocked: ${decision.reason}; cooldown until ${decision.state.cooldownUntil?.toISOString()}`);
      try {
        await runPaperCycle(args);
        await guard.recordSuccess();
      } catch (error) {
        await guard.recordFailure(error);
        throw error;
      }
    });
    json(report);
  } finally { safetyStore.close(); }
}

function openTrace(args: Args): { sink: SQLiteTraceSink; traceId: string } {
  if (typeof args["trace-db"] !== "string") throw new Error("--trace-db is required");
  const sink = new SQLiteTraceSink(args["trace-db"]);
  const traceId = typeof args["trace-id"] === "string" ? args["trace-id"] : sink.latestTraceId();
  if (!traceId) { sink.close(); throw new Error("no trace found in SQLite database"); }
  return { sink, traceId };
}

async function runTrace(args: Args): Promise<void> {
  const { sink, traceId } = openTrace(args);
  try {
    const allEvents = sink.load(traceId);
    const stage = typeof args.stage === "string" ? args.stage : undefined;
    json({ summary: summarizeTrace(allEvents), filters: { stage }, events: filterTraceEvents(allEvents, stage) });
  } finally { sink.close(); }
}

async function runStatus(args: Args): Promise<void> {
  const { sink, traceId } = openTrace(args);
  try { json({ latestTraceId: traceId, summary: summarizeTrace(sink.load(traceId)) }); }
  finally { sink.close(); }
}

async function runReconcile(args: Args): Promise<void> {
  if (typeof args["paper-db"] !== "string" || typeof args["account-id"] !== "string") throw new Error("--paper-db and --account-id are required");
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error("BINANCE_API_KEY and BINANCE_API_SECRET are required for read-only reconciliation");
  const store = new SQLitePaperAccountStore(args["paper-db"]);
  try {
    const local = await store.load(args["account-id"]);
    if (!local) throw new Error(`paper account not found: ${args["account-id"]}`);
    const remote = new BinanceFuturesReadClient(undefined, { apiKey, apiSecret });
    const report = await new ReconciliationService().reconcile(args["account-id"], local, remote);
    json(report);
    if (args["fail-on-drift"] === true && report.hasDrift) process.exitCode = 3;
  } finally { store.close(); }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "backtest";
  const args = parseArgs(command === "backtest" && argv[0]?.startsWith("--") ? argv : argv.slice(1));
  if (command === "backtest") return runBacktest(args);
  if (command === "experiment") return runExperiment(args);
  if (command === "walk-forward") return runWalkForward(args);
  if (command === "paper-cycle") return runPaperCycle(args);
  if (command === "dashboard") return runDashboard(args);
  if (command === "dashboard-watch") return runDashboardWatch(args);
  if (command === "journal") return runJournal(args);
  if (command === "profile") return runProfile(args);
  if (command === "artifacts") return runArtifacts(args);
  if (command === "review") return runReview(args);
  if (command === "doctor") return runDoctor(args);
  if (command === "preflight") return runPreflight(args);
  if (command === "paper-watch") return runPaperWatch(args);
  if (command === "trace") return runTrace(args);
  if (command === "status") return runStatus(args);
  if (command === "reconcile") return runReconcile(args);
  usage();
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
