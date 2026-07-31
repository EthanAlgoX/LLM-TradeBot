import { z } from "zod";
import { SemanticObservationWindowKindSchema } from "./semantic-agent-artifacts.js";

const StableOrchestrationIdSchema = z
  .string()
  .min(3)
  .max(180)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/u, "stable_id_format");

export const OrchestrationIntentObservationWindowSchema = z
  .object({
    kind: SemanticObservationWindowKindSchema,
    unit: z.enum([
      "second",
      "minute",
      "hour",
      "day",
      "week",
      "month",
      "quarter",
    ]),
    value: z.number().int().positive(),
  })
  .strict();

export const OrchestrationIntentRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    requestId: StableOrchestrationIdSchema,
    presetId: StableOrchestrationIdSchema,
    marketPackId: StableOrchestrationIdSchema,
    dataSourceIds: z.array(StableOrchestrationIdSchema).max(20),
    observationWindows: z
      .array(OrchestrationIntentObservationWindowSchema)
      .min(1)
      .max(20),
    requiredAgentTemplateIds: z
      .array(StableOrchestrationIdSchema)
      .max(50)
      .default([]),
    target: z.literal("draft_only").default("draft_only"),
  })
  .strict()
  .superRefine((request, context) => {
    const duplicate = (values: readonly string[]): boolean =>
      new Set(values).size !== values.length;
    if (duplicate(request.dataSourceIds)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "data_source_id_duplicate",
        path: ["dataSourceIds"],
      });
    }
    if (duplicate(request.requiredAgentTemplateIds)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "agent_template_id_duplicate",
        path: ["requiredAgentTemplateIds"],
      });
    }
    const windowKeys = request.observationWindows.map(
      (window) => `${window.kind}:${window.value}:${window.unit}`,
    );
    if (duplicate(windowKeys)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "observation_window_duplicate",
        path: ["observationWindows"],
      });
    }
  });

const VersionedReferenceSchema = z
  .object({
    id: StableOrchestrationIdSchema,
    version: z.string().min(1).max(80),
    fingerprint: z.string().min(8).max(256),
  })
  .strict();

export const CompiledOrchestrationIntentSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    intentId: StableOrchestrationIdSchema,
    humanReadableVersion: z.string().min(1).max(80),
    fingerprint: z.string().regex(/^(?:fnv1a32|sha256):/u),
    lifecycleStatus: z.literal("draft"),
    createdAt: z.string().datetime({ offset: true }),
    schemaRefs: z.array(z.string().min(1)).min(1),
    presetRef: VersionedReferenceSchema,
    graphRef: VersionedReferenceSchema,
    marketPackId: StableOrchestrationIdSchema,
    dataSourceIds: z.array(StableOrchestrationIdSchema),
    observationWindows: z.array(OrchestrationIntentObservationWindowSchema).min(1),
    agentTemplateRefs: z.array(VersionedReferenceSchema).min(1),
    releaseGates: z.tuple([
      z.literal("contract_validation"),
      z.literal("backtest"),
      z.literal("walk_forward"),
      z.literal("human_approval"),
      z.literal("paper_running"),
    ]),
    runtimeMutationAllowed: z.literal(false),
  })
  .strict();

export const OrchestrationIntentErrorCodeSchema = z.enum([
  "INVALID_ORCHESTRATION_INTENT",
  "SEMANTIC_PRESET_NOT_REGISTERED",
  "PRESET_CAPABILITY_REQUIRED",
  "PRESET_GRAPH_BINDING_NOT_REGISTERED",
  "MARKET_PACK_NOT_REGISTERED",
  "MARKET_PACK_NOT_SUPPORTED_BY_PRESET",
  "DATA_SOURCE_NOT_REGISTERED",
  "DATA_SOURCE_SET_NOT_SUPPORTED_BY_GRAPH",
  "OBSERVATION_WINDOW_SET_NOT_SUPPORTED_BY_GRAPH",
  "AGENT_TEMPLATE_NOT_REGISTERED",
  "AGENT_TEMPLATE_NOT_IN_PRESET",
  "INTENT_GRAPH_VALIDATION_FAILED",
]);

export type OrchestrationIntentObservationWindow = z.infer<
  typeof OrchestrationIntentObservationWindowSchema
>;
export type OrchestrationIntentRequest = z.infer<
  typeof OrchestrationIntentRequestSchema
>;
export type CompiledOrchestrationIntent = z.infer<
  typeof CompiledOrchestrationIntentSchema
>;
export type OrchestrationIntentErrorCode = z.infer<
  typeof OrchestrationIntentErrorCodeSchema
>;
