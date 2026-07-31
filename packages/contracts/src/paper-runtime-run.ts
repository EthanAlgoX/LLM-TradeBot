import { z } from "zod";
import { RuntimeControlModeSchema } from "./approved-paper-plan.js";

export const PaperRuntimeCadenceSchema = z.enum([
  "1m",
  "5m",
  "10m",
  "15m",
  "30m",
  "1h",
  "3h",
  "5h",
]);
export type PaperRuntimeCadence = z.infer<
  typeof PaperRuntimeCadenceSchema
>;

export const PaperRuntimeRunRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    idempotencyKey: z.string().min(8).max(200),
    confirmation: z.literal("start_bounded_paper_run"),
    locale: z.enum(["zh-CN", "en"]).optional(),
    cadence: PaperRuntimeCadenceSchema.optional(),
  })
  .strict();
export type PaperRuntimeRunRequest = z.infer<
  typeof PaperRuntimeRunRequestSchema
>;

export const PaperRuntimeRunStatusSchema = z.enum([
  "queued",
  "running",
  "stop_requested",
  "drained",
  "orphaned",
  "completed",
  "failed",
  "safety_blocked",
]);
export type PaperRuntimeRunStatus = z.infer<
  typeof PaperRuntimeRunStatusSchema
>;

export const PaperRuntimeSafetySnapshotSchema = z
  .object({
    consecutiveFailures: z.number().int().nonnegative(),
    cooldownUntil: z.string().datetime().optional(),
    lastFailure: z.string().optional(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type PaperRuntimeSafetySnapshot = z.infer<
  typeof PaperRuntimeSafetySnapshotSchema
>;

export const PaperRuntimeAccountSnapshotSchema = z
  .object({
    cash: z.number(),
    usedMargin: z.number().nonnegative(),
    equity: z.number(),
    realizedPnl: z.number(),
    unrealizedPnl: z.number(),
    fees: z.number().nonnegative(),
  })
  .strict();
export type PaperRuntimeAccountSnapshot = z.infer<
  typeof PaperRuntimeAccountSnapshotSchema
>;

export const PaperRuntimeCycleAuditSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    runId: z.string().min(1),
    cycle: z.number().int().positive(),
    traceId: z.string().min(1),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    status: z.enum([
      "ok",
      "partial",
      "blocked",
      "failed",
      "safety_blocked",
    ]),
    controlMode: RuntimeControlModeSchema,
    controlAuditId: z.string().min(1).optional(),
    controlApplied: z.boolean(),
    decisionCount: z.number().int().nonnegative(),
    riskDecisionCount: z.number().int().nonnegative(),
    executionCount: z.number().int().nonnegative(),
    accountSnapshot: PaperRuntimeAccountSnapshotSchema.optional(),
    safety: PaperRuntimeSafetySnapshotSchema,
    errorCode: z.string().min(1).optional(),
  })
  .strict();
export type PaperRuntimeCycleAudit = z.infer<
  typeof PaperRuntimeCycleAuditSchema
>;

export const PaperRuntimeRunSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    runId: z.string().min(1),
    planId: z.string().min(1),
    planFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    activationId: z.string().min(1),
    bindingId: z.string().min(1),
    paperAccountRef: z.string().min(1),
    strategyProfileRef: z.string().min(1),
    candidateSymbols: z.array(z.string().min(1)).min(1),
    requestedByActorId: z.string().min(1),
    responseLocale: z.enum(["zh-CN", "en"]).optional(),
    initialCash: z.number().positive().optional(),
    cadence: PaperRuntimeCadenceSchema.optional(),
    continuous: z.boolean().optional(),
    status: PaperRuntimeRunStatusSchema,
    plannedCycles: z.number().int().positive().max(100),
    processedCycles: z.number().int().nonnegative(),
    intervalMs: z.number().int().nonnegative().max(86_400_000),
    lastControlMode: RuntimeControlModeSchema,
    lastControlApplied: z.boolean(),
    lastSafetyState: PaperRuntimeSafetySnapshotSchema.optional(),
    preflightReportId: z.string().min(1).optional(),
    leaseOwnerId: z.string().min(1).optional(),
    leaseFencingToken: z.number().int().positive().optional(),
    heartbeatAt: z.string().datetime().optional(),
    stopId: z.string().min(1).optional(),
    failureCode: z.string().min(1).optional(),
    requestedAt: z.string().datetime(),
    startedAt: z.string().datetime().optional(),
    finishedAt: z.string().datetime().optional(),
    paperRuntimeApplied: z.boolean(),
    exchangeWriteAllowed: z.literal(false),
    clientRuntimeParametersAccepted: z.literal(false),
  })
  .strict();
export type PaperRuntimeRun = z.infer<typeof PaperRuntimeRunSchema>;
