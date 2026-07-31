import { z } from "zod";
import { ArtifactFingerprintSchema } from "./semantic-agent-artifacts.js";

const StableIdSchema = z.string().min(3).max(240).regex(/^[a-z0-9][a-z0-9._:@-]*$/u, "stable_id_format");
const VersionRefSchema = z.object({ id: StableIdSchema, versionId: StableIdSchema, fingerprint: ArtifactFingerprintSchema }).strict();

export const ShadowReplayAuditAppendInputSchema = z.object({
  selectedTradeId: StableIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  actorId: StableIdSchema,
  idempotencyKey: StableIdSchema.max(160),
  materializationRef: VersionRefSchema,
  approvalRef: VersionRefSchema,
  candidateRef: z.object({ id: StableIdSchema, fingerprint: ArtifactFingerprintSchema }).strict(),
  approvedLessonRef: z.object({ id: StableIdSchema, version: z.string().min(1).max(80), fingerprint: ArtifactFingerprintSchema }).strict(),
  shadowProjectionRef: VersionRefSchema,
  decisionContextRef: z.object({ id: StableIdSchema, version: z.string().min(1).max(80), fingerprint: ArtifactFingerprintSchema }).strict(),
  historicalLineageFingerprints: z.array(ArtifactFingerprintSchema).min(1).max(100),
  lifecycleStatus: z.literal("validated"),
  readOnly: z.literal(true),
  decisionContextApplied: z.literal(false),
  strategyMutationCreated: z.literal(false),
  runtimeApplied: z.literal(false),
  exchangeWriteAllowed: z.literal(false),
}).strict();

export const ShadowReplayAuditRecordSchema = ShadowReplayAuditAppendInputSchema.extend({
  schemaVersion: z.literal("1.0.0"),
  id: StableIdSchema,
  versionIndex: z.number().int().positive(),
  humanVersion: z.string().regex(/^1\.0\.[0-9]+$/u),
  fingerprint: ArtifactFingerprintSchema,
}).strict();

export const ShadowReplayAuditHistoryRequestSchema = z.object({
  selectedTradeId: StableIdSchema,
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/u).optional(),
  limit: z.number().int().min(1).max(20).default(10),
}).strict();

export const ShadowReplayAuditHistoryResponseSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  selectedTradeId: StableIdSchema,
  lifecycleStatus: z.enum(["available", "empty"]),
  records: z.array(ShadowReplayAuditRecordSchema).max(20),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/u).optional(),
  readOnly: z.literal(true),
  decisionContextApplied: z.literal(false),
  runtimeApplied: z.literal(false),
  exchangeWriteAllowed: z.literal(false),
}).strict();

export type ShadowReplayAuditAppendInput = z.infer<typeof ShadowReplayAuditAppendInputSchema>;
export type ShadowReplayAuditRecord = z.infer<typeof ShadowReplayAuditRecordSchema>;
export type ShadowReplayAuditHistoryResponse = z.infer<typeof ShadowReplayAuditHistoryResponseSchema>;
