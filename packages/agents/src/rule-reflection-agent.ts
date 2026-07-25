import { ReflectionReportSchema, type ClosedTrade, type ReflectionReport } from "../../contracts/src/index.js";
import type { ReflectionAgent, ReflectionInput } from "../../core/src/ports.js";

export interface RuleReflectionConfig { readonly minimumTrades?: number; readonly intervalTrades?: number; readonly windowSize?: number; readonly adjustmentDurationMs?: number; }

/** Produces bounded suggestions only; it never mutates live risk or order state. */
export class RuleReflectionAgent implements ReflectionAgent {
  readonly name = "rule_reflection_agent";
  readonly version = "v1";
  private readonly config: Required<RuleReflectionConfig>;
  private lastReflectedTradeCount = 0;

  constructor(config: RuleReflectionConfig = {}) {
    this.config = { minimumTrades: config.minimumTrades ?? 3, intervalTrades: config.intervalTrades ?? 3, windowSize: config.windowSize ?? 20, adjustmentDurationMs: config.adjustmentDurationMs ?? 12 * 60 * 60 * 1_000 };
  }

  async run({ asOf, trades }: ReflectionInput): Promise<ReflectionReport | undefined> {
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
    return ReflectionReportSchema.parse({
      reflectionId: `reflection:${asOf.toISOString()}:${trades.length}`,
      asOf, sampleSize: sample.length, winRatePct: wins.length / sample.length * 100, averageWin, averageLoss,
      longTradeCount: sample.filter((trade) => trade.side === "long").length, shortTradeCount: sample.filter((trade) => trade.side === "short").length,
      confidenceCalibration: calibration, recommendations, adjustments,
    });
  }
}
