import { z } from "zod";
import {
  ArtifactFingerprintSchema,
  ArtifactSchemaReferenceSchema,
  MarketPackReferenceSchema,
  SemanticArtifactReferenceSchema,
  SemanticArtifactSchemaVersion,
  VersionedEntityReferenceSchema,
} from "./semantic-agent-artifacts.js";
import {
  SemanticPresetAuthoritySchema,
  SemanticPresetExecutionModeSchema,
  SemanticPresetNodeRoleSchema,
} from "./semantic-pipeline-preset.js";

const ExecutionIdSchema = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/u, "stable_id_format");

export const HistoricalGraphExecutionErrorCodeSchema = z.enum([
  "PLAN_NOT_REGISTERED",
  "PLAN_FINGERPRINT_MISMATCH",
  "PLAN_CONTRACT_INVALID",
  "PRESET_NOT_REGISTERED",
  "CAPABILITY_NOT_AUTHORIZED",
  "NODE_EXECUTOR_NOT_REGISTERED",
  "NODE_EXECUTOR_ROLE_MISMATCH",
  "ARTIFACT_SCHEMA_NOT_REGISTERED",
  "INPUT_SCHEMA_INCOMPATIBLE",
  "OUTPUT_SCHEMA_INCOMPATIBLE",
  "OUTPUT_ARTIFACT_UNDECLARED",
  "REQUIRED_INPUT_MISSING",
  "FALLBACK_INPUT_INVALID",
  "LINEAGE_MISSING",
  "LINEAGE_MISMATCH",
  "SOURCE_ARTIFACT_MISMATCH",
  "FUTURE_DATA_DETECTED",
  "NODE_EXECUTION_FAILED",
  "ACTION_BOUNDARY_VIOLATION",
  "IDEMPOTENCY_CONFLICT",
]);

export const HistoricalGraphNodeRunStatusSchema = z.enum([
  "succeeded",
  "fallback_succeeded",
  "failed",
  "skipped",
]);

export const HistoricalGraphExecutionRunStatusSchema = z.enum([
  "succeeded",
  "completed_with_warnings",
  "failed",
]);

export const HistoricalGraphPlanInputBindingSchema = z
  .object({
    edgeId: ExecutionIdSchema,
    sourceNodeId: ExecutionIdSchema,
    artifactType: z.string().min(1).max(160),
    policy: z.enum(["required", "optional", "fallback"]),
    fallbackForEdgeId: ExecutionIdSchema.optional(),
  })
  .strict()
  .superRefine((binding, context) => {
    if (binding.policy === "fallback" && !binding.fallbackForEdgeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fallback_binding_target_missing",
        path: ["fallbackForEdgeId"],
      });
    }
    if (binding.policy !== "fallback" && binding.fallbackForEdgeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "non_fallback_binding_has_target",
        path: ["fallbackForEdgeId"],
      });
    }
  });

export const HistoricalGraphPlanNodeSchema = z
  .object({
    index: z.number().int().nonnegative(),
    nodeId: ExecutionIdSchema,
    role: SemanticPresetNodeRoleSchema,
    executorId: ExecutionIdSchema,
    authority: SemanticPresetAuthoritySchema,
    observationWindowIds: z.array(ExecutionIdSchema),
    predecessorNodeIds: z.array(ExecutionIdSchema),
    successorNodeIds: z.array(ExecutionIdSchema),
    inputBindings: z.array(HistoricalGraphPlanInputBindingSchema),
    outputArtifactTypes: z.array(z.string().min(1).max(160)),
  })
  .strict();

export const HistoricalGraphExecutionPlanSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    planId: ExecutionIdSchema,
    version: z.string().min(1).max(80),
    fingerprint: ArtifactFingerprintSchema,
    lifecycleStatus: z.literal("registered"),
    createdAt: z.string().datetime({ offset: true }),
    presetRef: VersionedEntityReferenceSchema,
    compiledGraphRef: VersionedEntityReferenceSchema,
    executionMode: SemanticPresetExecutionModeSchema,
    marketPackRef: MarketPackReferenceSchema,
    requiredCapabilityKinds: z.array(z.enum(["bar", "event", "report"])).min(1),
    nodes: z.array(HistoricalGraphPlanNodeSchema).min(1),
    runtimeApplied: z.literal(false),
  })
  .strict()
  .superRefine((plan, context) => {
    const nodeIndex = new Map(plan.nodes.map((node) => [node.nodeId, node.index]));
    if (nodeIndex.size !== plan.nodes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "historical_plan_duplicate_node",
        path: ["nodes"],
      });
    }
    const sortedIndexes = plan.nodes.map((node) => node.index).sort((left, right) => left - right);
    if (sortedIndexes.some((value, index) => value !== index)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "historical_plan_indexes_not_contiguous",
        path: ["nodes"],
      });
    }
    for (const [index, node] of plan.nodes.entries()) {
      for (const predecessor of node.predecessorNodeIds) {
        const predecessorIndex = nodeIndex.get(predecessor);
        if (predecessorIndex === undefined || predecessorIndex >= node.index) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "historical_plan_not_topological",
            path: ["nodes", index, "predecessorNodeIds"],
          });
        }
      }
      for (const binding of node.inputBindings.filter((item) => item.policy === "fallback")) {
        const primary = node.inputBindings.find((item) => item.edgeId === binding.fallbackForEdgeId);
        if (!primary || primary.policy === "fallback" || primary.artifactType !== binding.artifactType) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "historical_plan_fallback_binding_invalid",
            path: ["nodes", index, "inputBindings"],
          });
        }
      }
    }

    const authorities = new Map(plan.nodes.map((node) => [node.role, node.authority] as const));
    if (plan.executionMode === "paper_capable") {
      const chain = [
        ["decision", "decision_intent"],
        ["portfolio", "portfolio_action"],
        ["risk", "risk_gate"],
        ["execution", "execution"],
      ] as const;
      for (const [role, authority] of chain) {
        if (authorities.get(role) !== authority) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "historical_plan_action_chain_incomplete",
            path: ["nodes"],
          });
        }
      }
    } else if (
      plan.nodes.some((node) =>
        ["portfolio_action", "risk_gate", "execution"].includes(node.authority),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "historical_research_plan_has_action_authority",
        path: ["nodes"],
      });
    }
  });

export const HistoricalGraphArtifactEnvelopeSchema = z
  .object({
    artifactId: ExecutionIdSchema,
    artifactType: z.string().min(1).max(160),
    schemaRef: ArtifactSchemaReferenceSchema,
    fingerprint: ArtifactFingerprintSchema,
    producerNodeId: ExecutionIdSchema,
    asOf: z.string().datetime({ offset: true }),
    sourceArtifactRefs: z.array(SemanticArtifactReferenceSchema),
    lineageFingerprints: z.array(ArtifactFingerprintSchema).min(1),
  })
  .strict();

export const HistoricalGraphExecutionErrorSchema = z
  .object({
    code: HistoricalGraphExecutionErrorCodeSchema,
    nodeId: ExecutionIdSchema.optional(),
    fields: z.record(z.string(), z.string()),
  })
  .strict();

export const HistoricalGraphNodeRunSchema = z
  .object({
    nodeRunId: ExecutionIdSchema,
    nodeId: ExecutionIdSchema,
    executorId: ExecutionIdSchema,
    status: HistoricalGraphNodeRunStatusSchema,
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    durationMs: z.number().int().nonnegative(),
    inputArtifactRefs: z.array(SemanticArtifactReferenceSchema),
    outputArtifactRefs: z.array(SemanticArtifactReferenceSchema),
    usedFallbackEdgeIds: z.array(ExecutionIdSchema),
    error: HistoricalGraphExecutionErrorSchema.optional(),
  })
  .strict()
  .superRefine((nodeRun, context) => {
    if (nodeRun.status === "failed" && !nodeRun.error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "failed_node_run_requires_error",
        path: ["error"],
      });
    }
    if (nodeRun.status !== "failed" && nodeRun.error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "successful_node_run_cannot_have_error",
        path: ["error"],
      });
    }
  });

export const HistoricalGraphExecutionRequestSchema = z
  .object({
    planId: ExecutionIdSchema,
    idempotencyKey: z.string().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/u),
    asOf: z.string().datetime({ offset: true }),
  })
  .strict();

export const HistoricalGraphExecutionRunSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    runId: ExecutionIdSchema,
    planRef: VersionedEntityReferenceSchema,
    idempotencyKey: z.string().min(8).max(160),
    asOf: z.string().datetime({ offset: true }),
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    status: HistoricalGraphExecutionRunStatusSchema,
    nodeRuns: z.array(HistoricalGraphNodeRunSchema).min(1),
    artifactRefs: z.array(SemanticArtifactReferenceSchema),
    terminalArtifactRefs: z.array(SemanticArtifactReferenceSchema),
    errorCodes: z.array(HistoricalGraphExecutionErrorCodeSchema),
    runtimeApplied: z.literal(false),
  })
  .strict();

export const HistoricalGraphExecutionResultSchema = z
  .object({
    run: HistoricalGraphExecutionRunSchema,
    artifacts: z.array(HistoricalGraphArtifactEnvelopeSchema),
  })
  .strict();

export type HistoricalGraphExecutionErrorCode = z.infer<
  typeof HistoricalGraphExecutionErrorCodeSchema
>;
export type HistoricalGraphPlanInputBinding = z.infer<
  typeof HistoricalGraphPlanInputBindingSchema
>;
export type HistoricalGraphPlanNode = z.infer<typeof HistoricalGraphPlanNodeSchema>;
export type HistoricalGraphExecutionPlan = z.infer<typeof HistoricalGraphExecutionPlanSchema>;
export type HistoricalGraphArtifactEnvelope = z.infer<
  typeof HistoricalGraphArtifactEnvelopeSchema
>;
export type HistoricalGraphNodeRun = z.infer<typeof HistoricalGraphNodeRunSchema>;
export type HistoricalGraphExecutionRequest = z.infer<
  typeof HistoricalGraphExecutionRequestSchema
>;
export type HistoricalGraphExecutionRun = z.infer<typeof HistoricalGraphExecutionRunSchema>;
export type HistoricalGraphExecutionResult = z.infer<
  typeof HistoricalGraphExecutionResultSchema
>;
