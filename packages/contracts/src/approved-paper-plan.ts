import { z } from "zod";

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const ApprovedPaperPlanRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();
export type ApprovedPaperPlanRequest = z.infer<
  typeof ApprovedPaperPlanRequestSchema
>;

export const ApprovedPaperEvidenceRefSchema = z
  .object({
    kind: z.enum(["backtest", "walk_forward"]),
    evidenceId: z.string().min(1),
    jobId: z.string().min(1),
    artifactId: z.string().min(1),
    artifactRef: z.string().min(1),
    artifactSha256: Sha256Schema,
    manifestSha256: Sha256Schema,
    resultSha256: Sha256Schema,
  })
  .strict();
export type ApprovedPaperEvidenceRef = z.infer<
  typeof ApprovedPaperEvidenceRefSchema
>;

export const ApprovedPaperPlanSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    planId: z.string().min(1),
    planVersion: z.string().min(1),
    fingerprint: Sha256Schema,
    lifecycleStatus: z.literal("approved_ready"),
    draftId: z.string().min(1),
    graphId: z.string().min(1),
    graphVersion: z.string().min(1),
    graphFingerprint: z.string().min(1),
    marketPackRefs: z.array(z.string().min(1)).min(1),
    dataSourceRef: z.string().min(1),
    strategyProfileRef: z.string().min(1),
    dataFingerprint: z.string().min(1),
    paperAccountRef: z.string().min(1),
    candidateSymbols: z.array(z.string().min(1)),
    riskPolicyRefs: z.array(z.string().min(1)).min(1),
    approvalId: z.string().min(1),
    approvedByActorId: z.string().min(1),
    evidence: z
      .object({
        backtest: ApprovedPaperEvidenceRefSchema.extend({
          kind: z.literal("backtest"),
        }),
        walkForward: ApprovedPaperEvidenceRefSchema.extend({
          kind: z.literal("walk_forward"),
        }),
      })
      .strict(),
    compiledStepCount: z.number().int().positive(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    createdBy: z.literal("tradebot-server"),
    runtimeApplied: z.literal(false),
  })
  .strict();
export type ApprovedPaperPlan = z.infer<typeof ApprovedPaperPlanSchema>;

export const PaperActivationRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    idempotencyKey: z.string().min(8).max(200),
    confirmation: z.literal("activate_paper_plan"),
  })
  .strict();
export type PaperActivationRequest = z.infer<
  typeof PaperActivationRequestSchema
>;

export const PaperActivationRecordSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    activationId: z.string().min(1),
    planId: z.string().min(1),
    planFingerprint: Sha256Schema,
    draftId: z.string().min(1),
    graphFingerprint: z.string().min(1),
    actorId: z.string().min(1),
    actorDisplayName: z.string().min(1),
    status: z.literal("activated_not_applied"),
    activatedAt: z.string().datetime(),
    runtimeApplied: z.literal(false),
  })
  .strict();
export type PaperActivationRecord = z.infer<
  typeof PaperActivationRecordSchema
>;

export const RuntimeControlModeSchema = z.enum([
  "normal",
  "pause_new_openings_close_only",
]);
export type RuntimeControlMode = z.infer<typeof RuntimeControlModeSchema>;

export const PaperRuntimeControlRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    idempotencyKey: z.string().min(8).max(200),
    mode: z.literal("pause_new_openings_close_only"),
    confirmation: z.literal("pause_new_openings_close_only"),
  })
  .strict();
export type PaperRuntimeControlRequest = z.infer<
  typeof PaperRuntimeControlRequestSchema
>;

export const PaperRuntimeResumeRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    idempotencyKey: z.string().min(8).max(200),
    mode: z.literal("normal"),
    confirmation: z.literal("resume_normal_paper_cycles"),
  })
  .strict();
export type PaperRuntimeResumeRequest = z.infer<
  typeof PaperRuntimeResumeRequestSchema
>;

export const PaperRuntimeControlStateSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    controlId: z.string().min(1),
    planId: z.string().min(1),
    activationId: z.string().min(1),
    mode: RuntimeControlModeSchema,
    actorId: z.string().min(1),
    actorDisplayName: z.string().min(1),
    recordedAt: z.string().datetime(),
    controlPlaneRecorded: z.literal(true),
    runtimeApplied: z.literal(false),
  })
  .strict();
export type PaperRuntimeControlState = z.infer<
  typeof PaperRuntimeControlStateSchema
>;
