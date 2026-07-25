import {
  BacktestReportSchema,
  BacktestRequestSchema,
  SCHEMA_VERSION,
  type BacktestReport,
  type BacktestRequest,
  type ClosedTrade,
  type CycleRequest,
  type EquityPoint,
  type PortfolioState,
} from "../../contracts/src/index.js";
import type { TradingApplication } from "../../core/src/trading-application.js";

export interface BacktestAccountPort {
  markToMarket(markPrices: Readonly<Record<string, number>>): PortfolioState;
  forceCloseAll(markPrices: Readonly<Record<string, number>>, asOf: Date, traceId: string): unknown;
  getClosedTrades(): readonly ClosedTrade[];
}

export interface BacktestService { run(request: BacktestRequest): Promise<BacktestReport>; }

/** Runs the production DecisionPipeline against historical ports and a simulated account. */
export class PipelineBacktestService implements BacktestService {
  constructor(private readonly application: TradingApplication, private readonly account?: BacktestAccountPort) {}

  async run(rawRequest: BacktestRequest): Promise<BacktestReport> {
    const request = BacktestRequestSchema.parse(rawRequest);
    const cycles = [];
    const equityCurve: EquityPoint[] = [];
    let peakEquity = request.initialCash;
    let lastMarks: Record<string, number> = {};
    for (const [index, asOf] of request.asOf.entries()) {
      const cycleRequest: CycleRequest = { schemaVersion: SCHEMA_VERSION, traceId: `${request.runId}:${index + 1}:${asOf.toISOString()}`, runMode: "backtest", asOf, strategyId: request.strategyId, configVersion: request.configVersion, symbols: request.symbols, executionEnabled: request.executionEnabled };
      const cycle = await this.application.runCycle(cycleRequest);
      cycles.push(cycle);
      lastMarks = cycle.markPrices;
      if (this.account) equityCurve.push(this.equityPoint(asOf, this.account.markToMarket(lastMarks), peakEquity));
      peakEquity = Math.max(peakEquity, equityCurve.at(-1)?.equity ?? peakEquity);
    }

    if (this.account && request.asOf.at(-1)) {
      this.account.forceCloseAll(lastMarks, request.asOf.at(-1)!, `${request.runId}:force_close`);
      equityCurve.push(this.equityPoint(request.asOf.at(-1)!, this.account.markToMarket(lastMarks), peakEquity));
    }
    const state = this.account?.markToMarket(lastMarks);
    const trades = this.account?.getClosedTrades() ?? [];
    const performance = state
      ? { initialCash: request.initialCash, finalCash: state.equity, realizedPnl: state.realizedPnl, fees: state.fees, totalReturnPct: (state.equity / request.initialCash - 1) * 100, unrealizedPnl: state.unrealizedPnl, maxDrawdownPct: Math.max(0, ...equityCurve.map((point) => point.drawdownPct)) }
      : this.fallbackPerformance(cycles, request.initialCash);
    return BacktestReportSchema.parse({
      schemaVersion: SCHEMA_VERSION, runId: request.runId, datasetId: request.datasetId, strategyId: request.strategyId, configVersion: request.configVersion, cycles,
      diagnostics: { cycleCount: cycles.length, decisionCount: cycles.reduce((total, cycle) => total + cycle.decisions.length, 0), filledOrderCount: cycles.reduce((total, cycle) => total + cycle.executions.filter((execution) => execution.status === "filled").length, 0), blockedCycleCount: cycles.filter((cycle) => cycle.status === "blocked").length },
      performance, equityCurve, trades, tradeStatistics: this.tradeStatistics(trades),
    });
  }

  private equityPoint(asOf: Date, state: PortfolioState, peakEquity: number): EquityPoint {
    return { asOf, cash: state.cash, equity: state.equity, realizedPnl: state.realizedPnl, unrealizedPnl: state.unrealizedPnl, drawdownPct: peakEquity > 0 ? Math.max(0, (peakEquity - state.equity) / peakEquity * 100) : 0 };
  }

  private fallbackPerformance(cycles: Awaited<ReturnType<TradingApplication["runCycle"]>>[], initialCash: number) {
    const executions = cycles.flatMap((cycle) => cycle.executions);
    const fees = executions.reduce((total, execution) => total + execution.fee, 0);
    const realizedPnl = executions.reduce((total, execution) => total + execution.realizedPnl, 0);
    const finalCash = initialCash + realizedPnl - fees;
    return { initialCash, finalCash, realizedPnl, fees, totalReturnPct: (finalCash / initialCash - 1) * 100, unrealizedPnl: 0, maxDrawdownPct: 0 };
  }

  private tradeStatistics(trades: readonly ClosedTrade[]) {
    const wins = trades.filter((trade) => trade.realizedPnl > 0);
    const losses = trades.filter((trade) => trade.realizedPnl < 0);
    const grossWin = wins.reduce((sum, trade) => sum + trade.realizedPnl, 0);
    const grossLoss = losses.reduce((sum, trade) => sum + Math.abs(trade.realizedPnl), 0);
    return { closedTradeCount: trades.length, winRatePct: trades.length === 0 ? 0 : wins.length / trades.length * 100, averageWin: wins.length === 0 ? 0 : grossWin / wins.length, averageLoss: losses.length === 0 ? 0 : grossLoss / losses.length, profitFactor: grossLoss === 0 ? null : grossWin / grossLoss };
  }
}
