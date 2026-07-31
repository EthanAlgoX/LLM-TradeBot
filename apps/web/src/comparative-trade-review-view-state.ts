export type ComparativeTradeReviewViewMode =
  | "loading"
  | "comparison"
  | "insufficient"
  | "candidate"
  | "reviewed"
  | "unavailable";

export interface ComparativeTradeReviewViewState {
  mode: ComparativeTradeReviewViewMode;
  readOnlyEvidence: true;
  causalClaim: false;
  runtimeApplied: false;
  exchangeWriteAllowed: false;
  reviewAllowed: boolean;
}

export function deriveComparativeTradeReviewViewState(input?: {
  loading?: boolean;
  available?: boolean;
  insufficient?: boolean;
  candidateAvailable?: boolean;
  reviewed?: boolean;
  unavailable?: boolean;
}): ComparativeTradeReviewViewState {
  let mode: ComparativeTradeReviewViewMode = "unavailable";
  if (input?.loading) mode = "loading";
  else if (input?.reviewed) mode = "reviewed";
  else if (input?.candidateAvailable && input.available) mode = "candidate";
  else if (input?.available) mode = "comparison";
  else if (input?.insufficient) mode = "insufficient";
  else if (input?.unavailable) mode = "unavailable";
  return {
    mode,
    readOnlyEvidence: true,
    causalClaim: false,
    runtimeApplied: false,
    exchangeWriteAllowed: false,
    reviewAllowed: mode === "candidate",
  };
}

