export type RuntimeOperationKey =
  | "plan"
  | "activation"
  | "control"
  | "run"
  | "preflight"
  | "stop"
  | "acknowledgement"
  | "clearance";

export type RuntimeOperationKeys = Record<RuntimeOperationKey, string>;

export type RuntimeSessionRunStatus =
  | "queued"
  | "running"
  | "stop_requested"
  | "drained"
  | "orphaned"
  | "completed"
  | "failed"
  | "safety_blocked";

export interface RuntimeSessionRun {
  runId: string;
  status: RuntimeSessionRunStatus;
  plannedCycles: number;
  processedCycles: number;
  continuous?: boolean;
}

export interface RuntimeDashboardEvent {
  eventType: string;
  occurredAt: string;
}

export interface RuntimeDashboardSnapshot {
  connectionMode: "connecting" | "live" | "readonly" | "offline";
  uiState:
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
  activeRun: boolean;
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  controlMode: "normal" | "pause_new_openings_close_only";
  runId?: string;
  processedCycles?: number;
  plannedCycles?: number;
  continuous?: boolean;
  heartbeatAt?: string;
  eventCount: number;
  latestEvent?: RuntimeDashboardEvent;
}

const ACTIVE_RUN_STATUSES = new Set<RuntimeSessionRunStatus>([
  "queued",
  "running",
  "stop_requested",
]);

const OPERATION_KEYS: RuntimeOperationKey[] = [
  "plan",
  "activation",
  "control",
  "run",
  "preflight",
  "stop",
  "acknowledgement",
  "clearance",
];

export function createRuntimeOperationKeys(
  createKey: () => string = () => crypto.randomUUID(),
): RuntimeOperationKeys {
  return Object.fromEntries(
    OPERATION_KEYS.map((key) => [key, createKey()]),
  ) as RuntimeOperationKeys;
}

export function rotateRuntimeOperationKey(
  keys: RuntimeOperationKeys,
  operation: RuntimeOperationKey,
  createKey: () => string = () => crypto.randomUUID(),
): RuntimeOperationKeys {
  return {
    ...keys,
    [operation]: createKey(),
  };
}

export function partitionRuntimeRun<T extends RuntimeSessionRun>(
  run: T | undefined,
): { activeRun?: T; terminalRun?: T } {
  if (!run) return {};
  return ACTIVE_RUN_STATUSES.has(run.status)
    ? { activeRun: run }
    : { terminalRun: run };
}

export function createRuntimeDashboardSnapshot(input: {
  connectionMode: RuntimeDashboardSnapshot["connectionMode"];
  uiState: RuntimeDashboardSnapshot["uiState"];
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  controlMode?: RuntimeDashboardSnapshot["controlMode"];
  run?: RuntimeSessionRun;
  heartbeatAt?: string;
  events?: RuntimeDashboardEvent[];
}): RuntimeDashboardSnapshot {
  const activeRun = partitionRuntimeRun(input.run).activeRun;
  const events = input.events ?? [];
  const latestEvent = events[events.length - 1];
  return {
    connectionMode: input.connectionMode,
    uiState: input.uiState,
    activeRun: Boolean(activeRun),
    canPause: input.canPause,
    canResume: input.canResume,
    canStop: input.canStop,
    controlMode: input.controlMode ?? "normal",
    ...(activeRun
      ? {
          runId: activeRun.runId,
          processedCycles: activeRun.processedCycles,
          plannedCycles: activeRun.plannedCycles,
          ...(activeRun.continuous !== undefined
            ? { continuous: activeRun.continuous }
            : {}),
          ...(input.heartbeatAt ? { heartbeatAt: input.heartbeatAt } : {}),
        }
      : {}),
    eventCount: events.length,
    ...(latestEvent ? { latestEvent } : {}),
  };
}
