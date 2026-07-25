import type { StageEvent } from "../../contracts/src/index.js";

export interface StageSummary {
  readonly stage: string;
  readonly eventCount: number;
  readonly started: boolean;
  readonly ended: boolean;
  readonly fallbackCount: number;
  readonly errorCount: number;
}

export interface TraceSummary {
  readonly traceId: string | undefined;
  readonly eventCount: number;
  readonly stages: readonly StageSummary[];
  readonly executionActions: readonly string[];
  readonly riskRejectedCount: number;
  readonly fallbackCount: number;
  readonly errorCount: number;
}

export function filterTraceEvents(events: readonly StageEvent[], stage?: string): StageEvent[] {
  return stage ? events.filter((event) => event.stage === stage) : [...events];
}

export function summarizeTrace(events: readonly StageEvent[]): TraceSummary {
  const stages = new Map<string, { eventCount: number; started: boolean; ended: boolean; fallbackCount: number; errorCount: number }>();
  const executionActions: string[] = [];
  let riskRejectedCount = 0;
  let fallbackCount = 0;
  let errorCount = 0;
  for (const event of events) {
    const summary = stages.get(event.stage) ?? { eventCount: 0, started: false, ended: false, fallbackCount: 0, errorCount: 0 };
    summary.eventCount += 1;
    summary.started ||= event.phase === "start";
    summary.ended ||= event.phase === "end";
    summary.fallbackCount += event.phase === "fallback" ? 1 : 0;
    summary.errorCount += event.phase === "error" ? 1 : 0;
    stages.set(event.stage, summary);
    fallbackCount += event.phase === "fallback" ? 1 : 0;
    errorCount += event.phase === "error" ? 1 : 0;
    if (event.stage === "execution" && event.phase === "start" && typeof event.data.action === "string") executionActions.push(event.data.action);
    if (event.stage === "risk" && event.phase === "end" && event.data.passed === false) riskRejectedCount += 1;
  }
  return {
    traceId: events[0]?.traceId,
    eventCount: events.length,
    stages: [...stages.entries()].map(([stage, summary]) => ({ stage, ...summary })),
    executionActions,
    riskRejectedCount,
    fallbackCount,
    errorCount,
  };
}
