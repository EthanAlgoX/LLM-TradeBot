import { z } from "zod";
import {
  ArtifactFingerprintSchema,
  MarketPackReferenceSchema,
  SemanticArtifactSchemaVersion,
  VersionedEntityReferenceSchema,
} from "./semantic-agent-artifacts.js";

const GraphEvidenceIdSchema = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/u, "stable_id_format");
const TimestampSchema = z.string().datetime({ offset: true });
const PrimitiveSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

export const GraphHistoricalDatasetDefinitionSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    id: GraphEvidenceIdSchema,
    version: z.string().min(1).max(80),
    fingerprint: ArtifactFingerprintSchema,
    lifecycleStatus: z.literal("active"),
    createdAt: TimestampSchema,
    marketPackRef: MarketPackReferenceSchema,
    dataSourceRef: VersionedEntityReferenceSchema,
    timezone: z.string().min(1).max(80),
    tradingCalendarRef: z.string().min(1).max(160),
    asOfSequence: z.array(TimestampSchema).min(2),
  })
  .strict()
  .superRefine((dataset, context) => {
    for (let index = 1; index < dataset.asOfSequence.length; index += 1) {
      if (Date.parse(dataset.asOfSequence[index]!) <= Date.parse(dataset.asOfSequence[index - 1]!)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "dataset_as_of_not_strictly_increasing",
          path: ["asOfSequence", index],
        });
      }
    }
  });

export const GraphStrategyProfileDefinitionSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    id: GraphEvidenceIdSchema,
    version: z.string().min(1).max(80),
    fingerprint: ArtifactFingerprintSchema,
    lifecycleStatus: z.literal("active"),
    createdAt: TimestampSchema,
    compatiblePresetIds: z.array(GraphEvidenceIdSchema).min(1),
    parameters: z.record(z.string(), PrimitiveSchema),
  })
  .strict();

export const GraphStrategyProfileCandidateSetSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    id: GraphEvidenceIdSchema,
    version: z.string().min(1).max(80),
    fingerprint: ArtifactFingerprintSchema,
    lifecycleStatus: z.literal("active"),
    createdAt: TimestampSchema,
    profileIds: z.array(GraphEvidenceIdSchema).min(1),
  })
  .strict()
  .superRefine((candidateSet, context) => {
    if (new Set(candidateSet.profileIds).size !== candidateSet.profileIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "candidate_profile_duplicate",
        path: ["profileIds"],
      });
    }
  });

export const GraphWalkForwardPlanDefinitionSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    id: GraphEvidenceIdSchema,
    version: z.string().min(1).max(80),
    fingerprint: ArtifactFingerprintSchema,
    lifecycleStatus: z.literal("active"),
    createdAt: TimestampSchema,
    trainingCycles: z.number().int().min(2).max(100_000),
    validationCycles: z.number().int().min(1).max(100_000),
    stepCycles: z.number().int().min(1).max(100_000),
    objective: z.enum(["total_return_pct", "max_drawdown_pct", "research_success_rate"]),
  })
  .strict();

const RequestFields = {
  schemaVersion: z.literal(SemanticArtifactSchemaVersion),
  planId: GraphEvidenceIdSchema,
  datasetId: GraphEvidenceIdSchema,
  startAt: TimestampSchema,
  endAt: TimestampSchema,
  idempotencyKey: z.string().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/u),
};

export const GraphBacktestJobRequestSchema = z
  .object({
    ...RequestFields,
    profileId: GraphEvidenceIdSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (Date.parse(request.startAt) > Date.parse(request.endAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "backtest_range_invalid",
        path: ["endAt"],
      });
    }
  });

export const GraphWalkForwardJobRequestSchema = z
  .object({
    ...RequestFields,
    profileCandidateSetId: GraphEvidenceIdSchema,
    walkForwardPlanId: GraphEvidenceIdSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (Date.parse(request.startAt) > Date.parse(request.endAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "walk_forward_range_invalid",
        path: ["endAt"],
      });
    }
  });

export const GraphTradingCycleOutcomeSchema = z
  .object({
    mode: z.literal("trading"),
    equity: z.number().finite().nonnegative(),
    availableCash: z.number().finite().nonnegative(),
    realizedPnl: z.number().finite(),
    unrealizedPnl: z.number().finite(),
    tradeCount: z.number().int().nonnegative(),
    fillCount: z.number().int().nonnegative(),
    riskRejectionCount: z.number().int().nonnegative(),
  })
  .strict();

export const GraphResearchCycleOutcomeSchema = z
  .object({
    mode: z.literal("research"),
    assessmentArtifactCount: z.number().int().nonnegative(),
  })
  .strict();

export const GraphCycleOutcomeSchema = z.discriminatedUnion("mode", [
  GraphTradingCycleOutcomeSchema,
  GraphResearchCycleOutcomeSchema,
]);

export const GraphBacktestCycleEvidenceSchema = z
  .object({
    cycleId: GraphEvidenceIdSchema,
    asOf: TimestampSchema,
    graphRunId: GraphEvidenceIdSchema,
    graphPlanRef: VersionedEntityReferenceSchema,
    graphRunStatus: z.enum(["succeeded", "completed_with_warnings"]),
    nodeRunCount: z.number().int().positive(),
    artifactFingerprints: z.array(ArtifactFingerprintSchema),
    lineageFingerprints: z.array(ArtifactFingerprintSchema).min(1),
    outcome: GraphCycleOutcomeSchema,
    fingerprint: ArtifactFingerprintSchema,
  })
  .strict();

export const GraphTradingBacktestMetricsSchema = z
  .object({
    mode: z.literal("trading"),
    initialEquity: z.number().finite().nonnegative(),
    finalEquity: z.number().finite().nonnegative(),
    totalReturnPct: z.number().finite(),
    maxDrawdownPct: z.number().finite().min(0),
    tradeCount: z.number().int().nonnegative(),
    fillCount: z.number().int().nonnegative(),
    riskRejectionCount: z.number().int().nonnegative(),
    cycleCount: z.number().int().positive(),
  })
  .strict();

export const GraphResearchBacktestMetricsSchema = z
  .object({
    mode: z.literal("research"),
    cycleCount: z.number().int().positive(),
    succeededCycleCount: z.number().int().nonnegative(),
    assessmentArtifactCount: z.number().int().nonnegative(),
    researchSuccessRate: z.number().finite().min(0).max(1),
  })
  .strict();

export const GraphBacktestMetricsSchema = z.discriminatedUnion("mode", [
  GraphTradingBacktestMetricsSchema,
  GraphResearchBacktestMetricsSchema,
]);

export const GraphBacktestRunSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    runId: GraphEvidenceIdSchema,
    version: z.string().min(1).max(80),
    fingerprint: ArtifactFingerprintSchema,
    lifecycleStatus: z.literal("succeeded"),
    createdAt: TimestampSchema,
    planRef: VersionedEntityReferenceSchema,
    datasetRef: VersionedEntityReferenceSchema,
    profileRef: VersionedEntityReferenceSchema,
    startAt: TimestampSchema,
    endAt: TimestampSchema,
    cycles: z.array(GraphBacktestCycleEvidenceSchema).min(1),
    metrics: GraphBacktestMetricsSchema,
    promotionEligible: z.boolean(),
    runtimeApplied: z.literal(false),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.metrics.mode === "research" && run.promotionEligible) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "research_backtest_not_promotion_eligible",
        path: ["promotionEligible"],
      });
    }
  });

export const GraphWalkForwardCandidateEvidenceSchema = z
  .object({
    profileRef: VersionedEntityReferenceSchema,
    trainingRunRef: VersionedEntityReferenceSchema,
    metrics: GraphBacktestMetricsSchema,
  })
  .strict();

export const GraphWalkForwardFoldSchema = z
  .object({
    foldId: GraphEvidenceIdSchema,
    trainingStartAt: TimestampSchema,
    trainingEndAt: TimestampSchema,
    validationStartAt: TimestampSchema,
    validationEndAt: TimestampSchema,
    candidates: z.array(GraphWalkForwardCandidateEvidenceSchema).min(1),
    selectedProfileRef: VersionedEntityReferenceSchema,
    validationRunRef: VersionedEntityReferenceSchema,
    validationMetrics: GraphBacktestMetricsSchema,
    fingerprint: ArtifactFingerprintSchema,
  })
  .strict()
  .superRefine((fold, context) => {
    if (Date.parse(fold.trainingEndAt) >= Date.parse(fold.validationStartAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "walk_forward_training_validation_overlap",
        path: ["validationStartAt"],
      });
    }
  });

export const GraphWalkForwardRunSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    runId: GraphEvidenceIdSchema,
    version: z.string().min(1).max(80),
    fingerprint: ArtifactFingerprintSchema,
    lifecycleStatus: z.literal("succeeded"),
    createdAt: TimestampSchema,
    planRef: VersionedEntityReferenceSchema,
    datasetRef: VersionedEntityReferenceSchema,
    candidateSetRef: VersionedEntityReferenceSchema,
    walkForwardPlanRef: VersionedEntityReferenceSchema,
    folds: z.array(GraphWalkForwardFoldSchema).min(1),
    promotionEligible: z.boolean(),
    runtimeApplied: z.literal(false),
  })
  .strict()
  .superRefine((run, context) => {
    if (
      run.folds.some((fold) => fold.validationMetrics.mode === "research") &&
      run.promotionEligible
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "research_walk_forward_not_promotion_eligible",
        path: ["promotionEligible"],
      });
    }
  });

export const GraphEvidenceArtifactSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    artifactId: GraphEvidenceIdSchema,
    evidenceRef: z.string().min(1).max(500),
    kind: z.enum(["graph_backtest", "graph_walk_forward"]),
    planRef: VersionedEntityReferenceSchema,
    datasetRef: VersionedEntityReferenceSchema,
    profileScopeRef: VersionedEntityReferenceSchema,
    result: z.union([GraphBacktestRunSchema, GraphWalkForwardRunSchema]),
    resultFingerprint: ArtifactFingerprintSchema,
    manifestFingerprint: ArtifactFingerprintSchema,
    promotionEligible: z.boolean(),
    createdAt: TimestampSchema,
    generatedBy: z.literal("tradebot-server"),
  })
  .strict();

export const GraphEvidenceVerificationResultSchema = z
  .object({
    valid: z.boolean(),
    issueCodes: z.array(
      z.enum([
        "RESULT_FINGERPRINT_MISMATCH",
        "MANIFEST_FINGERPRINT_MISMATCH",
        "PLAN_FINGERPRINT_MISMATCH",
        "DATASET_FINGERPRINT_MISMATCH",
        "PROFILE_SCOPE_FINGERPRINT_MISMATCH",
        "EVIDENCE_REF_MISMATCH",
      ]),
    ),
  })
  .strict();

export const GraphEvidenceJobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "orphaned",
]);

export const GraphEvidenceJobSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    jobId: GraphEvidenceIdSchema,
    kind: z.enum(["backtest", "walk_forward"]),
    request: z.union([GraphBacktestJobRequestSchema, GraphWalkForwardJobRequestSchema]),
    requestFingerprint: ArtifactFingerprintSchema,
    status: GraphEvidenceJobStatusSchema,
    requestedAt: TimestampSchema,
    startedAt: TimestampSchema.optional(),
    completedAt: TimestampSchema.optional(),
    leaseOwnerId: GraphEvidenceIdSchema.optional(),
    leaseExpiresAt: TimestampSchema.optional(),
    evidence: GraphEvidenceArtifactSchema.optional(),
    failureCode: z.string().min(1).max(160).optional(),
  })
  .strict();

export type GraphHistoricalDatasetDefinition = z.infer<
  typeof GraphHistoricalDatasetDefinitionSchema
>;
export type GraphStrategyProfileDefinition = z.infer<
  typeof GraphStrategyProfileDefinitionSchema
>;
export type GraphStrategyProfileCandidateSet = z.infer<
  typeof GraphStrategyProfileCandidateSetSchema
>;
export type GraphWalkForwardPlanDefinition = z.infer<
  typeof GraphWalkForwardPlanDefinitionSchema
>;
export type GraphBacktestJobRequest = z.infer<typeof GraphBacktestJobRequestSchema>;
export type GraphWalkForwardJobRequest = z.infer<typeof GraphWalkForwardJobRequestSchema>;
export type GraphCycleOutcome = z.infer<typeof GraphCycleOutcomeSchema>;
export type GraphBacktestCycleEvidence = z.infer<
  typeof GraphBacktestCycleEvidenceSchema
>;
export type GraphBacktestMetrics = z.infer<typeof GraphBacktestMetricsSchema>;
export type GraphBacktestRun = z.infer<typeof GraphBacktestRunSchema>;
export type GraphWalkForwardFold = z.infer<typeof GraphWalkForwardFoldSchema>;
export type GraphWalkForwardRun = z.infer<typeof GraphWalkForwardRunSchema>;
export type GraphEvidenceArtifact = z.infer<typeof GraphEvidenceArtifactSchema>;
export type GraphEvidenceVerificationResult = z.infer<
  typeof GraphEvidenceVerificationResultSchema
>;
export type GraphEvidenceJob = z.infer<typeof GraphEvidenceJobSchema>;
