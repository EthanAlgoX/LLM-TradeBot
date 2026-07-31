import type { MarketBar } from "../../contracts/src/index.js";
import type { CurrentCryptoPublicMarketData } from "./current-crypto-paper-runtime-binding.js";

const intervalMilliseconds = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
} as const;

/**
 * Deterministic backend-only market fixture for the local Paper workspace.
 * It exercises the real Runtime chain but is never represented as live data.
 */
export class LocalPaperFixtureMarketData
  implements CurrentCryptoPublicMarketData {
  constructor(
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getMetrics(
    _asOf: Date,
    symbols: readonly string[],
  ) {
    return symbols.map((symbol, index) => ({
      symbol,
      quoteVolume24h: 1_000_000_000 - index * 10_000_000,
      price: 60_000 - index * 1_000,
      momentum30mPct: 1.8 - index * 0.2,
      trendStrength: 72 - index * 3,
      volatilityPct: 2.4,
    }));
  }

  async loadBars(
    symbol: string,
    timeframe: "5m" | "15m" | "1h",
  ): Promise<readonly MarketBar[]> {
    const intervalMs = intervalMilliseconds[timeframe];
    const latestCloseMs =
      Math.floor(this.now().getTime() / intervalMs) * intervalMs;
    const symbolOffset =
      [...symbol].reduce((total, character) => total + character.charCodeAt(0), 0) %
      500;

    return Array.from({ length: 80 }, (_, index) => {
      const closeTime = new Date(
        latestCloseMs - (79 - index) * intervalMs,
      );
      const close = 59_000 + symbolOffset + index * 8;
      const open = close - 5;
      return {
        timeframe,
        openTime: new Date(closeTime.getTime() - intervalMs),
        closeTime,
        open,
        high: close + 12,
        low: open - 12,
        close,
        volume: 1_000 + index * 5,
      };
    });
  }
}
