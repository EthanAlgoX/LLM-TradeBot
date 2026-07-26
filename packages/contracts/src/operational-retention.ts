import { z } from "zod";

const StableIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/);
const FingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const OperationalDispatcherScheduleSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    scheduleId: StableIdSchema,
    humanVersion: z.string().min(1).max(64),
    fingerprint: FingerprintSchema,
    lifecycleStatus: z.enum(["enabled", "disabled"]),
    intervalMs: z.number().int().min(1_000).max(3_600_000),
    batchLimit: z.number().int().min(1).max(100),
    createdAt: IsoDateTimeSchema,
    overlapAllowed: z.literal(false),
    clientMutable: z.literal(false),
    externalNetworkAllowed: z.literal(false),
  })
  .strict();

export const OperationalOutboxWorkerStateSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    workerId: StableIdSchema,
    scheduleId: StableIdSchema,
    enabled: z.boolean(),
    running: z.boolean(),
    tickInProgress: z.boolean(),
    ownerId: StableIdSchema,
    lastStartedAt: IsoDateTimeSchema.nullable(),
    lastCompletedAt: IsoDateTimeSchema.nullable(),
    lastErrorCode: StableIdSchema.nullable(),
    nextRunAt: IsoDateTimeSchema.nullable(),
    totalTicks: z.number().int().nonnegative(),
    totalProcessed: z.number().int().nonnegative(),
    overlapAllowed: z.literal(false),
    externalNetworkAllowed: z.literal(false),
  })
  .strict();

export const OperationalRetentionPolicySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyId: StableIdSchema,
    humanVersion: z.string().min(1).max(64),
    fingerprint: FingerprintSchema,
    lifecycleStatus: z.enum(["enabled", "disabled"]),
    retentionDays: z.number().int().min(1).max(3_650),
    candidateLimit: z.number().int().min(1).max(1_000),
    createdAt: IsoDateTimeSchema,
    cleanupAllowed: z.boolean(),
    serverRegistered: z.literal(true),
    clientMutable: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.lifecycleStatus === "disabled" && value.cleanupAllowed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cleanupAllowed"],
        message: "Disabled retention policy cannot allow cleanup",
      });
    }
  });

export const OperationalRetentionProtectedReasonSchema = z.enum([
  "too_new",
  "no_registered_template",
  "missing_delivery",
  "non_terminal_attempt",
  "open_delivery_failure",
  "open_runtime_incident",
  "orphaned_run",
]);

export const OperationalRetentionPreviewRequestSchema = z
  .object({
    confirmation: z.literal("CREATE_RETENTION_DRY_RUN"),
    idempotencyKey: StableIdSchema,
  })
  .strict();

export const OperationalRetentionPreviewSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    previewId: StableIdSchema,
    policyId: StableIdSchema,
    policyFingerprint: FingerprintSchema,
    cutoffAt: IsoDateTimeSchema,
    candidateFingerprint: FingerprintSchema,
    eligibleEventIds: z.array(StableIdSchema).max(1_000),
    eligibleAttemptIds: z.array(StableIdSchema).max(20_000),
    eligibleEventCount: z.number().int().nonnegative(),
    eligibleAttemptCount: z.number().int().nonnegative(),
    protectedReasonCounts: z.record(
      OperationalRetentionProtectedReasonSchema,
      z.number().int().nonnegative(),
    ),
    truncated: z.boolean(),
    createdAt: IsoDateTimeSchema,
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();

export const OperationalAuditExportManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    manifestId: StableIdSchema,
    previewId: StableIdSchema,
    policyId: StableIdSchema,
    policyFingerprint: FingerprintSchema,
    candidateFingerprint: FingerprintSchema,
    manifestFingerprint: FingerprintSchema,
    cutoffAt: IsoDateTimeSchema,
    eventCount: z.number().int().nonnegative(),
    attemptCount: z.number().int().nonnegative(),
    firstSequence: z.number().int().positive().nullable(),
    lastSequence: z.number().int().positive().nullable(),
    lifecycleStatus: z.literal("sealed"),
    createdAt: IsoDateTimeSchema,
    payloadIncluded: z.literal(false),
    externalNetworkAllowed: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();

export const OperationalRetentionExecutionRequestSchema = z
  .object({
    confirmation: z.literal("EXECUTE_CONFIRMED_RETENTION"),
    manifestId: StableIdSchema,
    manifestFingerprint: FingerprintSchema,
    idempotencyKey: StableIdSchema,
    reason: z.string().min(3).max(500),
  })
  .strict();

export const OperationalRetentionExecutionRecordSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    executionId: StableIdSchema,
    manifestId: StableIdSchema,
    manifestFingerprint: FingerprintSchema,
    policyId: StableIdSchema,
    actorId: StableIdSchema,
    idempotencyKey: StableIdSchema,
    deletedEventCount: z.number().int().nonnegative(),
    deletedAttemptCount: z.number().int().nonnegative(),
    firstSequence: z.number().int().positive().nullable(),
    lastSequence: z.number().int().positive().nullable(),
    executedAt: IsoDateTimeSchema,
    candidateSetRevalidated: z.literal(true),
    payloadRecorded: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();

export type OperationalDispatcherSchedule = z.infer<
  typeof OperationalDispatcherScheduleSchema
>;
export type OperationalOutboxWorkerState = z.infer<
  typeof OperationalOutboxWorkerStateSchema
>;
export type OperationalRetentionPolicy = z.infer<
  typeof OperationalRetentionPolicySchema
>;
export type OperationalRetentionPreviewRequest = z.infer<
  typeof OperationalRetentionPreviewRequestSchema
>;
export type OperationalRetentionPreview = z.infer<
  typeof OperationalRetentionPreviewSchema
>;
export type OperationalAuditExportManifest = z.infer<
  typeof OperationalAuditExportManifestSchema
>;
export type OperationalRetentionExecutionRequest = z.infer<
  typeof OperationalRetentionExecutionRequestSchema
>;
export type OperationalRetentionExecutionRecord = z.infer<
  typeof OperationalRetentionExecutionRecordSchema
>;
