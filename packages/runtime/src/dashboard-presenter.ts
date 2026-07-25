import {
  RuntimeDashboardSchema,
  SCHEMA_VERSION,
  type PaperAccountState,
  type ReflectionReport,
  type RuntimeSafetyState,
  type PaperCycleRecord,
  type RuntimeDashboard,
  type StageEvent,
} from "../../contracts/src/index.js";
import { summarizeTrace } from "./trace-summary.js";

export interface RuntimeDashboardInput {
  readonly accountId: string;
  readonly account?: PaperAccountState;
  readonly events?: readonly StageEvent[];
  readonly reflection?: ReflectionReport;
  readonly safety?: RuntimeSafetyState;
  readonly latestCycle?: PaperCycleRecord;
  readonly now?: () => Date;
}

/** Pure CUI view-model builder; callers provide already-read local state only. */
export function buildRuntimeDashboard(input: RuntimeDashboardInput): RuntimeDashboard {
  const summary = input.events && input.events.length > 0 ? summarizeTrace(input.events) : undefined;
  return RuntimeDashboardSchema.parse({
    schemaVersion: SCHEMA_VERSION, generatedAt: input.now?.() ?? new Date(), accountId: input.accountId,
    account: input.account ? { status: "available", cash: input.account.cash, equity: input.account.cash + input.account.positions.reduce((sum, position) => sum + position.margin, 0), realizedPnl: input.account.realizedPnl, fees: input.account.fees, openPositionCount: input.account.positions.length, closedTradeCount: input.account.closedTrades.length } : { status: "unavailable" },
    trace: summary ? { status: "available", traceId: summary.traceId, eventCount: summary.eventCount, riskRejectedCount: summary.riskRejectedCount, executionActions: [...summary.executionActions], fallbackCount: summary.fallbackCount, errorCount: summary.errorCount } : { status: "unavailable" },
    reflection: input.reflection ? { status: "available", reflectionId: input.reflection.reflectionId, recommendations: input.reflection.recommendations, adjustmentCount: input.reflection.adjustments.length, provider: input.reflection.llmAudit?.provider, model: input.reflection.llmAudit?.model, fallbackUsed: input.reflection.llmAudit?.fallbackUsed, errorCategory: input.reflection.llmAudit?.errorCategory } : { status: "unavailable" },
    safety: input.safety ? { status: "available", consecutiveFailures: input.safety.consecutiveFailures, cooldownUntil: input.safety.cooldownUntil, lastFailure: input.safety.lastFailure } : { status: "unavailable" },
    latestCycle: input.latestCycle ? { status: "available", traceId: input.latestCycle.traceId, asOf: input.latestCycle.asOf, cycleStatus: input.latestCycle.status, executionCount: input.latestCycle.executionCount, decisionCount: input.latestCycle.decisionCount, strategyId: input.latestCycle.strategyId, profileVersion: input.latestCycle.profileVersion, configVersion: input.latestCycle.configVersion, dataSourceKind: input.latestCycle.dataSource?.kind, dataSourceIdentifier: input.latestCycle.dataSource?.identifier } : { status: "unavailable" },
  });
}

export function renderRuntimeDashboard(dashboard: RuntimeDashboard): string {
  const account = dashboard.account.status === "available"
    ? `cash=${dashboard.account.cash?.toFixed(2)} equity=${dashboard.account.equity?.toFixed(2)} positions=${dashboard.account.openPositionCount} closed=${dashboard.account.closedTradeCount} pnl=${dashboard.account.realizedPnl?.toFixed(2)} fees=${dashboard.account.fees?.toFixed(2)}`
    : "unavailable";
  const trace = dashboard.trace.status === "available"
    ? `id=${dashboard.trace.traceId} events=${dashboard.trace.eventCount} riskRejected=${dashboard.trace.riskRejectedCount} actions=${dashboard.trace.executionActions?.join(",") || "none"} fallback=${dashboard.trace.fallbackCount} errors=${dashboard.trace.errorCount}`
    : "unavailable";
  const reflection = dashboard.reflection.status === "available"
    ? `id=${dashboard.reflection.reflectionId} adjustments=${dashboard.reflection.adjustmentCount} provider=${dashboard.reflection.provider ?? "rule"} fallback=${dashboard.reflection.fallbackUsed ?? false}\n  recommendations: ${dashboard.reflection.recommendations?.join(" | ") || "none"}`
    : "unavailable";
  const safety = dashboard.safety.status === "available"
    ? `consecutiveFailures=${dashboard.safety.consecutiveFailures} cooldownUntil=${dashboard.safety.cooldownUntil?.toISOString() ?? "none"} lastFailure=${dashboard.safety.lastFailure ?? "none"}`
    : "unavailable";
  const cycle = dashboard.latestCycle.status === "available" ? `status=${dashboard.latestCycle.cycleStatus} asOf=${dashboard.latestCycle.asOf?.toISOString()} decisions=${dashboard.latestCycle.decisionCount} executions=${dashboard.latestCycle.executionCount} profile=${dashboard.latestCycle.strategyId ?? "unknown"}@${dashboard.latestCycle.profileVersion ?? "unknown"} config=${dashboard.latestCycle.configVersion ?? "unknown"} source=${dashboard.latestCycle.dataSourceKind ?? "unknown"}` : "unavailable";
  return [`TradeBoard Dashboard · ${dashboard.accountId}`, `Account: ${account}`, `Trace: ${trace}`, `Reflection: ${reflection}`, `Safety: ${safety}`, `Latest cycle: ${cycle}`].join("\n");
}
