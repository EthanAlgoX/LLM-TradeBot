import { readFile } from "node:fs/promises";
import { MarketBarSchema, type MarketBar } from "../../contracts/src/index.js";
import type { HistoricalCandleSource, Timeframe } from "./historical-data-sync-agent.js";

export interface CsvHistoricalCandleSourceOptions {
  readonly defaultTimeframe?: Timeframe;
}

/**
 * CSV adapter for historical datasets. Required columns are `ts`, `symbol`,
 * and `close`; OHLC and volume default to close/0 for compatibility with the
 * legacy dataset format. A `timeframe` column enables multi-timeframe input.
 */
export class CsvHistoricalCandleSource implements HistoricalCandleSource {
  private readonly bars = new Map<string, Map<Timeframe, MarketBar[]>>();
  private readonly defaultTimeframe: Timeframe;

  private constructor(options: CsvHistoricalCandleSourceOptions) {
    this.defaultTimeframe = options.defaultTimeframe ?? "1h";
  }

  static async fromFile(path: string, options: CsvHistoricalCandleSourceOptions = {}): Promise<CsvHistoricalCandleSource> {
    const source = new CsvHistoricalCandleSource(options);
    source.addCsv(await readFile(path, "utf8"));
    return source;
  }

  async loadBars(symbol: string, timeframe: Timeframe): Promise<readonly MarketBar[]> {
    return this.bars.get(symbol)?.get(timeframe) ?? [];
  }

  symbols(): string[] {
    return [...this.bars.keys()].sort();
  }

  private addCsv(csv: string): void {
    const [headerLine, ...lines] = csv.trim().split(/\r?\n/).filter(Boolean);
    if (!headerLine) throw new Error("CSV is empty");
    const headers = headerLine.split(",").map((value) => value.trim());
    for (const line of lines) {
      const values = line.split(",").map((value) => value.trim());
      const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
      const symbol = row.symbol;
      const close = Number(row.close);
      const openTime = new Date(row.ts);
      if (!symbol || !Number.isFinite(close) || close <= 0 || Number.isNaN(openTime.getTime())) continue;
      const timeframe = this.toTimeframe(row.timeframe);
      const duration = timeframe === "5m" ? 5 * 60_000 : timeframe === "15m" ? 15 * 60_000 : 60 * 60_000;
      const bar = MarketBarSchema.parse({
        openTime,
        closeTime: new Date(openTime.getTime() + duration),
        open: this.positiveOr(row.open, close),
        high: this.positiveOr(row.high, close),
        low: this.positiveOr(row.low, close),
        close,
        volume: this.nonNegativeOr(row.volume, 0),
      });
      const byTimeframe = this.bars.get(symbol) ?? new Map<Timeframe, MarketBar[]>();
      const bars = byTimeframe.get(timeframe) ?? [];
      bars.push(bar);
      byTimeframe.set(timeframe, bars);
      this.bars.set(symbol, byTimeframe);
    }
    for (const byTimeframe of this.bars.values()) {
      for (const bars of byTimeframe.values()) bars.sort((left, right) => left.closeTime.getTime() - right.closeTime.getTime());
    }
  }

  private toTimeframe(value: string | undefined): Timeframe {
    return value === "5m" || value === "15m" || value === "1h" ? value : this.defaultTimeframe;
  }

  private positiveOr(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private nonNegativeOr(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
}
