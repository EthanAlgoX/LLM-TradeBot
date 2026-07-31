import {
  ClosedTradeSchema,
  ExecutionResultSchema,
  OpenPositionSchema,
  PortfolioStateSchema,
  PaperAccountStateSchema,
  SCHEMA_VERSION,
  type ClosedTrade,
  type ExecutionResult,
  type OpenPosition,
  type PortfolioState,
  type PaperAccountState,
  type LocalOrderSnapshot,
} from "../../contracts/src/index.js";
import type { ExecutionAgent, ExecutionInput, PositionStatePort } from "../../core/src/ports.js";

export interface SimulatedExecutionConfig {
  readonly initialCash: number;
  readonly feeBps?: number;
  readonly slippageBps?: number;
  readonly state?: PaperAccountState;
}

/** Deterministic market-fill model shared by paper mode and backtests. */
export class SimulatedExecutionAgent implements ExecutionAgent, PositionStatePort {
  readonly name = "simulated_execution_agent";
  readonly version = "v1";
  private cash: number;
  private realizedPnl = 0;
  private fees = 0;
  private readonly positions = new Map<string, OpenPosition>();
  private readonly closedTrades: ClosedTrade[] = [];
  private readonly orders: LocalOrderSnapshot[] = [];
  private readonly feeBps: number;
  private readonly slippageBps: number;

  constructor(config: SimulatedExecutionConfig) {
    const state = config.state ? PaperAccountStateSchema.parse(config.state) : undefined;
    this.cash = state?.cash ?? config.initialCash;
    this.realizedPnl = state?.realizedPnl ?? 0;
    this.fees = state?.fees ?? 0;
    for (const position of state?.positions ?? []) this.positions.set(position.symbol, position);
    this.closedTrades.push(...(state?.closedTrades ?? []));
    this.orders.push(...(state?.orders ?? []));
    this.feeBps = config.feeBps ?? 3;
    this.slippageBps = config.slippageBps ?? 1;
  }

  async getOpenPositions(): Promise<readonly OpenPosition[]> {
    return [...this.positions.values()];
  }

  getClosedTrades(): readonly ClosedTrade[] {
    return [...this.closedTrades];
  }

  exportState(): PaperAccountState {
    return PaperAccountStateSchema.parse({ schemaVersion: SCHEMA_VERSION, cash: this.cash, realizedPnl: this.realizedPnl, fees: this.fees, positions: [...this.positions.values()], closedTrades: this.closedTrades, orders: this.orders });
  }

  getOrderJournal(): readonly LocalOrderSnapshot[] { return [...this.orders]; }

  markToMarket(markPrices: Readonly<Record<string, number>>): PortfolioState {
    const positions = [...this.positions.values()];
    const usedMargin = positions.reduce((sum, position) => sum + position.margin, 0);
    const unrealizedPnl = positions.reduce((sum, position) => {
      const price = markPrices[position.symbol] ?? position.entryPrice;
      const sign = position.side === "long" ? 1 : -1;
      return sum + (price - position.entryPrice) * position.qty * sign;
    }, 0);
    return PortfolioStateSchema.parse({
      cash: this.cash,
      usedMargin,
      equity: this.cash + usedMargin + unrealizedPnl,
      realizedPnl: this.realizedPnl,
      unrealizedPnl,
      fees: this.fees,
      positions,
    });
  }

  forceCloseAll(markPrices: Readonly<Record<string, number>>, asOf: Date, traceId: string): ExecutionResult[] {
    const results: ExecutionResult[] = [];
    for (const position of [...this.positions.values()]) {
      const reference = markPrices[position.symbol] ?? position.entryPrice;
      const action = position.side === "long" ? "close_long" as const : "close_short" as const;
      results.push(this.close(position, reference, action, asOf, traceId, "backtest_end_force_close"));
    }
    return results;
  }

  async run({ decision, evidence }: ExecutionInput): Promise<ExecutionResult> {
    const intent = decision.orderIntent;
    if (!intent) return this.result(decision, "skipped", "no executable order intent");
    const localOrderId = `paper:${this.orders.length + 1}`;
    const isOpen = intent.action === "open_long" || intent.action === "open_short";
    const result = isOpen
      ? this.open(decision, localOrderId, evidence)
      : this.closeFromDecision(decision, localOrderId, evidence);
    return this.recordOrder(decision, result, localOrderId, evidence);
  }

  private closeFromDecision(
    decision: ExecutionInput["decision"],
    localOrderId: string,
    evidence?: ExecutionInput["evidence"],
  ): ExecutionResult {
    const intent = decision.orderIntent!;
    const position = this.positions.get(intent.symbol);
    const expectedSide = intent.action === "close_long" ? "long" : "short";
    if (!position || position.side !== expectedSide) return this.result(decision, "rejected", "no matching simulated position");
    const closeAction = intent.action === "close_long" ? "close_long" as const : "close_short" as const;
    return this.close(position, intent.entryPrice, closeAction, decision.asOf, decision.traceId, decision.reason, localOrderId, evidence);
  }

  private recordOrder(
    decision: ExecutionInput["decision"],
    result: ExecutionResult,
    localOrderId: string,
    evidence?: ExecutionInput["evidence"],
  ): ExecutionResult {
    const intent = decision.orderIntent!;
    const order = {
      localOrderId,
      clientOrderId: `paper:${decision.traceId}:${intent.symbol}:${intent.action}`,
      symbol: intent.symbol,
      action: intent.action,
      status: result.status === "filled" ? "filled" as const : "rejected" as const,
      requestedQty: intent.notional / intent.entryPrice,
      executedQty: result.status === "filled" ? intent.notional / (result.fillPrice ?? intent.entryPrice) : 0,
      requestedPrice: intent.entryPrice,
      createdAt: decision.asOf,
      traceId: decision.traceId,
      ...(result.tradeId ? { tradeId: result.tradeId } : {}),
      ...(result.positionId ? { positionId: result.positionId } : {}),
      ...(evidence?.riskArtifactId ? { riskArtifactId: evidence.riskArtifactId } : {}),
      ...(evidence?.executionArtifactId ? { executionArtifactId: evidence.executionArtifactId } : {}),
      ...(result.fillId ? { fillId: result.fillId } : {}),
      fee: result.fee,
      realizedPnl: result.realizedPnl,
    } satisfies LocalOrderSnapshot;
    this.orders.push(order);
    return ExecutionResultSchema.parse({ ...result, localOrderId: order.localOrderId });
  }

  private open(
    decision: ExecutionInput["decision"],
    localOrderId: string,
    evidence?: ExecutionInput["evidence"],
  ): ExecutionResult {
    const intent = decision.orderIntent!;
    if (this.positions.has(intent.symbol)) return this.result(decision, "rejected", "position already open");
    const fillPrice = this.fillPrice(intent.entryPrice, intent.action);
    const fee = intent.notional * this.feeBps / 10_000;
    const margin = intent.notional / intent.leverage;
    if (margin + fee > this.cash) return this.result(decision, "rejected", "insufficient simulated cash");
    const tradeId = `trade:${localOrderId}`;
    const positionId = `position:${localOrderId}`;
    const fillId = `fill:${localOrderId}`;
    const position = OpenPositionSchema.parse({
      positionId,
      tradeId,
      symbol: intent.symbol,
      side: intent.action === "open_long" ? "long" : "short",
      qty: intent.notional / fillPrice,
      entryPrice: fillPrice,
      leverage: intent.leverage,
      margin,
      stopLoss: intent.stopLoss,
      takeProfit: intent.takeProfit,
      openedAt: decision.asOf,
      openingFee: fee,
      entryConfidence: decision.confidence,
      entryOrderId: localOrderId,
      entryTraceId: decision.traceId,
      ...(evidence?.decisionArtifactId ? { entryDecisionArtifactId: evidence.decisionArtifactId } : {}),
      ...(evidence?.portfolioArtifactId ? { entryPortfolioArtifactId: evidence.portfolioArtifactId } : {}),
      ...(evidence?.riskArtifactId ? { entryRiskArtifactId: evidence.riskArtifactId } : {}),
      ...(evidence?.executionArtifactId ? { entryExecutionArtifactId: evidence.executionArtifactId } : {}),
      entryFillId: fillId,
    });
    this.cash -= margin + fee;
    this.fees += fee;
    this.positions.set(position.symbol, position);
    return this.result(decision, "filled", "simulated opening fill", fillPrice, fee, 0, {
      tradeId,
      positionId,
      fillId,
      executionArtifactId: evidence?.executionArtifactId,
    });
  }

  private close(position: OpenPosition, referencePrice: number, action: "close_long" | "close_short", closedAt: Date, traceId: string, exitReason: string, localOrderId?: string, evidence?: ExecutionInput["evidence"]): ExecutionResult {
    const fillPrice = this.fillPrice(referencePrice, action);
    const exitNotional = position.qty * fillPrice;
    const fee = exitNotional * this.feeBps / 10_000;
    const sign = position.side === "long" ? 1 : -1;
    const realizedPnl = (fillPrice - position.entryPrice) * position.qty * sign;
    const exitOrderId = localOrderId ?? `paper:force-close:${this.closedTrades.length + 1}`;
    const tradeId = position.tradeId ?? `trade:${exitOrderId}`;
    const positionId = position.positionId ?? `position:${exitOrderId}`;
    const fillId = `fill:${exitOrderId}`;
    const trade = ClosedTradeSchema.parse({
      tradeId,
      positionId,
      symbol: position.symbol,
      side: position.side,
      qty: position.qty,
      entryPrice: position.entryPrice,
      exitPrice: fillPrice,
      openedAt: position.openedAt,
      closedAt,
      exitReason,
      realizedPnl,
      fees: position.openingFee + fee,
      entryConfidence: position.entryConfidence,
      ...(position.entryOrderId ? { entryOrderId: position.entryOrderId } : {}),
      ...(position.entryTraceId ? { entryTraceId: position.entryTraceId } : {}),
      ...(position.entryDecisionArtifactId ? { entryDecisionArtifactId: position.entryDecisionArtifactId } : {}),
      ...(position.entryPortfolioArtifactId ? { entryPortfolioArtifactId: position.entryPortfolioArtifactId } : {}),
      ...(position.entryRiskArtifactId ? { entryRiskArtifactId: position.entryRiskArtifactId } : {}),
      ...(position.entryExecutionArtifactId ? { entryExecutionArtifactId: position.entryExecutionArtifactId } : {}),
      ...(position.entryFillId ? { entryFillId: position.entryFillId } : {}),
      exitOrderId,
      exitTraceId: traceId,
      ...(evidence?.decisionArtifactId ? { exitDecisionArtifactId: evidence.decisionArtifactId } : {}),
      ...(evidence?.portfolioArtifactId ? { exitPortfolioArtifactId: evidence.portfolioArtifactId } : {}),
      ...(evidence?.riskArtifactId ? { exitRiskArtifactId: evidence.riskArtifactId } : {}),
      ...(evidence?.executionArtifactId ? { exitExecutionArtifactId: evidence.executionArtifactId } : {}),
      exitFillId: fillId,
    });
    this.cash += position.margin + realizedPnl - fee;
    this.realizedPnl += realizedPnl;
    this.fees += fee;
    this.positions.delete(position.symbol);
    this.closedTrades.push(trade);
    return ExecutionResultSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      traceId,
      symbol: position.symbol,
      action,
      status: "filled",
      message: "simulated closing fill",
      fillPrice,
      fee,
      realizedPnl,
      closedTrade: trade,
      tradeId,
      positionId,
      fillId,
      ...(evidence?.executionArtifactId ? { executionArtifactId: evidence.executionArtifactId } : {}),
    });
  }

  private fillPrice(reference: number, action: string): number {
    const buying = action === "open_long" || action === "close_short";
    const impact = this.slippageBps / 10_000;
    return reference * (buying ? 1 + impact : 1 - impact);
  }

  private result(decision: ExecutionInput["decision"], status: "filled" | "rejected" | "skipped", message: string, fillPrice?: number, fee = 0, realizedPnl = 0, lineage: { tradeId?: string; positionId?: string; fillId?: string; executionArtifactId?: string } = {}): ExecutionResult {
    return ExecutionResultSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId: decision.traceId, symbol: decision.symbol, action: decision.action, status, message, fillPrice, fee, realizedPnl, ...lineage });
  }
}
