import {
  ExperimentCreateRequestSchema,
  type Experiment,
  type ExperimentCatalog,
  type ExperimentCreateRequest,
} from "../../../packages/contracts/src/index.js";

export type ExperimentAction =
  | "backtest"
  | "walk-forward"
  | "replay"
  | "candidate";

export interface ExperimentFormState {
  datasetId: string;
  walkForwardPlanId: string;
  comparisonMode: ExperimentCreateRequest["comparisonMode"];
  maxDrawdownPctLte?: number;
  minimumTradeCount?: number;
  walkForwardPositive?: true;
  runtimeFailureCountEqZero?: true;
  idempotencyKey: string;
}

export function boundedSeries<T>(
  points: readonly T[],
  maximumPoints = 120,
): T[] {
  if (maximumPoints < 2) throw new Error("SERIES_BOUND_INVALID");
  if (points.length <= maximumPoints) return [...points];
  return Array.from({ length: maximumPoints }, (_, index) =>
    points[
      Math.round((index * (points.length - 1)) / (maximumPoints - 1))
    ]!,
  );
}

export function createExperimentFormState(
  catalog: ExperimentCatalog,
  idempotencyKey: string,
  previous?: ExperimentFormState,
): ExperimentFormState {
  const datasetId = catalog.datasets.some(
    (dataset) => dataset.id === previous?.datasetId,
  )
    ? previous!.datasetId
    : (catalog.datasets[0]?.id ?? "");
  const walkForwardPlanId = catalog.walkForwardPlans.some(
    (plan) => plan.id === previous?.walkForwardPlanId,
  )
    ? previous!.walkForwardPlanId
    : (catalog.walkForwardPlans[0]?.id ?? "");
  const comparisonMode = catalog.supportedComparisonModes.includes(
    previous?.comparisonMode ?? "STRATEGY_COMPARISON",
  )
    ? (previous?.comparisonMode ?? "STRATEGY_COMPARISON")
    : catalog.supportedComparisonModes[0]!;
  return {
    ...previous,
    datasetId,
    walkForwardPlanId,
    comparisonMode,
    idempotencyKey: previous?.idempotencyKey || idempotencyKey,
  };
}

export function buildExperimentCreateRequest(
  catalog: ExperimentCatalog,
  form: ExperimentFormState,
  participantVersionIds: readonly string[],
): ExperimentCreateRequest {
  const dataset = catalog.datasets.find(
    (candidate) => candidate.id === form.datasetId,
  );
  if (!dataset) throw new Error("EXPERIMENT_DATASET_NOT_SELECTED");
  return ExperimentCreateRequestSchema.parse({
    schemaVersion: "1.0.0",
    idempotencyKey: form.idempotencyKey,
    participantVersionIds: [...participantVersionIds],
    datasetId: dataset.id,
    startAt: dataset.startAt,
    endAt: dataset.endAt,
    walkForwardPlanId: form.walkForwardPlanId,
    comparisonMode: form.comparisonMode,
    objective: { kind: "maximize_total_return" },
    constraints: {
      ...(form.maxDrawdownPctLte === undefined
        ? {}
        : { maxDrawdownPctLte: form.maxDrawdownPctLte }),
      ...(form.minimumTradeCount === undefined
        ? {}
        : { minimumTradeCount: form.minimumTradeCount }),
      ...(form.walkForwardPositive
        ? { walkForwardPositive: true as const }
        : {}),
      ...(form.runtimeFailureCountEqZero
        ? { runtimeFailureCountEqZero: true as const }
        : {}),
    },
  });
}

export function experimentActionEnabled(
  experiment: Experiment,
  action: ExperimentAction,
): boolean {
  if (experiment.comparability.status === "INCOMPATIBLE") return false;
  if (action === "backtest") {
    return (
      experiment.lifecycleStatus === "draft" ||
      experiment.lifecycleStatus === "backtest_partial"
    );
  }
  if (action === "walk-forward") {
    return (
      experiment.lifecycleStatus === "backtest_complete" ||
      experiment.lifecycleStatus === "walk_forward_partial"
    );
  }
  if (action === "replay") {
    return (
      (experiment.lifecycleStatus === "evidence_complete" ||
        experiment.lifecycleStatus === "candidate_ready") &&
      !experiment.replay
    );
  }
  return (
    experiment.lifecycleStatus === "evidence_complete" &&
    experiment.comparability.status === "CONTROLLED" &&
    !experiment.candidate
  );
}

export function mergeExperimentList(
  current: readonly Experiment[],
  incoming: readonly Experiment[],
): Experiment[] {
  const byId = new Map(current.map((experiment) => [experiment.experimentId, experiment]));
  for (const experiment of incoming) byId.set(experiment.experimentId, experiment);
  return [...byId.values()].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.experimentId.localeCompare(left.experimentId),
  );
}

export function acceptsExperimentResponse(input: {
  currentEpoch: number;
  responseEpoch: number;
  selectedExperimentId?: string;
  requestedExperimentId: string;
}): boolean {
  return (
    input.currentEpoch === input.responseEpoch &&
    input.selectedExperimentId === input.requestedExperimentId
  );
}
