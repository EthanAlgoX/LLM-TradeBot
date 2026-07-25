import { TradeReviewSchema, type AgentArtifact, type TradeReview } from "../../contracts/src/index.js";

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function summary(artifact: AgentArtifact): string {
  if (artifact.status === "error") return artifact.error ?? "agent error";
  const output = object(artifact.output);
  if (artifact.stage === "decision") return `action=${String(output.action ?? "unknown")} confidence=${String(output.confidence ?? "unknown")}`;
  if (artifact.stage === "risk" || artifact.stage === "portfolio_risk") return `passed=${String(output.passed ?? "unknown")}${output.blockedReason ? ` reason=${String(output.blockedReason)}` : ""}`;
  if (artifact.stage === "execution") return `status=${String(output.status ?? "unknown")}${output.message ? ` message=${String(output.message)}` : ""}`;
  return artifact.status;
}

/** Pure, deterministic review model assembled from append-only Agent artifacts. */
export function buildTradeReview(artifacts: readonly AgentArtifact[], orderId?: string): TradeReview | undefined {
  if (artifacts.length === 0) return undefined;
  const ordered = [...artifacts].sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime() || left.artifactId.localeCompare(right.artifactId));
  const traceId = ordered[0]!.traceId;
  const decision = ordered.find((item) => item.stage === "decision"); const risk = ordered.find((item) => item.stage === "risk" || item.stage === "portfolio_risk"); const execution = ordered.find((item) => item.stage === "execution");
  const decisionOut = object(decision?.output); const riskOut = object(risk?.output); const executionOut = object(execution?.output);
  return TradeReviewSchema.parse({ traceId, symbol: ordered.find((item) => item.symbol)?.symbol, orderId: orderId ?? execution?.orderId, artifactCount: ordered.length, fallbackCount: ordered.filter((item) => item.status === "fallback").length, errorCount: ordered.filter((item) => item.status === "error").length,
    timeline: ordered.map((item) => ({ artifactId: item.artifactId, stage: item.stage, agent: item.agent, agentVersion: item.agentVersion, status: item.status, symbol: item.symbol, startedAt: item.startedAt, durationMs: item.durationMs, summary: summary(item) })),
    decision: decision ? { action: typeof decisionOut.action === "string" ? decisionOut.action : undefined, confidence: typeof decisionOut.confidence === "number" ? decisionOut.confidence : undefined } : undefined,
    risk: risk ? { passed: typeof riskOut.passed === "boolean" ? riskOut.passed : undefined, blockedReason: typeof riskOut.blockedReason === "string" ? riskOut.blockedReason : undefined } : undefined,
    execution: execution ? { status: typeof executionOut.status === "string" ? executionOut.status : undefined, orderId: execution.orderId, message: typeof executionOut.message === "string" ? executionOut.message : undefined } : undefined,
  });
}

export function renderTradeReview(review: TradeReview | undefined): string {
  if (!review) return "No matching artifacts found.";
  const header = `TradeBoard Review · trace=${review.traceId} artifacts=${review.artifactCount} fallback=${review.fallbackCount} errors=${review.errorCount}`;
  const facts = `Decision: ${review.decision?.action ?? "unknown"} · Risk: ${review.risk?.passed === undefined ? "unknown" : review.risk.passed ? "passed" : "blocked"} · Execution: ${review.execution?.status ?? "none"}`;
  return [header, facts, "Timeline:", ...review.timeline.map((item) => `- ${item.startedAt.toISOString()} ${item.stage} [${item.agent}@${item.agentVersion}] ${item.status} ${item.summary}`)].join("\n");
}
