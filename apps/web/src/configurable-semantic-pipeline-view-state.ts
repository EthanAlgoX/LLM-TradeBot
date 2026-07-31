export type SemanticPipelinePreviewViewState =
  | "loading"
  | "ready"
  | "validation_failed"
  | "execution_required"
  | "unavailable";

export function deriveSemanticPipelinePreviewViewState(input: {
  loading?: boolean;
  unavailable?: boolean;
  lifecycleStatus?: "ready" | "validation_failed";
  nextGate?: "configuration_validation" | "registered_semantic_input_execution";
}): SemanticPipelinePreviewViewState {
  if (input.loading) return "loading";
  if (input.unavailable) return "unavailable";
  if (input.lifecycleStatus === "validation_failed") return "validation_failed";
  if (input.nextGate === "registered_semantic_input_execution") return "execution_required";
  return "ready";
}
