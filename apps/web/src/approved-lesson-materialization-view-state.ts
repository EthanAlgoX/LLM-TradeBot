export function deriveApprovedLessonMaterializationViewState(input: {
  lifecycleStatus?:
    | "not_approved"
    | "semantic_facts_unavailable"
    | "stale"
    | "expired"
    | "revoked"
    | "materialized";
  shadowStatus?: "unavailable" | "stale" | "validated";
}) {
  return {
    mode: input.lifecycleStatus ?? "unavailable",
    shadowMode: input.shadowStatus ?? "unavailable",
    decisionContextApplied: false as const,
    runtimeApplied: false as const,
  };
}
