import {
  BacktestExperimentReportSchema,
  BacktestExperimentRequestSchema,
  type BacktestExperimentReport,
  type BacktestExperimentRequest,
  type BacktestExperimentTrial,
  type BacktestReport,
  type ExperimentParameters,
  type ParameterGrid,
} from "../../contracts/src/index.js";

export type BacktestTrialRunner = (parameters: ExperimentParameters, trialId: string) => Promise<BacktestReport>;

/** Deterministic, finite experiment runner. The supplied runner must create isolated application/account state per call. */
export class DeterministicGridSearch {
  constructor(private readonly runTrial: BacktestTrialRunner, private readonly maxTrials = 128) {}

  async run(rawRequest: BacktestExperimentRequest): Promise<BacktestExperimentReport> {
    const request = BacktestExperimentRequestSchema.parse(rawRequest);
    const combinations = enumerateGrid(request.grid);
    if (combinations.length > this.maxTrials) throw new Error(`parameter grid yields ${combinations.length} trials; limit is ${this.maxTrials}`);
    const trials = await Promise.all(combinations.map(async (parameters, index) => this.toTrial(parameters, `trial:${index + 1}`, await this.runTrial(parameters, `trial:${index + 1}`))));
    const baseline = request.baseline
      ? await this.toTrial(request.baseline, "baseline", await this.runTrial(request.baseline, "baseline"))
      : undefined;
    const withBaseline = trials.map((trial) => baseline ? {
      ...trial,
      baselineDelta: {
        totalReturnPct: trial.totalReturnPct - baseline.totalReturnPct,
        maxDrawdownPct: trial.maxDrawdownPct - baseline.maxDrawdownPct,
        closedTradeCount: trial.closedTradeCount - baseline.closedTradeCount,
      },
    } : trial);
    return BacktestExperimentReportSchema.parse({
      schemaVersion: "v1", experimentId: request.experimentId, datasetId: request.datasetId, strategyId: request.strategyId, configFingerprint: request.configFingerprint, profileVersion: request.profileVersion,
      baseline,
      trials: withBaseline.sort(compareTrials),
    });
  }

  private toTrial(parameters: ExperimentParameters, trialId: string, report: BacktestReport): BacktestExperimentTrial { return summarizeBacktestTrial(parameters, trialId, report); }
}

export function summarizeBacktestTrial(parameters: ExperimentParameters, trialId: string, report: BacktestReport): BacktestExperimentTrial {
  const decisions = report.diagnostics.decisionCount;
  const rejected = report.cycles.flatMap((cycle) => cycle.executions).filter((execution) => execution.status === "rejected").length;
  const feePct = report.performance.initialCash === 0 ? 0 : report.performance.fees / report.performance.initialCash * 100;
  return {
    trialId, parameters, parameterFingerprint: stableFingerprint(parameters), totalReturnPct: report.performance.totalReturnPct,
    maxDrawdownPct: report.performance.maxDrawdownPct, closedTradeCount: report.tradeStatistics.closedTradeCount,
    winRatePct: report.tradeStatistics.winRatePct, fees: report.performance.fees,
    rejectedActionRatePct: decisions === 0 ? 0 : rejected / decisions * 100,
    score: report.performance.totalReturnPct - report.performance.maxDrawdownPct * 0.5 - feePct * 0.1,
  };
}

export function enumerateGrid(grid: ParameterGrid): ExperimentParameters[] {
  const entries = Object.entries(grid).sort(([left], [right]) => left.localeCompare(right));
  return entries.reduce<ExperimentParameters[]>((combinations, [key, values]) => combinations.flatMap((existing) => values.map((value) => ({ ...existing, [key]: value }))), [{}]);
}

export function stableFingerprint(parameters: ExperimentParameters): string {
  return JSON.stringify(Object.fromEntries(Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right))));
}

function compareTrials(left: BacktestExperimentTrial, right: BacktestExperimentTrial): number {
  return right.score - left.score
    || left.maxDrawdownPct - right.maxDrawdownPct
    || right.totalReturnPct - left.totalReturnPct
    || left.parameterFingerprint.localeCompare(right.parameterFingerprint);
}
