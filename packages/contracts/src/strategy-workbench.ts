import { z } from "zod";

const Id = z.string().min(3).max(240).regex(/^[a-z0-9][a-z0-9._:@-]*$/u);
const Fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const StrategyWorkbenchCommandSchema = z.object({
  schemaVersion: z.literal("1.0.0"), conversationId: Id, message: z.string().trim().min(2).max(2_000),
  locale: z.enum(["zh-CN", "en"]), idempotencyKey: Id,
}).strict();
export const StrategyIntentSchema = z.object({
  intentId: Id, conversationId: Id, turnId: Id, market: z.string().max(80).optional(),
  horizon: z.string().max(80).optional(), objective: z.string().max(240).optional(), riskPreference: z.string().max(80).optional(),
  known: z.array(z.string().max(160)).max(12), missingFields: z.array(z.enum(["market", "horizon", "objective", "riskPreference"])) .max(4),
  assumptions: z.array(z.string().max(240)).max(8), requiredCapabilities: z.array(z.string().max(120)).max(12), createdAt: z.string().datetime(),
}).strict();
export const StrategyRecommendationSchema = z.object({
  recommendationId: Id, fingerprint: Fingerprint, intentId: Id, conversationId: Id, createdAt: z.string().datetime(),
  status: z.literal("VALIDATED_RECOMMENDATION"), adapter: z.literal("DETERMINISTIC_STRUCTURED_ADAPTER"),
  catalogSnapshotFingerprint: Fingerprint, explanation: z.string().max(2_000), reasons: z.array(z.string().max(300)).max(12),
  assumptions: z.array(z.string().max(240)).max(8), gaps: z.array(z.string().max(240)).max(8),
  nodes: z.array(z.object({ nodeId: Id, label: z.string().max(120), category: z.string().max(40), systemOwned: z.boolean(), agentVersionId: Id.optional(), agentFingerprint: Fingerprint.optional(), dataRef: z.string().max(180).optional(), modelRef: z.string().max(180).optional() }).strict()).min(6).max(20),
  edges: z.array(z.object({ sourceNodeId: Id, targetNodeId: Id, artifactSchemaRef: z.string().max(180) }).strict()).min(5).max(32),
  runtimeApplied: z.literal(false), paperOnly: z.literal(true), exchangeWriteAllowed: z.literal(false),
}).strict();
export const StrategyDraftSchema = z.object({ draftId: Id, versionId: Id, fingerprint: Fingerprint, recommendationId: Id, intentId: Id, createdAt: z.string().datetime(), draftStatus: z.literal("NOT_VALIDATED"), runtimeApplied: z.literal(false), paperOnly: z.literal(true), exchangeWriteAllowed: z.literal(false) }).strict();
