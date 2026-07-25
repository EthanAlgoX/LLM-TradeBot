import { AccountRiskDecisionSchema, AccountRiskPolicySchema, type AccountRiskDecision, type AccountRiskPolicy } from "../../contracts/src/index.js";
import type { PortfolioRiskAgent, PortfolioRiskInput } from "../../core/src/ports.js";

/** Account-level pre-execution guard. Closing actions remain available to reduce exposure. */
export class RulePortfolioRiskGuard implements PortfolioRiskAgent {
  readonly name = "rule_portfolio_risk_guard";
  readonly version = "v1";
  private readonly policy: AccountRiskPolicy;

  constructor(policy: Partial<AccountRiskPolicy> = {}) { this.policy = AccountRiskPolicySchema.parse(policy); }

  async run({ decision, state }: PortfolioRiskInput): Promise<AccountRiskDecision> {
    if (decision.action !== "open_long" && decision.action !== "open_short") return AccountRiskDecisionSchema.parse({ passed: true, reasons: [] });
    const intent = decision.orderIntent;
    if (!intent) return AccountRiskDecisionSchema.parse({ passed: false, reasons: ["opening decision has no order intent"] });
    const reasons: string[] = [];
    if (state.positions.length >= this.policy.maxOpenPositions) reasons.push(`maximum open positions reached: ${state.positions.length}/${this.policy.maxOpenPositions}`);
    if (intent.notional > this.policy.maxOrderNotional) reasons.push(`order notional exceeds account limit: ${intent.notional}/${this.policy.maxOrderNotional}`);
    const projectedUsedMargin = state.usedMargin + intent.notional / intent.leverage;
    const projectedUsedMarginPct = state.equity > 0 ? projectedUsedMargin / state.equity * 100 : Number.POSITIVE_INFINITY;
    if (projectedUsedMarginPct > this.policy.maxUsedMarginPct) reasons.push(`projected used margin exceeds account limit: ${projectedUsedMarginPct.toFixed(2)}%/${this.policy.maxUsedMarginPct}%`);
    const cumulativeRealizedLoss = Math.max(0, -(state.realizedPnl - state.fees));
    if (this.policy.maxCumulativeRealizedLoss !== undefined && cumulativeRealizedLoss >= this.policy.maxCumulativeRealizedLoss) reasons.push(`cumulative realized loss circuit breaker: ${cumulativeRealizedLoss.toFixed(2)}/${this.policy.maxCumulativeRealizedLoss}`);
    const inferredInitialEquity = state.equity - (state.realizedPnl + state.unrealizedPnl - state.fees);
    const equityLossPct = inferredInitialEquity > 0 ? Math.max(0, (inferredInitialEquity - state.equity) / inferredInitialEquity * 100) : 100;
    if (this.policy.maxEquityLossPct !== undefined && equityLossPct >= this.policy.maxEquityLossPct) reasons.push(`equity loss circuit breaker: ${equityLossPct.toFixed(2)}%/${this.policy.maxEquityLossPct}%`);
    return AccountRiskDecisionSchema.parse({ passed: reasons.length === 0, reasons, projectedUsedMarginPct, cumulativeRealizedLoss, equityLossPct });
  }
}
