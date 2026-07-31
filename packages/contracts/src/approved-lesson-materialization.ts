import { z } from "zod";

import {
  ApprovedReflectionLessonSchema,
  ArtifactFingerprintSchema,
  DecisionSemanticContextSchema,
} from "./semantic-agent-artifacts.js";

const StableIdSchema = z
  .string()
  .min(3)
  .max(240)
  .regex(/^[a-z0-9][a-z0-9._:@-]*$/u, "stable_id_format");

export const ApprovedLessonMaterializationCommandSchema = z
  .object({
    selectedTradeId: StableIdSchema,
    idempotencyKey: StableIdSchema.max(160),
  })
  .strict();

export const ApprovedLessonMaterializationIssueCodeSchema = z.enum([
  "APPROVED_LESSON_NOT_AVAILABLE",
  "APPROVED_LESSON_REJECTED",
  "APPROVED_LESSON_EXPIRED",
  "APPROVED_LESSON_REVOKED",
  "APPROVED_LESSON_SCOPE_STALE",
  "REFLECTION_SEMANTIC_CANDIDATE_UNAVAILABLE",
  "REFLECTION_SEMANTIC_CANDIDATE_STALE",
  "SHADOW_DECISION_CONTEXT_BASE_UNAVAILABLE",
  "SHADOW_DECISION_CONTEXT_FACTS_UNAVAILABLE",
  "SHADOW_DECISION_CONTEXT_ARTIFACT_STALE",
  "SHADOW_DECISION_CONTEXT_MARKET_STALE",
]);

export const ShadowDecisionContextProjectionSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    projectionId: StableIdSchema,
    versionId: StableIdSchema,
    fingerprint: ArtifactFingerprintSchema,
    lifecycleStatus: z.enum(["unavailable", "stale", "validated"]),
    targetSchemaRef: z
      .object({
        schemaId: z.literal("tradebot.semantic.decision_semantic_context.v1"),
        schemaVersion: z.literal("1.0.0"),
      })
      .strict(),
    approvedLessonRefs: z.array(
      z
        .object({
          id: StableIdSchema,
          version: z.string().min(1).max(80),
          fingerprint: ArtifactFingerprintSchema,
        })
        .strict(),
    ).max(1),
    context: DecisionSemanticContextSchema.optional(),
    decisionContextApplied: z.literal(false),
    runtimeApplied: z.literal(false),
  })
  .strict()
  .superRefine((projection, context) => {
    if ((projection.lifecycleStatus === "validated") !== Boolean(projection.context)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["context"],
        message: "shadow_context_lifecycle_mismatch",
      });
    }
  });

export const ApprovedLessonMaterializationResponseSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    id: StableIdSchema,
    versionId: StableIdSchema,
    humanVersion: z.literal("1.0.0"),
    fingerprint: ArtifactFingerprintSchema,
    createdAt: z.string().datetime({ offset: true }),
    lifecycleStatus: z.enum([
      "not_approved",
      "semantic_facts_unavailable",
      "stale",
      "expired",
      "revoked",
      "materialized",
    ]),
    selectedTradeId: StableIdSchema,
    approvedLesson: ApprovedReflectionLessonSchema.optional(),
    shadowDecisionContext: ShadowDecisionContextProjectionSchema,
    issueCodes: z.array(ApprovedLessonMaterializationIssueCodeSchema).max(20),
    materializedByActorId: StableIdSchema,
    readOnlyProjection: z.literal(true),
    decisionContextApplied: z.literal(false),
    strategyMutationCreated: z.literal(false),
    runtimeApplied: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict()
  .superRefine((response, context) => {
    if ((response.lifecycleStatus === "materialized") !== Boolean(response.approvedLesson)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approvedLesson"],
        message: "materialized_lesson_lifecycle_mismatch",
      });
    }
  });

export type ApprovedLessonMaterializationCommand = z.infer<
  typeof ApprovedLessonMaterializationCommandSchema
>;
export type ApprovedLessonMaterializationResponse = z.infer<
  typeof ApprovedLessonMaterializationResponseSchema
>;
