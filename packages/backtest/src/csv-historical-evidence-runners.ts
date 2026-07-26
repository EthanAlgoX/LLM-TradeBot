import {
  type BacktestReport,
  type ExperimentParameters,
  type ParameterGrid,
  type WalkForwardPlan,
} from "../../contracts/src/index.js";
import {
  CsvHistoricalCandleSource,
  HistoricalDataSyncAgent,
  HistoricalSelectorMetricsPort,
  MarketOpportunitySelectorAgent,
  SimulatedExecutionAgent,
} from "../../adapters/src/index.js";
import {
  RuleAnalysisPipelineAgent,
  RuleBearCaseAgent,
  RuleBullCaseAgent,
  RuleDataQualityGate,
  RuleDecisionAgent,
  RulePositionMonitorAgent,
  RuleReflectionAgent,
  RuleRiskAgent,
  SingleBestPortfolioAgent,
} from "../../agents/src/index.js";
import { DecisionPipeline } from "../../core/src/index.js";
import {
  createRunManifest,
  experimentBaseFromProfile,
  loadStrategyProfile,
  resolveStrategyProfile,
  sha256File,
  strategyProfileFingerprint,
  validateOptimizationGrid,
  validateOptimizationParameters,
} from "../../config/src/index.js";
import type {
  HistoricalEvidenceRunPlan,
  HistoricalEvidenceRunnerResult,
} from "../../contracts/src/index.js";
import type { RegisteredHistoricalEvidenceRunner } from "../../runtime/src/registered-historical-evidence-executor.js";
import { PipelineBacktestService } from "./backtest-service.js";
import { stableFingerprint } from "./experiment-service.js";
import { DeterministicWalkForwardValidator } from "./walk-forward-service.js";

const optimizationParameterKeys = [
  "initialCash",
  "feeBps",
  "slippageBps",
  "perTradeNotional",
  "minQuoteVolume",
  "minPrice",
  "minTrendStrength",
  "maxVolatilityPct",
] as const;

export interface CsvHistoricalEvidenceRunnerConfig {
  csvPath: string;
  symbols: readonly string[];
  profilePath: string;
  dataSourceRef?: string;
  start?: Date;
  end?: Date;
  walkForwardGrid: ParameterGrid;
  walkForwardPlan: WalkForwardPlan;
  maxTrials?: number;
}

function experimentNumber(
  parameters: ExperimentParameters,
  name: string,
  fallback: number,
): number {
  const value = parameters[name];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`experiment parameter ${name} must be a finite number`);
  }
  return value;
}

function jsonPayload(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

export async function createCsvHistoricalEvidenceRunners(
  config: CsvHistoricalEvidenceRunnerConfig,
): Promise<readonly RegisteredHistoricalEvidenceRunner[]> {
  if (config.symbols.length === 0) {
    throw new Error("CSV historical evidence requires at least one symbol.");
  }
  if (
    (config.start && Number.isNaN(config.start.getTime())) ||
    (config.end && Number.isNaN(config.end.getTime())) ||
    (config.start && config.end && config.start > config.end)
  ) {
    throw new Error("CSV historical evidence time range is invalid.");
  }

  const loadedProfile = await loadStrategyProfile(config.profilePath);
  const profile = resolveStrategyProfile(loadedProfile);
  if (profile.llm.enabled) {
    throw new Error(
      "Historical evidence runners are deterministic rule-only; profile.llm.enabled must be false.",
    );
  }
  const profileFingerprint = strategyProfileFingerprint(profile);
  const strategyProfileRef = `${profile.profileId}@${profile.profileVersion}:${profileFingerprint}`;
  const dataFingerprint = await sha256File(config.csvPath);
  const source = await CsvHistoricalCandleSource.fromFile(config.csvPath);
  const timelineBars = await source.loadBars(config.symbols[0]!, "5m");
  const timeline = timelineBars
    .map((bar) => bar.closeTime)
    .filter(
      (asOf) =>
        (!config.start || asOf >= config.start) &&
        (!config.end || asOf <= config.end),
    );
  if (timeline.length === 0) {
    throw new Error(
      "Trusted CSV must contain 5m candles for the first registered symbol and time range.",
    );
  }

  const base = experimentBaseFromProfile(profile);
  const walkForwardGrid = validateOptimizationGrid(config.walkForwardGrid);
  const dataSourceRef =
    config.dataSourceRef ?? "data-source:csv-historical@1.0.0";
  const requestedAsOf = timeline.at(-1)!.toISOString();
  const costModel = {
    feeBps: profile.execution.feeBps,
    slippageBps: profile.execution.slippageBps,
  };

  async function verifiedSource(plan: HistoricalEvidenceRunPlan) {
    const currentFingerprint = await sha256File(config.csvPath);
    if (
      currentFingerprint !== dataFingerprint ||
      plan.dataFingerprint !== dataFingerprint
    ) {
      throw new Error(
        "Trusted CSV content fingerprint changed after runner registration.",
      );
    }
    const currentSource = await CsvHistoricalCandleSource.fromFile(
      config.csvPath,
    );
    const currentTimeline = (
      await currentSource.loadBars(config.symbols[0]!, "5m")
    )
      .map((bar) => bar.closeTime)
      .filter(
        (asOf) =>
          asOf <= new Date(plan.requestedAsOf) &&
          (!config.start || asOf >= config.start) &&
          (!config.end || asOf <= config.end),
      );
    if (currentTimeline.length === 0) {
      throw new Error("No trusted CSV cycles remain inside the Run Plan.");
    }
    return { source: currentSource, asOf: currentTimeline };
  }

  function runTrial(
    currentSource: CsvHistoricalCandleSource,
    parameters: ExperimentParameters,
    trialId: string,
    asOf: readonly Date[],
  ): Promise<BacktestReport> {
    const merged = { ...base, ...parameters };
    const initialCash = experimentNumber(
      merged,
      "initialCash",
      profile.execution.initialCash,
    );
    const executor = new SimulatedExecutionAgent({
      initialCash,
      feeBps: experimentNumber(
        merged,
        "feeBps",
        profile.execution.feeBps,
      ),
      slippageBps: experimentNumber(
        merged,
        "slippageBps",
        profile.execution.slippageBps,
      ),
    });
    const application = new DecisionPipeline({
      selector: new MarketOpportunitySelectorAgent(
        new HistoricalSelectorMetricsPort(currentSource),
        {
          candidates: [...config.symbols],
          ...profile.selector,
          minQuoteVolume24h: experimentNumber(
            merged,
            "minQuoteVolume",
            profile.selector.minQuoteVolume24h,
          ),
          minPrice: experimentNumber(
            merged,
            "minPrice",
            profile.selector.minPrice,
          ),
          minTrendStrength: experimentNumber(
            merged,
            "minTrendStrength",
            profile.selector.minTrendStrength,
          ),
          maxVolatilityPct: experimentNumber(
            merged,
            "maxVolatilityPct",
            profile.selector.maxVolatilityPct,
          ),
        },
      ),
      dataSync: new HistoricalDataSyncAgent(currentSource),
      dataQuality: new RuleDataQualityGate(profile.dataQuality),
      analysis: new RuleAnalysisPipelineAgent(),
      bullCase: new RuleBullCaseAgent(),
      bearCase: new RuleBearCaseAgent(),
      decision: new RuleDecisionAgent({
        ...profile.decision,
        perTradeNotional: experimentNumber(
          merged,
          "perTradeNotional",
          profile.decision.perTradeNotional,
        ),
      }),
      portfolio: new SingleBestPortfolioAgent(),
      risk: new RuleRiskAgent(profile.risk),
      execution: executor,
      positionState: executor,
      positionMonitor: new RulePositionMonitorAgent(),
      reflection: new RuleReflectionAgent(),
      tradeHistory: executor,
    });
    return new PipelineBacktestService(application, executor).run({
      schemaVersion: "v1",
      runId: `${trialId}:${new Date().toISOString()}`,
      datasetId: dataSourceRef,
      strategyId: profile.profileId,
      configVersion: `${profileFingerprint}:${stableFingerprint(merged)}`,
      asOf: [...asOf],
      symbols: [...config.symbols],
      executionEnabled: true,
      initialCash,
    });
  }

  const common = {
    strategyProfileRef,
    dataSourceRef,
    dataFingerprint,
    timezone: "UTC",
    tradingCalendarRef: "calendar:crypto-24x7@1.0.0",
    costModel,
    requestedAsOf: () => requestedAsOf,
  };

  const backtestRunner: RegisteredHistoricalEvidenceRunner = {
    ...common,
    runnerId: "historical-runner:csv-backtest@1.0.0",
    kind: "backtest",
    allowedParameterKeys: optimizationParameterKeys,
    async run(plan): Promise<HistoricalEvidenceRunnerResult> {
      const parameters = validateOptimizationParameters(plan.parameters);
      const verified = await verifiedSource(plan);
      const report = await runTrial(
        verified.source,
        parameters,
        plan.runPlanId,
        verified.asOf,
      );
      const manifest = createRunManifest({
        runId: report.runId,
        runMode: "backtest",
        createdAt: new Date(),
        strategyId: report.strategyId,
        profileVersion: profile.profileVersion,
        configFingerprint: report.configVersion,
        dataSource: {
          kind: "csv",
          identifier: dataSourceRef,
          contentFingerprint: dataFingerprint,
        },
        symbols: [...config.symbols],
        timeRange: {
          start: verified.asOf[0],
          end: verified.asOf.at(-1),
        },
      });
      return {
        schemaVersion: "1.0.0",
        metrics: {
          totalReturnPct: report.performance.totalReturnPct,
          maxDrawdownPct: report.performance.maxDrawdownPct,
          closedTradeCount: report.tradeStatistics.closedTradeCount,
          winRatePct: report.tradeStatistics.winRatePct,
          fees: report.performance.fees,
          cycleCount: report.diagnostics.cycleCount,
          decisionCount: report.diagnostics.decisionCount,
          filledOrderCount: report.diagnostics.filledOrderCount,
        },
        summary: `CSV backtest completed ${report.diagnostics.cycleCount} production DecisionPipeline cycles.`,
        observations: [
          `dataset=${dataSourceRef}`,
          `profile=${strategyProfileRef}`,
          `dataFingerprint=${dataFingerprint}`,
        ],
        payload: jsonPayload({ manifest, report }),
      };
    },
  };

  const walkForwardRunner: RegisteredHistoricalEvidenceRunner = {
    ...common,
    runnerId: "historical-runner:csv-walk-forward@1.0.0",
    kind: "walk_forward",
    allowedParameterKeys: [],
    async run(plan): Promise<HistoricalEvidenceRunnerResult> {
      const verified = await verifiedSource(plan);
      const validator = new DeterministicWalkForwardValidator(
        (parameters, trialId, asOf) =>
          runTrial(verified.source, parameters, trialId, asOf),
        config.maxTrials ?? 128,
      );
      const report = await validator.run({
        schemaVersion: "v1",
        runId: plan.runPlanId,
        datasetId: dataSourceRef,
        strategyId: profile.profileId,
        configFingerprint: `${profileFingerprint}:${stableFingerprint(base)}`,
        profileVersion: profile.profileVersion,
        asOf: [...verified.asOf],
        grid: walkForwardGrid,
        plan: config.walkForwardPlan,
      });
      const manifest = createRunManifest({
        runId: report.runId,
        runMode: "backtest",
        createdAt: new Date(),
        strategyId: report.strategyId,
        profileVersion: profile.profileVersion,
        configFingerprint: report.configFingerprint,
        dataSource: {
          kind: "csv",
          identifier: dataSourceRef,
          contentFingerprint: dataFingerprint,
        },
        symbols: [...config.symbols],
        timeRange: {
          start: verified.asOf[0],
          end: verified.asOf.at(-1),
        },
      });
      return {
        schemaVersion: "1.0.0",
        metrics: {
          foldCount: report.folds.length,
          averageReturnPct: report.outOfSample.averageReturnPct,
          worstDrawdownPct: report.outOfSample.worstDrawdownPct,
          closedTradeCount: report.outOfSample.closedTradeCount,
          averageWinRatePct: report.outOfSample.averageWinRatePct,
          distinctParameterCount:
            report.parameterStability.distinctParameterCount,
        },
        summary: `CSV walk-forward completed ${report.folds.length} out-of-sample folds through isolated production DecisionPipeline trials.`,
        observations: [
          `dataset=${dataSourceRef}`,
          `profile=${strategyProfileRef}`,
          `dataFingerprint=${dataFingerprint}`,
        ],
        payload: jsonPayload({ manifest, report }),
      };
    },
  };

  return [backtestRunner, walkForwardRunner];
}
