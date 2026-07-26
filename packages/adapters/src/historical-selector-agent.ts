import {
  SCHEMA_VERSION,
  UniverseSetSchema,
  type RankedSymbol,
  type UniverseSet,
} from "../../contracts/src/index.js";
import type { SelectionInput, SelectorAgent } from "../../core/src/ports.js";

export interface SelectorMarketMetrics {
  readonly symbol: string;
  readonly quoteVolume24h: number;
  readonly price: number;
  readonly momentum30mPct: number;
  readonly trendStrength: number;
  readonly volatilityPct: number;
}

export interface SelectorMetricsPort {
  getMetrics(asOf: Date, symbols: readonly string[]): Promise<readonly SelectorMarketMetrics[]>;
}

export interface SelectorPolicy {
  readonly candidates: readonly string[];
  readonly topN: number;
  readonly minQuoteVolume24h: number;
  readonly minPrice: number;
  readonly minTrendStrength: number;
  readonly minVolatilityPct: number;
  readonly maxVolatilityPct: number;
}

const defaultPolicy: SelectorPolicy = {
  candidates: [],
  topN: 1,
  minQuoteVolume24h: 5_000_000,
  minPrice: 0.05,
  minTrendStrength: 20,
  minVolatilityPct: 0.2,
  maxVolatilityPct: 12,
};

/**
 * Selector implementation without simulated scores. A symbol must first be
 * tradable, then it is ranked by directional opportunity at the current asOf.
 */
export class MarketOpportunitySelectorAgent implements SelectorAgent {
  readonly name = "market_opportunity_selector_agent";
  readonly version = "v1";
  private readonly policy: SelectorPolicy;

  constructor(private readonly metrics: SelectorMetricsPort, policy: Partial<SelectorPolicy> & Pick<SelectorPolicy, "candidates">) {
    this.policy = { ...defaultPolicy, ...policy };
  }

  async run({ request }: SelectionInput): Promise<UniverseSet> {
    const symbols = request.symbols ?? this.policy.candidates;
    const metrics = await this.metrics.getMetrics(request.asOf, symbols);
    const rows = metrics.map((metric) => this.toRankedSymbol(metric));
    rows.sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));

    let selected = 0;
    for (const row of rows) {
      if (row.tradable && selected < this.policy.topN) {
        selected += 1;
        row.rank = selected;
      } else {
        row.tradable = false;
        if (selected >= this.policy.topN && row.rejectionReasons.length === 0) {
          row.rejectionReasons.push(`outside top ${this.policy.topN} opportunity ranking`);
        }
      }
    }

    return UniverseSetSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      traceId: request.traceId,
      asOf: request.asOf,
      candidates: rows,
    });
  }

  private toRankedSymbol(metric: SelectorMarketMetrics): RankedSymbol {
    const rejectionReasons: string[] = [];
    if (metric.quoteVolume24h < this.policy.minQuoteVolume24h) rejectionReasons.push("insufficient 24h quote volume");
    if (metric.price < this.policy.minPrice) rejectionReasons.push("price below configured floor");
    if (metric.trendStrength < this.policy.minTrendStrength) rejectionReasons.push("weak directional trend");
    if (metric.volatilityPct < this.policy.minVolatilityPct || metric.volatilityPct > this.policy.maxVolatilityPct) {
      rejectionReasons.push("volatility outside tradable range");
    }
    const directionalScore = Math.min(100, Math.abs(metric.momentum30mPct) * 20);
    const trendScore = Math.min(100, metric.trendStrength);
    const liquidityScore = Math.min(100, Math.log10(Math.max(metric.quoteVolume24h, 1)) / 10 * 100);
    const volatilityCenter = (this.policy.minVolatilityPct + this.policy.maxVolatilityPct) / 2;
    const volatilityScore = Math.max(0, 100 - Math.abs(metric.volatilityPct - volatilityCenter) / volatilityCenter * 100);
    const score = directionalScore * 0.35 + trendScore * 0.35 + liquidityScore * 0.2 + volatilityScore * 0.1;

    return {
      symbol: metric.symbol,
      rank: 0,
      score: Number(score.toFixed(4)),
      tradable: rejectionReasons.length === 0,
      selectedReasons: [
        `30m directional score=${directionalScore.toFixed(1)}`,
        `trend strength=${trendScore.toFixed(1)}`,
        `24h quote volume=${metric.quoteVolume24h.toFixed(0)}`,
      ],
      rejectionReasons,
    };
  }
}

export class InMemorySelectorMetricsPort implements SelectorMetricsPort {
  constructor(private readonly metrics: readonly SelectorMarketMetrics[]) {}

  async getMetrics(_asOf: Date, symbols: readonly string[]): Promise<readonly SelectorMarketMetrics[]> {
    const allowed = new Set(symbols);
    return this.metrics.filter((metric) => allowed.has(metric.symbol));
  }
}
