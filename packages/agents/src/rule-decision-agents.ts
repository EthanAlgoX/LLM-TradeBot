import {
  AnalysisBundleSchema,
  DecisionBundleSchema,
  DirectionalCaseSchema,
  RiskDecisionSchema,
  SCHEMA_VERSION,
  type Agent,
  type AnalysisBundle,
  type DecisionBundle,
  type DirectionalCase,
  type RiskDecision,
} from "../../contracts/src/index.js";
import type { DecisionInput, PositionMonitorInput, RiskInput } from "../../core/src/ports.js";

abstract class RuleDirectionalCaseAgent implements Agent<AnalysisBundle, DirectionalCase> {
  abstract readonly name: string;
  readonly version = "v1";
  protected abstract readonly side: "long" | "short";

  async run(rawAnalysis: AnalysisBundle): Promise<DirectionalCase> {
    const analysis = AnalysisBundleSchema.parse(rawAnalysis);
    const sideMatches = analysis.trend === this.side;
    const setupReady = analysis.setup === "ready";
    const triggerConfirmed = analysis.trigger === "confirmed";
    const regimeAllowed = analysis.regime === "trending_up" || analysis.regime === "trending_down";
    const confidence = (sideMatches ? 45 : 0) + (setupReady ? 25 : 0) + (triggerConfirmed ? 20 : 0) + (regimeAllowed ? 10 : 0);
    return DirectionalCaseSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      traceId: analysis.traceId,
      symbol: analysis.symbol,
      side: this.side,
      confidence,
      evidence: [
        `trend=${analysis.trend}`,
        `setup=${analysis.setup}`,
        `trigger=${analysis.trigger}`,
        `regime=${analysis.regime}`,
      ],
      invalidationConditions: ["trend reverses", "setup becomes avoid", "regime no longer allows opening"],
      veto: !regimeAllowed || analysis.setup === "avoid",
    });
  }
}

export class RuleBullCaseAgent extends RuleDirectionalCaseAgent {
  readonly name = "rule_bull_case_agent";
  protected readonly side = "long" as const;
}

export class RuleBearCaseAgent extends RuleDirectionalCaseAgent {
  readonly name = "rule_bear_case_agent";
  protected readonly side = "short" as const;
}

export interface RuleDecisionConfig { readonly perTradeNotional?: number; readonly leverage?: number; readonly minimumConfidence?: number; }
export class RuleDecisionAgent implements Agent<DecisionInput, DecisionBundle> {
  readonly name = "rule_decision_agent";
  readonly version = "v1";
  private readonly config: Required<RuleDecisionConfig>;

  constructor(config: RuleDecisionConfig = {}) {
    this.config = { perTradeNotional: config.perTradeNotional ?? 1_000, leverage: config.leverage ?? 1.5, minimumConfidence: config.minimumConfidence ?? 60 };
  }

  async run(input: DecisionInput): Promise<DecisionBundle> {
    const winner = input.bullCase.confidence >= input.bearCase.confidence ? input.bullCase : input.bearCase;
    const action = winner.confidence >= this.config.minimumConfidence && !winner.veto
      ? winner.side === "long" ? "open_long" as const : "open_short" as const
      : "wait" as const;
    const price = input.snapshot.liveQuote.price;
    const orderIntent = action === "wait" ? undefined : {
      symbol: input.snapshot.symbol,
      action,
      entryPrice: price,
      notional: this.config.perTradeNotional,
      stopLoss: action === "open_long" ? price * 0.98 : price * 1.02,
      takeProfit: action === "open_long" ? price * 1.03 : price * 0.97,
      leverage: this.config.leverage,
    };
    return DecisionBundleSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      traceId: input.request.traceId,
      asOf: input.request.asOf,
      symbol: input.snapshot.symbol,
      action,
      confidence: winner.confidence,
      reason: action === "wait" ? "no directional case reached the minimum confidence" : `${winner.side} case selected`,
      evidence: winner.evidence,
      missingConfirmations: action === "wait" ? ["trend/setup/trigger confirmation"] : [],
      orderIntent,
    });
  }
}

/** Select one best new opening opportunity per cycle. Close/hold actions are retained. */
export class SingleBestPortfolioAgent implements Agent<readonly DecisionBundle[], DecisionBundle[]> {
  readonly name = "single_best_portfolio_agent";
  readonly version = "v1";

  async run(decisions: readonly DecisionBundle[]): Promise<DecisionBundle[]> {
    const exits = decisions.filter((decision) => decision.action === "close_long" || decision.action === "close_short");
    const opens = decisions.filter((decision) => decision.action === "open_long" || decision.action === "open_short");
    if (opens.length === 0) return exits;
    const winner = [...opens].sort((left, right) => right.confidence - left.confidence || left.symbol.localeCompare(right.symbol))[0];
    return winner ? [...exits, winner] : exits;
  }
}

export interface RuleRiskConfig { readonly maxLeverage?: number; readonly maxNotional?: number; }
export class RuleRiskAgent implements Agent<RiskInput, RiskDecision> {
  readonly name = "rule_risk_agent";
  readonly version = "v1";
  private readonly config: Required<RuleRiskConfig>;

  constructor(config: RuleRiskConfig = {}) { this.config = { maxLeverage: config.maxLeverage ?? 1.5, maxNotional: config.maxNotional ?? 3_333 }; }

  async run({ decision }: RiskInput): Promise<RiskDecision> {
    const intent = decision.orderIntent;
    if (!intent) return RiskDecisionSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId: decision.traceId, symbol: decision.symbol, passed: true, riskLevel: "safe", corrections: {}, warnings: [] });
    if (intent.action === "close_long" || intent.action === "close_short") {
      return RiskDecisionSchema.parse({ schemaVersion: SCHEMA_VERSION, traceId: decision.traceId, symbol: decision.symbol, passed: true, riskLevel: "safe", corrections: {}, warnings: [] });
    }
    const badStop = intent.action === "open_long" ? intent.stopLoss >= intent.entryPrice : intent.stopLoss <= intent.entryPrice;
    const blockedReason = intent.leverage > this.config.maxLeverage
      ? `leverage ${intent.leverage} exceeds ${this.config.maxLeverage}`
      : intent.notional > this.config.maxNotional
        ? `notional ${intent.notional} exceeds ${this.config.maxNotional}`
        : badStop ? "stop loss is on the wrong side of entry" : undefined;
    return RiskDecisionSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      traceId: decision.traceId,
      symbol: decision.symbol,
      passed: blockedReason === undefined,
      riskLevel: blockedReason ? "fatal" : "safe",
      corrections: {},
      warnings: [],
      blockedReason,
    });
  }
}

export interface PositionMonitorConfig { readonly maxHoldingMs?: number; }
export class RulePositionMonitorAgent implements Agent<PositionMonitorInput, DecisionBundle | undefined> {
  readonly name = "rule_position_monitor_agent";
  readonly version = "v1";
  private readonly maxHoldingMs: number;

  constructor(config: PositionMonitorConfig = {}) { this.maxHoldingMs = config.maxHoldingMs ?? 24 * 60 * 60 * 1_000; }

  async run({ request, snapshot, analysis, position }: PositionMonitorInput): Promise<DecisionBundle | undefined> {
    const price = snapshot.liveQuote.price;
    const stopHit = position.side === "long" ? price <= position.stopLoss : price >= position.stopLoss;
    const takeHit = position.side === "long" ? price >= position.takeProfit : price <= position.takeProfit;
    const reversal = position.side === "long" ? analysis.trend === "short" && analysis.trigger === "confirmed" : analysis.trend === "long" && analysis.trigger === "confirmed";
    const expired = request.asOf.getTime() - position.openedAt.getTime() >= this.maxHoldingMs;
    const reason = stopHit ? "stop_loss" : takeHit ? "take_profit" : reversal ? "trend_reversal" : expired ? "max_holding_time" : undefined;
    if (!reason) return undefined;
    const action = position.side === "long" ? "close_long" as const : "close_short" as const;
    return DecisionBundleSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      traceId: request.traceId,
      asOf: request.asOf,
      symbol: position.symbol,
      action,
      confidence: 100,
      reason,
      evidence: [`price=${price}`, `position side=${position.side}`, `analysis trend=${analysis.trend}`],
      missingConfirmations: [],
      orderIntent: { symbol: position.symbol, action, entryPrice: price, notional: position.qty * price, stopLoss: 0, takeProfit: 0, leverage: position.leverage },
    });
  }
}
