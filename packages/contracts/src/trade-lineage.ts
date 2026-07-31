import { z } from "zod";

const OpaqueIdSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9._:@/-]+$/);
const FingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const TradeEvidenceReferenceSchema = z
  .object({
    artifactId: OpaqueIdSchema,
    traceId: OpaqueIdSchema,
    stage: z.string().min(1).max(120),
    schemaRef: OpaqueIdSchema,
  })
  .strict();

export const OrderEvidenceReferenceSchema = z
  .object({
    orderId: OpaqueIdSchema,
    traceId: OpaqueIdSchema,
    executionArtifactId: OpaqueIdSchema.optional(),
    riskArtifactId: OpaqueIdSchema.optional(),
  })
  .strict();

export const FillEvidenceReferenceSchema = z
  .object({
    fillId: OpaqueIdSchema,
    orderId: OpaqueIdSchema,
    executionArtifactId: OpaqueIdSchema.optional(),
    fillPrice: z.number().positive(),
    fee: z.number().nonnegative(),
  })
  .strict();

export const PositionLifecycleReferenceSchema = z
  .object({
    positionId: OpaqueIdSchema,
    tradeId: OpaqueIdSchema,
    symbol: z.string().min(1).max(80),
    entryOrderId: OpaqueIdSchema.optional(),
    exitOrderId: OpaqueIdSchema.optional(),
  })
  .strict();

export const ClosedTradeReferenceSchema = z
  .object({
    tradeId: OpaqueIdSchema,
    positionId: OpaqueIdSchema.optional(),
    entryOrderId: OpaqueIdSchema.optional(),
    exitOrderId: OpaqueIdSchema.optional(),
    realizedPnl: z.number(),
    fees: z.number().nonnegative(),
  })
  .strict();

export const TradeCausalLinkSchema = z
  .object({
    linkId: OpaqueIdSchema,
    fromRef: OpaqueIdSchema,
    toRef: OpaqueIdSchema,
    relationship: z.enum([
      "explicit_artifact_input",
      "order_fill",
      "position_entry",
      "position_exit",
      "closed_trade",
      "reflection_source",
      "observed_sequence",
    ]),
    causal: z.boolean(),
  })
  .strict();

export const TradeReviewIssueCodeSchema = z.enum([
  "ENTRY_EVIDENCE_NOT_RECORDED",
  "EXIT_EVIDENCE_NOT_RECORDED",
  "FILL_EVIDENCE_NOT_RECORDED",
  "POSITION_LINEAGE_NOT_RECORDED",
  "EXPLICIT_LINEAGE_NOT_RECORDED",
  "REFLECTION_NOT_RECORDED",
  "REFLECTION_NOT_TRADE_LINKED",
  "ARTIFACT_DEGRADED",
  "ARTIFACT_ERROR",
]);

export const TradeReviewIssueSchema = z
  .object({
    code: TradeReviewIssueCodeSchema,
    severity: z.enum(["info", "warning", "error"]),
    message: z.string().min(1).max(500),
  })
  .strict();

export const TradeLifecycleLegSchema = z
  .object({
    orderId: OpaqueIdSchema.optional(),
    traceId: OpaqueIdSchema.optional(),
    decisionArtifactId: OpaqueIdSchema.optional(),
    portfolioArtifactId: OpaqueIdSchema.optional(),
    riskArtifactId: OpaqueIdSchema.optional(),
    executionArtifactId: OpaqueIdSchema.optional(),
    fillId: OpaqueIdSchema.optional(),
    fillPrice: z.number().positive().optional(),
    fee: z.number().nonnegative().optional(),
    occurredAt: z.string().datetime().optional(),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();

export const SingleTradeReviewSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    reviewId: OpaqueIdSchema,
    humanVersion: z.string().min(1).max(80),
    fingerprint: FingerprintSchema,
    createdAt: z.string().datetime(),
    lifecycleStatus: z.enum([
      "active_position",
      "closed_trade",
      "partial_evidence",
      "unavailable",
    ]),
    availability: z.enum(["available", "partial", "unavailable"]),
    runId: OpaqueIdSchema,
    cycle: z.number().int().positive(),
    traceId: OpaqueIdSchema,
    tradeRef: OpaqueIdSchema,
    tradeId: OpaqueIdSchema.optional(),
    positionId: OpaqueIdSchema.optional(),
    symbol: z.string().min(1).max(80).optional(),
    entry: TradeLifecycleLegSchema.optional(),
    exit: TradeLifecycleLegSchema.optional(),
    side: z.enum(["long", "short"]).optional(),
    quantity: z.number().positive().optional(),
    realizedPnl: z.number().optional(),
    fees: z.number().nonnegative().optional(),
    reflectionId: OpaqueIdSchema.optional(),
    reflectionCandidateOnly: z.literal(true),
    links: z.array(TradeCausalLinkSchema).max(200),
    issues: z.array(TradeReviewIssueSchema).max(100),
    marketPackRef: OpaqueIdSchema,
    dataSourceRef: z.string().min(1).max(200),
    graphRef: OpaqueIdSchema,
    schemaRefs: z.array(OpaqueIdSchema).min(1).max(20),
    readOnly: z.literal(true),
    runtimeApplied: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();

export type SingleTradeReview = z.infer<typeof SingleTradeReviewSchema>;
export type TradeReviewIssue = z.infer<typeof TradeReviewIssueSchema>;
