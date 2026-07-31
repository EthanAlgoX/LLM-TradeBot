export type ConversationViewState =
  | "loading"
  | "proposal"
  | "validation_failed"
  | "evidence_required"
  | "approval_ready"
  | "unavailable";

export function deriveConversationViewState(input: {
  busy: boolean;
  responseStatus?: Exclude<ConversationViewState, "loading">;
  unavailable: boolean;
}): ConversationViewState {
  if (input.busy) return "loading";
  if (input.responseStatus) return input.responseStatus;
  return input.unavailable ? "unavailable" : "proposal";
}
