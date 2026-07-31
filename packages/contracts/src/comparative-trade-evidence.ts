import { z } from "zod";
import {
  ArtifactFingerprintSchema,
  ArtifactSchemaReferenceSchema,
  VersionedEntityReferenceSchema,
} from "./semantic-agent-artifacts.js";

export const ComparativeTradeEvidenceSchemaVersion = "1.0.0" as const;

const StableIdSchema = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/u, "stable_id_format");

const HumanVersionSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[0-9A-Za-z][0-9A-Za-z._+-]*$/u, "human_version_format");

export const TradeOutcomeEvidenceSchema = z
  .object({
    schemaVersion: z.literal(ComparativeTradeEvidenceSchemaVersion),
    id: StableIdSchema,
    humanVersion: HumanVersionSchema,
    fingerprint: ArtifactFingerprintSchema,
    createdAt: z.string().datetime({ offset: true }),
    lifecycleStatus: z.literal("recorded"),
    tradeId: StableIdSchema,
    runId: StableIdSchema,
    traceId: StableIdSchema,
    symbol: z.string().min(1).max(80),
    side: z.enum(["long", "short"]),
    openedAt: z.string().datetime({ offset: true }),
    closedAt: z.string().datetime({ offset: true }),
    entryPrice: z.number().finite().nonnegative(),
    exitPrice: z.number().finite().nonnegative(),
    quantity: z.number().finite().positive(),
    realizedPnl: z.number().finite(),
    fees: z.number().finite().nonnegative(),
    closeReason: z.string().min(1).max(160),
    marketPackRef: VersionedEntityReferenceSchema,
    dataSourceRef: VersionedEntityReferenceSchema,
    pipelineGraphRef: VersionedEntityReferenceSchema,
    schemaRef: ArtifactSchemaReferenceSchema,
  })
  .strict()
  .superRefine((trade, context) => {
    if (Date.parse(trade.closedAt) < Date.parse(trade.openedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "trade_close_before_open",
        path: ["closedAt"],
      });
    }
  });

export const TradeComparisonPolicySchema = z
  .object({
    policyId: z.literal("most_recent_prior_same_graph_market_symbol"),
    samePipelineGraphFingerprint: z.literal(true),
    sameMarketPack: z.literal(true),
    sameSymbol: z.literal(true),
    priorClosedTradesOnly: z.literal(true),
    maximumComparators: z.number().int().min(1).max(10),
    serverSelected: z.literal(true),
  })
  .strict();

export const ComparativeTradeEvidenceIssueCodeSchema = z.enum([
  "COMPARATOR_NOT_AVAILABLE",
  "SELECTED_TRADE_NOT_REGISTERED",
  "COMPARISON_SCOPE_MISMATCH",
]);

export const TradeMetricComparisonSchema = z
  .object({
    metric: z.enum(["realized_pnl", "fees", "holding_duration_ms"]),
    unit: z.enum(["account_currency", "milliseconds"]),
    selectedValue: z.number().finite(),
    baselineValue: z.number().finite(),
    delta: z.number().finite(),
  })
  .strict();

export const ComparativeTradeEvidenceSchema = z
  .object({
    schemaVersion: z.literal(ComparativeTradeEvidenceSchemaVersion),
    id: StableIdSchema,
    humanVersion: HumanVersionSchema,
    fingerprint: ArtifactFingerprintSchema,
    createdAt: z.string().datetime({ offset: true }),
    lifecycleStatus: z.enum(["available", "insufficient_evidence", "stale"]),
    selectedTrade: TradeOutcomeEvidenceSchema,
    comparatorTrades: z.array(TradeOutcomeEvidenceSchema).max(10),
    baselineTradeId: StableIdSchema.optional(),
    policy: TradeComparisonPolicySchema,
    metrics: z.array(TradeMetricComparisonSchema).max(3),
    issueCodes: z.array(ComparativeTradeEvidenceIssueCodeSchema),
    causalClaim: z.literal(false),
    readOnly: z.literal(true),
    runtimeApplied: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict()
  .superRefine((evidence, context) => {
    const available = evidence.lifecycleStatus === "available";
    if (available && (evidence.comparatorTrades.length === 0 || !evidence.baselineTradeId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "available_comparison_requires_baseline",
        path: ["baselineTradeId"],
      });
    }
    if (!available && evidence.metrics.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "unavailable_comparison_has_metrics",
        path: ["metrics"],
      });
    }
  });

export const ComparativeTradeEvidenceRequestSchema = z
  .object({
    selectedTradeId: StableIdSchema,
  })
  .strict();

export const ReflectionCandidateInspectionRequestSchema = z
  .object({
    selectedTradeId: StableIdSchema,
  })
  .strict();

export const ReflectionCandidateReviewSummarySchema = z
  .object({
    schemaVersion: z.literal(ComparativeTradeEvidenceSchemaVersion),
    id: StableIdSchema,
    humanVersion: HumanVersionSchema,
    fingerprint: ArtifactFingerprintSchema,
    createdAt: z.string().datetime({ offset: true }),
    lifecycleStatus: z.literal("candidate"),
    sourceTradeId: StableIdSchema,
    sourceReflectionFingerprint: ArtifactFingerprintSchema,
    semanticCandidateRef: z.object({
      id: StableIdSchema,
      fingerprint: ArtifactFingerprintSchema,
    }).strict(),
    semanticFactsAvailable: z.literal(true),
    lineageStatus: z.literal("verified"),
    readOnly: z.literal(true),
    runtimeApplied: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();

export const LessonCandidateReviewDecisionSchema = z.enum([
  "accept_for_validation",
  "reject",
]);

export const LessonCandidateReviewCommandSchema = z
  .object({
    candidateId: StableIdSchema,
    candidateFingerprint: ArtifactFingerprintSchema,
    comparativeEvidenceId: StableIdSchema,
    comparativeEvidenceFingerprint: ArtifactFingerprintSchema,
    decision: LessonCandidateReviewDecisionSchema,
    rationale: z.string().trim().min(8).max(2_000),
    idempotencyKey: StableIdSchema,
  })
  .strict();

export const LessonCandidateReviewContextSchema = z
  .object({
    actorId: StableIdSchema,
    role: z.literal("approver"),
    authenticatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const LessonCandidateReviewRecordSchema = z
  .object({
    schemaVersion: z.literal(ComparativeTradeEvidenceSchemaVersion),
    id: StableIdSchema,
    humanVersion: HumanVersionSchema,
    fingerprint: ArtifactFingerprintSchema,
    createdAt: z.string().datetime({ offset: true }),
    lifecycleStatus: z.enum(["accepted_for_validation", "rejected"]),
    candidateId: StableIdSchema,
    candidateFingerprint: ArtifactFingerprintSchema,
    comparativeEvidenceId: StableIdSchema,
    comparativeEvidenceFingerprint: ArtifactFingerprintSchema,
    sourceTradeId: StableIdSchema,
    decision: LessonCandidateReviewDecisionSchema,
    rationale: z.string().min(8).max(2_000),
    reviewer: LessonCandidateReviewContextSchema,
    idempotencyKey: StableIdSchema,
    approvedLessonCreated: z.literal(false),
    strategyMutationCreated: z.literal(false),
    readOnlyEvidence: z.literal(true),
    runtimeApplied: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();

export const LessonCandidateReviewResponseSchema = z
  .object({
    review: LessonCandidateReviewRecordSchema,
    nextGate: z.enum([
      "contract_validation",
      "candidate_closed",
    ]),
    runtimeApplied: z.literal(false),
  })
  .strict();

export const LessonCandidateReviewHistoryRequestSchema = z
  .object({
    selectedTradeId: z.string().min(1).max(200),
    cursor: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/u).optional(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

export const LessonCandidateReviewHistoryResponseSchema = z
  .object({
    schemaVersion: z.literal(ComparativeTradeEvidenceSchemaVersion),
    id: z.string().min(1),
    humanVersion: z.string().min(1),
    fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    createdAt: z.string().datetime(),
    lifecycleStatus: z.enum(["available", "empty"]),
    selectedTradeId: z.string().min(1),
    candidateId: z.string().min(1),
    records: z.array(LessonCandidateReviewRecordSchema).max(20),
    nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/u).optional(),
    readOnly: z.literal(true),
    runtimeApplied: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();

export type TradeOutcomeEvidence = z.infer<typeof TradeOutcomeEvidenceSchema>;
export type TradeComparisonPolicy = z.infer<typeof TradeComparisonPolicySchema>;
export type ComparativeTradeEvidence = z.infer<typeof ComparativeTradeEvidenceSchema>;
export type ComparativeTradeEvidenceRequest = z.infer<
  typeof ComparativeTradeEvidenceRequestSchema
>;
export type ReflectionCandidateInspectionRequest = z.infer<
  typeof ReflectionCandidateInspectionRequestSchema
>;
export type ReflectionCandidateReviewSummary = z.infer<
  typeof ReflectionCandidateReviewSummarySchema
>;
export type LessonCandidateReviewCommand = z.infer<
  typeof LessonCandidateReviewCommandSchema
>;
export type LessonCandidateReviewContext = z.infer<
  typeof LessonCandidateReviewContextSchema
>;
export type LessonCandidateReviewRecord = z.infer<
  typeof LessonCandidateReviewRecordSchema
>;
export type LessonCandidateReviewResponse = z.infer<
  typeof LessonCandidateReviewResponseSchema
>;
export type LessonCandidateReviewHistoryRequest = z.infer<
  typeof LessonCandidateReviewHistoryRequestSchema
>;
export type LessonCandidateReviewHistoryResponse = z.infer<
  typeof LessonCandidateReviewHistoryResponseSchema
>;
