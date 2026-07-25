import {
  AnalysisBundleSchema,
  QuantAnalysisSchema,
  RegimeAssessmentSchema,
  SCHEMA_VERSION,
  SetupAssessmentSchema,
  TrendAssessmentSchema,
  TriggerAssessmentSchema,
  type Agent,
  type AnalysisBundle,
  type MarketBar,
  type MultiTimeframeSnapshot,
  type QuantAnalysis,
  type RegimeAssessment,
  type SetupAssessment,
  type TimeframeAnalysis,
  type TrendAssessment,
  type TriggerAssessment,
} from "../../contracts/src/index.js";

type Timeframe = "5m" | "15m" | "1h";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function ema(values: readonly number[], period: number): number {
  if (values.length === 0) return 0;
  const multiplier = 2 / (period + 1);
  return values.reduce((current, value, index) => index === 0 ? value : value * multiplier + current * (1 - multiplier), values[0] ?? 0);
}

function rsi(values: readonly number[], period = 14): number {
  if (values.length < 2) return 50;
  const changes = values.slice(1).map((value, index) => value - (values[index] ?? value)).slice(-period);
  const gains = changes.filter((change) => change > 0);
  const losses = changes.filter((change) => change < 0).map(Math.abs);
  const avgGain = gains.reduce((sum, value) => sum + value, 0) / Math.max(changes.length, 1);
  const avgLoss = losses.reduce((sum, value) => sum + value, 0) / Math.max(changes.length, 1);
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function analyzeTimeframe(bars: readonly MarketBar[]): TimeframeAnalysis {
  if (bars.length < 2) return { trendScore: 0, oscillatorScore: 0, momentumPct: 0, rsi: 50, volatilityPct: 0, volumeRatio: 0 };
  const closes = bars.map((bar) => bar.close);
  const volumes = bars.map((bar) => bar.volume);
  const first = closes[0] ?? 1;
  const last = closes.at(-1) ?? first;
  const momentumPct = (last / first - 1) * 100;
  const fast = ema(closes, Math.min(20, closes.length));
  const slow = ema(closes, Math.min(60, closes.length));
  const trendScore = clamp(((last - slow) / slow * 5000) + ((fast - slow) / slow * 5000), -100, 100);
  const rsiValue = rsi(closes);
  const oscillatorScore = clamp((50 - rsiValue) * 2, -100, 100);
  const returns = closes.slice(1).map((close, index) => (close / (closes[index] ?? close) - 1) * 100);
  const volatilityPct = standardDeviation(returns);
  const averageVolume = volumes.reduce((sum, value) => sum + value, 0) / volumes.length;
  const volumeRatio = averageVolume === 0 ? 0 : (volumes.at(-1) ?? 0) / averageVolume;
  return { trendScore, oscillatorScore, momentumPct, rsi: rsiValue, volatilityPct, volumeRatio };
}

export class RuleQuantAnalystAgent implements Agent<MultiTimeframeSnapshot, QuantAnalysis> {
  readonly name = "rule_quant_analyst_agent";
  readonly version = "v1";

  async run(snapshot: MultiTimeframeSnapshot): Promise<QuantAnalysis> {
    return QuantAnalysisSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      traceId: snapshot.traceId,
      asOf: snapshot.asOf,
      symbol: snapshot.symbol,
      byTimeframe: {
        "5m": analyzeTimeframe(snapshot.stableBars["5m"]),
        "15m": analyzeTimeframe(snapshot.stableBars["15m"]),
        "1h": analyzeTimeframe(snapshot.stableBars["1h"]),
      },
    });
  }
}

export class RuleRegimeAgent implements Agent<QuantAnalysis, RegimeAssessment> {
  readonly name = "rule_regime_agent";
  readonly version = "v1";

  async run(quant: QuantAnalysis): Promise<RegimeAssessment> {
    const oneHour = quant.byTimeframe["1h"];
    const trendMagnitude = Math.abs(oneHour.trendScore);
    const volatile = oneHour.volatilityPct >= 3;
    const regime = volatile
      ? "volatile"
      : trendMagnitude >= 25
        ? oneHour.trendScore > 0 ? "trending_up" : "trending_down"
        : "choppy";
    return RegimeAssessmentSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      traceId: quant.traceId,
      symbol: quant.symbol,
      regime,
      confidence: clamp(volatile ? oneHour.volatilityPct * 15 : trendMagnitude, 0, 100),
      reason: volatile ? `1h volatility ${oneHour.volatilityPct.toFixed(2)}% exceeds safety threshold` : `1h trend score ${oneHour.trendScore.toFixed(1)}`,
      openAllowed: regime === "trending_up" || regime === "trending_down",
    });
  }
}

export interface TrendInput { quant: QuantAnalysis; regime: RegimeAssessment; }
export class RuleTrendAgent implements Agent<TrendInput, TrendAssessment> {
  readonly name = "rule_trend_agent";
  readonly version = "v1";

  async run({ quant, regime }: TrendInput): Promise<TrendAssessment> {
    const score = quant.byTimeframe["1h"].trendScore;
    const stance = regime.openAllowed ? score >= 0 ? "long" : "short" : "neutral";
    return TrendAssessmentSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      traceId: quant.traceId,
      symbol: quant.symbol,
      stance,
      strength: clamp(Math.abs(score), 0, 100),
      reasons: [`1h trend score=${score.toFixed(1)}`, `regime=${regime.regime}`],
      invalidationConditions: stance === "neutral" ? ["wait for directional regime"] : ["1h trend score reverses", "regime becomes volatile or choppy"],
    });
  }
}

export interface SetupInput { quant: QuantAnalysis; trend: TrendAssessment; }
export class RuleSetupAgent implements Agent<SetupInput, SetupAssessment> {
  readonly name = "rule_setup_agent";
  readonly version = "v1";

  async run({ quant, trend }: SetupInput): Promise<SetupAssessment> {
    const fifteenMinute = quant.byTimeframe["15m"];
    const longReady = trend.stance === "long" && fifteenMinute.rsi >= 35 && fifteenMinute.rsi <= 65;
    const shortReady = trend.stance === "short" && fifteenMinute.rsi >= 35 && fifteenMinute.rsi <= 65;
    const status = longReady || shortReady ? "ready" : trend.stance === "neutral" ? "avoid" : "wait";
    return SetupAssessmentSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      traceId: quant.traceId,
      symbol: quant.symbol,
      status,
      reasons: [`15m RSI=${fifteenMinute.rsi.toFixed(1)}`, `trend stance=${trend.stance}`],
    });
  }
}

export interface TriggerInput { snapshot: MultiTimeframeSnapshot; quant: QuantAnalysis; trend: TrendAssessment; setup: SetupAssessment; }
export class RuleTriggerAgent implements Agent<TriggerInput, TriggerAssessment> {
  readonly name = "rule_trigger_agent";
  readonly version = "v1";

  async run({ snapshot, quant, trend, setup }: TriggerInput): Promise<TriggerAssessment> {
    const fiveMinute = quant.byTimeframe["5m"];
    const bars = snapshot.stableBars["5m"];
    const previous = bars.at(-2);
    const current = bars.at(-1);
    const directionalMove = previous && current ? current.close - previous.close : 0;
    const directionMatches = (trend.stance === "long" && directionalMove > 0) || (trend.stance === "short" && directionalMove < 0);
    const confirmed = setup.status === "ready" && directionMatches && fiveMinute.volumeRatio >= 1;
    const pattern = !previous || !current ? "unavailable" : directionalMove > 0 ? "bullish_close" : directionalMove < 0 ? "bearish_close" : "flat_close";
    return TriggerAssessmentSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      traceId: quant.traceId,
      symbol: quant.symbol,
      status: !previous || !current ? "unavailable" : confirmed ? "confirmed" : "waiting",
      pattern,
      relativeVolume: fiveMinute.volumeRatio,
      reasons: [`5m pattern=${pattern}`, `relative volume=${fiveMinute.volumeRatio.toFixed(2)}`, `setup=${setup.status}`],
    });
  }
}

export interface MultiPeriodInput { quant: QuantAnalysis; regime: RegimeAssessment; trend: TrendAssessment; setup: SetupAssessment; trigger: TriggerAssessment; }
export class MultiPeriodParserAgent implements Agent<MultiPeriodInput, AnalysisBundle> {
  readonly name = "multi_period_parser_agent";
  readonly version = "v1";

  async run({ quant, regime, trend, setup, trigger }: MultiPeriodInput): Promise<AnalysisBundle> {
    const diagnostics = [
      `1h=${quant.byTimeframe["1h"].trendScore.toFixed(1)}`,
      `15m=${quant.byTimeframe["15m"].trendScore.toFixed(1)}`,
      `5m=${quant.byTimeframe["5m"].trendScore.toFixed(1)}`,
      ...trend.reasons,
      ...setup.reasons,
      ...trigger.reasons,
    ];
    return AnalysisBundleSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      traceId: quant.traceId,
      asOf: quant.asOf,
      symbol: quant.symbol,
      regime: regime.regime,
      trend: trend.stance,
      setup: setup.status,
      trigger: trigger.status,
      diagnostics,
    });
  }
}
