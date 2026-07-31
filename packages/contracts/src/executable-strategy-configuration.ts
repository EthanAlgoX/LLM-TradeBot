import { z } from "zod";

import {
  ArtifactFingerprintSchema,
  MarketPackReferenceSchema,
  SemanticArtifactSchemaVersion,
  VersionedEntityReferenceSchema,
} from "./semantic-agent-artifacts.js";
import {
  GraphStrategyProfileCandidateSetSchema,
  GraphStrategyProfileDefinitionSchema,
} from "./graph-backtest-evidence.js";

const StableIdSchema = z
  .string()
  .min(3)
  .max(240)
  .regex(/^[a-z0-9][a-z0-9._:@-]*$/u, "stable_id_format");
const TimestampSchema = z.string().datetime({ offset: true });
const PrimitiveSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const ExecutableConfigurationVersionReferenceSchema = z
  .object({
    draftId: StableIdSchema,
    versionId: StableIdSchema,
    fingerprint: ArtifactFingerprintSchema,
    kind: z.enum(["strategy", "agent", "prompt_policy"]),
  })
  .strict();

export const ExecutableParameterSourceSchema = z
  .object({
    kind: z.enum([
      "base_profile",
      "agent_configuration",
      "prompt_policy",
      "strategy_threshold",
      "strategy_weight",
      "materialization_policy",
    ]),
    sourceId: StableIdSchema,
  })
  .strict();

export const ExecutableStrategyConfigurationSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    executableStrategyId: StableIdSchema,
    humanVersion: z.string().min(1).max(80),
    fingerprint: ArtifactFingerprintSchema,
    sourceFingerprint: ArtifactFingerprintSchema,
    lifecycleStatus: z.literal("materialized"),
    createdAt: TimestampSchema,
    createdByActorId: StableIdSchema,
    materializationPolicyVersion: z.string().min(1).max(80),
    strategyConfigurationRef:
      ExecutableConfigurationVersionReferenceSchema.extend({
        kind: z.literal("strategy"),
      }).strict(),
    agentConfigurationRefs: z.array(
      ExecutableConfigurationVersionReferenceSchema.extend({
        kind: z.literal("agent"),
      }).strict(),
    ).min(1),
    promptPolicyRefs: z.array(
      ExecutableConfigurationVersionReferenceSchema.extend({
        kind: z.literal("prompt_policy"),
      }).strict(),
    ),
    historicalPlanRef: VersionedEntityReferenceSchema,
    marketPackRef: MarketPackReferenceSchema,
    baseProfileRef: VersionedEntityReferenceSchema,
    effectiveParameters: z.record(z.string(), PrimitiveSchema),
    parameterSources: z.record(
      z.string(),
      ExecutableParameterSourceSchema,
    ),
    promptExecutionMode: z.literal("semantic_only"),
    derivedProfile: GraphStrategyProfileDefinitionSchema,
    derivedCandidateSet: GraphStrategyProfileCandidateSetSchema,
    runtimeApplied: z.literal(false),
  })
  .strict()
  .superRefine((configuration, context) => {
    if (
      configuration.derivedCandidateSet.profileIds.length !== 1 ||
      configuration.derivedCandidateSet.profileIds[0] !==
        configuration.derivedProfile.id
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "derived_candidate_set_profile_mismatch",
        path: ["derivedCandidateSet", "profileIds"],
      });
    }
    if (
      !configuration.derivedProfile.compatiblePresetIds.includes(
        configuration.historicalPlanRef.id
          .split(":historical-plan:")[0]!
          .replace(/^pipeline-graph:/u, ""),
      ) &&
      configuration.derivedProfile.compatiblePresetIds.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "derived_profile_preset_missing",
        path: ["derivedProfile", "compatiblePresetIds"],
      });
    }
  });

export const MaterializeExecutableStrategyRequestSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
  })
  .strict();

export type ExecutableConfigurationVersionReference = z.infer<
  typeof ExecutableConfigurationVersionReferenceSchema
>;
export type ExecutableParameterSource = z.infer<
  typeof ExecutableParameterSourceSchema
>;
export type ExecutableStrategyConfiguration = z.infer<
  typeof ExecutableStrategyConfigurationSchema
>;
export type MaterializeExecutableStrategyRequest = z.infer<
  typeof MaterializeExecutableStrategyRequestSchema
>;

