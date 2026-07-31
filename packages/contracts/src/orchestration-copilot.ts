import { z } from "zod";
import { OrchestrationIntentObservationWindowSchema } from "./orchestration-intent.js";

const ConversationStableIdSchema = z
  .string()
  .min(3)
  .max(240)
  .regex(/^[a-z0-9][a-z0-9._:@-]*$/u, "stable_id_format");
const FingerprintSchema = z
  .string()
  .min(8)
  .max(256)
  .regex(/^(?:fnv1a32|sha256):/u, "fingerprint_format");
const HumanVersionSchema = z.string().min(1).max(80);
const CreatedAtSchema = z.string().datetime({ offset: true });

export const ConversationDraftReferenceSchema = z
  .object({
    draftId: ConversationStableIdSchema,
    versionId: ConversationStableIdSchema,
    fingerprint: FingerprintSchema,
  })
  .strict();

export const ConversationCommandSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    message: z.string().trim().min(2).max(2_000),
    locale: z.enum(["zh-CN", "en"]),
    conversationId: ConversationStableIdSchema,
    idempotencyKey: ConversationStableIdSchema,
    draftReference: ConversationDraftReferenceSchema.optional(),
  })
  .strict();

export const ConversationContextSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    contextId: ConversationStableIdSchema,
    conversationId: ConversationStableIdSchema,
    humanVersion: HumanVersionSchema,
    fingerprint: FingerprintSchema,
    createdAt: CreatedAtSchema,
    lifecycleStatus: z.literal("active"),
    actor: z
      .object({
        actorId: ConversationStableIdSchema,
        roles: z.array(z.enum(["operator", "approver"])).min(1),
      })
      .strict(),
    registry: z
      .object({
        marketPackIds: z.array(ConversationStableIdSchema),
        dataSourceIds: z.array(ConversationStableIdSchema),
        agentTemplateIds: z.array(ConversationStableIdSchema),
        presetIds: z.array(ConversationStableIdSchema),
        toolIds: z.array(ConversationStableIdSchema),
      })
      .strict(),
    selected: z
      .object({
        marketPackId: ConversationStableIdSchema.optional(),
        dataSourceIds: z.array(ConversationStableIdSchema),
        presetId: ConversationStableIdSchema.optional(),
        agentTemplateId: ConversationStableIdSchema.optional(),
        draftReference: ConversationDraftReferenceSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const RegisteredCopilotToolNameSchema = z.enum([
  "list_market_packs",
  "list_data_sources",
  "inspect_data_source_capability",
  "list_pipeline_presets",
  "list_agent_templates",
  "inspect_agent_template",
  "create_configuration_draft",
  "update_configuration_draft",
  "create_pipeline_draft",
  "validate_configuration_draft",
  "validate_pipeline_draft",
  "inspect_evidence_gates",
  "request_backtest",
  "request_walk_forward",
  "submit_for_human_approval",
]);

export const RegisteredToolCallSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    toolCallId: ConversationStableIdSchema,
    toolName: RegisteredCopilotToolNameSchema,
    humanVersion: HumanVersionSchema,
    fingerprint: FingerprintSchema,
    createdAt: CreatedAtSchema,
    lifecycleStatus: z.literal("requested"),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();

export const RegisteredToolResultSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    toolResultId: ConversationStableIdSchema,
    toolCallId: ConversationStableIdSchema,
    toolName: RegisteredCopilotToolNameSchema,
    humanVersion: HumanVersionSchema,
    fingerprint: FingerprintSchema,
    createdAt: CreatedAtSchema,
    lifecycleStatus: z.enum(["succeeded", "rejected", "unavailable"]),
    output: z.record(z.string(), z.unknown()),
  })
  .strict();

export const DraftChangeSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    changeId: ConversationStableIdSchema,
    operation: z.enum(["add", "replace", "remove"]),
    scope: z.enum(["market", "source", "agent", "graph", "schema"]),
    entityId: ConversationStableIdSchema,
    path: z.array(z.union([z.string(), z.number()])).min(1),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
  })
  .strict();

const VersionedReferenceSchema = z
  .object({
    id: ConversationStableIdSchema,
    humanVersion: HumanVersionSchema,
    fingerprint: FingerprintSchema,
  })
  .strict();

export const AgentOrchestrationClassSchema = z.enum([
  "input_agent",
  "analysis_agent",
  "decision_reflection_agent",
]);

export const AgentConfigurationKindSchema = z.enum([
  "input_source",
  "prompt_strategy",
  "controlled_policy",
]);

const CategorizedAgentReferenceSchema = VersionedReferenceSchema.extend({
  orchestrationClass: AgentOrchestrationClassSchema,
  configurationKind: AgentConfigurationKindSchema,
}).strict();

export const AgentOrchestrationGroupsSchema = z
  .object({
    inputAgents: z.array(CategorizedAgentReferenceSchema),
    analysisAgents: z.array(CategorizedAgentReferenceSchema),
    decisionReflectionAgents: z.array(CategorizedAgentReferenceSchema),
  })
  .strict();

export const DraftProposalSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    proposalId: ConversationStableIdSchema,
    draftId: ConversationStableIdSchema,
    versionId: ConversationStableIdSchema,
    humanVersion: HumanVersionSchema,
    fingerprint: FingerprintSchema,
    parentFingerprint: FingerprintSchema.optional(),
    createdAt: CreatedAtSchema,
    lifecycleStatus: z.enum(["draft", "validated", "approved_not_applied"]),
    evidenceStatus: z.enum(["none", "current", "stale"]),
    marketRef: VersionedReferenceSchema,
    sourceRefs: z.array(VersionedReferenceSchema),
    presetRef: VersionedReferenceSchema,
    agentRefs: z.array(VersionedReferenceSchema).min(1),
    agentGroups: AgentOrchestrationGroupsSchema,
    graphRef: VersionedReferenceSchema,
    schemaRefs: z.array(z.string().min(1)).min(1),
    changes: z.array(DraftChangeSchema),
    runtimeApplied: z.literal(false),
  })
  .strict();

export const ValidationSummarySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    validationId: ConversationStableIdSchema,
    humanVersion: HumanVersionSchema,
    fingerprint: FingerprintSchema,
    createdAt: CreatedAtSchema,
    lifecycleStatus: z.enum(["passed", "failed", "not_run"]),
    valid: z.boolean(),
    checkedFingerprint: FingerprintSchema.optional(),
    issues: z.array(
      z
        .object({
          issueId: ConversationStableIdSchema,
          code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
          severity: z.enum(["error", "warning"]),
          path: z.array(z.union([z.string(), z.number()])),
          details: z.record(z.string(), z.unknown()),
        })
        .strict(),
    ),
    capabilities: z.array(
      z
        .object({
          capabilityId: ConversationStableIdSchema,
          dataSourceId: ConversationStableIdSchema,
          nativeObservationWindows: z.array(
            OrchestrationIntentObservationWindowSchema,
          ),
          requestedObservationWindows: z.array(
            OrchestrationIntentObservationWindowSchema,
          ),
          lineage: z.array(
            z
              .object({
                sourceWindow: OrchestrationIntentObservationWindowSchema,
                targetWindow: OrchestrationIntentObservationWindowSchema,
                transformerVersion: z.string().min(1),
                timezone: z.string().min(1),
                tradingCalendar: z.string().min(1),
                asOfPolicy: z.literal("closed_windows_only"),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export const EvidenceGateSummarySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    summaryId: ConversationStableIdSchema,
    humanVersion: HumanVersionSchema,
    fingerprint: FingerprintSchema,
    createdAt: CreatedAtSchema,
    lifecycleStatus: z.enum(["required", "in_progress", "ready", "blocked"]),
    gates: z
      .array(
        z
          .object({
            gate: z.enum([
              "contract_validation",
              "backtest",
              "walk_forward",
              "human_approval",
              "paper_running",
            ]),
            status: z.enum([
              "passed",
              "required",
              "blocked",
              "running",
              "ready",
              "not_applied",
            ]),
            evidenceRef: z.string().min(1).optional(),
          })
          .strict(),
      )
      .length(5),
    nextGate: z
      .enum([
        "contract_validation",
        "backtest",
        "walk_forward",
        "human_approval",
        "paper_running",
      ])
      .optional(),
  })
  .strict();

export const ConversationAssistantResponseSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    responseId: ConversationStableIdSchema,
    conversationId: ConversationStableIdSchema,
    idempotencyKey: ConversationStableIdSchema,
    humanVersion: HumanVersionSchema,
    fingerprint: FingerprintSchema,
    createdAt: CreatedAtSchema,
    lifecycleStatus: z.literal("completed"),
    status: z.enum([
      "proposal",
      "validation_failed",
      "evidence_required",
      "approval_ready",
      "unavailable",
    ]),
    assistantMessage: z.string().min(1).max(4_000),
    context: ConversationContextSchema,
    toolCalls: z.array(RegisteredToolCallSchema),
    toolResults: z.array(RegisteredToolResultSchema),
    proposal: DraftProposalSchema.optional(),
    validation: ValidationSummarySchema,
    evidenceGates: EvidenceGateSummarySchema,
    runtimeApplied: z.literal(false),
  })
  .strict();

export const OrchestrationCopilotErrorCodeSchema = z.enum([
  "INVALID_CONVERSATION_COMMAND",
  "COPILOT_SENSITIVE_CONTENT_REJECTED",
  "COPILOT_TOOL_NOT_REGISTERED",
  "COPILOT_DRAFT_REFERENCE_REQUIRED",
  "COPILOT_DRAFT_NOT_FOUND",
  "COPILOT_IDEMPOTENCY_CONFLICT",
  "COPILOT_PARENT_FINGERPRINT_CONFLICT",
  "COPILOT_AGENT_FIELD_NOT_ALLOWED",
]);

// Compatibility aliases for existing imports while the endpoint adopts the
// conversation-first names.
export const OrchestrationCopilotMessageRequestSchema =
  ConversationCommandSchema;
export const OrchestrationCopilotResponseSchema =
  ConversationAssistantResponseSchema;

export type ConversationCommand = z.infer<typeof ConversationCommandSchema>;
export type ConversationContext = z.infer<typeof ConversationContextSchema>;
export type RegisteredCopilotToolName = z.infer<
  typeof RegisteredCopilotToolNameSchema
>;
export type RegisteredToolCall = z.infer<typeof RegisteredToolCallSchema>;
export type RegisteredToolResult = z.infer<typeof RegisteredToolResultSchema>;
export type DraftChange = z.infer<typeof DraftChangeSchema>;
export type AgentOrchestrationClass = z.infer<
  typeof AgentOrchestrationClassSchema
>;
export type AgentConfigurationKind = z.infer<
  typeof AgentConfigurationKindSchema
>;
export type AgentOrchestrationGroups = z.infer<
  typeof AgentOrchestrationGroupsSchema
>;
export type DraftProposal = z.infer<typeof DraftProposalSchema>;
export type ValidationSummary = z.infer<typeof ValidationSummarySchema>;
export type EvidenceGateSummary = z.infer<typeof EvidenceGateSummarySchema>;
export type ConversationAssistantResponse = z.infer<
  typeof ConversationAssistantResponseSchema
>;
export type OrchestrationCopilotMessageRequest = ConversationCommand;
export type OrchestrationCopilotResponse = ConversationAssistantResponse;
export type OrchestrationCopilotErrorCode = z.infer<
  typeof OrchestrationCopilotErrorCodeSchema
>;
