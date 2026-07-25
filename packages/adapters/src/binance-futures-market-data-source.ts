import type { MarketBar } from "../../contracts/src/index.js";
import type { SelectorMarketMetrics, SelectorMetricsPort } from "./historical-selector-agent.js";
import type { HistoricalCandleSource, Timeframe } from "./historical-data-sync-agent.js";
import { BinanceFuturesReadClient } from "./binance-futures-read-port.js";

/** Public Binance data adapter; it exposes no credential and no exchange mutation operation. */
export interface BinanceFuturesMarketDataSourceOptions {
  readonly candleLimit?: number;
  readonly cacheTtlMs?: number;
  readonly now?: () => Date;
}

interface CachedBars { readonly fetchedAt: number; readonly bars: readonly MarketBar[]; }

/**
 * Public Binance source inspired by LLM-TradeBot's data-sync flow: bulk ticker
 * lookup, concurrent multi-timeframe reads, and a local-first short TTL cache.
 * Integrity checks only discard malformed OHLC rows; prices are never altered.
 */
export class BinanceFuturesMarketDataSource implements HistoricalCandleSource, SelectorMetricsPort {
  private readonly candleLimit: number;
  private readonly cacheTtlMs: number;
  private readonly now: () => Date;
  private readonly cache = new Map<string, CachedBars>();

  constructor(private readonly client: BinanceFuturesReadClient, options: BinanceFuturesMarketDataSourceOptions = {}) {
    this.candleLimit = options.candleLimit ?? 240;
    this.cacheTtlMs = options.cacheTtlMs ?? 15_000;
    this.now = options.now ?? (() => new Date());
  }

  async loadBars(symbol: string, timeframe: Timeframe): Promise<readonly MarketBar[]> {
    const key = `${symbol}:${timeframe}`;
    const cached = this.cache.get(key);
    if (cached && this.now().getTime() - cached.fetchedAt <= this.cacheTtlMs) return cached.bars;
    const bars = (await this.client.getKlines(symbol, timeframe, this.candleLimit))
      .filter(isValidOhlc)
      .sort((left, right) => left.openTime.getTime() - right.openTime.getTime())
      .filter((bar, index, rows) => index === 0 || rows[index - 1]?.openTime.getTime() !== bar.openTime.getTime());
    this.cache.set(key, { fetchedAt: this.now().getTime(), bars });
    return bars;
  }

  async getMetrics(_asOf: Date, symbols: readonly string[]): Promise<readonly SelectorMarketMetrics[]> {
    const tickerBySymbol = new Map((await this.client.getTicker24h()).map((ticker) => [ticker.symbol, ticker]));
    return Promise.all(symbols.map(async (symbol) => {
      const ticker = tickerBySymbol.get(symbol);
      const [bars5m, bars15m, bars1h] = await Promise.all([this.loadBars(symbol, "5m"), this.loadBars(symbol, "15m"), this.loadBars(symbol, "1h")]);
      const closes = bars5m.map((bar) => bar.close);
      const latest = ticker?.lastPrice ?? closes.at(-1) ?? 0;
      const lookback = closes.slice(-7);
      const first = (lookback[0] ?? latest) || 1;
      const momentum30mPct = latest > 0 ? (latest / first - 1) * 100 : 0;
      const trend15m = directionalStrength(bars15m.map((bar) => bar.close));
      const trend1h = directionalStrength(bars1h.map((bar) => bar.close));
      const trendStrength = trend15m === 0 || trend1h === 0 || Math.sign(trend15m) !== Math.sign(trend1h)
        ? Math.min(100, Math.abs(trend15m) * 0.4 + Math.abs(trend1h) * 0.6)
        : Math.min(100, (Math.abs(trend15m) * 0.4 + Math.abs(trend1h) * 0.6) * 1.2);
      const returns = closes.slice(1).map((close, index) => (close / (closes[index] ?? close) - 1) * 100);
      return {
        symbol,
        quoteVolume24h: ticker?.quoteVolume ?? 0,
        price: latest,
        momentum30mPct,
        trendStrength,
        volatilityPct: standardDeviation(returns),
      };
    }));
  }
}

function isValidOhlc(bar: MarketBar): boolean {
  return Number.isFinite(bar.open) && Number.isFinite(bar.high) && Number.isFinite(bar.low) && Number.isFinite(bar.close)
    && bar.high >= Math.max(bar.open, bar.close, bar.low)
    && bar.low <= Math.min(bar.open, bar.close, bar.high)
    && bar.volume >= 0;
}

function directionalStrength(closes: readonly number[]): number {
  const latest = closes.at(-1) ?? 0;
  const base = closes.at(-Math.min(25, closes.length)) ?? latest;
  return latest > 0 && base > 0 ? (latest / base - 1) * 1_000 : 0;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}
