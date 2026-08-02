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
}).strict();
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
