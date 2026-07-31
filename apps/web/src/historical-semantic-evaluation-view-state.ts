export type HistoricalSemanticEvaluationViewState =
  | "loading"
  | "stale"
  | "contract_validated"
  | "backtest_passed"
  | "walk_forward_passed"
  | "approval_ready"
  | "approved_not_applied"
  | "unavailable";

export function deriveHistoricalSemanticEvaluationViewState(input: {
  loading?: boolean;
  unavailable?: boolean;
  lifecycleStatus?: Exclude<HistoricalSemanticEvaluationViewState, "loading" | "unavailable">;
}): HistoricalSemanticEvaluationViewState {
  if (input.loading) return "loading";
  if (input.unavailable || !input.lifecycleStatus) return "unavailable";
  return input.lifecycleStatus;
}
