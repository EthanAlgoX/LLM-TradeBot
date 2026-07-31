import { z } from "zod";

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

export const LessonEvidenceGateActionSchema = z.enum([
  "inspect",
  "run_backtest",
  "run_walk_forward",
]);

export const LessonEvidenceGateCommandSchema = z
  .object({
    selectedTradeId: StableIdSchema,
    idempotencyKey: StableIdSchema.max(120),
    action: LessonEvidenceGateActionSchema,
  })
  .strict();

export const LessonEvidenceGateIssueCodeSchema = z.enum([
  "LESSON_EVIDENCE_VALIDATION_BINDING_REQUIRED",
  "LESSON_EVIDENCE_VALIDATION_NOT_PASSED",
  "LESSON_EVIDENCE_SCOPE_UNAVAILABLE",
  "LESSON_EVIDENCE_SCOPE_AMBIGUOUS",
  "LESSON_EVIDENCE_SCOPE_STALE",
  "LESSON_EVIDENCE_BACKTEST_REQUIRED",
  "LESSON_EVIDENCE_ACTION_NOT_ALLOWED",
]);

export const LessonEvidenceValidationBindingReferenceSchema = z
  .object({
    bindingId: StableIdSchema,
    versionId: StableIdSchema,
    versionIndex: z.number().int().positive(),
    fingerprint: ArtifactFingerprintSchema,
    lifecycleStatus: z.literal("validation_passed"),
    configurationVersionId: StableIdSchema,
    configurationFingerprint: ArtifactFingerprintSchema,
    pipelineGraphRef: ReferenceSchema,
    candidateRef: z
      .object({ id: StableIdSchema, fingerprint: ArtifactFingerprintSchema })
      .strict(),
    reviewRef: z
      .object({ id: StableIdSchema, fingerprint: ArtifactFingerprintSchema })
      .strict(),
    comparativeEvidenceRef: z
      .object({ id: StableIdSchema, fingerprint: ArtifactFingerprintSchema })
      .strict(),
  })
  .strict();

export const LessonStrategyEvidenceBindingReferenceSchema = z
  .object({
    bindingId: StableIdSchema,
    versionId: StableIdSchema,
    versionIndex: z.number().int().positive(),
    fingerprint: ArtifactFingerprintSchema,
    lifecycleStatus: z.enum([
      "draft",
      "partial_evidence",
      "evidence_ready",
      "approved",
      "stale",
    ]),
    configurationRef: z
      .object({
        versionId: StableIdSchema,
        versionFingerprint: ArtifactFingerprintSchema,
        payloadFingerprint: ArtifactFingerprintSchema,
      })
      .strict(),
    datasetRef: ReferenceSchema,
    backtestProfileRef: ReferenceSchema,
    walkForwardCandidateSetRef: ReferenceSchema,
    walkForwardPlanRef: ReferenceSchema,
    marketPackRef: ReferenceSchema,
    dataSourceRef: ReferenceSchema,
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const LessonEvidenceJobGateSchema = z
  .object({
    gate: z.enum(["backtest", "walk_forward"]),
    status: z.enum(["blocked", "required", "passed", "stale", "unavailable"]),
    jobId: StableIdSchema.optional(),
    evidenceFingerprint: ArtifactFingerprintSchema.optional(),
  })
  .strict()
  .superRefine((gate, context) => {
    if (gate.status === "passed" && (!gate.jobId || !gate.evidenceFingerprint)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "passed_gate_requires_evidence",
      });
    }
  });

export const LessonEvidenceApprovalGateSchema = z
  .object({
    gate: z.literal("human_approval"),
    status: z.enum(["blocked", "ready", "not_executed", "stale", "unavailable"]),
    approvalExecuted: z.literal(false),
  })
  .strict();

export const LessonEvidenceGateProjectionSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    id: StableIdSchema,
    versionId: StableIdSchema,
    humanVersion: z.literal("1.0.0"),
    fingerprint: ArtifactFingerprintSchema,
    createdAt: z.string().datetime({ offset: true }),
    lifecycleStatus: z.enum([
      "binding_required",
      "evidence_unavailable",
      "backtest_required",
      "walk_forward_required",
      "approval_required",
      "stale",
    ]),
    selectedTradeId: StableIdSchema,
    validationBindingRef: LessonEvidenceValidationBindingReferenceSchema.optional(),
    strategyEvidenceBindingRef: LessonStrategyEvidenceBindingReferenceSchema.optional(),
    backtest: LessonEvidenceJobGateSchema,
    walkForward: LessonEvidenceJobGateSchema,
    approval: LessonEvidenceApprovalGateSchema,
    issueCodes: z.array(LessonEvidenceGateIssueCodeSchema).max(20),
    nextGate: z.enum([
      "validation_binding",
      "evidence_scope",
      "backtest",
      "walk_forward",
      "human_approval",
      "none",
    ]),
    allowedAction: z.enum(["run_backtest", "run_walk_forward", "none"]),
    readOnlyProjection: z.literal(true),
    approvedLessonCreated: z.literal(false),
    strategyMutationCreated: z.literal(false),
    runtimeApplied: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict()
  .superRefine((projection, context) => {
    if (
      projection.lifecycleStatus === "approval_required" &&
      (projection.backtest.status !== "passed" ||
        projection.walkForward.status !== "passed" ||
        projection.approval.status !== "ready")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lifecycleStatus"],
        message: "approval_ready_requires_evidence_pair",
      });
    }
    if (
      ["backtest_required", "walk_forward_required", "approval_required"].includes(
        projection.lifecycleStatus,
      ) &&
      (!projection.validationBindingRef || !projection.strategyEvidenceBindingRef)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["strategyEvidenceBindingRef"],
        message: "active_evidence_gate_requires_bindings",
      });
    }
  });

export type LessonEvidenceGateAction = z.infer<typeof LessonEvidenceGateActionSchema>;
export type LessonEvidenceGateCommand = z.infer<typeof LessonEvidenceGateCommandSchema>;
export type LessonEvidenceGateIssueCode = z.infer<typeof LessonEvidenceGateIssueCodeSchema>;
export type LessonEvidenceGateProjection = z.infer<
  typeof LessonEvidenceGateProjectionSchema
>;
