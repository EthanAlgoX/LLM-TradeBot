import { createHash } from "node:crypto";
import {
  ReflectionLessonCandidateSchema,
  ReflectionReportSchema,
  type AgentArtifact,
  type ClosedTrade,
  type ReflectionLessonCandidate,
  type ReflectionReport,
  type VersionedEntityReference,
} from "../../contracts/src/index.js";
import type { ReflectionAgent, ReflectionInput } from "../../core/src/ports.js";

export interface RuleReflectionConfig {
  readonly minimumTrades?: number;
  readonly intervalTrades?: number;
  readonly windowSize?: number;
  readonly adjustmentDurationMs?: number;
  readonly semanticCandidate?: {
    readonly marketPackRef: VersionedEntityReference;
    readonly reflectionAgentConfigRef: VersionedEntityReference;
  };
}

function fingerprint(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function artifactRegime(artifact: AgentArtifact): string {
  if (!artifact.input || typeof artifact.input !== "object" || Array.isArray(artifact.input)) {
    return "unclassified";
  }
  const analysis = (artifact.input as Record<string, unknown>).analysis;
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
    return "unclassified";
  }
  const regime = (analysis as Record<string, unknown>).regime;
  return typeof regime === "string" && regime.length > 0 ? regime : "unclassified";
}

/** Produces bounded suggestions only; it never mutates live risk or order state. */
export class RuleReflectionAgent implements ReflectionAgent {
  readonly name = "rule_reflection_agent";
  readonly version = "v1";
  private readonly config: Required<Omit<RuleReflectionConfig, "semanticCandidate">> &
    Pick<RuleReflectionConfig, "semanticCandidate">;
  private lastReflectedTradeCount = 0;

  constructor(config: RuleReflectionConfig = {}) {
    this.config = {
      minimumTrades: config.minimumTrades ?? 3,
      intervalTrades: config.intervalTrades ?? 3,
      windowSize: config.windowSize ?? 20,
      adjustmentDurationMs: config.adjustmentDurationMs ?? 12 * 60 * 60 * 1_000,
      semanticCandidate: config.semanticCandidate,
    };
  }

  async run({ asOf, trades, sourceArtifacts = [] }: ReflectionInput): Promise<ReflectionReport | undefined> {
    if (trades.length < this.config.minimumTrades || trades.length - this.lastReflectedTradeCount < this.config.intervalTrades) return undefined;
    const sample = trades.slice(-this.config.windowSize);
    this.lastReflectedTradeCount = trades.length;
    const wins = sample.filter((trade) => trade.realizedPnl > 0);
    const losses = sample.filter((trade) => trade.realizedPnl < 0);
    const averageWin = wins.length === 0 ? 0 : wins.reduce((sum, trade) => sum + trade.realizedPnl, 0) / wins.length;
    const averageLoss = losses.length === 0 ? 0 : losses.reduce((sum, trade) => sum + Math.abs(trade.realizedPnl), 0) / losses.length;
    const withConfidence = (predicate: (trade: ClosedTrade) => boolean) => sample.filter((trade) => trade.entryConfidence !== undefined && predicate(trade));
    const avgConfidence = (items: readonly ClosedTrade[]) => items.length === 0 ? undefined : items.reduce((sum, trade) => sum + (trade.entryConfidence ?? 0), 0) / items.length;
    const winConfidence = avgConfidence(withConfidence((trade) => trade.realizedPnl > 0));
    const lossConfidence = avgConfidence(withConfidence((trade) => trade.realizedPnl < 0));
    const calibration = winConfidence === undefined || lossConfidence === undefined ? "unavailable" : lossConfidence > winConfidence ? "overconfident_losses" : "aligned";
    const consecutiveLosses = sample.slice().reverse().findIndex((trade) => trade.realizedPnl >= 0);
    const lossStreak = consecutiveLosses === -1 ? sample.length : consecutiveLosses;
    const recommendations: string[] = [];
    const adjustments = [];
    if (wins.length / sample.length < 0.5) recommendations.push("Tighten entry filters until the next reflection window.");
    if (averageLoss > averageWin) recommendations.push("Average loss exceeds average win; prioritize cleaner setup and trigger confirmation.");
    if (calibration === "overconfident_losses") recommendations.push("Losing trades carry higher confidence; avoid confidence-based overrides.");
    if (lossStreak >= 3) {
      recommendations.push(`Recent ${lossStreak}-trade loss streak; reduce new-entry aggressiveness temporarily.`);
      adjustments.push({ scope: "entry_confidence_min" as const, value: 10, maxValue: 20, expiresAt: new Date(asOf.getTime() + this.config.adjustmentDurationMs), reason: "consecutive losses" });
      adjustments.push({ scope: "leverage_cap" as const, value: 1, maxValue: 1.5, expiresAt: new Date(asOf.getTime() + this.config.adjustmentDurationMs), reason: "consecutive losses" });
    }
    if (recommendations.length === 0) recommendations.push("Maintain current filters; continue monitoring confidence calibration.");
    const semanticLessonCandidates = this.semanticCandidates(
      asOf,
      losses,
      sourceArtifacts,
    );
    return ReflectionReportSchema.parse({
      reflectionId: `reflection:${asOf.toISOString()}:${trades.length}`,
      asOf, sampleSize: sample.length, winRatePct: wins.length / sample.length * 100, averageWin, averageLoss,
      longTradeCount: sample.filter((trade) => trade.side === "long").length, shortTradeCount: sample.filter((trade) => trade.side === "short").length,
      confidenceCalibration: calibration, recommendations, adjustments,
      sourceTradeIds: sample.flatMap((trade) =>
        trade.tradeId ? [trade.tradeId] : []),
      ...(semanticLessonCandidates.length > 0
        ? { semanticLessonCandidates }
        : {}),
    });
  }

  private semanticCandidates(
    asOf: Date,
    losses: readonly ClosedTrade[],
    artifacts: readonly AgentArtifact[],
  ): ReflectionLessonCandidate[] {
    const config = this.config.semanticCandidate;
    if (!config) return [];
    return losses.flatMap((trade) => {
      if (!trade.tradeId || !trade.entryTraceId || !trade.entryDecisionArtifactId) {
        return [];
      }
      const decisionArtifact = artifacts.find((artifact) =>
        artifact.traceId === trade.entryTraceId &&
        artifact.artifactId === trade.entryDecisionArtifactId &&
        artifact.stage === "decision" &&
        artifact.status !== "error");
      if (!decisionArtifact) return [];
      const decisionFingerprint = fingerprint(decisionArtifact);
      const identity = {
        tradeId: trade.tradeId,
        realizedPnl: trade.realizedPnl,
        exitReason: trade.exitReason,
        decisionArtifactId: decisionArtifact.artifactId,
        decisionFingerprint,
        marketPackFingerprint: config.marketPackRef.fingerprint,
        reflectionAgentFingerprint: config.reflectionAgentConfigRef.fingerprint,
      };
      const candidateId = `lesson-candidate:${fingerprint(identity).slice(7, 31)}`;
      const withoutFingerprint = {
        schemaVersion: "1.0.0" as const,
        id: candidateId,
        version: "1.0.0",
        lifecycleStatus: "candidate" as const,
        createdAt: asOf.toISOString(),
        marketPackRef: config.marketPackRef,
        schemaRef: {
          schemaId: "tradebot.semantic.reflection_lesson_candidate.v1",
          schemaVersion: "1.0.0",
        },
        artifactType: "reflection_lesson_candidate" as const,
        reflectionAgentConfigRef: config.reflectionAgentConfigRef,
        failedTradeRef: {
          tradeId: trade.tradeId,
          decisionArtifactRef: {
            artifactId: decisionArtifact.artifactId,
            artifactType: "decision_agent_artifact",
            fingerprint: decisionFingerprint,
          },
        },
        semanticLesson: `After a losing ${trade.side} trade closed by ${trade.exitReason}, require renewed server-validated confirmation before repeating the same setup.`,
        failurePattern: `${trade.side}:${trade.exitReason}:negative_realized_pnl`,
        applicableMarketPackIds: [config.marketPackRef.id],
        applicableRegimes: [artifactRegime(decisionArtifact)],
        confidence: trade.entryConfidence === undefined
          ? 0.6
          : Math.max(0.5, Math.min(0.9, trade.entryConfidence / 100)),
        supportingEvidence: [{
          evidenceId: `reflection-evidence:${fingerprint(identity).slice(7, 31)}`,
          sourceArtifactRef: {
            artifactId: decisionArtifact.artifactId,
            artifactType: "decision_agent_artifact",
            fingerprint: decisionFingerprint,
          },
          evidenceType: "lesson" as const,
          locator: `closed-trade:${trade.tradeId}`,
          summary: `Server-recorded trade closed with realized PnL ${trade.realizedPnl} and reason ${trade.exitReason}.`,
        }],
      };
      return [ReflectionLessonCandidateSchema.parse({
        ...withoutFingerprint,
        fingerprint: fingerprint(withoutFingerprint),
      })];
    });
  }
}
