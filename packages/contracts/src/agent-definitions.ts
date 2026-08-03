import { z } from "zod";

export const AgentCategorySchema = z.enum(["input", "analysis", "decision", "reflection"]);
export type AgentCategory = z.infer<typeof AgentCategorySchema>;

export const AgentVersionPayloadSchema = z.object({
  name: z.string().min(1).max(120),
  templateRef: z.string().min(1),
  dataRef: z.string().min(1).optional(),
  upstreamArtifactSchemaRefs: z.array(z.string().min(1)).max(8),
  modelRef: z.string().min(1).optional(),
  userInstructionPrompt: z.string().min(1).max(12_000),
  inputSchemaRef: z.string().min(1),
  budget: z.object({ maxTokens: z.number().int().positive().max(100_000), maxCalls: z.number().int().positive().max(100), timeoutMs: z.number().int().positive().max(120_000) }).strict(),
}).strict();
export type AgentVersionPayload = z.infer<typeof AgentVersionPayloadSchema>;

export const AgentVersionSchema = z.object({
  versionId: z.string().min(1), definitionId: z.string().min(1), versionIndex: z.number().int().positive(),
  parentVersionId: z.string().min(1).nullable(), fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  createdByActorId: z.string().min(1), createdAt: z.string().datetime(), category: AgentCategorySchema,
  payload: AgentVersionPayloadSchema,
  systemPolicyRef: z.string().min(1), outputSchemaRef: z.string().min(1), toolPermissionPolicyRef: z.string().min(1),
  runtimeApplied: z.literal(false), exchangeWriteAllowed: z.literal(false), paperOnly: z.literal(true),
}).strict();
export type AgentVersion = z.infer<typeof AgentVersionSchema>;

export const AgentDefinitionSchema = z.object({
  definitionId: z.string().min(1), category: AgentCategorySchema, createdByActorId: z.string().min(1), createdAt: z.string().datetime(),
  sourceLineage: z.object({ definitionId: z.string().min(1), versionId: z.string().min(1), fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict().optional(),
}).strict();
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

export const AgentLifecycleStatusSchema = z.enum(["draft", "validated", "published", "archived"]);
export type AgentLifecycleStatus = z.infer<typeof AgentLifecycleStatusSchema>;

export const AgentTestEvidenceSchema = z.object({
  testRunId: z.string().min(1), agentVersionId: z.string().min(1), fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/), fixtureRef: z.string().min(1),
  adapter: z.literal("DETERMINISTIC_TEST_ADAPTER"), status: z.enum(["succeeded", "failed"]), inputSummary: z.string().max(1_000), outputSummary: z.string().max(1_000),
  schemaValid: z.boolean(), durationMs: z.number().int().nonnegative(), usage: z.object({ calls: z.number().int().nonnegative(), tokens: z.number().int().nonnegative() }).strict(),
  errorCode: z.string().min(1).optional(), createdByActorId: z.string().min(1), createdAt: z.string().datetime(), runtimeApplied: z.literal(false), exchangeWriteAllowed: z.literal(false), paperOnly: z.literal(true),
}).strict();
export type AgentTestEvidence = z.infer<typeof AgentTestEvidenceSchema>;
