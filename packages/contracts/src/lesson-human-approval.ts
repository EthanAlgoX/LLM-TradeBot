import { z } from "zod";

import { LessonEvidenceGateProjectionSchema } from "./lesson-evidence-gate.js";
import { ArtifactFingerprintSchema } from "./semantic-agent-artifacts.js";

const StableIdSchema = z
  .string()
  .min(3)
  .max(240)
  .regex(/^[a-z0-9][a-z0-9._:@-]*$/u, "stable_id_format");

const ReferenceSchema = z
  .object({
    id: StableIdSchema,
    version: z.string().min(1).max(80),
    fingerprint: ArtifactFingerprintSchema,
  })
  .strict();

const ActorSchema = z
  .object({
    actorId: StableIdSchema,
    role: z.literal("approver"),
    authenticatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const LessonHumanApprovalDecisionSchema = z.enum(["approve", "reject"]);

export const LessonHumanApprovalCommandSchema = z
  .object({
    selectedTradeId: StableIdSchema,
    decision: LessonHumanApprovalDecisionSchema,
    rationale: z.string().trim().min(8).max(2_000),
    idempotencyKey: StableIdSchema.max(160),
  })
  .strict();

export const LessonHumanApprovalInspectionRequestSchema = z
  .object({ selectedTradeId: StableIdSchema })
  .strict();

export const ApprovedLessonScopeSchema = z
  .object({
    marketPackRef: ReferenceSchema,
    pipelineGraphRef: ReferenceSchema,
    configurationRef: z
      .object({
        versionId: StableIdSchema,
        versionFingerprint: ArtifactFingerprintSchema,
        payloadFingerprint: ArtifactFingerprintSchema,
      })
      .strict(),
    dataSourceRef: ReferenceSchema,
    datasetRef: ReferenceSchema,
    backtestProfileRef: ReferenceSchema,
    walkForwardCandidateSetRef: ReferenceSchema,
    walkForwardPlanRef: ReferenceSchema,
    historicalRange: z
      .object({
        startAt: z.string().datetime({ offset: true }),
        endAt: z.string().datetime({ offset: true }),
      })
      .strict(),
    applicableRegimes: z.array(z.literal("unclassified")).length(1),
    validFrom: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    revocationStatus: z.enum(["active", "revoked"]),
  })
  .strict()
  .superRefine((scope, context) => {
    if (Date.parse(scope.historicalRange.startAt) > Date.parse(scope.historicalRange.endAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["historicalRange", "endAt"],
        message: "historical_range_invalid",
      });
    }
    if (Date.parse(scope.validFrom) >= Date.parse(scope.expiresAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "lesson_validity_invalid",
      });
    }
  });

const CandidateRefSchema = z
  .object({ id: StableIdSchema, fingerprint: ArtifactFingerprintSchema })
  .strict();

export const ApprovedLessonArtifactSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    lessonId: StableIdSchema,
    versionId: StableIdSchema,
    versionIndex: z.literal(1),
    humanVersion: z.literal("1.0.0"),
    fingerprint: ArtifactFingerprintSchema,
    lifecycleStatus: z.literal("approved"),
    createdAt: z.string().datetime({ offset: true }),
    sourceTradeId: StableIdSchema,
    candidateRef: CandidateRefSchema,
    reviewRef: CandidateRefSchema,
    comparativeEvidenceRef: CandidateRefSchema,
    validationBindingRef: z
      .object({
        id: StableIdSchema,
        versionId: StableIdSchema,
        fingerprint: ArtifactFingerprintSchema,
      })
      .strict(),
    strategyEvidenceBindingRef: z
      .object({
        id: StableIdSchema,
        versionId: StableIdSchema,
        fingerprint: ArtifactFingerprintSchema,
      })
      .strict(),
    backtestEvidenceRef: z
      .object({ jobId: StableIdSchema, fingerprint: ArtifactFingerprintSchema })
      .strict(),
    walkForwardEvidenceRef: z
      .object({ jobId: StableIdSchema, fingerprint: ArtifactFingerprintSchema })
      .strict(),
    approvalRef: z
      .object({
        approvalId: StableIdSchema,
        actorId: StableIdSchema,
        fingerprint: ArtifactFingerprintSchema,
      })
      .strict(),
    scope: ApprovedLessonScopeSchema,
    decisionContextMaterializationStatus: z.literal("pending"),
    decisionContextApplied: z.literal(false),
    strategyMutationCreated: z.literal(false),
    runtimeApplied: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();

export const LessonHumanApprovalRecordSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    approvalId: StableIdSchema,
    versionId: StableIdSchema,
    versionIndex: z.literal(1),
    humanVersion: z.literal("1.0.0"),
    fingerprint: ArtifactFingerprintSchema,
    createdAt: z.string().datetime({ offset: true }),
    lifecycleStatus: z.enum(["approved", "rejected"]),
    selectedTradeId: StableIdSchema,
    decision: LessonHumanApprovalDecisionSchema,
    rationale: z.string().min(8).max(2_000),
    approver: ActorSchema,
    evidenceGateRef: z
      .object({
        id: StableIdSchema,
        versionId: StableIdSchema,
        fingerprint: ArtifactFingerprintSchema,
        lifecycleStatus: z.literal("approval_required"),
      })
      .strict(),
    approvedLessonRef: z
      .object({
        lessonId: StableIdSchema,
        versionId: StableIdSchema,
        fingerprint: ArtifactFingerprintSchema,
      })
      .strict()
      .optional(),
    idempotencyKey: StableIdSchema,
    decisionContextApplied: z.literal(false),
    strategyMutationCreated: z.literal(false),
    runtimeApplied: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict()
  .superRefine((record, context) => {
    if ((record.lifecycleStatus === "approved") !== Boolean(record.approvedLessonRef)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approvedLessonRef"],
        message: "approval_lesson_reference_mismatch",
      });
    }
  });

export const LessonHumanApprovalResponseSchema = z
  .object({
    approval: LessonHumanApprovalRecordSchema,
    evidenceGate: LessonEvidenceGateProjectionSchema,
    approvedLesson: ApprovedLessonArtifactSchema.optional(),
    nextGate: z.enum(["decision_context_materialization", "candidate_closed"]),
    approvedLessonCreated: z.boolean(),
    decisionContextApplied: z.literal(false),
    strategyMutationCreated: z.literal(false),
    runtimeApplied: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict()
  .superRefine((response, context) => {
    const approved = response.approval.lifecycleStatus === "approved";
    if (approved !== Boolean(response.approvedLesson) || approved !== response.approvedLessonCreated) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approvedLessonCreated"],
        message: "approved_lesson_response_mismatch",
      });
    }
  });

export type LessonHumanApprovalCommand = z.infer<typeof LessonHumanApprovalCommandSchema>;
export type ApprovedLessonArtifact = z.infer<typeof ApprovedLessonArtifactSchema>;
export type LessonHumanApprovalRecord = z.infer<typeof LessonHumanApprovalRecordSchema>;
export type LessonHumanApprovalResponse = z.infer<typeof LessonHumanApprovalResponseSchema>;
