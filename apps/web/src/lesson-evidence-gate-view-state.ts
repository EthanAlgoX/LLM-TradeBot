export type LessonEvidenceGateMode =
  | "binding_required"
  | "evidence_unavailable"
  | "backtest_required"
  | "walk_forward_required"
  | "approval_required"
  | "stale"
  | "unavailable";

export function deriveLessonEvidenceGateViewState(input: {
  lifecycleStatus?: Exclude<LessonEvidenceGateMode, "unavailable">;
  allowedAction?: "run_backtest" | "run_walk_forward" | "none";
}) {
  return {
    mode: input.lifecycleStatus ?? "unavailable",
    action: input.allowedAction ?? "none",
    runtimeApplied: false as const,
  };
}
