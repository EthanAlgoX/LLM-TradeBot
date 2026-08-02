import { z } from "zod";

const Id = z.string().min(3).max(160).regex(/^[a-z0-9][a-z0-9._:-]*$/u);
const Timestamp = z.string().datetime({ offset: true });
const Fingerprint = z.string().min(12).max(256).regex(/^[a-zA-Z0-9:_@.-]+$/u);
const IssueCode = z.string().min(3).max(160).regex(/^[A-Z][A-Z0-9_]*$/u);

export const ShadowStrategySnapshotSchema = z.object({
  strategyVersionId: Id,
  sourceFingerprint: Fingerprint,
  datasetFingerprint: Fingerprint,
  graphFingerprint: Fingerprint,
  executionFingerprint: Fingerprint,
  riskFingerprint: Fingerprint,
}).strict();
export type ShadowStrategySnapshot = z.infer<typeof ShadowStrategySnapshotSchema>;

export const ShadowSourceScopeSchema = z.object({
  actorId: Id,
  sourceDeploymentId: Id,
  sourceRunId: Id,
  sourceCycleId: Id,
  sourceCycleFingerprint: Fingerprint,
  sourceArtifactFingerprint: Fingerprint,
  asOf: Timestamp,
}).strict();
export type ShadowSourceScope = z.infer<typeof ShadowSourceScopeSchema>;

export const ShadowDefinitionSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  shadowId: Id,
  actorId: Id,
  source: ShadowSourceScopeSchema,
  champion: ShadowStrategySnapshotSchema,
  challenger: ShadowStrategySnapshotSchema.optional(),
  adapterId: Id,
  adapterFingerprint: Fingerprint,
  createdAt: Timestamp,
  runtimeApplied: z.literal(false),
  exchangeWriteAllowed: z.literal(false),
  executionReachable: z.literal(false),
}).strict();
export type ShadowDefinition = z.infer<typeof ShadowDefinitionSchema>;

export const ShadowRunStatusSchema = z.enum(["succeeded", "unavailable", "stale"]);
export type ShadowRunStatus = z.infer<typeof ShadowRunStatusSchema>;

export const ShadowRunSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  shadowRunId: Id,
  shadowId: Id,
  actorId: Id,
  source: ShadowSourceScopeSchema,
  status: ShadowRunStatusSchema,
  issueCodes: z.array(IssueCode).max(40),
  startedAt: Timestamp,
  completedAt: Timestamp,
  fingerprint: Fingerprint,
  runtimeApplied: z.literal(false),
  exchangeWriteAllowed: z.literal(false),
  executionReachable: z.literal(false),
}).strict();
export type ShadowRun = z.infer<typeof ShadowRunSchema>;

export const ShadowDecisionSummarySchema = z.object({
  decisionCount: z.number().int().nonnegative(),
  actions: z.array(z.string().min(1).max(80)).max(40),
  riskRejectedCount: z.number().int().nonnegative(),
  expectedExposure: z.object({
    availability: z.enum(["available", "unavailable"]),
    grossNotional: z.number().finite().nonnegative().optional(),
    reason: z.string().min(1).max(240).optional(),
  }).strict(),
}).strict();
export type ShadowDecisionSummary = z.infer<typeof ShadowDecisionSummarySchema>;

export const ShadowDecisionContextSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  shadowCycleId: Id,
  shadowId: Id,
  shadowRunId: Id,
  actorId: Id,
  source: ShadowSourceScopeSchema,
  status: ShadowRunStatusSchema,
  champion: ShadowDecisionSummarySchema.optional(),
  challenger: ShadowDecisionSummarySchema.optional(),
  dataQuality: z.enum(["available", "unavailable", "stale"]),
  health: z.enum(["healthy", "degraded", "unavailable", "stale"]),
  evidenceGaps: z.array(IssueCode).max(40),
  createdAt: Timestamp,
  fingerprint: Fingerprint,
  runtimeApplied: z.literal(false),
  exchangeWriteAllowed: z.literal(false),
  executionReachable: z.literal(false),
}).strict();
export type ShadowDecisionContext = z.infer<typeof ShadowDecisionContextSchema>;

export const ShadowComparisonSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  comparisonId: Id,
  shadowId: Id,
  shadowRunId: Id,
  shadowCycleId: Id,
  actorId: Id,
  source: ShadowSourceScopeSchema,
  status: ShadowRunStatusSchema,
  decision: z.enum(["same", "different", "unavailable"]),
  risk: z.enum(["same", "different", "unavailable"]),
  expectedExposure: z.enum(["same", "different", "unavailable"]),
  dataQuality: z.enum(["same", "different", "unavailable"]),
  health: z.enum(["same", "different", "unavailable"]),
  evidenceGaps: z.array(IssueCode).max(40),
  note: z.string().min(1).max(500),
  createdAt: Timestamp,
  fingerprint: Fingerprint,
  runtimeApplied: z.literal(false),
  exchangeWriteAllowed: z.literal(false),
}).strict();
export type ShadowComparison = z.infer<typeof ShadowComparisonSchema>;

export const PromotionPolicySchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  policyId: Id,
  version: z.string().min(1).max(80),
  fingerprint: Fingerprint,
  minimumComparableCycles: z.number().int().positive().max(10_000),
  createdAt: Timestamp,
  runtimeApplied: z.literal(false),
  exchangeWriteAllowed: z.literal(false),
}).strict();
export type PromotionPolicy = z.infer<typeof PromotionPolicySchema>;

export const PromotionRecommendationStatusSchema = z.enum(["insufficient_data", "observe", "recommend_validation"]);
export type PromotionRecommendationStatus = z.infer<typeof PromotionRecommendationStatusSchema>;

export const PromotionRecommendationSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  recommendationId: Id,
  shadowId: Id,
  shadowRunId: Id,
  shadowCycleId: Id,
  comparisonId: Id.optional(),
  actorId: Id,
  source: ShadowSourceScopeSchema,
  policy: PromotionPolicySchema,
  status: PromotionRecommendationStatusSchema,
  comparableCycleCount: z.number().int().nonnegative(),
  reasons: z.array(z.string().min(1).max(500)).min(1).max(20),
  terminal: z.literal(true),
  readOnly: z.literal(true),
  createdAt: Timestamp,
  fingerprint: Fingerprint,
  runtimeApplied: z.literal(false),
  exchangeWriteAllowed: z.literal(false),
  executionReachable: z.literal(false),
}).strict();
export type PromotionRecommendation = z.infer<typeof PromotionRecommendationSchema>;

export const ShadowObservationRequestSchema = z.object({
  idempotencyKey: z.string().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/u),
  sourceRunId: Id,
  sourceCycleId: Id,
}).strict();
export type ShadowObservationRequest = z.infer<typeof ShadowObservationRequestSchema>;

export const ShadowRecordSchema = z.object({
  definition: ShadowDefinitionSchema,
  run: ShadowRunSchema,
  cycle: ShadowDecisionContextSchema,
  comparison: ShadowComparisonSchema.optional(),
  recommendation: PromotionRecommendationSchema,
}).strict();
export type ShadowRecord = z.infer<typeof ShadowRecordSchema>;

export const ShadowHistoryResponseSchema = z.object({
  data: z.array(ShadowRecordSchema).max(100),
  nextCursor: z.string().min(1).optional(),
}).strict();
export type ShadowHistoryResponse = z.infer<typeof ShadowHistoryResponseSchema>;
