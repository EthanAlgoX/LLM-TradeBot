import { z } from "zod";

const FingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u, "fingerprint_format");
const ReferenceSchema = z
  .object({
    id: z.string().min(1).max(200),
    version: z.string().min(1).max(80),
    fingerprint: FingerprintSchema,
  })
  .strict();

export const StrategyConfigurationEvidenceReferenceSchema = z
  .object({
    draftId: z.string().min(1).max(200),
    versionId: z.string().min(1).max(240),
    versionFingerprint: FingerprintSchema,
    payloadFingerprint: FingerprintSchema,
  })
  .strict();

export const StrategyEvidenceJobReferenceSchema = z
  .union([
    z.object({ jobId: z.string().min(1).max(240), status: z.literal("succeeded"), evidenceRef: z.string().min(1).max(500), evidenceFingerprint: FingerprintSchema }).strict(),
    z.object({ jobId: z.string().min(1).max(240), status: z.literal("failed"), failureCode: z.string().min(1).max(160) }).strict(),
  ]);

export const StrategyEvidenceApprovalRecordSchema = z
  .object({
    approvalId: z.string().min(1).max(240),
    actorId: z.string().min(1).max(160),
    actorDisplayName: z.string().min(1).max(160),
    note: z.string().max(2_000).optional(),
    approvedAt: z.string().datetime({ offset: true }),
    evidenceFingerprints: z.array(FingerprintSchema).length(2),
  })
  .strict();

export const StrategyEvidenceBindingSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    bindingId: z.string().min(1).max(240),
    versionId: z.string().min(1).max(260),
    versionIndex: z.number().int().positive(),
    parentFingerprint: FingerprintSchema.optional(),
    fingerprint: FingerprintSchema,
    lifecycleStatus: z.enum(["draft", "partial_evidence", "evidence_ready", "approved", "stale"]),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    createdByActorId: z.string().min(1).max(160),
    configurationRef: StrategyConfigurationEvidenceReferenceSchema,
    historicalPlanRef: ReferenceSchema,
    compiledGraphRef: ReferenceSchema,
    marketPackRef: ReferenceSchema,
    datasetRef: ReferenceSchema,
    dataSourceRef: ReferenceSchema,
    backtestProfileRef: ReferenceSchema,
    walkForwardCandidateSetRef: ReferenceSchema,
    walkForwardPlanRef: ReferenceSchema,
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    backtestJob: StrategyEvidenceJobReferenceSchema.optional(),
    walkForwardJob: StrategyEvidenceJobReferenceSchema.optional(),
    approval: StrategyEvidenceApprovalRecordSchema.optional(),
    approvedPaperPlanId: z.string().min(1).max(240).optional(),
    staleReason: z.enum(["configuration_changed", "evidence_scope_changed"]).optional(),
    runtimeApplied: z.literal(false),
  })
  .strict()
  .superRefine((binding, context) => {
    if (Date.parse(binding.startAt) > Date.parse(binding.endAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endAt"],
        message: "historical_range_invalid",
      });
    }
    if (binding.lifecycleStatus === "evidence_ready" || binding.lifecycleStatus === "approved") {
      if (!binding.backtestJob || !binding.walkForwardJob) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lifecycleStatus"],
          message: "evidence_pair_required",
        });
      }
    }
    if (binding.lifecycleStatus === "approved" && (!binding.approval || !binding.approvedPaperPlanId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approval"],
        message: "approval_plan_required",
      });
    }
    if (binding.lifecycleStatus === "stale" && !binding.staleReason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["staleReason"],
        message: "stale_reason_required",
      });
    }
  });

export const CreateStrategyEvidenceBindingRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    strategyConfigurationVersionId: z.string().min(1).max(240),
    datasetId: z.string().min(1).max(200),
    backtestProfileId: z.string().min(1).max(200),
    walkForwardCandidateSetId: z.string().min(1).max(200),
    walkForwardPlanId: z.string().min(1).max(200),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    idempotencyKey: z.string().min(8).max(160),
  })
  .strict()
  .superRefine((request, context) => {
    if (Date.parse(request.startAt) > Date.parse(request.endAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endAt"],
        message: "historical_range_invalid",
      });
    }
  });

export const RunStrategyEvidenceJobRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    idempotencyKey: z.string().min(8).max(160),
  })
  .strict();

export const ApproveStrategyEvidenceRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    idempotencyKey: z.string().min(8).max(160),
    note: z.string().max(2_000).optional(),
  })
  .strict();

export type StrategyConfigurationEvidenceReference = z.infer<
  typeof StrategyConfigurationEvidenceReferenceSchema
>;
export type StrategyEvidenceJobReference = z.infer<typeof StrategyEvidenceJobReferenceSchema>;
export type StrategyEvidenceApprovalRecord = z.infer<
  typeof StrategyEvidenceApprovalRecordSchema
>;
export type StrategyEvidenceBinding = z.infer<typeof StrategyEvidenceBindingSchema>;
export type CreateStrategyEvidenceBindingRequest = z.infer<
  typeof CreateStrategyEvidenceBindingRequestSchema
>;
export type RunStrategyEvidenceJobRequest = z.infer<
  typeof RunStrategyEvidenceJobRequestSchema
>;
export type ApproveStrategyEvidenceRequest = z.infer<
  typeof ApproveStrategyEvidenceRequestSchema
>;
