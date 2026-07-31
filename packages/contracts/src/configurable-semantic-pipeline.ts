import { z } from "zod";
import {
  AgentSemanticAssessmentSchema,
  DecisionSemanticContextSchema,
  MarketObservationArtifactSchema,
} from "./semantic-agent-artifacts.js";

export const ConfigurableSemanticPipelineSchemaVersion = "1.0.0" as const;

const StableIdSchema = z.string().min(3).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u, "stable_id_format");
const FingerprintSchema = z.string().min(16).max(200);

export const SemanticPipelinePreviewCommandSchema = z.object({
  schemaVersion: z.literal(ConfigurableSemanticPipelineSchemaVersion),
  configurationVersionId: StableIdSchema,
  idempotencyKey: StableIdSchema,
}).strict();

const RegisteredEntityRefSchema = z.object({
  id: StableIdSchema,
  humanVersion: z.string().min(1).max(80),
  fingerprint: FingerprintSchema,
}).strict();

const ObservationWindowProjectionSchema = z.object({
  id: StableIdSchema,
  kind: z.enum(["bar_interval", "rolling_window", "event_batch", "reporting_period"]),
  description: z.string().min(1).max(500),
}).strict();

const RegisteredDataSourceProjectionSchema = RegisteredEntityRefSchema.extend({
  capabilityRefs: z.array(RegisteredEntityRefSchema),
}).strict();

const ConfiguredSemanticAgentProjectionSchema = z.object({
  configurationRef: RegisteredEntityRefSchema,
  templateRef: RegisteredEntityRefSchema,
  dataSourceRefs: z.array(RegisteredDataSourceProjectionSchema).min(1),
  observationWindows: z.array(ObservationWindowProjectionSchema).min(1),
  inputArtifactType: z.literal("market_observation"),
  outputArtifactType: z.literal("agent_semantic_assessment"),
}).strict();

export const SemanticPipelinePreviewSchema = z.object({
  schemaVersion: z.literal(ConfigurableSemanticPipelineSchemaVersion),
  previewId: StableIdSchema,
  humanVersion: z.string().min(1).max(80),
  fingerprint: FingerprintSchema,
  createdAt: z.string().datetime({ offset: true }),
  lifecycleStatus: z.enum(["ready", "validation_failed"]),
  strategyConfigurationRef: RegisteredEntityRefSchema,
  marketPackRef: RegisteredEntityRefSchema,
  agents: z.array(ConfiguredSemanticAgentProjectionSchema),
  validation: z.object({
    valid: z.boolean(),
    issueCodes: z.array(z.string().min(1).max(160)),
  }).strict(),
  nextGate: z.enum(["configuration_validation", "registered_semantic_input_execution"]),
  clientDataAccepted: z.literal(false),
  clientAgentImplementationAccepted: z.literal(false),
  decisionContextCreated: z.literal(false),
  runtimeApplied: z.literal(false),
  exchangeWriteAllowed: z.literal(false),
}).strict();

export type SemanticPipelinePreviewCommand = z.infer<typeof SemanticPipelinePreviewCommandSchema>;
export type SemanticPipelinePreview = z.infer<typeof SemanticPipelinePreviewSchema>;

export const SemanticPipelineExecutionCommandSchema = z.object({
  schemaVersion: z.literal(ConfigurableSemanticPipelineSchemaVersion),
  configurationVersionId: StableIdSchema,
  semanticPipelineFingerprint: FingerprintSchema,
  idempotencyKey: StableIdSchema,
}).strict();

export const SemanticPipelineExecutionRecordSchema = z.object({
  schemaVersion: z.literal(ConfigurableSemanticPipelineSchemaVersion),
  executionId: StableIdSchema,
  humanVersion: z.string().min(1).max(80),
  fingerprint: FingerprintSchema,
  createdAt: z.string().datetime({ offset: true }),
  lifecycleStatus: z.enum([
    "stale",
    "semantic_ready",
    "decision_context_ready",
    "decision_context_unavailable",
  ]),
  actorId: StableIdSchema,
  idempotencyKey: StableIdSchema,
  configurationRef: RegisteredEntityRefSchema,
  semanticPipelineRef: z.object({
    previewId: StableIdSchema,
    fingerprint: FingerprintSchema,
  }).strict(),
  observations: z.array(MarketObservationArtifactSchema),
  assessments: z.array(AgentSemanticAssessmentSchema),
  decisionContext: DecisionSemanticContextSchema.optional(),
  issueCodes: z.array(z.string().min(1).max(160)),
  nextGate: z.enum([
    "configuration_refresh",
    "decision_context_snapshot",
    "historical_semantic_evaluation",
  ]),
  sourceMode: z.literal("server_registered"),
  decisionContextApplied: z.literal(false),
  runtimeApplied: z.literal(false),
  exchangeWriteAllowed: z.literal(false),
}).strict().superRefine((record, context) => {
  if (record.lifecycleStatus === "decision_context_ready" && !record.decisionContext) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "decision_context_required", path: ["decisionContext"] });
  }
  if (record.lifecycleStatus !== "decision_context_ready" && record.decisionContext) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "decision_context_status_invalid", path: ["decisionContext"] });
  }
});

export type SemanticPipelineExecutionCommand = z.infer<typeof SemanticPipelineExecutionCommandSchema>;
export type SemanticPipelineExecutionRecord = z.infer<typeof SemanticPipelineExecutionRecordSchema>;
