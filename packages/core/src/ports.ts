import type {
  Agent,
  AgentArtifact,
  AgentArtifactQuery,
  AnalysisBundle,
  CycleRequest,
  DecisionBundle,
  DirectionalCase,
  ExecutionResult,
  MultiTimeframeSnapshot,
  OpenPosition,
  ClosedTrade,
  ReflectionReport,
  RuntimeSafetyState,
  DataQualityDecision,
  AccountRiskDecision,
  PortfolioState,
  PaperCycleRecord,
  RiskDecision,
  StageEvent,
  UniverseSet,
} from "../../contracts/src/index.js";

export interface SelectionInput {
  request: CycleRequest;
}

export interface MarketDataInput {
  traceId: string;
  asOf: Date;
  symbol: string;
  timeframes: readonly ["5m", "15m", "1h"];
}

export interface DecisionInput {
  request: CycleRequest;
  snapshot: MultiTimeframeSnapshot;
  analysis: AnalysisBundle;
  bullCase: DirectionalCase;
  bearCase: DirectionalCase;
}

export interface RiskInput {
  decision: DecisionBundle;
}
export interface PortfolioRiskInput { decision: DecisionBundle; state: PortfolioState; }

export interface ExecutionInput {
  decision: DecisionBundle;
  risk: RiskDecision;
}

export interface PositionMonitorInput {
  request: CycleRequest;
  snapshot: MultiTimeframeSnapshot;
  analysis: AnalysisBundle;
  position: OpenPosition;
}

export interface ReflectionInput { asOf: Date; trades: readonly ClosedTrade[]; }

export type SelectorAgent = Agent<SelectionInput, UniverseSet>;
export type DataSyncAgent = Agent<MarketDataInput, MultiTimeframeSnapshot>;
export type AnalysisAgent = Agent<MultiTimeframeSnapshot, AnalysisBundle>;
export type DirectionalCaseAgent = Agent<AnalysisBundle, DirectionalCase>;
export type DecisionAgent = Agent<DecisionInput, DecisionBundle>;
export type PortfolioAgent = Agent<readonly DecisionBundle[], DecisionBundle[]>;
export type RiskAgent = Agent<RiskInput, RiskDecision>;
export type ExecutionAgent = Agent<ExecutionInput, ExecutionResult>;
export type PositionMonitorAgent = Agent<PositionMonitorInput, DecisionBundle | undefined>;
export type ReflectionAgent = Agent<ReflectionInput, ReflectionReport | undefined>;
export type DataQualityAgent = Agent<MultiTimeframeSnapshot, DataQualityDecision>;
export type PortfolioRiskAgent = Agent<PortfolioRiskInput, AccountRiskDecision>;

export interface PositionStatePort {
  getOpenPositions(): Promise<readonly OpenPosition[]>;
}
export interface PortfolioStatePort { markToMarket(markPrices: Readonly<Record<string, number>>): PortfolioState; }

export interface TradeHistoryPort { getClosedTrades(): readonly ClosedTrade[]; }
export interface ReflectionStore { save(accountId: string, report: ReflectionReport): Promise<void>; latest(accountId: string): Promise<ReflectionReport | undefined>; }
export interface RuntimeSafetyStore { load(scope: string): Promise<RuntimeSafetyState | undefined>; save(scope: string, state: RuntimeSafetyState): Promise<void>; }
export interface PaperCycleJournal { append(record: PaperCycleRecord): Promise<void>; latest(accountId: string, limit?: number): Promise<readonly PaperCycleRecord[]>; }

export interface TraceSink {
  append(event: StageEvent): Promise<void>;
}
export interface ArtifactLedger { append(artifact: AgentArtifact): Promise<void>; query(query: AgentArtifactQuery): Promise<readonly AgentArtifact[]>; }

export interface Clock {
  now(): Date;
}
