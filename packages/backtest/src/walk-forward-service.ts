import {
  WalkForwardReportSchema,
  WalkForwardRequestSchema,
  type BacktestExperimentTrial,
  type BacktestReport,
  type ExperimentParameters,
  type WalkForwardFold,
  type WalkForwardPlan,
  type WalkForwardReport,
  type WalkForwardRequest,
} from "../../contracts/src/index.js";
import { DeterministicGridSearch, summarizeBacktestTrial } from "./experiment-service.js";

export interface WalkForwardWindow { readonly trainingStart: number; readonly trainingEnd: number; readonly validationStart: number; readonly validationEnd: number; }
export type ScopedBacktestTrialRunner = (parameters: ExperimentParameters, trialId: string, asOf: readonly Date[]) => Promise<BacktestReport>;

/** Selects on historical training windows and evaluates only on following out-of-sample windows. */
export class DeterministicWalkForwardValidator {
  constructor(private readonly runTrial: ScopedBacktestTrialRunner, private readonly maxTrials = 128) {}

  async run(rawRequest: WalkForwardRequest): Promise<WalkForwardReport> {
    const request = WalkForwardRequestSchema.parse(rawRequest);
    const windows = buildWalkForwardWindows(request.asOf.length, request.plan);
    if (windows.length === 0) throw new Error("walk-forward plan produces no complete validation fold");
    const folds: WalkForwardFold[] = [];
    for (const [index, window] of windows.entries()) {
      const foldId = `fold:${index + 1}`;
      const trainingAsOf = request.asOf.slice(window.trainingStart, window.trainingEnd);
      const validationAsOf = request.asOf.slice(window.validationStart, window.validationEnd);
      const grid = await new DeterministicGridSearch((parameters, trialId) => this.runTrial(parameters, `${foldId}:train:${trialId}`, trainingAsOf), this.maxTrials).run({
        schemaVersion: "v1", experimentId: `${request.runId}:${foldId}:train`, datasetId: request.datasetId, strategyId: request.strategyId, configFingerprint: request.configFingerprint, profileVersion: request.profileVersion, grid: request.grid,
      });
      const selected = grid.trials[0]!;
      const validationReport = await this.runTrial(selected.parameters, `${foldId}:validation`, validationAsOf);
      const validation = summarizeBacktestTrial(selected.parameters, `${foldId}:validation`, validationReport);
      folds.push({
        foldId,
        trainingStart: trainingAsOf[0]!, trainingEnd: trainingAsOf.at(-1)!, validationStart: validationAsOf[0]!, validationEnd: validationAsOf.at(-1)!,
        selected, validation,
      });
    }
    const selections = folds.reduce<Record<string, number>>((result, fold) => ({ ...result, [fold.selected.parameterFingerprint]: (result[fold.selected.parameterFingerprint] ?? 0) + 1 }), {});
    const sortedSelections = Object.entries(selections).sort(([left], [right]) => left.localeCompare(right)).sort((left, right) => right[1] - left[1]);
    return WalkForwardReportSchema.parse({
      schemaVersion: "v1", runId: request.runId, datasetId: request.datasetId, strategyId: request.strategyId, configFingerprint: request.configFingerprint, profileVersion: request.profileVersion, plan: request.plan, folds,
      outOfSample: {
        averageReturnPct: folds.reduce((sum, fold) => sum + fold.validation.totalReturnPct, 0) / folds.length,
        worstDrawdownPct: Math.max(...folds.map((fold) => fold.validation.maxDrawdownPct)),
        closedTradeCount: folds.reduce((sum, fold) => sum + fold.validation.closedTradeCount, 0),
        averageWinRatePct: folds.reduce((sum, fold) => sum + fold.validation.winRatePct, 0) / folds.length,
      },
      parameterStability: { distinctParameterCount: Object.keys(selections).length, mostSelectedFingerprint: sortedSelections[0]?.[0], selections },
    });
  }
}

export function buildWalkForwardWindows(totalCycles: number, plan: WalkForwardPlan): WalkForwardWindow[] {
  const windows: WalkForwardWindow[] = [];
  for (let trainingStart = 0, trainingEnd = plan.trainingCycles; trainingEnd + plan.validationCycles <= totalCycles; trainingStart += plan.stepCycles, trainingEnd += plan.stepCycles) {
    windows.push({ trainingStart: plan.mode === "expanding" ? 0 : trainingStart, trainingEnd, validationStart: trainingEnd, validationEnd: trainingEnd + plan.validationCycles });
  }
  return windows;
}
