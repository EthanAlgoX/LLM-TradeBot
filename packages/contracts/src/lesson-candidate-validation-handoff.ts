import { z } from "zod";
import {
  ArtifactFingerprintSchema,
  VersionedEntityReferenceSchema,
} from "./semantic-agent-artifacts.js";

export const LessonCandidateValidationHandoffSchemaVersion = "1.0.0" as const;

const StableIdSchema = z
  .string()
  .min(3)
  .max(240)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/u, "stable_id_format");

const FingerprintedReferenceSchema = z
  .object({
    id: StableIdSchema,
    fingerprint: ArtifactFingerprintSchema,
  })
  .strict();

export const LessonCandidateValidationHandoffRequestSchema = z
  .object({
    selectedTradeId: StableIdSchema,
  })
  .strict();

export const CreateLessonCandidateValidationBindingCommandSchema = z
  .object({
    selectedTradeId: StableIdSchema,
    idempotencyKey: StableIdSchema,
  })
  .strict();

const ValidationIssueCodeSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[A-Z][A-Z0-9_]+$/u, "validation_issue_code_format");

export const LessonCandidateContractValidationResultSchema = z
  .object({
    configuration: z
      .object({
        valid: z.boolean(),
        checkedFingerprint: ArtifactFingerprintSchema,
        issueCodes: z.array(ValidationIssueCodeSchema).max(100),
      })
      .strict(),
    pipeline: z
      .object({
        valid: z.boolean(),
        checkedFingerprint: ArtifactFingerprintSchema,
        issueCodes: z.array(ValidationIssueCodeSchema).max(100),
        errorCount: z.number().int().nonnegative(),
        warningCount: z.number().int().nonnegative(),
      })
      .strict(),
    valid: z.boolean(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.valid !== (result.configuration.valid && result.pipeline.valid)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valid"],
        message: "combined_validation_result_mismatch",
      });
    }
  });

export const LessonCandidateValidationBindingReferenceSchema = z
  .object({
    bindingVersionRef: z
      .object({
        bindingId: StableIdSchema,
        versionId: StableIdSchema,
        versionIndex: z.number().int().positive(),
        parentFingerprint: ArtifactFingerprintSchema.optional(),
        fingerprint: ArtifactFingerprintSchema,
        lifecycleStatus: z.enum(["validation_failed", "validation_passed"]),
      })
      .strict()
      .optional(),
    reviewFingerprint: ArtifactFingerprintSchema,
    candidateFingerprint: ArtifactFingerprintSchema,
    comparativeEvidenceFingerprint: ArtifactFingerprintSchema,
    configurationRef: z
      .object({
        draftId: StableIdSchema,
        versionId: StableIdSchema,
        versionFingerprint: ArtifactFingerprintSchema,
        payloadFingerprint: ArtifactFingerprintSchema,
      })
      .strict(),
    pipelineGraphRef: VersionedEntityReferenceSchema,
  })
  .strict();

export const LessonCandidateValidationBindingSchema = z
  .object({
    schemaVersion: z.literal(LessonCandidateValidationHandoffSchemaVersion),
    bindingId: StableIdSchema,
    versionId: StableIdSchema,
    versionIndex: z.number().int().positive(),
    parentFingerprint: ArtifactFingerprintSchema.optional(),
    humanVersion: z.literal("1.0.0"),
    fingerprint: ArtifactFingerprintSchema,
    createdAt: z.string().datetime({ offset: true }),
    createdByActorId: StableIdSchema,
    lifecycleStatus: z.enum(["validation_failed", "validation_passed"]),
    sourceTradeId: StableIdSchema,
    candidateRef: FingerprintedReferenceSchema,
    reviewRef: FingerprintedReferenceSchema,
    comparativeEvidenceRef: FingerprintedReferenceSchema,
    configurationRef: z
      .object({
        draftId: StableIdSchema,
        versionId: StableIdSchema,
        versionFingerprint: ArtifactFingerprintSchema,
        payloadFingerprint: ArtifactFingerprintSchema,
      })
      .strict(),
    pipelineGraphRef: VersionedEntityReferenceSchema,
    contractValidation: LessonCandidateContractValidationResultSchema,
    readOnly: z.literal(true),
    approvedLessonCreated: z.literal(false),
    strategyMutationCreated: z.literal(false),
    runtimeApplied: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict()
  .superRefine((binding, context) => {
    const passed = binding.lifecycleStatus === "validation_passed";
    if (passed !== binding.contractValidation.valid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lifecycleStatus"],
        message: "binding_lifecycle_validation_mismatch",
      });
    }
    if (binding.versionIndex === 1 && binding.parentFingerprint) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentFingerprint"],
        message: "first_binding_version_cannot_have_parent",
      });
    }
    if (binding.versionIndex > 1 && !binding.parentFingerprint) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentFingerprint"],
        message: "later_binding_version_requires_parent",
      });
    }
  });

export const LessonCandidateValidationBindingResponseSchema = z
  .object({
    binding: LessonCandidateValidationBindingSchema,
    nextGate: z.enum(["contract_validation", "backtest"]),
    approvedLessonCreated: z.literal(false),
    strategyMutationCreated: z.literal(false),
    runtimeApplied: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();

export const LessonCandidateValidationIssueCodeSchema = z.union([
  z.enum([
    "LESSON_CANDIDATE_REVIEW_REQUIRED",
    "LESSON_CANDIDATE_REJECTED",
    "LESSON_CANDIDATE_FINGERPRINT_CHANGED",
    "COMPARATIVE_EVIDENCE_NOT_AVAILABLE",
    "COMPARATIVE_EVIDENCE_FINGERPRINT_CHANGED",
    "VALIDATION_DRAFT_BINDING_NOT_AVAILABLE",
    "VALIDATION_BINDING_SCOPE_MISMATCH",
  ]),
  z
    .string()
    .min(3)
    .max(80)
    .regex(/^[A-Z][A-Z0-9_]+$/u, "pipeline_validation_code_format"),
]);

export const LessonCandidateValidationGateSummarySchema = z
  .object({
    gate: z.literal("contract_validation"),
    status: z.enum([
      "not_started",
      "unavailable",
      "failed",
      "passed",
      "stale",
      "closed",
    ]),
    issueCodes: z.array(LessonCandidateValidationIssueCodeSchema).max(100),
    errorCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    validatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const LessonCandidateValidationHandoffResponseSchema = z
  .object({
    schemaVersion: z.literal(LessonCandidateValidationHandoffSchemaVersion),
    id: StableIdSchema,
    humanVersion: z.literal("1.0.0"),
    fingerprint: ArtifactFingerprintSchema,
    createdAt: z.string().datetime({ offset: true }),
    lifecycleStatus: z.enum([
      "not_reviewed",
      "candidate_closed",
      "accepted_for_validation",
      "validation_unavailable",
      "validation_failed",
      "validation_passed",
      "stale",
    ]),
    selectedTradeId: StableIdSchema,
    candidateRef: FingerprintedReferenceSchema,
    reviewRef: FingerprintedReferenceSchema.optional(),
    comparativeEvidenceRef: FingerprintedReferenceSchema.optional(),
    binding: LessonCandidateValidationBindingReferenceSchema.optional(),
    contractValidation: LessonCandidateValidationGateSummarySchema,
    nextGate: z.enum([
      "human_review",
      "candidate_closed",
      "draft_binding_required",
      "contract_validation",
      "backtest",
    ]),
    readOnly: z.literal(true),
    approvedLessonCreated: z.literal(false),
    strategyMutationCreated: z.literal(false),
    runtimeApplied: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict()
  .superRefine((handoff, context) => {
    if (
      handoff.lifecycleStatus === "validation_passed" &&
      (handoff.contractValidation.status !== "passed" || !handoff.binding)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contractValidation", "status"],
        message: "validation_passed_requires_server_binding",
      });
    }
    if (
      handoff.contractValidation.status === "passed" &&
      handoff.contractValidation.issueCodes.length > 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contractValidation", "issueCodes"],
        message: "passed_validation_cannot_have_issues",
      });
    }
  });

export type LessonCandidateValidationHandoffRequest = z.infer<
  typeof LessonCandidateValidationHandoffRequestSchema
>;
export type CreateLessonCandidateValidationBindingCommand = z.infer<
  typeof CreateLessonCandidateValidationBindingCommandSchema
>;
export type LessonCandidateContractValidationResult = z.infer<
  typeof LessonCandidateContractValidationResultSchema
>;
export type LessonCandidateValidationBindingReference = z.infer<
  typeof LessonCandidateValidationBindingReferenceSchema
>;
export type LessonCandidateValidationBinding = z.infer<
  typeof LessonCandidateValidationBindingSchema
>;
export type LessonCandidateValidationBindingResponse = z.infer<
  typeof LessonCandidateValidationBindingResponseSchema
>;
export type LessonCandidateValidationGateSummary = z.infer<
  typeof LessonCandidateValidationGateSummarySchema
>;
export type LessonCandidateValidationHandoffResponse = z.infer<
  typeof LessonCandidateValidationHandoffResponseSchema
>;
