export type RuntimeConnectionMode =
  | "connecting"
  | "live"
  | "readonly"
  | "offline";

export type RuntimeRunStatus =
  | "queued"
  | "running"
  | "stop_requested"
  | "drained"
  | "orphaned"
  | "completed"
  | "failed"
  | "safety_blocked";

export type RuntimeControlUiState =
  | "connecting"
  | "offline"
  | "auth_required"
  | "stopped"
  | "preflight"
  | "ready"
  | "running"
  | "only_close"
  | "draining"
  | "blocked";

export interface RuntimeControlStateInput {
  mode: RuntimeConnectionMode;
  busy: boolean;
  hasActivatedPlan: boolean;
  preflightStatus?: "passed" | "failed";
  runStatus?: RuntimeRunStatus;
  controlMode?: "normal" | "pause_new_openings_close_only";
  stopStatus?: "requested" | "drained";
  errorCode?: string;
}

export interface RuntimeControlState {
  state: RuntimeControlUiState;
  canPreflight: boolean;
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
}

const ACTIVE_RUN_STATUSES: RuntimeRunStatus[] = [
  "queued",
  "running",
  "stop_requested",
];

const BLOCKED_RUN_STATUSES: RuntimeRunStatus[] = [
  "orphaned",
  "failed",
  "safety_blocked",
];

export function deriveRuntimeControlState(
  input: RuntimeControlStateInput,
): RuntimeControlState {
  let state: RuntimeControlUiState;
  if (input.mode === "connecting") {
    state = "connecting";
  } else if (input.mode === "offline") {
    state = "offline";
  } else if (input.mode === "readonly") {
    state = "auth_required";
  } else if (
    input.preflightStatus === "failed" ||
    (input.runStatus && BLOCKED_RUN_STATUSES.includes(input.runStatus))
  ) {
    state = "blocked";
  } else if (
    input.runStatus === "stop_requested" ||
    input.stopStatus === "requested"
  ) {
    state = "draining";
  } else if (
    input.runStatus &&
    ACTIVE_RUN_STATUSES.includes(input.runStatus) &&
    input.controlMode === "pause_new_openings_close_only"
  ) {
    state = "only_close";
  } else if (
    input.runStatus &&
    ACTIVE_RUN_STATUSES.includes(input.runStatus)
  ) {
    state = "running";
  } else if (
    input.hasActivatedPlan &&
    input.controlMode === "pause_new_openings_close_only"
  ) {
    state = "only_close";
  } else if (
    input.hasActivatedPlan &&
    input.preflightStatus === "passed"
  ) {
    state = "ready";
  } else if (input.hasActivatedPlan) {
    state = "preflight";
  } else {
    state = "stopped";
  }

  const liveAndIdle = input.mode === "live" && !input.busy;
  const activeRun =
    input.runStatus !== undefined &&
    ACTIVE_RUN_STATUSES.includes(input.runStatus);

  return {
    state,
    canPreflight:
      liveAndIdle &&
      input.hasActivatedPlan &&
      !activeRun,
    canStart:
      liveAndIdle &&
      state === "ready",
    canPause:
      liveAndIdle &&
      state === "running",
    canResume:
      liveAndIdle &&
      state === "only_close",
    canStop:
      liveAndIdle &&
      activeRun &&
      (state === "running" || state === "only_close"),
  };
}
