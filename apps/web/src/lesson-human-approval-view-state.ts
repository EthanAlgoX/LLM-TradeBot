export function deriveLessonHumanApprovalViewState(input: {
  evidenceLifecycle?: string;
  approvalLifecycle?: "approved" | "rejected";
}) {
  return {
    mode: input.approvalLifecycle ?? (
      input.evidenceLifecycle === "approval_required" ? "approval_ready" : "blocked"
    ),
    canDecide: !input.approvalLifecycle && input.evidenceLifecycle === "approval_required",
    decisionContextApplied: false as const,
    runtimeApplied: false as const,
  };
}
