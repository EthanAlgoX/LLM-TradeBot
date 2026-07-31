import { z } from "zod";
import {
  ArtifactFingerprintSchema,
  SemanticArtifactSchemaVersion,
} from "./semantic-agent-artifacts.js";

const ConfigurationIdSchema = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._:@-]*$/u, "stable_id_format");
const PrimitiveSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const ObservationWindowDraftSchema = z
  .object({
    kind: z.enum(["bar_interval", "rolling_window", "event_batch", "reporting_period"]),
    unit: z.enum(["second", "minute", "hour", "day", "week", "month", "quarter"]),
    value: z.number().int().positive(),
  })
  .strict();

export const MarketConfigurationDraftSchema = z
  .object({
    kind: z.literal("market"),
    marketPackId: ConfigurationIdSchema,
    dataSourceIds: z.array(ConfigurationIdSchema).min(1),
    observationWindows: z.array(ObservationWindowDraftSchema).min(1),
    timezone: z.string().min(1).max(80),
    tradingCalendarRef: z.string().min(1).max(160),
  })
  .strict();

export const PromptPolicyDraftSchema = z
  .object({
    kind: z.literal("prompt_policy"),
    agentTemplateId: ConfigurationIdSchema,
    systemInstructions: z.string().min(1).max(20_000),
    decisionRules: z.array(z.string().min(1).max(2_000)).max(128),
    parameters: z.record(z.string(), PrimitiveSchema),
    allowedToolIds: z.array(ConfigurationIdSchema),
  })
  .strict();

export const AgentConfigurationDraftSchema = z
  .object({
    kind: z.literal("agent"),
    marketPackId: ConfigurationIdSchema,
    agentTemplateId: ConfigurationIdSchema,
    dataSourceIds: z.array(ConfigurationIdSchema),
    observationWindows: z.array(ObservationWindowDraftSchema),
    promptPolicyDraftId: ConfigurationIdSchema.optional(),
    parameters: z.record(z.string(), PrimitiveSchema),
  })
  .strict();

export const StrategyCompositionDraftSchema = z
  .object({
    kind: z.literal("strategy"),
    marketPackId: ConfigurationIdSchema,
    pipelineDraftId: ConfigurationIdSchema,
    agentConfigurationDraftIds: z.array(ConfigurationIdSchema).min(1),
    promptPolicyDraftIds: z.array(ConfigurationIdSchema),
    weights: z.record(ConfigurationIdSchema, z.number().finite().min(0).max(1)),
    thresholds: z.record(z.string(), z.number().finite()),
  })
  .strict();

export const ConfigurationDraftPayloadSchema = z.discriminatedUnion("kind", [
  MarketConfigurationDraftSchema,
  AgentConfigurationDraftSchema,
  PromptPolicyDraftSchema,
  StrategyCompositionDraftSchema,
]);

export const ConfigurationDraftVersionSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    draftId: ConfigurationIdSchema,
    versionId: ConfigurationIdSchema,
    versionIndex: z.number().int().positive(),
    parentVersionId: ConfigurationIdSchema.optional(),
    parentFingerprint: ArtifactFingerprintSchema.optional(),
    humanVersion: z.string().min(1).max(80),
    fingerprint: ArtifactFingerprintSchema,
    lifecycleStatus: z.enum(["draft", "validated", "compiled", "superseded"]),
    createdAt: z.string().datetime({ offset: true }),
    createdByActorId: ConfigurationIdSchema,
    payload: ConfigurationDraftPayloadSchema,
    evidenceState: z
      .object({
        status: z.enum(["none", "current", "stale"]),
        evidenceRefs: z.array(z.string().min(1).max(500)),
        staleReason: z.enum(["configuration_changed"]).optional(),
      })
      .strict(),
    runtimeApplied: z.literal(false),
  })
  .strict();

export const ConfigurationDraftPatchSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    parentFingerprint: ArtifactFingerprintSchema,
    humanVersion: z.string().min(1).max(80),
    payload: ConfigurationDraftPayloadSchema,
  })
  .strict();

export const CreateConfigurationDraftRequestSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    humanVersion: z.string().min(1).max(80),
    payload: ConfigurationDraftPayloadSchema,
  })
  .strict();

export const ConfigurationValidationCodeSchema = z.enum([
  "MARKET_PACK_NOT_REGISTERED",
  "DATA_SOURCE_NOT_REGISTERED",
  "AGENT_TEMPLATE_NOT_REGISTERED",
  "PROMPT_POLICY_DRAFT_NOT_FOUND",
  "AGENT_CONFIGURATION_DRAFT_NOT_FOUND",
  "PIPELINE_DRAFT_NOT_FOUND",
  "DRAFT_KIND_MISMATCH",
  "PARENT_FINGERPRINT_CONFLICT",
  "HISTORICAL_COMPILE_FAILED",
]);

export const ConfigurationValidationIssueSchema = z
  .object({
    issueId: ConfigurationIdSchema,
    code: ConfigurationValidationCodeSchema,
    entityType: z.enum(["draft", "market_pack", "data_source", "agent_template", "pipeline"]),
    entityId: z.string().optional(),
    path: z.array(z.union([z.string(), z.number()])),
    details: z.record(z.string(), z.string()),
  })
  .strict();

export const ConfigurationValidationResultSchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(ConfigurationValidationIssueSchema),
    checkedFingerprint: ArtifactFingerprintSchema,
  })
  .strict();

export const ConfigurationCatalogSnapshotSchema = z
  .object({
    marketPackIds: z.array(ConfigurationIdSchema),
    dataSourceIds: z.array(ConfigurationIdSchema),
    agentTemplateIds: z.array(ConfigurationIdSchema),
    allowedToolIds: z.array(ConfigurationIdSchema),
  })
  .strict();

export type MarketConfigurationDraft = z.infer<typeof MarketConfigurationDraftSchema>;
export type AgentConfigurationDraft = z.infer<typeof AgentConfigurationDraftSchema>;
export type PromptPolicyDraft = z.infer<typeof PromptPolicyDraftSchema>;
export type StrategyCompositionDraft = z.infer<typeof StrategyCompositionDraftSchema>;
export type ConfigurationDraftPayload = z.infer<typeof ConfigurationDraftPayloadSchema>;
export type ConfigurationDraftVersion = z.infer<typeof ConfigurationDraftVersionSchema>;
export type ConfigurationDraftPatch = z.infer<typeof ConfigurationDraftPatchSchema>;
export type CreateConfigurationDraftRequest = z.infer<typeof CreateConfigurationDraftRequestSchema>;
export type ConfigurationValidationIssue = z.infer<typeof ConfigurationValidationIssueSchema>;
export type ConfigurationValidationResult = z.infer<typeof ConfigurationValidationResultSchema>;
export type ConfigurationCatalogSnapshot = z.infer<typeof ConfigurationCatalogSnapshotSchema>;
