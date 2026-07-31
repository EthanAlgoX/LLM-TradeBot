export type LessonCandidateValidationViewMode =
  | "not_reviewed"
  | "candidate_closed"
  | "accepted_for_validation"
  | "validation_unavailable"
  | "validation_failed"
  | "validation_passed"
  | "stale"
  | "unavailable";

export interface LessonCandidateValidationViewState {
  mode: LessonCandidateValidationViewMode;
  contractValidationPassed: boolean;
  backtestAvailable: boolean;
  readOnly: true;
  runtimeApplied: false;
  exchangeWriteAllowed: false;
}

export function deriveLessonCandidateValidationViewState(input?: {
  lifecycleStatus?: Exclude<LessonCandidateValidationViewMode, "unavailable">;
}): LessonCandidateValidationViewState {
  const mode = input?.lifecycleStatus ?? "unavailable";
  return {
    mode,
    contractValidationPassed: mode === "validation_passed",
    backtestAvailable: mode === "validation_passed",
    readOnly: true,
    runtimeApplied: false,
    exchangeWriteAllowed: false,
  };
}
