import type { HistoricalCandleSource, Timeframe } from "./historical-data-sync-agent.js";
import type { SelectorMarketMetrics, SelectorMetricsPort } from "./historical-selector-agent.js";

const standardDeviation = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
};

/** Calculates selector inputs only from candles closed at the requested asOf. */
export class HistoricalSelectorMetricsPort implements SelectorMetricsPort {
  constructor(private readonly source: HistoricalCandleSource) {}

  async getMetrics(asOf: Date, symbols: readonly string[]): Promise<readonly SelectorMarketMetrics[]> {
    return Promise.all(symbols.map((symbol) => this.metricsFor(symbol, asOf)));
  }

  private async metricsFor(symbol: string, asOf: Date): Promise<SelectorMarketMetrics> {
    const bars = await this.latestClosed(symbol, asOf);
    const closes = bars.map((bar) => bar.close);
    const latest = closes.at(-1) ?? 0;
    const lookback30m = closes.slice(-7);
    const first30m = (lookback30m[0] ?? latest) || 1;
    const momentum30mPct = latest > 0 ? (latest / first30m - 1) * 100 : 0;
    const trendBase = (closes.at(-Math.min(25, closes.length)) ?? latest) || 1;
    const trendStrength = latest > 0 ? Math.min(100, Math.abs((latest / trendBase - 1) * 1_000)) : 0;
    const returns = closes.slice(1).map((close, index) => (close / (closes[index] ?? close) - 1) * 100);
    const quoteVolume24h = bars.slice(-288).reduce((sum, bar) => sum + bar.close * bar.volume, 0);
    return { symbol, quoteVolume24h, price: latest, momentum30mPct, trendStrength, volatilityPct: standardDeviation(returns) };
  }

  private async latestClosed(symbol: string, asOf: Date) {
    for (const timeframe of ["5m", "15m", "1h"] as const satisfies readonly Timeframe[]) {
      const bars = await this.source.loadBars(symbol, timeframe);
      const closed = bars.filter((bar) => bar.closeTime.getTime() <= asOf.getTime());
      if (closed.length > 0) return closed;
    }
    return [];
  }
}
