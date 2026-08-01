export type ConversationViewState =
  | "loading"
  | "empty"
  | "ready"
  | "proposal"
  | "validation_failed"
  | "evidence_required"
  | "approval_ready"
  | "unavailable"
  | "offline"
  | "unauthorized"
  | "error";

export function deriveConversationViewState(input: {
  busy: boolean;
  responseStatus?: Extract<ConversationViewState, "proposal" | "validation_failed" | "evidence_required" | "approval_ready" | "unavailable">;
  unavailable: boolean;
  hasTurns?: boolean;
  unauthorized?: boolean;
  failed?: boolean;
}): ConversationViewState {
  if (input.busy) return "loading";
  if (input.responseStatus) return input.responseStatus;
  if (input.unauthorized) return "unauthorized";
  if (input.unavailable) return "offline";
  if (input.failed) return "error";
  return input.hasTurns ? "ready" : "empty";
}
