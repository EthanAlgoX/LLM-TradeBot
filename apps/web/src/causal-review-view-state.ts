export type CausalReviewViewMode =
  | "loading"
  | "active"
  | "recent"
  | "partial"
  | "unavailable";

export interface CausalReviewViewState {
  mode: CausalReviewViewMode;
  dataTone: "runtime" | "sample";
  readOnly: true;
  runtimeApplied: false;
  tradeMode:
    | "none"
    | "active_position"
    | "closed_trade"
    | "partial_evidence"
    | "unavailable";
}

export function deriveCausalReviewViewState(input?: {
  evidenceStatus?: "active" | "recent" | "partial" | "unavailable";
  dataClass?: "runtime" | "sample";
  loading?: boolean;
  failed?: boolean;
  tradeLifecycleStatus?:
    | "active_position"
    | "closed_trade"
    | "partial_evidence"
    | "unavailable";
}): CausalReviewViewState {
  return {
    mode:
      input?.loading
        ? "loading"
        : input?.failed
          ? "unavailable"
          : input?.evidenceStatus ?? "unavailable",
    dataTone: input?.dataClass ?? "runtime",
    readOnly: true,
    runtimeApplied: false,
    tradeMode: input?.tradeLifecycleStatus ?? "none",
  };
}
