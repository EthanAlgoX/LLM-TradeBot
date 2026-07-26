import { z } from "zod";

const SchemaVersion = z.literal("1.0.0");
const IsoDateTime = z.string().datetime();
const SafeMachineFieldKey = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][A-Za-z0-9]*$/);
const SafeMachineFields = z
  .record(SafeMachineFieldKey, z.string().max(500))
  .superRefine((fields, context) => {
    const forbidden =
      /^(token|secret|authorization|password|databasePath|profilePath|artifactPath|httpBody|prompt|sourceCode|script|provider|email|phone)$/i;
    if (Object.keys(fields).length > 32) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Operational event fields are bounded to 32 keys.",
      });
    }
    for (const key of Object.keys(fields)) {
      if (forbidden.test(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Sensitive or executable operational field is not allowed.",
          path: [key],
        });
      }
    }
  });

export const PaperRuntimeOperationalEventTypeSchema = z.enum([
  "preflight_accepted",
  "run_queued",
  "lease_acquired",
  "run_started",
  "lease_heartbeat",
  "cycle_completed",
  "cycle_failed",
  "safety_blocked",
  "stop_requested",
  "run_drained",
  "run_completed",
  "run_failed",
  "lease_lost",
  "run_orphaned",
  "runtime_resources_closed",
  "runtime_resource_close_failed",
  "orphan_cleared",
]);
export type PaperRuntimeOperationalEventType = z.infer<
  typeof PaperRuntimeOperationalEventTypeSchema
>;

export const PaperRuntimeOperationalEventSchema = z
  .object({
    schemaVersion: SchemaVersion,
    eventId: z.string().min(1),
    runId: z.string().min(1),
    planId: z.string().min(1),
    sequence: z.number().int().positive(),
    eventType: PaperRuntimeOperationalEventTypeSchema,
    severity: z.enum(["info", "warning", "critical"]),
    occurredAt: IsoDateTime,
    fields: SafeMachineFields,
    outboxStatus: z.literal("pending"),
    deliveryConfigured: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();
export type PaperRuntimeOperationalEvent = z.infer<
  typeof PaperRuntimeOperationalEventSchema
>;

export const PaperRuntimeOperationalEventPageSchema = z
  .object({
    schemaVersion: SchemaVersion,
    runId: z.string().min(1),
    events: z.array(PaperRuntimeOperationalEventSchema),
    limit: z.number().int().min(1).max(100),
    nextAfterSequence: z.number().int().positive().optional(),
  })
  .strict();
export type PaperRuntimeOperationalEventPage = z.infer<
  typeof PaperRuntimeOperationalEventPageSchema
>;

export const PaperRuntimeIncidentTypeSchema = z.enum([
  "lease_lost",
  "run_orphaned",
  "runtime_failure",
  "resource_close_failure",
]);
export type PaperRuntimeIncidentType = z.infer<
  typeof PaperRuntimeIncidentTypeSchema
>;

export const PaperRuntimeIncidentSchema = z
  .object({
    schemaVersion: SchemaVersion,
    incidentId: z.string().min(1),
    runId: z.string().min(1),
    planId: z.string().min(1),
    incidentType: PaperRuntimeIncidentTypeSchema,
    severity: z.enum(["warning", "critical"]),
    status: z.enum(["open", "acknowledged", "cleared"]),
    dedupeKey: z.string().min(1),
    openedAt: IsoDateTime,
    lastEventId: z.string().min(1),
    acknowledgedAt: IsoDateTime.optional(),
    acknowledgedByActorId: z.string().min(1).optional(),
    acknowledgedByDisplayName: z.string().min(1).optional(),
    clearedAt: IsoDateTime.optional(),
    clearedByActorId: z.string().min(1).optional(),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();
export type PaperRuntimeIncident = z.infer<
  typeof PaperRuntimeIncidentSchema
>;

export const PaperRuntimeIncidentAcknowledgeRequestSchema = z
  .object({
    schemaVersion: SchemaVersion,
    idempotencyKey: z.string().min(1).max(200),
    confirmation: z.literal("acknowledge_paper_runtime_incident"),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type PaperRuntimeIncidentAcknowledgeRequest = z.infer<
  typeof PaperRuntimeIncidentAcknowledgeRequestSchema
>;

export const PaperRuntimeIncidentAcknowledgeRecordSchema = z
  .object({
    schemaVersion: SchemaVersion,
    acknowledgementId: z.string().min(1),
    incidentId: z.string().min(1),
    runId: z.string().min(1),
    actorId: z.string().min(1),
    actorDisplayName: z.string().min(1),
    note: z.string().min(1).optional(),
    acknowledgedAt: IsoDateTime,
    runtimeMutationAllowed: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();
export type PaperRuntimeIncidentAcknowledgeRecord = z.infer<
  typeof PaperRuntimeIncidentAcknowledgeRecordSchema
>;

export const PaperRuntimeOrphanClearanceRequestSchema = z
  .object({
    schemaVersion: SchemaVersion,
    idempotencyKey: z.string().min(1).max(200),
    confirmation: z.literal("clear_terminal_orphan_incident"),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type PaperRuntimeOrphanClearanceRequest = z.infer<
  typeof PaperRuntimeOrphanClearanceRequestSchema
>;

export const PaperRuntimeOrphanClearanceRecordSchema = z
  .object({
    schemaVersion: SchemaVersion,
    clearanceId: z.string().min(1),
    runId: z.string().min(1),
    planId: z.string().min(1),
    incidentId: z.string().min(1),
    actorId: z.string().min(1),
    actorDisplayName: z.string().min(1),
    reason: z.string().min(1),
    clearedAt: IsoDateTime,
    runStatusBefore: z.literal("orphaned"),
    runStatusAfter: z.literal("orphaned"),
    cycleStarted: z.literal(false),
    executionTriggered: z.literal(false),
    paperAccountMutated: z.literal(false),
    runtimeResumed: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
  })
  .strict();
export type PaperRuntimeOrphanClearanceRecord = z.infer<
  typeof PaperRuntimeOrphanClearanceRecordSchema
>;
