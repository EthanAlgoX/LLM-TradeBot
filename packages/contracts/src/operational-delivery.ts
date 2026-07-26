import { z } from "zod";

const StableIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/);

const FingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const OperationalDeliverySinkKindSchema = z.enum([
  "local_jsonl_audit",
  "in_memory_test",
]);

export const OperationalDeliveryTemplateSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    templateId: StableIdSchema,
    humanVersion: z.string().min(1).max(64),
    fingerprint: FingerprintSchema,
    lifecycleStatus: z.enum(["active", "disabled"]),
    sinkKind: OperationalDeliverySinkKindSchema,
    maxAttempts: z.number().int().min(1).max(20),
    initialBackoffMs: z.number().int().min(100).max(86_400_000),
    maxBackoffMs: z.number().int().min(100).max(604_800_000),
    createdAt: IsoDateTimeSchema,
    deliveryConfigured: z.literal(true),
    externalNetworkAllowed: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.maxBackoffMs < value.initialBackoffMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxBackoffMs"],
        message: "maxBackoffMs must be greater than or equal to initialBackoffMs",
      });
    }
  });

export const OperationalDeliveryAttemptStatusSchema = z.enum([
  "queued",
  "delivering",
  "delivered",
  "retry_wait",
  "dead_letter",
]);

export const OperationalDeliveryAttemptSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    attemptId: StableIdSchema,
    eventId: StableIdSchema,
    runId: StableIdSchema,
    eventSequence: z.number().int().positive(),
    eventFingerprint: FingerprintSchema,
    templateId: StableIdSchema,
    templateFingerprint: FingerprintSchema,
    status: OperationalDeliveryAttemptStatusSchema,
    attemptCount: z.number().int().nonnegative().max(20),
    nextAttemptAt: IsoDateTimeSchema.nullable(),
    lastAttemptAt: IsoDateTimeSchema.nullable(),
    deliveredAt: IsoDateTimeSchema.nullable(),
    deadLetteredAt: IsoDateTimeSchema.nullable(),
    errorCode: StableIdSchema.nullable(),
    leaseOwnerId: StableIdSchema.nullable(),
    fencingToken: z.number().int().positive().nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    externalNetworkAllowed: z.literal(false),
  })
  .strict();

export const OperationalDeadLetterSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    deadLetterId: StableIdSchema,
    attemptId: StableIdSchema,
    eventId: StableIdSchema,
    runId: StableIdSchema,
    templateId: StableIdSchema,
    eventFingerprint: FingerprintSchema,
    reasonCode: StableIdSchema,
    incidentType: z.literal("delivery_failure"),
    incidentStatus: z.enum(["open", "acknowledged", "replayed"]),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    replayedAt: IsoDateTimeSchema.nullable(),
  })
  .strict();

export const OperationalDispatcherStateSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    dispatcherId: StableIdSchema,
    ownerId: StableIdSchema.nullable(),
    fencingToken: z.number().int().nonnegative(),
    leaseExpiresAt: IsoDateTimeSchema.nullable(),
    registeredTemplateIds: z.array(StableIdSchema).max(32),
    externalDeliveryConfigured: z.literal(false),
    networkRequestCount: z.literal(0),
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const OperationalDeadLetterReplayRequestSchema = z
  .object({
    confirmation: z.literal("REPLAY_REGISTERED_DELIVERY"),
    idempotencyKey: StableIdSchema,
    reason: z.string().min(3).max(500),
  })
  .strict();

export const OperationalDispatchRequestSchema = z
  .object({
    confirmation: z.literal("DISPATCH_REGISTERED_OUTBOX"),
    idempotencyKey: StableIdSchema,
  })
  .strict();

export type OperationalDeliveryTemplate = z.infer<
  typeof OperationalDeliveryTemplateSchema
>;
export type OperationalDeliveryAttempt = z.infer<
  typeof OperationalDeliveryAttemptSchema
>;
export type OperationalDeadLetter = z.infer<typeof OperationalDeadLetterSchema>;
export type OperationalDispatcherState = z.infer<
  typeof OperationalDispatcherStateSchema
>;
export type OperationalDeadLetterReplayRequest = z.infer<
  typeof OperationalDeadLetterReplayRequestSchema
>;
export type OperationalDispatchRequest = z.infer<
  typeof OperationalDispatchRequestSchema
>;
