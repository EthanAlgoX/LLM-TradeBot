import {
  MultiTimeframeSnapshotSchema,
  SCHEMA_VERSION,
  type MarketBar,
  type MultiTimeframeSnapshot,
} from "../../contracts/src/index.js";
import type { DataSyncAgent, MarketDataInput } from "../../core/src/ports.js";

export type Timeframe = "5m" | "15m" | "1h";

export interface HistoricalCandleSource {
  loadBars(symbol: string, timeframe: Timeframe): Promise<readonly MarketBar[]>;
}

export interface HistoricalDataSyncOptions {
  readonly barsPerTimeframe?: number;
}

/**
 * A look-ahead-safe DataSync implementation. Each stable bar has to be fully
 * closed at `asOf`; the live quote is derived from the last known 5m close.
 */
export class HistoricalDataSyncAgent implements DataSyncAgent {
  readonly name = "historical_data_sync_agent";
  readonly version = "v1";
  private readonly barsPerTimeframe: number;

  constructor(
    private readonly source: HistoricalCandleSource,
    options: HistoricalDataSyncOptions = {},
  ) {
    this.barsPerTimeframe = options.barsPerTimeframe ?? 240;
  }

  async run(input: MarketDataInput): Promise<MultiTimeframeSnapshot> {
    const stableBars = await Promise.all(
      input.timeframes.map(async (timeframe) => [timeframe, await this.closedBars(input.symbol, timeframe, input.asOf)] as const),
    );
    const byTimeframe = Object.fromEntries(stableBars) as Record<Timeframe, MarketBar[]>;
    const missingTimeframes = input.timeframes.filter((timeframe) => byTimeframe[timeframe].length === 0);
    const warnings = missingTimeframes.map((timeframe) => `no closed ${timeframe} bars at ${input.asOf.toISOString()}`);
    const last5m = byTimeframe["5m"].at(-1);
    const fallback = byTimeframe["15m"].at(-1) ?? byTimeframe["1h"].at(-1);
    const latest = last5m ?? fallback;
    if (!latest) {
      throw new Error(`no historical bars available for ${input.symbol} at ${input.asOf.toISOString()}`);
    }

    return MultiTimeframeSnapshotSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      traceId: input.traceId,
      asOf: input.asOf,
      symbol: input.symbol,
      stableBars: {
        "5m": byTimeframe["5m"],
        "15m": byTimeframe["15m"],
        "1h": byTimeframe["1h"],
      },
      liveQuote: { price: latest.close, observedAt: latest.closeTime },
      quality: {
        alignmentOk: missingTimeframes.length === 0,
        missingTimeframes,
        warnings,
      },
    });
  }

  private async closedBars(symbol: string, timeframe: Timeframe, asOf: Date): Promise<MarketBar[]> {
    const all = await this.source.loadBars(symbol, timeframe);
    return all
      .filter((bar) => bar.closeTime.getTime() <= asOf.getTime())
      .sort((left, right) => left.closeTime.getTime() - right.closeTime.getTime())
      .slice(-this.barsPerTimeframe);
  }
}

export class InMemoryHistoricalCandleSource implements HistoricalCandleSource {
  constructor(private readonly bars: ReadonlyMap<string, ReadonlyMap<Timeframe, readonly MarketBar[]>>) {}

  async loadBars(symbol: string, timeframe: Timeframe): Promise<readonly MarketBar[]> {
    return this.bars.get(symbol)?.get(timeframe) ?? [];
  }
}
