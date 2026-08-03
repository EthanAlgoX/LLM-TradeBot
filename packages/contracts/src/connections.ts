import { z } from "zod";

export const ConnectionKindSchema = z.enum(["data_source", "model_adapter"]);
export type ConnectionKind = z.infer<typeof ConnectionKindSchema>;
export const ConnectionHealthSchema = z.enum(["healthy", "unavailable", "not_configured"]);
export type ConnectionHealth = z.infer<typeof ConnectionHealthSchema>;

/** Display-safe connection facts. Secrets are deliberately represented only as state. */
export const ConnectionVersionSchema = z.object({
  versionId: z.string().min(1), definitionId: z.string().min(1), versionIndex: z.number().int().positive(),
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/), createdByActorId: z.string().min(1), createdAt: z.string().datetime(),
  kind: ConnectionKindSchema, registeredRef: z.string().min(1), name: z.string().min(1).max(120),
  capabilityRefs: z.array(z.string().min(1)).max(32), health: ConnectionHealthSchema,
  secretReferenceStatus: z.enum(["not_required", "configured", "unavailable"]),
  impact: z.object({ agentDefinitionCount: z.number().int().nonnegative(), strategyReferenceCount: z.number().int().nonnegative() }).strict(),
  runtimeApplied: z.literal(false), exchangeWriteAllowed: z.literal(false), paperOnly: z.literal(true),
}).strict();
export type ConnectionVersion = z.infer<typeof ConnectionVersionSchema>;
export const ConnectionDefinitionSchema = z.object({ definitionId: z.string().min(1), kind: ConnectionKindSchema, createdByActorId: z.string().min(1), createdAt: z.string().datetime() }).strict();
export type ConnectionDefinition = z.infer<typeof ConnectionDefinitionSchema>;
