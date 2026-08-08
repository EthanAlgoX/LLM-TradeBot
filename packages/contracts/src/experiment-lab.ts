import { z } from "zod";
import {
  ArtifactFingerprintSchema,
  MarketPackReferenceSchema,
  SemanticArtifactSchemaVersion,
  VersionedEntityReferenceSchema,
} from "./semantic-agent-artifacts.js";

const IdSchema = z
  .string()
  .min(3)
  .max(240)
  .regex(/^[a-z0-9][a-z0-9._:@-]*$/u);
const TimestampSchema = z.string().datetime({ offset: true });
const IssueCodesSchema = z.array(z.string().min(1).max(160)).max(32);
const PrimitiveSchema = z.union([
  z.string().max(240),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const ReferenceSchema = VersionedEntityReferenceSchema;

export const ExperimentComparisonModeSchema = z.enum([
  "STRATEGY_COMPARISON",
  "MODEL_COMPARISON",
  "AGENT_GRAPH_COMPARISON",
  "OPEN_CLASS",
]);

export const ExperimentObjectiveSchema = z
  .object({ kind: z.literal("maximize_total_return") })
  .strict();

export const ExperimentConstraintsSchema = z
  .object({
    maxDrawdownPctLte: z.number().min(0).max(100).optional(),
    minimumTradeCount: z.number().int().min(0).max(1_000_000).optional(),
    walkForwardPositive: z.boolean().optional(),
    runtimeFailureCountEqZero: z.literal(true).optional(),
    deflatedSharpeGte: z.number().min(0).max(1).optional(),
  })
  .strict();

export const ExperimentCreateRequestSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    idempotencyKey: z
      .string()
      .min(8)
      .max(160)
      .regex(/^[A-Za-z0-9._:-]+$/u),
    participantVersionIds: z.array(IdSchema).min(2).max(5),
    datasetId: IdSchema,
    startAt: TimestampSchema,
    endAt: TimestampSchema,
    walkForwardPlanId: IdSchema,
    comparisonMode: ExperimentComparisonModeSchema,
    objective: ExperimentObjectiveSchema,
    constraints: ExperimentConstraintsSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (
      new Set(request.participantVersionIds).size !==
      request.participantVersionIds.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "participant_duplicate",
        path: ["participantVersionIds"],
      });
    }
    if (Date.parse(request.startAt) >= Date.parse(request.endAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "range_invalid",
        path: ["endAt"],
      });
    }
  });

export const ExperimentDatasetLockSchema = z
  .object({
    datasetRef: ReferenceSchema,
    marketPackRef: MarketPackReferenceSchema,
    dataSourceRef: ReferenceSchema,
    timezone: z.string().min(1).max(80),
    tradingCalendarRef: z.string().min(1).max(160),
    startAt: TimestampSchema,
    endAt: TimestampSchema,
  })
  .strict();

export const ExperimentExecutionLockSchema = z
  .object({
    model: z.literal("graph_trading"),
    parameters: z.record(z.string().min(1).max(80), PrimitiveSchema),
    fingerprint: ArtifactFingerprintSchema,
    unavailableFields: z
      .array(z.enum(["initial_capital", "fee_bps", "slippage_bps"]))
      .max(3),
  })
  .strict();

export const ExperimentRiskLockSchema = z
  .object({
    parameters: z.record(z.string().min(1).max(80), PrimitiveSchema),
    fingerprint: ArtifactFingerprintSchema,
  })
  .strict();

export const ExperimentModelPromptLockSchema = z
  .object({
    modelMode: z.enum(["none", "rule"]),
    modelFingerprint: ArtifactFingerprintSchema,
    promptRefs: z.array(ReferenceSchema).max(32),
    promptSetFingerprint: ArtifactFingerprintSchema,
  })
  .strict();

export const ExperimentScorecardSchema = z
  .object({
    totalReturnPct: z.number().finite(),
    maxDrawdownPct: z.number().finite().min(0),
    tradeCount: z.number().int().nonnegative(),
    fillCount: z.number().int().nonnegative(),
    riskRejectionCount: z.number().int().nonnegative(),
    cycleCount: z.number().int().positive(),
    runtimeFailureCount: z.number().int().nonnegative(),
    equityPoints: z
      .array(
        z
          .object({
            asOf: TimestampSchema,
            equity: z.number().finite().nonnegative(),
          })
          .strict(),
      )
      .min(1),
    unavailableMetrics: z.array(
      z.enum(["sharpe", "sortino", "profit_factor"]),
    ),
  })
  .strict();

export const ExperimentWalkForwardSchema = z
  .object({
    foldCount: z.number().int().positive(),
    positiveValidation: z.boolean(),
    promotionEligible: z.boolean(),
    runtimeFailureCount: z.number().int().nonnegative(),
    validationReturnsPct: z.array(z.number().finite()).min(1),
  })
  .strict();

export const ExperimentEvidenceSchema = z
  .object({
    evidenceRef: z.string().min(1).max(500),
    artifactId: IdSchema,
    artifactFingerprint: ArtifactFingerprintSchema,
    resultFingerprint: ArtifactFingerprintSchema,
    manifestFingerprint: ArtifactFingerprintSchema,
    promotionEligible: z.boolean(),
    scorecard: ExperimentScorecardSchema.optional(),
    walkForward: ExperimentWalkForwardSchema.optional(),
    lineage: z
      .object({
        planRef: ReferenceSchema,
        datasetRef: ReferenceSchema,
        profileScopeRef: ReferenceSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if ((evidence.scorecard ? 1 : 0) + (evidence.walkForward ? 1 : 0) !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "experiment_evidence_kind_ambiguous",
        path: [],
      });
    }
  });

export const ExperimentConstraintResultSchema = z
  .object({
    key: z.enum([
      "maxDrawdownPctLte",
      "minimumTradeCount",
      "walkForwardPositive",
      "runtimeFailureCountEqZero",
      "deflatedSharpeGte",
    ]),
    status: z.enum(["PASS", "FAIL", "UNAVAILABLE"]),
    actual: z.union([z.number().finite(), z.boolean()]).optional(),
    expected: z.union([z.number().finite(), z.boolean()]),
    issueCode: z.string().min(1).max(160).optional(),
  })
  .strict();

export const ExperimentCandidateSchema = z
  .object({
    candidateId: IdSchema,
    status: z.literal("candidate_for_validation"),
    fingerprint: ArtifactFingerprintSchema,
    participantId: IdSchema,
    experimentFingerprint: ArtifactFingerprintSchema,
    evidenceFingerprint: ArtifactFingerprintSchema,
    constraintResults: z.array(ExperimentConstraintResultSchema),
    runtimeApplied: z.literal(false),
  })
  .strict();

export const ExperimentReplaySchema = z
  .object({
    replayId: IdSchema,
    definitionFingerprint: ArtifactFingerprintSchema,
    evidenceFingerprint: ArtifactFingerprintSchema,
    resultFingerprint: ArtifactFingerprintSchema,
    status: z.literal("verified"),
    issueCodes: IssueCodesSchema,
  })
  .strict();

export const ExperimentParticipantSchema = z
  .object({
    participantId: IdSchema,
    label: z.string().min(1).max(120),
    strategyVersionRef: ReferenceSchema,
    strategyFingerprint: ArtifactFingerprintSchema,
    executableFingerprint: ArtifactFingerprintSchema,
    historicalPlanRef: ReferenceSchema,
    marketPackRef: MarketPackReferenceSchema,
    baseProfileRef: ReferenceSchema,
    profileRef: ReferenceSchema,
    candidateSetRef: ReferenceSchema,
    agentConfigurationRefs: z.array(ReferenceSchema).min(1).max(32),
    promptPolicyRefs: z.array(ReferenceSchema).max(32),
    configProjection: z
      .object({
        marketPackId: IdSchema,
        modelMode: z.enum(["none", "rule"]),
        executionFingerprint: ArtifactFingerprintSchema,
        riskFingerprint: ArtifactFingerprintSchema,
        modelFingerprint: ArtifactFingerprintSchema,
        promptSetFingerprint: ArtifactFingerprintSchema,
        graphFingerprint: ArtifactFingerprintSchema,
        agentGraphFingerprint: ArtifactFingerprintSchema,
        effectiveParameters: z.record(
          z.string().min(1).max(80),
          PrimitiveSchema,
        ),
      })
      .strict(),
    backtestJobId: IdSchema.optional(),
    walkForwardJobId: IdSchema.optional(),
    backtestEvidence: ExperimentEvidenceSchema.optional(),
    walkForwardEvidence: ExperimentEvidenceSchema.optional(),
    constraintResults: z.array(ExperimentConstraintResultSchema),
    issueCodes: IssueCodesSchema,
  })
  .strict();

export const ExperimentDimensionSchema = z.enum([
  "strategy",
  "dataset",
  "range",
  "market",
  "execution",
  "risk",
  "model",
  "prompt",
  "graph",
  "agent_graph",
]);

export const ExperimentSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    experimentId: IdSchema,
    fingerprint: ArtifactFingerprintSchema,
    createdAt: TimestampSchema,
    actorId: IdSchema,
    lifecycleStatus: z.enum([
      "draft",
      "backtest_partial",
      "backtest_complete",
      "walk_forward_partial",
      "evidence_complete",
      "candidate_ready",
      "insufficient",
      "stale",
      "failed",
    ]),
    comparability: z
      .object({
        status: z.enum(["CONTROLLED", "OPEN_CLASS", "INCOMPATIBLE"]),
        requestedMode: ExperimentComparisonModeSchema,
        changedDimensions: z.array(ExperimentDimensionSchema).max(16),
        lockedDimensions: z.array(ExperimentDimensionSchema).min(1).max(16),
        issueCodes: IssueCodesSchema,
      })
      .strict(),
    lock: z
      .object({
        dataset: ExperimentDatasetLockSchema,
        walkForwardPlanRef: ReferenceSchema,
        objective: ExperimentObjectiveSchema,
        constraints: ExperimentConstraintsSchema,
        execution: ExperimentExecutionLockSchema,
        risk: ExperimentRiskLockSchema,
        modelPrompt: ExperimentModelPromptLockSchema,
        failurePolicy: z.literal("fail_closed"),
        runtimeApplied: z.literal(false),
        exchangeWriteAllowed: z.literal(false),
      })
      .strict(),
    participants: z.array(ExperimentParticipantSchema).min(2).max(5),
    configurationDiff: z
      .array(
        z
          .object({
            field: z.string().min(1).max(160),
            values: z
              .array(
                z
                  .object({
                    participantId: IdSchema,
                    value: PrimitiveSchema,
                  })
                  .strict(),
              )
              .min(2)
              .max(5),
          })
          .strict(),
      )
      .max(128),
    candidate: ExperimentCandidateSchema.optional(),
    replay: ExperimentReplaySchema.optional(),
  })
  .strict();

export const ExperimentEligibleParticipantSchema = z
  .object({
    versionId: IdSchema,
    draftId: IdSchema,
    fingerprint: ArtifactFingerprintSchema,
    label: z.string().min(1).max(120),
    eligibility: z.enum(["eligible", "stale", "invalid", "unsupported"]),
    issueCodes: IssueCodesSchema,
    runtimeApplied: z.literal(false),
  })
  .strict();

export const ExperimentCatalogSchema = z
  .object({
    participants: z.array(ExperimentEligibleParticipantSchema).max(500),
    datasets: z
      .array(
        z
          .object({
            id: IdSchema,
            version: z.string().min(1).max(80),
            fingerprint: ArtifactFingerprintSchema,
            startAt: TimestampSchema,
            endAt: TimestampSchema,
            timezone: z.string().min(1).max(80),
            tradingCalendarRef: z.string().min(1).max(160),
          })
          .strict(),
      )
      .max(100),
    walkForwardPlans: z
      .array(
        z
          .object({
            id: IdSchema,
            version: z.string().min(1).max(80),
            fingerprint: ArtifactFingerprintSchema,
          })
          .strict(),
      )
      .max(100),
    supportedComparisonModes: z.array(ExperimentComparisonModeSchema).min(1),
    runtimeApplied: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();

export const ExperimentListResponseSchema = z
  .object({
    data: z.array(ExperimentSchema).max(50),
    nextCursor: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export type ExperimentCreateRequest = z.infer<
  typeof ExperimentCreateRequestSchema
>;
export type ExperimentConstraintResult = z.infer<
  typeof ExperimentConstraintResultSchema
>;
export type ExperimentEvidence = z.infer<typeof ExperimentEvidenceSchema>;
export type ExperimentParticipant = z.infer<
  typeof ExperimentParticipantSchema
>;
export type Experiment = z.infer<typeof ExperimentSchema>;
export type ExperimentCatalog = z.infer<typeof ExperimentCatalogSchema>;
export type ExperimentListResponse = z.infer<
  typeof ExperimentListResponseSchema
>;
