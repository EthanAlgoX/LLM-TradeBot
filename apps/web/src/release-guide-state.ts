export type ReleaseConnectionMode =
  | "connecting"
  | "live"
  | "readonly"
  | "offline";

export type ReleaseGateId =
  | "draft"
  | "validation"
  | "backtest"
  | "walk_forward"
  | "approval"
  | "activation"
  | "preflight"
  | "start";

export type ReleaseGateStatus =
  | "complete"
  | "current"
  | "pending"
  | "blocked";

export type ReleaseGuideAction =
  | "save"
  | "validate"
  | "backtest"
  | "walk-forward"
  | "approve"
  | "paper-plan"
  | "activate-paper"
  | "paper-preflight"
  | "start-paper-run"
  | "retry";

export interface ReleaseGuideInput {
  mode: ReleaseConnectionMode;
  busy: boolean;
  hasDraft: boolean;
  promotionStage?: string;
  validationValid?: boolean;
  backtestStatus?: string;
  walkForwardStatus?: string;
  hasApproval: boolean;
  hasPaperPlan: boolean;
  hasActivation: boolean;
  preflightStatus?: "passed" | "failed";
  runStatus?: string;
  errorCode?: string;
}

export interface ReleaseGuideState {
  phase: "disconnected" | "release" | "blocked" | "ready" | "running";
  steps: Array<{
    id: ReleaseGateId;
    status: ReleaseGateStatus;
  }>;
  nextStepId?: ReleaseGateId;
  nextAction?: ReleaseGuideAction;
  requiresHumanAction: boolean;
  reasonCode?: string;
}

const gateOrder: readonly ReleaseGateId[] = [
  "draft",
  "validation",
  "backtest",
  "walk_forward",
  "approval",
  "activation",
  "preflight",
  "start",
];

const promotionRank: Readonly<Record<string, number>> = {
  draft: 0,
  contract_validated: 1,
  backtested: 2,
  walk_forward_validated: 3,
  human_approved: 4,
  paper_running: 5,
};

function stageAtLeast(stage: string | undefined, rank: number): boolean {
  return stage !== undefined && (promotionRank[stage] ?? -1) >= rank;
}

function actionFor(
  gate: ReleaseGateId,
  input: ReleaseGuideInput,
): ReleaseGuideAction {
  switch (gate) {
    case "draft":
      return "save";
    case "validation":
      return "validate";
    case "backtest":
      return "backtest";
    case "walk_forward":
      return "walk-forward";
    case "approval":
      return "approve";
    case "activation":
      return input.hasPaperPlan ? "activate-paper" : "paper-plan";
    case "preflight":
      return "paper-preflight";
    case "start":
      return "start-paper-run";
  }
}

export function deriveReleaseGuideState(
  input: ReleaseGuideInput,
): ReleaseGuideState {
  const complete: Readonly<Record<ReleaseGateId, boolean>> = {
    draft: input.hasDraft,
    validation:
      input.validationValid === true ||
      stageAtLeast(input.promotionStage, 1),
    backtest:
      input.backtestStatus === "succeeded" ||
      stageAtLeast(input.promotionStage, 2),
    walk_forward:
      input.walkForwardStatus === "succeeded" ||
      stageAtLeast(input.promotionStage, 3),
    approval:
      input.hasApproval || stageAtLeast(input.promotionStage, 4),
    activation: input.hasActivation,
    preflight: input.preflightStatus === "passed",
    start: input.runStatus !== undefined,
  };
  const nextStepId = gateOrder.find((gate) => !complete[gate]);
  const explicitFailure =
    input.validationValid === false
      ? { gate: "validation" as const, code: "CONTRACT_VALIDATION_FAILED" }
      : input.backtestStatus === "failed"
        ? { gate: "backtest" as const, code: "BACKTEST_JOB_FAILED" }
        : input.walkForwardStatus === "failed"
          ? {
              gate: "walk_forward" as const,
              code: "WALK_FORWARD_JOB_FAILED",
            }
          : input.preflightStatus === "failed"
            ? {
                gate: "preflight" as const,
                code: "PAPER_PREFLIGHT_FAILED",
              }
            : input.runStatus === "failed" ||
                input.runStatus === "safety_blocked" ||
                input.runStatus === "orphaned"
              ? {
                  gate: "start" as const,
                  code: `PAPER_RUN_${input.runStatus.toUpperCase()}`,
                }
              : undefined;
  const connectionFailure =
    input.mode === "offline"
      ? "RUNTIME_API_OFFLINE"
      : input.mode === "readonly"
        ? "OPERATOR_AUTH_REQUIRED"
        : input.mode === "connecting"
          ? "RUNTIME_API_CONNECTING"
          : undefined;
  const blockedGate = explicitFailure?.gate;
  const activeGate = blockedGate ?? nextStepId;
  const reasonCode =
    explicitFailure?.code ?? connectionFailure ?? input.errorCode;
  const isBlocked = Boolean(explicitFailure || input.errorCode);
  const isDisconnected = input.mode !== "live";
  const canOfferAction =
    !isDisconnected && !isBlocked && activeGate !== undefined;
  const steps = gateOrder.map((id) => ({
    id,
    status: complete[id]
      ? ("complete" as const)
      : id === activeGate
        ? isBlocked || isDisconnected
          ? ("blocked" as const)
          : ("current" as const)
        : ("pending" as const),
  }));
  const activeRun =
    input.runStatus === "queued" ||
    input.runStatus === "running" ||
    input.runStatus === "stop_requested";

  return {
    phase: isDisconnected
      ? "disconnected"
      : isBlocked
        ? "blocked"
        : activeRun
          ? "running"
          : nextStepId === "start"
            ? "ready"
            : "release",
    steps,
    nextStepId: activeGate,
    nextAction: canOfferAction
      ? actionFor(activeGate, input)
      : input.mode === "offline"
        ? "retry"
        : undefined,
    requiresHumanAction:
      canOfferAction && activeGate === "approval",
    reasonCode,
  };
}
