import { z } from "zod";

export const OrchestrationActorRoleSchema = z.enum(["operator", "approver"]);
export type OrchestrationActorRole = z.infer<typeof OrchestrationActorRoleSchema>;

export const OrchestrationActorSchema = z
  .object({
    actorId: z.string().min(1),
    displayName: z.string().min(1),
    roles: z.array(OrchestrationActorRoleSchema).min(1),
  })
  .strict();
export type OrchestrationActor = z.infer<typeof OrchestrationActorSchema>;

export const PipelineEvidenceJobKindSchema = z.enum([
  "backtest",
  "walk_forward",
]);
export type PipelineEvidenceJobKind = z.infer<
  typeof PipelineEvidenceJobKindSchema
>;

export const PipelineEvidenceJobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export type PipelineEvidenceJobStatus = z.infer<
  typeof PipelineEvidenceJobStatusSchema
>;

const EvidenceParameterValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const PipelineEvidenceJobRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    idempotencyKey: z.string().min(8).max(200).optional(),
    experimentRef: z.string().min(1).optional(),
    parameters: z
      .record(z.string(), EvidenceParameterValueSchema)
      .default({}),
  })
  .strict();
export type PipelineEvidenceJobRequest = z.infer<
  typeof PipelineEvidenceJobRequestSchema
>;

export const PipelineEvidenceSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    evidenceId: z.string().min(1),
    jobId: z.string().min(1),
    draftId: z.string().min(1),
    graphId: z.string().min(1),
    graphFingerprint: z.string().min(1),
    kind: PipelineEvidenceJobKindSchema,
    artifactRef: z.string().min(1),
    artifactSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
    lineage: z
      .object({
        artifactId: z.string().min(1),
        runnerId: z.string().min(1),
        runPlanId: z.string().min(1),
        strategyProfileRef: z.string().min(1),
        dataSourceRef: z.string().min(1),
        dataFingerprint: z.string().min(1),
        manifestSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        resultSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
    metrics: z.record(z.string(), z.number().finite()),
    summary: z.string().min(1),
    completedAt: z.string().datetime(),
    generatedBy: z.literal("tradebot-server"),
  })
  .strict();
export type PipelineEvidence = z.infer<typeof PipelineEvidenceSchema>;

export const PipelineEvidenceJobSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    jobId: z.string().min(1),
    draftId: z.string().min(1),
    graphId: z.string().min(1),
    graphFingerprint: z.string().min(1),
    kind: PipelineEvidenceJobKindSchema,
    status: PipelineEvidenceJobStatusSchema,
    request: PipelineEvidenceJobRequestSchema,
    requestedByActorId: z.string().min(1),
    requestedAt: z.string().datetime(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    evidence: PipelineEvidenceSchema.optional(),
    failureCode: z.string().min(1).optional(),
  })
  .strict();
export type PipelineEvidenceJob = z.infer<typeof PipelineEvidenceJobSchema>;

export const HumanApprovalRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    decision: z.literal("approve"),
    note: z.string().max(2_000).optional(),
  })
  .strict();
export type HumanApprovalRequest = z.infer<typeof HumanApprovalRequestSchema>;

export const PipelineApprovalAuditSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    approvalId: z.string().min(1),
    draftId: z.string().min(1),
    graphId: z.string().min(1),
    graphFingerprint: z.string().min(1),
    actorId: z.string().min(1),
    actorDisplayName: z.string().min(1),
    decision: z.literal("approve"),
    note: z.string().max(2_000).optional(),
    evidenceRefs: z.array(z.string().min(1)).min(2),
    approvedAt: z.string().datetime(),
  })
  .strict();
export type PipelineApprovalAudit = z.infer<
  typeof PipelineApprovalAuditSchema
>;
