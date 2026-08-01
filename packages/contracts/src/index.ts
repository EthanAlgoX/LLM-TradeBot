import { z } from "zod";
import { ReflectionLessonCandidateSchema } from "./semantic-agent-artifacts.js";

export const SCHEMA_VERSION = "v1" as const;

export const ActionSchema = z.enum([
  "open_long",
  "open_short",
  "close_long",
  "close_short",
  "hold",
  "wait",
]);
export type Action = z.infer<typeof ActionSchema>;

export const RunModeSchema = z.enum(["live", "paper", "backtest"]);
export type RunMode = z.infer<typeof RunModeSchema>;

export const TraceIdSchema = z.string().min(1);

export const MarketBarSchema = z.object({
  openTime: z.coerce.date(),
  closeTime: z.coerce.date(),
  open: z.number().positive(),
  high: z.number().positive(),
  low: z.number().positive(),
  close: z.number().positive(),
  volume: z.number().nonnegative(),
});
export type MarketBar = z.infer<typeof MarketBarSchema>;

export const DataQualitySchema = z.object({
  alignmentOk: z.boolean(),
  missingTimeframes: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type DataQuality = z.infer<typeof DataQualitySchema>;

export const MultiTimeframeSnapshotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  traceId: TraceIdSchema,
  asOf: z.coerce.date(),
  symbol: z.string().min(1),
  stableBars: z.object({
    "5m": z.array(MarketBarSchema),
    "15m": z.array(MarketBarSchema),
    "1h": z.array(MarketBarSchema),
  }),
  liveQuote: z.object({ price: z.number().positive(), observedAt: z.coerce.date() }),
  quality: DataQualitySchema,
});
export type MultiTimeframeSnapshot = z.infer<typeof MultiTimeframeSnapshotSchema>;

export const RankedSymbolSchema = z.object({
  symbol: z.string().min(1),
  // `0` means the candidate was evaluated but not admitted to the selected universe.
  rank: z.number().int().nonnegative(),
  score: z.number(),
  tradable: z.boolean(),
  selectedReasons: z.array(z.string()),
  rejectionReasons: z.array(z.string()),
});
export type RankedSymbol = z.infer<typeof RankedSymbolSchema>;

export const UniverseSetSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  traceId: TraceIdSchema,
  asOf: z.coerce.date(),
  candidates: z.array(RankedSymbolSchema),
});
export type UniverseSet = z.infer<typeof UniverseSetSchema>;

export const AnalysisBundleSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  traceId: TraceIdSchema,
  asOf: z.coerce.date(),
  symbol: z.string().min(1),
  regime: z.enum(["trending_up", "trending_down", "choppy", "volatile", "unknown"]),
  trend: z.enum(["long", "short", "neutral"]),
  setup: z.enum(["ready", "wait", "avoid"]),
  trigger: z.enum(["confirmed", "waiting", "unavailable"]),
  diagnostics: z.array(z.string()),
});
export type AnalysisBundle = z.infer<typeof AnalysisBundleSchema>;

export const TimeframeAnalysisSchema = z.object({
  trendScore: z.number().min(-100).max(100),
  oscillatorScore: z.number().min(-100).max(100),
  momentumPct: z.number(),
  rsi: z.number().min(0).max(100),
  volatilityPct: z.number().nonnegative(),
  volumeRatio: z.number().nonnegative(),
});
export type TimeframeAnalysis = z.infer<typeof TimeframeAnalysisSchema>;

export const QuantAnalysisSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  traceId: TraceIdSchema,
  asOf: z.coerce.date(),
  symbol: z.string().min(1),
  byTimeframe: z.object({ "5m": TimeframeAnalysisSchema, "15m": TimeframeAnalysisSchema, "1h": TimeframeAnalysisSchema }),
});
export type QuantAnalysis = z.infer<typeof QuantAnalysisSchema>;

export const RegimeAssessmentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  traceId: TraceIdSchema,
  symbol: z.string().min(1),
  regime: z.enum(["trending_up", "trending_down", "choppy", "volatile", "unknown"]),
  confidence: z.number().min(0).max(100),
  reason: z.string().min(1),
  openAllowed: z.boolean(),
});
export type RegimeAssessment = z.infer<typeof RegimeAssessmentSchema>;

export const TrendAssessmentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  traceId: TraceIdSchema,
  symbol: z.string().min(1),
  stance: z.enum(["long", "short", "neutral"]),
  strength: z.number().min(0).max(100),
  reasons: z.array(z.string()),
  invalidationConditions: z.array(z.string()),
});
export type TrendAssessment = z.infer<typeof TrendAssessmentSchema>;

export const SetupAssessmentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  traceId: TraceIdSchema,
  symbol: z.string().min(1),
  status: z.enum(["ready", "wait", "avoid"]),
  reasons: z.array(z.string()),
});
export type SetupAssessment = z.infer<typeof SetupAssessmentSchema>;

export const TriggerAssessmentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  traceId: TraceIdSchema,
  symbol: z.string().min(1),
  status: z.enum(["confirmed", "waiting", "unavailable"]),
  pattern: z.string(),
  relativeVolume: z.number().nonnegative(),
  reasons: z.array(z.string()),
});
export type TriggerAssessment = z.infer<typeof TriggerAssessmentSchema>;

export const DirectionalCaseSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  traceId: TraceIdSchema,
  symbol: z.string().min(1),
  side: z.enum(["long", "short"]),
  confidence: z.number().min(0).max(100),
  evidence: z.array(z.string()),
  invalidationConditions: z.array(z.string()),
  veto: z.boolean(),
});
export type DirectionalCase = z.infer<typeof DirectionalCaseSchema>;

export const OrderIntentSchema = z.object({
  symbol: z.string().min(1),
  action: z.enum(["open_long", "open_short", "close_long", "close_short"]),
  entryPrice: z.number().positive(),
  notional: z.number().positive(),
  stopLoss: z.number().nonnegative(),
  takeProfit: z.number().nonnegative(),
  leverage: z.number().positive(),
});
export type OrderIntent = z.infer<typeof OrderIntentSchema>;

export const DecisionBundleSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  traceId: TraceIdSchema,
  asOf: z.coerce.date(),
  symbol: z.string().min(1),
  action: ActionSchema,
  confidence: z.number().min(0).max(100),
  reason: z.string().min(1),
  evidence: z.array(z.string()),
  missingConfirmations: z.array(z.string()),
  orderIntent: OrderIntentSchema.optional(),
});
export type DecisionBundle = z.infer<typeof DecisionBundleSchema>;

export const RiskDecisionSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  traceId: TraceIdSchema,
  symbol: z.string().min(1),
  passed: z.boolean(),
  riskLevel: z.enum(["safe", "warning", "danger", "fatal"]),
  corrections: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string()),
  blockedReason: z.string().optional(),
});
export type RiskDecision = z.infer<typeof RiskDecisionSchema>;

export const OpenPositionSchema = z.object({
  positionId: z.string().min(1).optional(),
  tradeId: z.string().min(1).optional(),
  symbol: z.string().min(1),
  side: z.enum(["long", "short"]),
  qty: z.number().positive(),
  entryPrice: z.number().positive(),
  leverage: z.number().positive(),
  margin: z.number().positive(),
  stopLoss: z.number().nonnegative(),
  takeProfit: z.number().nonnegative(),
  openedAt: z.coerce.date(),
  openingFee: z.number().nonnegative(),
  entryConfidence: z.number().min(0).max(100).optional(),
  entryOrderId: z.string().min(1).optional(),
  entryTraceId: z.string().min(1).optional(),
  entryDecisionArtifactId: z.string().min(1).optional(),
  entryPortfolioArtifactId: z.string().min(1).optional(),
  entryRiskArtifactId: z.string().min(1).optional(),
  entryExecutionArtifactId: z.string().min(1).optional(),
  entryFillId: z.string().min(1).optional(),
});
export type OpenPosition = z.infer<typeof OpenPositionSchema>;

export const ClosedTradeSchema = z.object({
  tradeId: z.string().min(1).optional(),
  positionId: z.string().min(1).optional(),
  symbol: z.string().min(1),
  side: z.enum(["long", "short"]),
  qty: z.number().positive(),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive(),
  openedAt: z.coerce.date(),
  closedAt: z.coerce.date(),
  exitReason: z.string().min(1),
  realizedPnl: z.number(),
  fees: z.number().nonnegative(),
  entryConfidence: z.number().min(0).max(100).optional(),
  entryOrderId: z.string().min(1).optional(),
  entryTraceId: z.string().min(1).optional(),
  entryDecisionArtifactId: z.string().min(1).optional(),
  entryPortfolioArtifactId: z.string().min(1).optional(),
  entryRiskArtifactId: z.string().min(1).optional(),
  entryExecutionArtifactId: z.string().min(1).optional(),
  entryFillId: z.string().min(1).optional(),
  exitOrderId: z.string().min(1).optional(),
  exitTraceId: z.string().min(1).optional(),
  exitDecisionArtifactId: z.string().min(1).optional(),
  exitPortfolioArtifactId: z.string().min(1).optional(),
  exitRiskArtifactId: z.string().min(1).optional(),
  exitExecutionArtifactId: z.string().min(1).optional(),
  exitFillId: z.string().min(1).optional(),
});
export type ClosedTrade = z.infer<typeof ClosedTradeSchema>;

export const PortfolioStateSchema = z.object({
  cash: z.number(),
  usedMargin: z.number().nonnegative(),
  equity: z.number(),
  realizedPnl: z.number(),
  unrealizedPnl: z.number(),
  fees: z.number().nonnegative(),
  positions: z.array(OpenPositionSchema),
});
export type PortfolioState = z.infer<typeof PortfolioStateSchema>;

export const EquityPointSchema = z.object({
  asOf: z.coerce.date(),
  cash: z.number(),
  equity: z.number(),
  realizedPnl: z.number(),
  unrealizedPnl: z.number(),
  drawdownPct: z.number().nonnegative(),
});
export type EquityPoint = z.infer<typeof EquityPointSchema>;

export const TradeStatisticsSchema = z.object({
  closedTradeCount: z.number().int().nonnegative(),
  winRatePct: z.number().min(0).max(100),
  averageWin: z.number().nonnegative(),
  averageLoss: z.number().nonnegative(),
  profitFactor: z.number().nonnegative().nullable(),
});
export type TradeStatistics = z.infer<typeof TradeStatisticsSchema>;

export const LocalOrderSnapshotSchema = z.object({
  localOrderId: z.string().min(1),
  clientOrderId: z.string().min(1).optional(),
  exchangeOrderId: z.string().min(1).optional(),
  symbol: z.string().min(1),
  action: z.enum(["open_long", "open_short", "close_long", "close_short"]),
  status: z.enum(["pending", "submitted", "filled", "rejected", "canceled"]),
  requestedQty: z.number().positive(),
  executedQty: z.number().nonnegative(),
  requestedPrice: z.number().positive(),
  createdAt: z.coerce.date(),
  traceId: z.string().min(1).optional(),
  tradeId: z.string().min(1).optional(),
  positionId: z.string().min(1).optional(),
  riskArtifactId: z.string().min(1).optional(),
  executionArtifactId: z.string().min(1).optional(),
  fillId: z.string().min(1).optional(),
  fee: z.number().nonnegative().optional(),
  realizedPnl: z.number().optional(),
});
export type LocalOrderSnapshot = z.infer<typeof LocalOrderSnapshotSchema>;

export const PaperAccountStateSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  cash: z.number(),
  realizedPnl: z.number(),
  fees: z.number().nonnegative(),
  positions: z.array(OpenPositionSchema),
  closedTrades: z.array(ClosedTradeSchema),
  orders: z.array(LocalOrderSnapshotSchema).default([]),
});
export type PaperAccountState = z.infer<typeof PaperAccountStateSchema>;

export const ExchangePositionSnapshotSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["long", "short"]),
  qty: z.number().positive(),
  entryPrice: z.number().positive(),
});
export type ExchangePositionSnapshot = z.infer<typeof ExchangePositionSnapshotSchema>;

export const ReconciliationReportSchema = z.object({
  accountId: z.string().min(1),
  checkedAt: z.coerce.date(),
  onlyLocal: z.array(OpenPositionSchema),
  onlyRemote: z.array(ExchangePositionSnapshotSchema),
  mismatches: z.array(z.object({ symbol: z.string().min(1), reason: z.string().min(1) })),
  matchedCount: z.number().int().nonnegative(),
});
export type ReconciliationReport = z.infer<typeof ReconciliationReportSchema>;

export const ExchangeOrderSnapshotSchema = z.object({
  orderId: z.string().min(1),
  clientOrderId: z.string().min(1).optional(),
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  status: z.string().min(1),
  originalQty: z.number().positive(),
  executedQty: z.number().nonnegative(),
  price: z.number().nonnegative(),
  reduceOnly: z.boolean(),
});
export type ExchangeOrderSnapshot = z.infer<typeof ExchangeOrderSnapshotSchema>;

export const RemoteAccountSnapshotSchema = z.object({
  asOf: z.coerce.date(),
  totalWalletBalance: z.number(),
  availableBalance: z.number(),
  positions: z.array(ExchangePositionSnapshotSchema),
  openOrders: z.array(ExchangeOrderSnapshotSchema),
});
export type RemoteAccountSnapshot = z.infer<typeof RemoteAccountSnapshotSchema>;

export const OrderReconciliationReportSchema = z.object({
  accountId: z.string().min(1),
  checkedAt: z.coerce.date(),
  onlyLocal: z.array(LocalOrderSnapshotSchema),
  onlyRemote: z.array(ExchangeOrderSnapshotSchema),
  mismatches: z.array(z.object({ localOrderId: z.string().min(1), remoteOrderId: z.string().min(1), reason: z.string().min(1) })),
  matchedCount: z.number().int().nonnegative(),
});
export type OrderReconciliationReport = z.infer<typeof OrderReconciliationReportSchema>;

export const AccountReconciliationReportSchema = z.object({
  accountId: z.string().min(1),
  checkedAt: z.coerce.date(),
  remoteAsOf: z.coerce.date(),
  positions: ReconciliationReportSchema,
  orders: OrderReconciliationReportSchema,
  hasDrift: z.boolean(),
});
export type AccountReconciliationReport = z.infer<typeof AccountReconciliationReportSchema>;

export const PolicyAdjustmentSchema = z.object({
  scope: z.enum(["entry_confidence_min", "leverage_cap", "symbol_cooldown"]),
  value: z.number().nonnegative(),
  maxValue: z.number().nonnegative(),
  expiresAt: z.coerce.date(),
  reason: z.string().min(1),
});
export type PolicyAdjustment = z.infer<typeof PolicyAdjustmentSchema>;

export const LlmReflectionAuditSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  fallbackUsed: z.boolean(),
  errorCategory: z.enum(["timeout", "api_error", "invalid_output", "disabled"]).optional(),
});
export type LlmReflectionAudit = z.infer<typeof LlmReflectionAuditSchema>;

export const ReflectionReportSchema = z.object({
  reflectionId: z.string().min(1),
  asOf: z.coerce.date(),
  sampleSize: z.number().int().nonnegative(),
  winRatePct: z.number().min(0).max(100),
  averageWin: z.number().nonnegative(),
  averageLoss: z.number().nonnegative(),
  longTradeCount: z.number().int().nonnegative(),
  shortTradeCount: z.number().int().nonnegative(),
  confidenceCalibration: z.enum(["unavailable", "aligned", "overconfident_losses"]),
  recommendations: z.array(z.string()),
  adjustments: z.array(PolicyAdjustmentSchema),
  sourceTradeIds: z.array(z.string().min(1)).optional(),
  semanticLessonCandidates: z.array(ReflectionLessonCandidateSchema).optional(),
  llmAudit: LlmReflectionAuditSchema.optional(),
}).strict();
export type ReflectionReport = z.infer<typeof ReflectionReportSchema>;

export const AgentRuntimeConfigSchema = z.object({
  llm: z.object({
    bullCaseEnabled: z.boolean().default(false),
    bearCaseEnabled: z.boolean().default(false),
    reflectionEnabled: z.boolean().default(false),
    timeoutMs: z.number().int().positive().default(15_000),
    fallbackToRules: z.boolean().default(true),
  }).default({}),
});
export type AgentRuntimeConfig = z.infer<typeof AgentRuntimeConfigSchema>;

export const ExecutionResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  traceId: TraceIdSchema,
  symbol: z.string().min(1),
  action: ActionSchema,
  status: z.enum(["filled", "rejected", "skipped"]),
  message: z.string(),
  fillPrice: z.number().positive().optional(),
  fee: z.number().nonnegative().default(0),
  realizedPnl: z.number().default(0),
  closedTrade: ClosedTradeSchema.optional(),
  localOrderId: z.string().min(1).optional(),
  tradeId: z.string().min(1).optional(),
  positionId: z.string().min(1).optional(),
  fillId: z.string().min(1).optional(),
  executionArtifactId: z.string().min(1).optional(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

export const CycleRequestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  traceId: TraceIdSchema,
  runMode: RunModeSchema,
  asOf: z.coerce.date(),
  strategyId: z.string().min(1),
  configVersion: z.string().min(1),
  symbols: z.array(z.string().min(1)).optional(),
  executionEnabled: z.boolean(),
  executionMode: z.enum(["normal", "close_only"]).optional(),
});
export type CycleRequest = z.infer<typeof CycleRequestSchema>;

export const CycleResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  traceId: TraceIdSchema,
  asOf: z.coerce.date(),
  universe: UniverseSetSchema,
  decisions: z.array(DecisionBundleSchema),
  riskDecisions: z.array(RiskDecisionSchema),
  executions: z.array(ExecutionResultSchema),
  markPrices: z.record(z.string(), z.number().positive()),
  status: z.enum(["ok", "partial", "blocked", "failed"]),
});
export type CycleResult = z.infer<typeof CycleResultSchema>;

export const BacktestRequestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  runId: z.string().min(1),
  datasetId: z.string().min(1),
  strategyId: z.string().min(1),
  configVersion: z.string().min(1),
  asOf: z.array(z.coerce.date()).min(1),
  symbols: z.array(z.string().min(1)).optional(),
  executionEnabled: z.boolean().default(true),
  initialCash: z.number().positive().default(10_000),
});
export type BacktestRequest = z.infer<typeof BacktestRequestSchema>;

export const BacktestReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  runId: z.string().min(1),
  datasetId: z.string().min(1),
  strategyId: z.string().min(1),
  configVersion: z.string().min(1),
  cycles: z.array(CycleResultSchema),
  diagnostics: z.object({
    cycleCount: z.number().int().nonnegative(),
    decisionCount: z.number().int().nonnegative(),
    filledOrderCount: z.number().int().nonnegative(),
    blockedCycleCount: z.number().int().nonnegative(),
  }),
  performance: z.object({
    initialCash: z.number().positive(),
    finalCash: z.number(),
    realizedPnl: z.number(),
    fees: z.number().nonnegative(),
    totalReturnPct: z.number(),
    unrealizedPnl: z.number(),
    maxDrawdownPct: z.number().nonnegative(),
  }),
  equityCurve: z.array(EquityPointSchema),
  trades: z.array(ClosedTradeSchema),
  tradeStatistics: TradeStatisticsSchema,
});
export type BacktestReport = z.infer<typeof BacktestReportSchema>;

export const ExperimentParameterValueSchema = z.union([z.number(), z.string(), z.boolean()]);
export type ExperimentParameterValue = z.infer<typeof ExperimentParameterValueSchema>;
export const ParameterGridSchema = z.record(z.string().min(1), z.array(ExperimentParameterValueSchema).min(1));
export type ParameterGrid = z.infer<typeof ParameterGridSchema>;
export const ExperimentParametersSchema = z.record(z.string().min(1), ExperimentParameterValueSchema);
export type ExperimentParameters = z.infer<typeof ExperimentParametersSchema>;

export const BacktestExperimentRequestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  experimentId: z.string().min(1),
  datasetId: z.string().min(1),
  strategyId: z.string().min(1),
  configFingerprint: z.string().min(1),
  profileVersion: z.string().min(1).optional(),
  grid: ParameterGridSchema,
  baseline: ExperimentParametersSchema.optional(),
});
export type BacktestExperimentRequest = z.infer<typeof BacktestExperimentRequestSchema>;

export const BacktestExperimentTrialSchema = z.object({
  trialId: z.string().min(1),
  parameters: ExperimentParametersSchema,
  parameterFingerprint: z.string().min(1),
  totalReturnPct: z.number(),
  maxDrawdownPct: z.number().nonnegative(),
  closedTradeCount: z.number().int().nonnegative(),
  winRatePct: z.number().min(0).max(100),
  fees: z.number().nonnegative(),
  rejectedActionRatePct: z.number().min(0).max(100),
  score: z.number(),
  baselineDelta: z.object({ totalReturnPct: z.number(), maxDrawdownPct: z.number(), closedTradeCount: z.number() }).optional(),
});
export type BacktestExperimentTrial = z.infer<typeof BacktestExperimentTrialSchema>;

export const BacktestExperimentReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  experimentId: z.string().min(1),
  datasetId: z.string().min(1),
  strategyId: z.string().min(1),
  configFingerprint: z.string().min(1),
  profileVersion: z.string().min(1).optional(),
  baseline: BacktestExperimentTrialSchema.optional(),
  trials: z.array(BacktestExperimentTrialSchema),
});
export type BacktestExperimentReport = z.infer<typeof BacktestExperimentReportSchema>;

export const WalkForwardPlanSchema = z.object({
  mode: z.enum(["rolling", "expanding"]),
  trainingCycles: z.number().int().positive(),
  validationCycles: z.number().int().positive(),
  stepCycles: z.number().int().positive(),
});
export type WalkForwardPlan = z.infer<typeof WalkForwardPlanSchema>;

export const WalkForwardRequestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  runId: z.string().min(1),
  datasetId: z.string().min(1),
  strategyId: z.string().min(1),
  configFingerprint: z.string().min(1),
  profileVersion: z.string().min(1).optional(),
  asOf: z.array(z.coerce.date()).min(1),
  grid: ParameterGridSchema,
  plan: WalkForwardPlanSchema,
});
export type WalkForwardRequest = z.infer<typeof WalkForwardRequestSchema>;

export const WalkForwardFoldSchema = z.object({
  foldId: z.string().min(1),
  trainingStart: z.coerce.date(),
  trainingEnd: z.coerce.date(),
  validationStart: z.coerce.date(),
  validationEnd: z.coerce.date(),
  selected: BacktestExperimentTrialSchema,
  validation: BacktestExperimentTrialSchema,
});
export type WalkForwardFold = z.infer<typeof WalkForwardFoldSchema>;

export const WalkForwardReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  runId: z.string().min(1),
  datasetId: z.string().min(1),
  strategyId: z.string().min(1),
  configFingerprint: z.string().min(1),
  profileVersion: z.string().min(1).optional(),
  plan: WalkForwardPlanSchema,
  folds: z.array(WalkForwardFoldSchema),
  outOfSample: z.object({ averageReturnPct: z.number(), worstDrawdownPct: z.number().nonnegative(), closedTradeCount: z.number().int().nonnegative(), averageWinRatePct: z.number().min(0).max(100) }),
  parameterStability: z.object({ distinctParameterCount: z.number().int().nonnegative(), mostSelectedFingerprint: z.string().optional(), selections: z.record(z.string(), z.number().int().positive()) }),
});
export type WalkForwardReport = z.infer<typeof WalkForwardReportSchema>;

export const RuntimeDashboardSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatedAt: z.coerce.date(),
  accountId: z.string().min(1),
  account: z.object({
    status: z.enum(["available", "unavailable"]),
    cash: z.number().optional(), equity: z.number().optional(), realizedPnl: z.number().optional(), fees: z.number().nonnegative().optional(),
    openPositionCount: z.number().int().nonnegative().optional(), closedTradeCount: z.number().int().nonnegative().optional(),
  }),
  trace: z.object({
    status: z.enum(["available", "unavailable"]), traceId: z.string().optional(), eventCount: z.number().int().nonnegative().optional(), riskRejectedCount: z.number().int().nonnegative().optional(),
    executionActions: z.array(z.string()).optional(), fallbackCount: z.number().int().nonnegative().optional(), errorCount: z.number().int().nonnegative().optional(),
  }),
  reflection: z.object({
    status: z.enum(["available", "unavailable"]), reflectionId: z.string().optional(), recommendations: z.array(z.string()).optional(), adjustmentCount: z.number().int().nonnegative().optional(),
    provider: z.string().optional(), model: z.string().optional(), fallbackUsed: z.boolean().optional(), errorCategory: z.string().optional(),
  }),
  safety: z.object({
    status: z.enum(["available", "unavailable"]), consecutiveFailures: z.number().int().nonnegative().optional(), cooldownUntil: z.coerce.date().optional(), lastFailure: z.string().optional(),
  }),
  latestCycle: z.object({ status: z.enum(["available", "unavailable"]), traceId: z.string().optional(), asOf: z.coerce.date().optional(), cycleStatus: z.string().optional(), executionCount: z.number().int().nonnegative().optional(), decisionCount: z.number().int().nonnegative().optional(), strategyId: z.string().optional(), profileVersion: z.string().optional(), configVersion: z.string().optional(), dataSourceKind: z.string().optional(), dataSourceIdentifier: z.string().optional() }),
});
export type RuntimeDashboard = z.infer<typeof RuntimeDashboardSchema>;

export const PaperWatchPlanSchema = z.object({
  cycles: z.number().int().min(1).max(1_000),
  intervalMs: z.number().int().nonnegative(),
  executionEnabled: z.boolean().default(false),
  continueOnError: z.boolean().default(false),
});
export type PaperWatchPlan = z.infer<typeof PaperWatchPlanSchema>;
export const PaperWatchCycleSchema = z.object({
  cycle: z.number().int().positive(), startedAt: z.coerce.date(), finishedAt: z.coerce.date(), status: z.enum(["ok", "error"]), error: z.string().optional(),
});
export type PaperWatchCycle = z.infer<typeof PaperWatchCycleSchema>;
export const PaperWatchReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION), plan: PaperWatchPlanSchema, cycles: z.array(PaperWatchCycleSchema), successCount: z.number().int().nonnegative(), errorCount: z.number().int().nonnegative(), stoppedEarly: z.boolean(),
});
export type PaperWatchReport = z.infer<typeof PaperWatchReportSchema>;

export const RuntimeSafetyPolicySchema = z.object({
  maxConsecutiveFailures: z.number().int().positive().default(3),
  cooldownMs: z.number().int().nonnegative().default(300_000),
  maxExecutionsPerCycle: z.number().int().nonnegative().default(1),
});
export type RuntimeSafetyPolicy = z.infer<typeof RuntimeSafetyPolicySchema>;
export const RuntimeSafetyStateSchema = z.object({
  consecutiveFailures: z.number().int().nonnegative(), cooldownUntil: z.coerce.date().optional(), lastFailure: z.string().optional(), updatedAt: z.coerce.date(),
});
export type RuntimeSafetyState = z.infer<typeof RuntimeSafetyStateSchema>;
export const RuntimeSafetyDecisionSchema = z.object({ allowed: z.boolean(), reason: z.enum(["cooldown"]).optional(), state: RuntimeSafetyStateSchema });
export type RuntimeSafetyDecision = z.infer<typeof RuntimeSafetyDecisionSchema>;

export const DataQualityPolicySchema = z.object({
  minBars5m: z.number().int().nonnegative().default(50), minBars15m: z.number().int().nonnegative().default(50), minBars1h: z.number().int().nonnegative().default(50),
  requireAlignment: z.boolean().default(true), maxQuoteAgeMs: z.number().int().nonnegative().default(900_000),
});
export type DataQualityPolicy = z.infer<typeof DataQualityPolicySchema>;
export const DataQualityDecisionSchema = z.object({ passed: z.boolean(), reasons: z.array(z.string()) });
export type DataQualityDecision = z.infer<typeof DataQualityDecisionSchema>;

export const AccountRiskPolicySchema = z.object({
  maxOpenPositions: z.number().int().positive().default(1), maxUsedMarginPct: z.number().positive().max(100).default(50), maxOrderNotional: z.number().positive().default(1_000),
  /** Net realized loss cap (including accumulated fees); omitted means disabled. */
  maxCumulativeRealizedLoss: z.number().positive().optional(),
  /** Equity loss percentage relative to inferred initial equity; omitted means disabled. */
  maxEquityLossPct: z.number().positive().max(100).optional(),
});
export type AccountRiskPolicy = z.infer<typeof AccountRiskPolicySchema>;
export const AccountRiskDecisionSchema = z.object({
  passed: z.boolean(), reasons: z.array(z.string()), projectedUsedMarginPct: z.number().nonnegative().optional(), cumulativeRealizedLoss: z.number().nonnegative().optional(), equityLossPct: z.number().nonnegative().optional(),
});
export type AccountRiskDecision = z.infer<typeof AccountRiskDecisionSchema>;

/** Versioned, portable policy used by both historical and paper runtimes. */
export const StrategyProfileSchema = z.object({
  profileId: z.string().min(1),
  profileVersion: z.string().min(1),
  selector: z.object({ topN: z.number().int().positive(), minQuoteVolume24h: z.number().nonnegative(), minPrice: z.number().positive(), minTrendStrength: z.number().nonnegative(), minVolatilityPct: z.number().nonnegative(), maxVolatilityPct: z.number().positive() }).strict(),
  dataQuality: DataQualityPolicySchema,
  decision: z.object({ perTradeNotional: z.number().positive(), leverage: z.number().positive(), minimumConfidence: z.number().min(0).max(100) }).strict(),
  risk: z.object({ maxLeverage: z.number().positive(), maxNotional: z.number().positive() }).strict(),
  accountRisk: AccountRiskPolicySchema,
  execution: z.object({ initialCash: z.number().positive(), feeBps: z.number().nonnegative(), slippageBps: z.number().nonnegative(), maxExecutionsPerCycle: z.number().int().positive() }).strict(),
  llm: z.object({ enabled: z.boolean(), timeoutMs: z.number().int().positive(), fallbackToRules: z.boolean() }).strict(),
}).strict();
export type StrategyProfile = z.infer<typeof StrategyProfileSchema>;
export const StrategyProfileOverrideSchema = StrategyProfileSchema.deepPartial().strict();
export type StrategyProfileOverride = z.infer<typeof StrategyProfileOverrideSchema>;

/** Provenance record for a reproducible run. It contains identifiers and hashes, never credentials or prompts. */
export const RunManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  runId: z.string().min(1),
  runMode: RunModeSchema,
  createdAt: z.coerce.date(),
  strategyId: z.string().min(1),
  profileVersion: z.string().min(1).optional(),
  configFingerprint: z.string().min(1),
  dataSource: z.object({ kind: z.enum(["csv", "binance_futures_public"]), identifier: z.string().min(1), contentFingerprint: z.string().min(1).optional(), observedAt: z.coerce.date().optional() }).strict(),
  symbols: z.array(z.string().min(1)).min(1),
  timeRange: z.object({ start: z.coerce.date().optional(), end: z.coerce.date().optional() }).strict(),
}).strict();
export type RunManifest = z.infer<typeof RunManifestSchema>;

export const ProfileInspectionSchema = z.object({
  profile: StrategyProfileSchema,
  fingerprint: z.string().min(1),
  llm: z.object({ enabled: z.boolean(), explicitlyAuthorized: z.boolean(), warning: z.string().optional() }).strict(),
  riskGuards: z.object({ maxOpenPositions: z.number().int().positive(), maxUsedMarginPct: z.number().positive(), maxOrderNotional: z.number().positive(), maxCumulativeRealizedLoss: z.number().positive().nullable(), maxEquityLossPct: z.number().positive().nullable() }).strict(),
  warnings: z.array(z.string()),
}).strict();
export type ProfileInspection = z.infer<typeof ProfileInspectionSchema>;

export const PaperCycleRecordSchema = z.object({
  recordId: z.string().min(1), accountId: z.string().min(1), traceId: z.string().min(1), asOf: z.coerce.date(), status: z.enum(["ok", "partial", "blocked", "failed"]), executionEnabled: z.boolean(), strategyId: z.string().min(1).optional(), profileVersion: z.string().min(1).optional(), configVersion: z.string().min(1).optional(), dataSource: z.object({ kind: z.string().min(1), identifier: z.string().min(1), contentFingerprint: z.string().min(1).optional(), observedAt: z.coerce.date().optional() }).strict().optional(), decisionCount: z.number().int().nonnegative(), riskDecisionCount: z.number().int().nonnegative(), executionCount: z.number().int().nonnegative(),
});
export type PaperCycleRecord = z.infer<typeof PaperCycleRecordSchema>;

/** Append-only, sanitized evidence for one Agent invocation within a decision trace. */
export const AgentArtifactSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION), artifactId: z.string().min(1), traceId: TraceIdSchema, asOf: z.coerce.date(), symbol: z.string().min(1).optional(),
  stage: z.string().min(1), agent: z.string().min(1), agentVersion: z.string().min(1), status: z.enum(["success", "fallback", "error"]),
  startedAt: z.coerce.date(), completedAt: z.coerce.date(), durationMs: z.number().nonnegative(),
  input: z.unknown(), output: z.unknown().optional(), error: z.string().min(1).optional(), orderId: z.string().min(1).optional(), tradeId: z.string().min(1).optional(),
  sourceArtifactIds: z.array(z.string().min(1)).max(100).optional(),
}).strict();
export type AgentArtifact = z.infer<typeof AgentArtifactSchema>;
export const AgentArtifactQuerySchema = z.object({ traceId: TraceIdSchema.optional(), orderId: z.string().min(1).optional(), tradeId: z.string().min(1).optional(), symbol: z.string().min(1).optional(), stage: z.string().min(1).optional(), limit: z.number().int().positive().max(500).default(100) }).strict().refine((value) => Boolean(value.traceId || value.orderId || value.tradeId), "traceId, orderId, or tradeId is required");
export type AgentArtifactQuery = z.infer<typeof AgentArtifactQuerySchema>;

export const TradeReviewSchema = z.object({ traceId: TraceIdSchema, symbol: z.string().min(1).optional(), orderId: z.string().min(1).optional(), artifactCount: z.number().int().nonnegative(), fallbackCount: z.number().int().nonnegative(), errorCount: z.number().int().nonnegative(), timeline: z.array(z.object({ artifactId: z.string().min(1), stage: z.string().min(1), agent: z.string().min(1), agentVersion: z.string().min(1), status: z.enum(["success", "fallback", "error"]), symbol: z.string().min(1).optional(), startedAt: z.coerce.date(), durationMs: z.number().nonnegative(), summary: z.string().min(1) })), decision: z.object({ action: z.string().optional(), confidence: z.number().optional() }).optional(), risk: z.object({ passed: z.boolean().optional(), blockedReason: z.string().optional() }).optional(), execution: z.object({ status: z.string().optional(), orderId: z.string().optional(), message: z.string().optional() }).optional() }).strict();
export type TradeReview = z.infer<typeof TradeReviewSchema>;

export const StageEventSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  traceId: TraceIdSchema,
  stage: z.string().min(1),
  agent: z.string().min(1),
  phase: z.enum(["start", "end", "fallback", "error"]),
  at: z.coerce.date(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type StageEvent = z.infer<typeof StageEventSchema>;

export const EntityLifecycleStatusSchema = z.enum([
  "draft",
  "validated",
  "approved",
  "active",
  "deprecated",
  "archived",
]);
export type EntityLifecycleStatus = z.infer<typeof EntityLifecycleStatusSchema>;

export const ObservationWindowKindSchema = z.enum([
  "bar_interval",
  "rolling_window",
  "event_batch",
  "reporting_period",
]);
export type ObservationWindowKind = z.infer<typeof ObservationWindowKindSchema>;

export const ObservationTimeUnitSchema = z.enum([
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "quarter",
]);
export type ObservationTimeUnit = z.infer<typeof ObservationTimeUnitSchema>;

export const ObservationWindowSchema = z.object({
  kind: ObservationWindowKindSchema,
  value: z.number().int().positive(),
  unit: ObservationTimeUnitSchema,
}).strict();
export type ObservationWindow = z.infer<typeof ObservationWindowSchema>;

const VersionedEntityFields = {
  schemaVersion: z.literal(SCHEMA_VERSION),
  humanReadableVersion: z.string().min(1),
  fingerprint: z.string().min(1),
  lifecycleStatus: EntityLifecycleStatusSchema,
  createdAt: z.coerce.date(),
};

export const MarketPackDefinitionSchema = z.object({
  ...VersionedEntityFields,
  marketPackId: z.string().min(1),
  name: z.string().min(1),
  market: z.string().min(1),
  timezone: z.string().min(1),
  tradingCalendar: z.string().min(1),
  marketSchemaRef: z.string().min(1),
  schemaRefs: z.array(z.string().min(1)).min(1),
  capabilities: z.array(z.string().min(1)),
  executionModes: z.array(z.enum(["backtest", "paper", "read_only"])).min(1),
}).strict();
export type MarketPackDefinition = z.infer<typeof MarketPackDefinitionSchema>;

export const DataSourceKindSchema = z.enum([
  "public_api",
  "private_read_api",
  "historical_file",
  "database",
  "event_feed",
]);
export type DataSourceKind = z.infer<typeof DataSourceKindSchema>;

export const MarketDataTypeSchema = z.enum([
  "ohlcv",
  "tick",
  "orderbook",
  "news",
  "fundamental",
  "macro",
  "alternative",
]);
export type MarketDataType = z.infer<typeof MarketDataTypeSchema>;

export const DataSourceDefinitionSchema = z.object({
  ...VersionedEntityFields,
  dataSourceId: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().min(1),
  sourceKind: DataSourceKindSchema,
  connectorRef: z.string().min(1),
  marketPackRefs: z.array(z.string().min(1)).min(1),
  marketSchemaRefs: z.array(z.string().min(1)).min(1),
  capabilityRefs: z.array(z.string().min(1)).min(1),
  readOnly: z.boolean(),
}).strict();
export type DataSourceDefinition = z.infer<typeof DataSourceDefinitionSchema>;

export const DataSourceCapabilitySchema = z.object({
  ...VersionedEntityFields,
  capabilityId: z.string().min(1),
  dataSourceId: z.string().min(1),
  markets: z.array(z.string().min(1)).min(1),
  marketPackRefs: z.array(z.string().min(1)).min(1),
  schemaRefs: z.array(z.string().min(1)).min(1),
  dataTypes: z.array(MarketDataTypeSchema).min(1),
  nativeObservationWindows: z.array(ObservationWindowSchema),
  historyStart: z.coerce.date().optional(),
  supportsRealtime: z.boolean(),
  updateCadence: ObservationWindowSchema.optional(),
  timezone: z.string().min(1),
  timestampSemantics: z.enum(["event_time", "publish_time", "open_time", "close_time"]),
  tradingCalendar: z.string().min(1),
  aggregation: z.object({
    allowed: z.boolean(),
    transformerVersion: z.string().min(1).optional(),
    closedWindowsOnly: z.boolean(),
  }).strict(),
  completeness: z.number().min(0).max(1),
  latencyMs: z.number().nonnegative().optional(),
}).strict();
export type DataSourceCapability = z.infer<typeof DataSourceCapabilitySchema>;

export const DataLineageSchema = z.object({
  ...VersionedEntityFields,
  lineageId: z.string().min(1),
  dataSourceId: z.string().min(1),
  capabilityId: z.string().min(1),
  sourceWindow: ObservationWindowSchema,
  targetWindow: ObservationWindowSchema,
  transformation: z.enum(["native", "aggregate"]),
  transformerVersion: z.string().min(1),
  timezone: z.string().min(1),
  tradingCalendar: z.string().min(1),
  sourceSchemaRef: z.string().min(1),
  targetSchemaRef: z.string().min(1),
  asOfPolicy: z.literal("closed_windows_only"),
}).strict();
export type DataLineage = z.infer<typeof DataLineageSchema>;

export const AgentRoleSchema = z.enum([
  "selector",
  "data_sync",
  "data_quality",
  "processing",
  "analysis",
  "bull_case",
  "bear_case",
  "context",
  "decision",
  "portfolio",
  "risk",
  "execution",
  "position_monitor",
  "reflection",
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const AgentPermissionSchema = z.enum([
  "observe",
  "analyze",
  "propose_decision",
  "propose_close_only",
  "allocate_portfolio",
  "veto_risk",
  "execute_paper",
  "reflect",
]);
export type AgentPermission = z.infer<typeof AgentPermissionSchema>;

export const AgentPortSchema = z.object({
  portId: z.string().min(1),
  schemaRefs: z.array(z.string().min(1)).min(1),
  required: z.boolean(),
  external: z.boolean(),
}).strict();
export type AgentPort = z.infer<typeof AgentPortSchema>;

export const AgentTemplateSchema = z.object({
  ...VersionedEntityFields,
  templateId: z.string().min(1),
  name: z.string().min(1),
  role: AgentRoleSchema,
  implementationRef: z.string().min(1),
  configSchemaRef: z.string().min(1),
  inputPorts: z.array(AgentPortSchema),
  outputPorts: z.array(AgentPortSchema),
  supportedMarkets: z.array(z.string().min(1)).min(1),
  supportedMarketPackRefs: z.array(z.string().min(1)).min(1),
  supportedDataTypes: z.array(MarketDataTypeSchema),
  permissions: z.array(AgentPermissionSchema),
  timeoutPolicy: z.object({
    maxDurationMs: z.number().int().positive(),
    onTimeout: z.enum(["fail", "use_fallback", "continue_degraded"]),
    fallbackTemplateId: z.string().min(1).optional(),
  }).strict(),
  fallbackPolicy: z.object({
    supported: z.boolean(),
    fallbackTemplateIds: z.array(z.string().min(1)),
  }).strict(),
  allowsFeedback: z.boolean(),
}).strict();
export type AgentTemplate = z.infer<typeof AgentTemplateSchema>;

export const InputRequirementSchema = z.enum(["required", "optional", "fallback"]);
export type InputRequirement = z.infer<typeof InputRequirementSchema>;

export const FailurePolicySchema = z.object({
  mode: InputRequirementSchema,
  onFailure: z.enum(["block_openings", "continue_degraded", "use_fallback"]),
  fallbackNodeId: z.string().min(1).optional(),
}).strict();
export type FailurePolicy = z.infer<typeof FailurePolicySchema>;

export const AgentConfigSchema = z.object({
  ...VersionedEntityFields,
  agentConfigId: z.string().min(1),
  templateId: z.string().min(1),
  templateVersion: z.string().min(1),
  market: z.string().min(1),
  marketPackRef: z.string().min(1),
  schemaRefs: z.array(z.string().min(1)).min(1),
  dataSourceRefs: z.array(z.string().min(1)),
  observationRequests: z.array(z.object({
    portId: z.string().min(1),
    dataSourceId: z.string().min(1),
    capabilityId: z.string().min(1).optional(),
    window: ObservationWindowSchema,
    requirement: InputRequirementSchema,
    fallbackDataSourceId: z.string().min(1).optional(),
  }).strict()),
  config: z.record(z.string(), z.unknown()),
}).strict();
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const PipelineNodeSchema = z.object({
  nodeId: z.string().min(1),
  displayName: z.string().min(1),
  agentConfigId: z.string().min(1),
  required: z.boolean(),
  failurePolicy: FailurePolicySchema,
}).strict();
export type PipelineNode = z.infer<typeof PipelineNodeSchema>;

export const PipelineEdgeSchema = z.object({
  edgeId: z.string().min(1),
  fromNodeId: z.string().min(1),
  fromPort: z.string().min(1),
  toNodeId: z.string().min(1),
  toPort: z.string().min(1),
  kind: z.enum(["data", "control", "post_process", "fallback", "feedback"]),
  required: z.boolean(),
  feedbackPolicy: z.object({
    maxIterations: z.number().int().positive(),
    delayMs: z.number().int().nonnegative(),
  }).strict().optional(),
}).strict();
export type PipelineEdge = z.infer<typeof PipelineEdgeSchema>;

export const PipelineReleaseGateSchema = z.enum([
  "contract_validation",
  "backtest",
  "walk_forward",
  "human_approval",
  "paper_running",
]);
export type PipelineReleaseGate = z.infer<typeof PipelineReleaseGateSchema>;

export const PipelineGraphVersionSchema = z.object({
  ...VersionedEntityFields,
  pipelineGraphId: z.string().min(1),
  name: z.string().min(1),
  market: z.string().min(1),
  marketPackRef: z.string().min(1),
  schemaRefs: z.array(z.string().min(1)).min(1),
  dataSourceRefs: z.array(z.string().min(1)),
  nodes: z.array(PipelineNodeSchema).min(1),
  edges: z.array(PipelineEdgeSchema),
  entryNodeIds: z.array(z.string().min(1)).min(1),
  terminalNodeIds: z.array(z.string().min(1)).min(1),
  dataLineage: z.array(DataLineageSchema),
  releaseGates: z.array(PipelineReleaseGateSchema).min(1),
}).strict();
export type PipelineGraphVersion = z.infer<typeof PipelineGraphVersionSchema>;

export const PipelineValidationCodeSchema = z.enum([
  "INVALID_GRAPH_CONTRACT",
  "DUPLICATE_NODE_ID",
  "DUPLICATE_EDGE_ID",
  "UNKNOWN_ENTRY_NODE",
  "UNKNOWN_TERMINAL_NODE",
  "UNKNOWN_EDGE_SOURCE",
  "UNKNOWN_EDGE_TARGET",
  "UNKNOWN_AGENT_CONFIG",
  "UNKNOWN_AGENT_TEMPLATE",
  "AGENT_TEMPLATE_VERSION_MISMATCH",
  "PORT_NOT_FOUND",
  "SCHEMA_INCOMPATIBLE",
  "MARKET_PACK_NOT_FOUND",
  "MARKET_PACK_MISMATCH",
  "MARKET_UNSUPPORTED",
  "DATA_SOURCE_NOT_FOUND",
  "DATA_CAPABILITY_NOT_FOUND",
  "DATA_SOURCE_TYPE_UNSUPPORTED",
  "OBSERVATION_WINDOW_UNSUPPORTED",
  "UPSAMPLING_FORBIDDEN",
  "DATA_LINEAGE_REQUIRED",
  "DATA_LINEAGE_INVALID",
  "REQUIRED_INPUT_MISSING",
  "DANGLING_NODE",
  "UNREACHABLE_NODE",
  "CYCLE_NOT_ALLOWED",
  "FEEDBACK_POLICY_INCOMPLETE",
  "DECISION_BOUNDARY_BYPASSED",
  "RISK_BOUNDARY_BYPASSED",
  "EXECUTION_BOUNDARY_BYPASSED",
  "FAILURE_POLICY_INCOMPLETE",
  "FALLBACK_NODE_INVALID",
  "RELEASE_GATES_INCOMPLETE",
]);
export type PipelineValidationCode = z.infer<typeof PipelineValidationCodeSchema>;

export const PipelineValidationIssueSchema = z.object({
  issueId: z.string().min(1),
  code: PipelineValidationCodeSchema,
  severity: z.enum(["error", "warning"]),
  entityType: z.enum(["graph", "node", "edge", "agent_config", "agent_template", "data_source", "capability", "lineage"]),
  entityId: z.string().min(1).optional(),
  path: z.array(z.union([z.string(), z.number()])),
  details: z.record(z.string(), z.unknown()),
}).strict();
export type PipelineValidationIssue = z.infer<typeof PipelineValidationIssueSchema>;

export const PipelineValidationResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  pipelineGraphId: z.string().min(1),
  graphVersion: z.string().min(1),
  valid: z.boolean(),
  issues: z.array(PipelineValidationIssueSchema),
  summary: z.object({
    errorCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type PipelineValidationResult = z.infer<typeof PipelineValidationResultSchema>;

export interface Agent<Input, Output> {
  readonly name: string;
  readonly version: string;
  run(input: Input): Promise<Output>;
}
export * from "./orchestration-evidence.js";
export * from "./historical-evidence-artifact.js";
export * from "./approved-paper-plan.js";
export * from "./paper-runtime-run.js";
export * from "./paper-runtime-operations.js";
export * from "./paper-runtime-launch.js";
export * from "./runtime-evidence-read-model.js";
export * from "./causal-trade-review.js";
export * from "./trade-lineage.js";
export * from "./comparative-trade-evidence.js";
export * from "./lesson-candidate-validation-handoff.js";
export * from "./lesson-evidence-gate.js";
export * from "./lesson-human-approval.js";
export * from "./approved-lesson-materialization.js";
export * from "./shadow-replay-audit.js";
export * from "./paper-runtime-supervision.js";
export * from "./operational-delivery.js";
export * from "./operational-retention.js";
export * from "./semantic-agent-artifacts.js";
export * from "./semantic-pipeline-preset.js";
export * from "./orchestration-intent.js";
export * from "./orchestration-copilot.js";
export * from "./historical-graph-execution.js";
export * from "./graph-backtest-evidence.js";
export * from "./configuration-drafts.js";
export * from "./strategy-evidence-approval.js";
export * from "./executable-strategy-configuration.js";
export * from "./configurable-semantic-pipeline.js";
export * from "./historical-semantic-evaluation.js";
export * from "./data-center.js";
