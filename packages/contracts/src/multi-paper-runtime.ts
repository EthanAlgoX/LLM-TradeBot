import { z } from "zod";

const Id = z.string().min(3).max(120).regex(/^[a-z0-9][a-z0-9._:-]*$/u);
const Timestamp = z.string().datetime({ offset: true });
const Fingerprint = z.string().min(12).max(256).regex(/^[a-zA-Z0-9:_@.-]+$/u);

export const PaperDeploymentLifecycleSchema = z.enum([
  "draft", "preflight_passed", "running", "stopping", "stopped", "failed", "close_only", "archived",
]);
export type PaperDeploymentLifecycle = z.infer<typeof PaperDeploymentLifecycleSchema>;

export const PaperDeploymentDefinitionSchema = z.object({
  deploymentId: Id,
  actorId: Id,
  name: z.string().min(1).max(80),
  strategyVersionId: Id,
  sourceFingerprint: Fingerprint,
  datasetFingerprint: Fingerprint,
  graphFingerprint: Fingerprint,
  executionFingerprint: Fingerprint,
  riskFingerprint: Fingerprint,
  accountId: Id,
  initialCapital: z.number().finite().positive().max(100_000_000),
  intervalMs: z.number().int().min(1_000).max(86_400_000),
  createdAt: Timestamp,
  runtimeApplied: z.literal(false),
  exchangeWriteAllowed: z.literal(false),
}).strict();
export type PaperDeploymentDefinition = z.infer<typeof PaperDeploymentDefinitionSchema>;

export const PaperDeploymentStateSchema = z.object({
  deploymentId: Id,
  lifecycle: PaperDeploymentLifecycleSchema,
  sourceFingerprint: Fingerprint,
  latestRunId: Id.optional(),
  latestCycle: z.number().int().nonnegative(),
  heartbeatAt: Timestamp.optional(),
  startedAt: Timestamp.optional(),
  stoppedAt: Timestamp.optional(),
  archivedAt: Timestamp.optional(),
  failureCount: z.number().int().nonnegative(),
  retryAt: Timestamp.optional(),
  health: z.enum(["healthy", "degraded", "failed", "stopped"]),
  runtimeApplied: z.literal(false),
  exchangeWriteAllowed: z.literal(false),
}).strict();
export type PaperDeploymentState = z.infer<typeof PaperDeploymentStateSchema>;

export const PaperDeploymentSchema = z.object({ definition: PaperDeploymentDefinitionSchema, state: PaperDeploymentStateSchema }).strict();
export type PaperDeployment = z.infer<typeof PaperDeploymentSchema>;

export const PaperDeploymentCreateRequestSchema = z.object({
  idempotencyKey: z.string().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/u),
  name: z.string().min(1).max(80),
  strategyVersionId: Id,
  initialCapital: z.number().finite().positive().max(100_000_000),
  intervalMs: z.number().int().min(1_000).max(86_400_000),
}).strict();
export type PaperDeploymentCreateRequest = z.infer<typeof PaperDeploymentCreateRequestSchema>;

export const PaperDeploymentActionRequestSchema = z.object({
  idempotencyKey: z.string().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/u),
  sourceFingerprint: Fingerprint.optional(),
}).strict();
export type PaperDeploymentActionRequest = z.infer<typeof PaperDeploymentActionRequestSchema>;

export const PaperDeploymentEventSchema = z.object({
  eventId: Id,
  deploymentId: Id,
  actorId: Id,
  kind: z.enum(["created", "preflight_passed", "started", "heartbeat", "failed", "stopping", "stopped", "archived", "close_only"]),
  state: PaperDeploymentStateSchema,
  requestFingerprint: Fingerprint.optional(),
  createdAt: Timestamp,
}).strict();
export type PaperDeploymentEvent = z.infer<typeof PaperDeploymentEventSchema>;

export const PaperRuntimeOverviewPointSchema = z.object({ at: Timestamp, equity: z.number().finite().nonnegative(), normalizedReturnPct: z.number().finite() }).strict();
export type PaperRuntimeOverviewPoint = z.infer<typeof PaperRuntimeOverviewPointSchema>;
