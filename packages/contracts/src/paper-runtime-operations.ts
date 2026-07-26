import { z } from "zod";

const RuntimeSchemaVersion = z.literal("1.0.0");
const IsoDateTime = z.string().datetime();
const MachineFields = z.record(z.string());

export const PaperRuntimePreflightRequestSchema = z
  .object({
    schemaVersion: RuntimeSchemaVersion,
    idempotencyKey: z.string().min(1).max(200),
    confirmation: z.literal("run_paper_runtime_preflight"),
  })
  .strict();
export type PaperRuntimePreflightRequest = z.infer<
  typeof PaperRuntimePreflightRequestSchema
>;

export const PaperRuntimePreflightCheckSchema = z
  .object({
    checkId: z.string().min(1),
    component: z.enum([
      "approved_plan",
      "activation",
      "evidence",
      "binding",
      "paper_database",
      "safety_database",
      "trace_database",
      "artifact_database",
      "reflection_database",
      "market_ticker",
      "market_bars",
    ]),
    status: z.enum(["passed", "failed"]),
    code: z.string().min(1),
    checkedAt: IsoDateTime,
    latencyMs: z.number().int().nonnegative(),
    fields: MachineFields.default({}),
  })
  .strict();
export type PaperRuntimePreflightCheck = z.infer<
  typeof PaperRuntimePreflightCheckSchema
>;

export const PaperRuntimePreflightReportSchema = z
  .object({
    schemaVersion: RuntimeSchemaVersion,
    reportId: z.string().min(1),
    fingerprint: z.string().min(1),
    planId: z.string().min(1),
    planFingerprint: z.string().min(1),
    activationId: z.string().min(1),
    bindingId: z.string().min(1),
    bindingFingerprint: z.string().min(1),
    status: z.enum(["passed", "failed"]),
    checks: z.array(PaperRuntimePreflightCheckSchema).min(1),
    requestedByActorId: z.string().min(1),
    createdAt: IsoDateTime,
    expiresAt: IsoDateTime,
    paperAccountMutationAllowed: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();
export type PaperRuntimePreflightReport = z.infer<
  typeof PaperRuntimePreflightReportSchema
>;

export const PaperRuntimeLeaseStatusSchema = z.enum([
  "active",
  "released",
  "lost",
  "orphaned",
]);
export type PaperRuntimeLeaseStatus = z.infer<
  typeof PaperRuntimeLeaseStatusSchema
>;

export const PaperRuntimeLeaseSchema = z
  .object({
    schemaVersion: RuntimeSchemaVersion,
    runId: z.string().min(1),
    planId: z.string().min(1),
    ownerId: z.string().min(1),
    fencingToken: z.number().int().positive(),
    status: PaperRuntimeLeaseStatusSchema,
    acquiredAt: IsoDateTime,
    heartbeatAt: IsoDateTime,
    expiresAt: IsoDateTime,
    releasedAt: IsoDateTime.optional(),
  })
  .strict();
export type PaperRuntimeLease = z.infer<typeof PaperRuntimeLeaseSchema>;

export const PaperRuntimeStopRequestSchema = z
  .object({
    schemaVersion: RuntimeSchemaVersion,
    idempotencyKey: z.string().min(1).max(200),
    confirmation: z.literal("stop_after_current_paper_cycle"),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type PaperRuntimeStopRequest = z.infer<
  typeof PaperRuntimeStopRequestSchema
>;

export const PaperRuntimeStopRecordSchema = z
  .object({
    schemaVersion: RuntimeSchemaVersion,
    stopId: z.string().min(1),
    runId: z.string().min(1),
    planId: z.string().min(1),
    actorId: z.string().min(1),
    actorDisplayName: z.string().min(1),
    reason: z.string().min(1),
    requestedAt: IsoDateTime,
    status: z.enum(["requested", "drained"]),
    drainedAt: IsoDateTime.optional(),
    currentCycleMayComplete: z.literal(true),
    futureCyclesAllowed: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();
export type PaperRuntimeStopRecord = z.infer<
  typeof PaperRuntimeStopRecordSchema
>;
