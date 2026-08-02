import { z } from "zod";
import { ArtifactFingerprintSchema, SemanticArtifactSchemaVersion, VersionedEntityReferenceSchema } from "./semantic-agent-artifacts.js";

const Id = z.string().min(3).max(240).regex(/^[a-z0-9][a-z0-9._:@-]*$/u);
const Timestamp = z.string().datetime({ offset: true });
export const ExperimentObjectiveSchema = z.object({ kind: z.literal("maximize_total_return") }).strict();
export const ExperimentConstraintsSchema = z.object({ maxDrawdownPctLte: z.number().min(0).max(100).optional(), minimumTradeCount: z.number().int().min(0).max(1_000_000).optional(), walkForwardPositive: z.boolean().optional(), runtimeFailureCountEqZero: z.boolean().optional() }).strict();
export const ExperimentCreateRequestSchema = z.object({
  schemaVersion: z.literal(SemanticArtifactSchemaVersion), idempotencyKey: z.string().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/u),
  participantVersionIds: z.array(Id).min(2).max(5), datasetId: Id, startAt: Timestamp, endAt: Timestamp, walkForwardPlanId: Id,
  comparisonMode: z.enum(["STRATEGY_COMPARISON", "MODEL_COMPARISON", "AGENT_GRAPH_COMPARISON", "OPEN_CLASS"]), objective: ExperimentObjectiveSchema, constraints: ExperimentConstraintsSchema,
}).strict().superRefine((v, c) => { if (new Set(v.participantVersionIds).size !== v.participantVersionIds.length) c.addIssue({ code: z.ZodIssueCode.custom, message: "participant_duplicate", path: ["participantVersionIds"] }); if (Date.parse(v.startAt) > Date.parse(v.endAt)) c.addIssue({ code: z.ZodIssueCode.custom, message: "range_invalid", path: ["endAt"] }); });
export const ExperimentSchema = z.object({
  schemaVersion: z.literal(SemanticArtifactSchemaVersion), experimentId: Id, fingerprint: ArtifactFingerprintSchema, createdAt: Timestamp, actorId: Id,
  lifecycleStatus: z.enum(["draft", "backtest_partial", "backtest_complete", "walk_forward_partial", "evidence_complete", "candidate_ready", "insufficient", "stale", "failed"]),
  comparability: z.object({ status: z.enum(["CONTROLLED", "OPEN_CLASS", "INCOMPATIBLE"]), requestedMode: z.string(), issueCodes: z.array(z.string()) }).strict(),
  lock: z.object({ datasetRef: VersionedEntityReferenceSchema, startAt: Timestamp, endAt: Timestamp, walkForwardPlanRef: VersionedEntityReferenceSchema, runtimeApplied: z.literal(false), exchangeWriteAllowed: z.literal(false) }).strict(),
  participants: z.array(z.object({ participantId: Id, label: z.string().min(1).max(120), strategyVersionId: Id, strategyFingerprint: ArtifactFingerprintSchema, executableFingerprint: ArtifactFingerprintSchema, profileRef: VersionedEntityReferenceSchema, candidateSetRef: VersionedEntityReferenceSchema, sourceRefs: z.array(VersionedEntityReferenceSchema), backtestJobId: Id.optional(), walkForwardJobId: Id.optional(), backtestEvidence: z.unknown().optional(), walkForwardEvidence: z.unknown().optional(), issueCodes: z.array(z.string()) }).strict()).min(2).max(5),
  candidate: z.object({ candidateId: Id, status: z.literal("candidate_for_validation"), fingerprint: ArtifactFingerprintSchema, runtimeApplied: z.literal(false) }).strict().optional(),
}).strict();
export type ExperimentCreateRequest = z.infer<typeof ExperimentCreateRequestSchema>;
export type Experiment = z.infer<typeof ExperimentSchema>;
