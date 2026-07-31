import { z } from "zod";
import {
  PaperRuntimeCycleAuditSchema,
  PaperRuntimeRunStatusSchema,
} from "./paper-runtime-run.js";
import { SingleTradeReviewSchema } from "./trade-lineage.js";

export const CausalReviewOpaqueIdSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9._:@/-]+$/);

export const CausalReviewFingerprintSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/);

export const CausalReviewLifecycleStatusSchema = z.enum([
  "active",
  "recent",
  "partial",
  "unavailable",
]);

export const CausalReviewDataClassSchema = z.enum([
  "runtime",
  "sample",
]);

export const CausalEvidenceAvailabilitySchema = z.enum([
  "available",
  "partial",
  "unavailable",
  "not_inspected",
]);

export const CausalReviewIssueCodeSchema = z.enum([
  "RUN_NOT_FOUND",
  "CYCLE_NOT_FOUND",
  "TRACE_NOT_RECORDED",
  "ARTIFACTS_NOT_RECORDED",
  "TRADE_NOT_FOUND",
  "EXPLICIT_LINEAGE_NOT_RECORDED",
  "ARTIFACT_DEGRADED",
  "ARTIFACT_ERROR",
  "SENSITIVE_EVIDENCE_REDACTED",
  "REFLECTION_NOT_RECORDED",
  "REFLECTION_NOT_CYCLE_LINKED",
  "ENTRY_EVIDENCE_NOT_RECORDED",
  "EXIT_EVIDENCE_NOT_RECORDED",
  "FILL_EVIDENCE_NOT_RECORDED",
  "POSITION_LINEAGE_NOT_RECORDED",
  "REFLECTION_NOT_TRADE_LINKED",
]);

export const CausalReviewIssueSchema = z
  .object({
    code: CausalReviewIssueCodeSchema,
    severity: z.enum(["info", "warning", "error"]),
    message: z.string().min(1).max(500),
    artifactId: CausalReviewOpaqueIdSchema.optional(),
  })
  .strict();

export const CausalEvidenceFieldSchema = z
  .object({
    key: z.string().min(1).max(160),
    value: z.union([
      z.string().max(500),
      z.number().finite(),
      z.boolean(),
      z.null(),
    ]),
  })
  .strict();

export const CausalAgentEvidenceNodeSchema = z
  .object({
    artifactId: CausalReviewOpaqueIdSchema,
    traceId: CausalReviewOpaqueIdSchema,
    stage: z.string().min(1).max(120),
    agentRef: z.string().min(1).max(200),
    agentVersion: z.string().min(1).max(120),
    status: z.enum(["success", "fallback", "error"]),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    durationMs: z.number().int().nonnegative(),
    symbol: z.string().min(1).max(80).optional(),
    orderId: CausalReviewOpaqueIdSchema.optional(),
    tradeId: CausalReviewOpaqueIdSchema.optional(),
    inputFields: z.array(CausalEvidenceFieldSchema).max(40),
    outputFields: z.array(CausalEvidenceFieldSchema).max(40),
    evidenceAvailability: CausalEvidenceAvailabilitySchema,
  })
  .strict();

export const CausalTraceEventSchema = z
  .object({
    eventId: CausalReviewOpaqueIdSchema,
    traceId: CausalReviewOpaqueIdSchema,
    stage: z.string().min(1).max(120),
    agentRef: z.string().min(1).max(200),
    phase: z.enum(["start", "end", "fallback", "error"]),
    occurredAt: z.string().datetime(),
    fields: z.array(CausalEvidenceFieldSchema).max(40),
  })
  .strict();

export const CausalLineageLinkSchema = z
  .object({
    linkId: CausalReviewOpaqueIdSchema,
    fromArtifactId: CausalReviewOpaqueIdSchema,
    toArtifactId: CausalReviewOpaqueIdSchema,
    relationship: z.enum(["explicit_reference", "observed_sequence"]),
    causal: z.boolean(),
  })
  .strict();

export const CausalActionChainSchema = z
  .object({
    selectorArtifactIds: z.array(CausalReviewOpaqueIdSchema),
    positionMonitorArtifactIds: z.array(CausalReviewOpaqueIdSchema),
    decisionArtifactIds: z.array(CausalReviewOpaqueIdSchema),
    portfolioArtifactIds: z.array(CausalReviewOpaqueIdSchema),
    riskArtifactIds: z.array(CausalReviewOpaqueIdSchema),
    executionArtifactIds: z.array(CausalReviewOpaqueIdSchema),
  })
  .strict();

export const CausalTradeReviewSchema = z
  .object({
    tradeRef: CausalReviewOpaqueIdSchema,
    orderId: CausalReviewOpaqueIdSchema.optional(),
    tradeId: CausalReviewOpaqueIdSchema.optional(),
    symbol: z.string().min(1).max(80).optional(),
    matchedArtifactIds: z.array(CausalReviewOpaqueIdSchema),
    presenterFields: z.array(CausalEvidenceFieldSchema).max(40),
    singleTradeReview: SingleTradeReviewSchema.optional(),
  })
  .strict();

export const CausalReflectionEvidenceSchema = z
  .object({
    availability: CausalEvidenceAvailabilitySchema,
    scope: z.literal("latest_account_snapshot"),
    candidateOnly: z.literal(true),
    runtimeApplied: z.literal(false),
    reflectionId: CausalReviewOpaqueIdSchema.optional(),
    asOf: z.string().datetime().optional(),
    recommendations: z.array(z.string().min(1).max(500)).max(20),
  })
  .strict();

export const CausalCycleSummarySchema = z
  .object({
    cycle: z.number().int().positive(),
    traceId: CausalReviewOpaqueIdSchema,
    status: PaperRuntimeCycleAuditSchema.shape.status,
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    decisionCount: z.number().int().nonnegative(),
    riskDecisionCount: z.number().int().nonnegative(),
    executionCount: z.number().int().nonnegative(),
    evidenceAvailability: CausalEvidenceAvailabilitySchema,
  })
  .strict();

export const CausalCycleReviewSchema = z
  .object({
    cycle: CausalCycleSummarySchema,
    traceEvents: z.array(CausalTraceEventSchema).max(500),
    agentEvidence: z.array(CausalAgentEvidenceNodeSchema).max(500),
    actionChain: CausalActionChainSchema,
    lineage: z.array(CausalLineageLinkSchema).max(1_000),
    tradeReviews: z.array(CausalTradeReviewSchema).max(100),
    selectedTradeRef: CausalReviewOpaqueIdSchema.optional(),
    reflection: CausalReflectionEvidenceSchema,
    issues: z.array(CausalReviewIssueSchema).max(500),
  })
  .strict();

export const CausalRunSummarySchema = z
  .object({
    runId: CausalReviewOpaqueIdSchema,
    status: PaperRuntimeRunStatusSchema,
    planId: CausalReviewOpaqueIdSchema,
    planFingerprint: CausalReviewFingerprintSchema,
    strategyProfileRef: CausalReviewOpaqueIdSchema,
    paperAccountRef: CausalReviewOpaqueIdSchema,
    candidateSymbols: z.array(z.string().min(1).max(80)).min(1),
    plannedCycles: z.number().int().positive(),
    processedCycles: z.number().int().nonnegative(),
    requestedAt: z.string().datetime(),
    startedAt: z.string().datetime().optional(),
    finishedAt: z.string().datetime().optional(),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();

export const CausalReviewContextSchema = z
  .object({
    marketPackRef: CausalReviewOpaqueIdSchema,
    dataSourceRef: z.string().min(1).max(200),
    paperAccountRef: CausalReviewOpaqueIdSchema,
    graphRef: CausalReviewOpaqueIdSchema.optional(),
    schemaRefs: z.array(CausalReviewOpaqueIdSchema).min(1).max(20),
  })
  .strict();

export const CausalReviewPaginationSchema = z
  .object({
    limit: z.number().int().min(1).max(20),
    nextCursor: z.string().min(1).max(200).optional(),
  })
  .strict();

export const CausalRunReviewResponseSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    reviewId: CausalReviewOpaqueIdSchema,
    humanVersion: z.string().min(1).max(80),
    fingerprint: CausalReviewFingerprintSchema,
    createdAt: z.string().datetime(),
    lifecycleStatus: CausalReviewLifecycleStatusSchema,
    evidenceStatus: CausalReviewLifecycleStatusSchema,
    dataClass: CausalReviewDataClassSchema,
    context: CausalReviewContextSchema,
    run: CausalRunSummarySchema.optional(),
    cycles: z.array(CausalCycleSummarySchema).max(20),
    selectedCycle: CausalCycleReviewSchema.optional(),
    pagination: CausalReviewPaginationSchema,
    issues: z.array(CausalReviewIssueSchema).max(500),
    readOnly: z.literal(true),
    runtimeApplied: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();

export const CausalReviewPageRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    cursor: z.string().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(20).default(8),
  })
  .strict();

export type CausalReviewIssue = z.infer<typeof CausalReviewIssueSchema>;
export type CausalEvidenceField = z.infer<typeof CausalEvidenceFieldSchema>;
export type CausalAgentEvidenceNode = z.infer<
  typeof CausalAgentEvidenceNodeSchema
>;
export type CausalCycleReview = z.infer<typeof CausalCycleReviewSchema>;
export type CausalRunReviewResponse = z.infer<
  typeof CausalRunReviewResponseSchema
>;
export type CausalReviewPageRequest = z.infer<
  typeof CausalReviewPageRequestSchema
>;
