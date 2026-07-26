import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  PaperRuntimeIncidentAcknowledgeRecordSchema,
  PaperRuntimeIncidentAcknowledgeRequestSchema,
  PaperRuntimeIncidentSchema,
  PaperRuntimeOperationalEventPageSchema,
  PaperRuntimeOperationalEventSchema,
  PaperRuntimeOrphanClearanceRecordSchema,
  PaperRuntimeOrphanClearanceRequestSchema,
  type OrchestrationActor,
  type PaperRuntimeIncident,
  type PaperRuntimeIncidentAcknowledgeRecord,
  type PaperRuntimeOperationalEvent,
  type PaperRuntimeOperationalEventPage,
  type PaperRuntimeOperationalEventType,
  type PaperRuntimeOrphanClearanceRecord,
} from "../../contracts/src/index.js";
import type {
  PaperRuntimeOperationsRepository,
  PaperRuntimeRunRepository,
} from "./paper-runtime-activation.js";

interface JsonRow {
  record_json: string;
}

export interface PaperRuntimeOperationalEventInput {
  runId: string;
  planId: string;
  eventType: PaperRuntimeOperationalEventType;
  severity?: "info" | "warning" | "critical";
  occurredAt: Date;
  fields?: Readonly<Record<string, string>>;
}

export interface PaperRuntimeOperationalEventSink {
  appendOperationalEvent(
    input: PaperRuntimeOperationalEventInput,
  ): PaperRuntimeOperationalEvent;
}

type SupervisorErrorCode =
  | "PAPER_RUNTIME_SUPERVISOR_ACTOR_ROLE_REQUIRED"
  | "PAPER_RUNTIME_SUPERVISOR_REQUEST_INVALID"
  | "PAPER_RUNTIME_INCIDENT_NOT_FOUND"
  | "PAPER_RUNTIME_INCIDENT_CONFLICT"
  | "PAPER_RUNTIME_ORPHAN_CLEARANCE_NOT_ALLOWED"
  | "PAPER_RUNTIME_ORPHAN_LEASE_NOT_TERMINAL"
  | "PAPER_RUNTIME_SUPERVISOR_PERSISTENCE_FAILED";

export class PaperRuntimeSupervisorError extends Error {
  readonly name = "PaperRuntimeSupervisorError";

  constructor(
    readonly code: SupervisorErrorCode,
    message: string,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(message);
  }
}

const incidentByEvent: Partial<
  Record<
    PaperRuntimeOperationalEventType,
    {
      incidentType: PaperRuntimeIncident["incidentType"];
      severity: PaperRuntimeIncident["severity"];
    }
  >
> = {
  lease_lost: { incidentType: "lease_lost", severity: "critical" },
  run_orphaned: { incidentType: "run_orphaned", severity: "critical" },
  run_failed: { incidentType: "runtime_failure", severity: "critical" },
  runtime_resource_close_failed: {
    incidentType: "resource_close_failure",
    severity: "critical",
  },
};

function requireOperator(actor: OrchestrationActor): void {
  if (!actor.roles.includes("operator")) {
    throw new PaperRuntimeSupervisorError(
      "PAPER_RUNTIME_SUPERVISOR_ACTOR_ROLE_REQUIRED",
      "Paper Runtime supervision requires the operator role.",
      { actorId: actor.actorId, role: "operator" },
    );
  }
}

export class SqlitePaperRuntimeSupervisorRepository
  implements PaperRuntimeOperationalEventSink
{
  constructor(private readonly database: DatabaseSync) {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS paper_runtime_operational_events (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE (run_id, sequence)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS paper_runtime_incidents (
        incident_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        incident_type TEXT NOT NULL,
        status TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE (run_id, incident_type)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS paper_runtime_incident_acknowledgements (
        acknowledgement_id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        incident_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE (actor_id, idempotency_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS paper_runtime_orphan_clearances (
        clearance_id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        run_id TEXT NOT NULL UNIQUE,
        record_json TEXT NOT NULL,
        UNIQUE (actor_id, idempotency_key)
      ) STRICT;
    `);
  }

  appendOperationalEvent(
    input: PaperRuntimeOperationalEventInput,
  ): PaperRuntimeOperationalEvent {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database
        .prepare(
          `SELECT COALESCE(MAX(sequence), 0) AS last_sequence
           FROM paper_runtime_operational_events
           WHERE run_id = ?`,
        )
        .get(input.runId) as { last_sequence: number };
      const event = PaperRuntimeOperationalEventSchema.parse({
        schemaVersion: "1.0.0",
        eventId: `paper-runtime-event:${randomUUID()}`,
        runId: input.runId,
        planId: input.planId,
        sequence: row.last_sequence + 1,
        eventType: input.eventType,
        severity: input.severity ?? "info",
        occurredAt: input.occurredAt.toISOString(),
        fields: { ...(input.fields ?? {}) },
        outboxStatus: "pending",
        deliveryConfigured: false,
        exchangeWriteAllowed: false,
      });
      this.database
        .prepare(
          `INSERT INTO paper_runtime_operational_events (
             event_id, run_id, plan_id, sequence, event_type, occurred_at,
             record_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.eventId,
          event.runId,
          event.planId,
          event.sequence,
          event.eventType,
          event.occurredAt,
          JSON.stringify(event),
        );
      const incidentSpec = incidentByEvent[event.eventType];
      if (incidentSpec) {
        const existing = this.database
          .prepare(
            `SELECT record_json FROM paper_runtime_incidents
             WHERE run_id = ? AND incident_type = ?`,
          )
          .get(event.runId, incidentSpec.incidentType) as JsonRow | undefined;
        if (existing) {
          const incident = PaperRuntimeIncidentSchema.parse(
            JSON.parse(existing.record_json),
          );
          const updated = PaperRuntimeIncidentSchema.parse({
            ...incident,
            lastEventId: event.eventId,
          });
          this.database
            .prepare(
              `UPDATE paper_runtime_incidents
               SET record_json = ? WHERE incident_id = ?`,
            )
            .run(JSON.stringify(updated), updated.incidentId);
        } else {
          const incident = PaperRuntimeIncidentSchema.parse({
            schemaVersion: "1.0.0",
            incidentId: `paper-runtime-incident:${randomUUID()}`,
            runId: event.runId,
            planId: event.planId,
            incidentType: incidentSpec.incidentType,
            severity: incidentSpec.severity,
            status: "open",
            dedupeKey: `${event.runId}:${incidentSpec.incidentType}`,
            openedAt: event.occurredAt,
            lastEventId: event.eventId,
            exchangeWriteAllowed: false,
          });
          this.database
            .prepare(
              `INSERT INTO paper_runtime_incidents (
                 incident_id, run_id, incident_type, status, opened_at,
                 record_json
               ) VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(
              incident.incidentId,
              incident.runId,
              incident.incidentType,
              incident.status,
              incident.openedAt,
              JSON.stringify(incident),
            );
        }
      }
      this.database.exec("COMMIT");
      return event;
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (error instanceof Error && error.name === "ZodError") throw error;
      throw new PaperRuntimeSupervisorError(
        "PAPER_RUNTIME_SUPERVISOR_PERSISTENCE_FAILED",
        "Paper Runtime operational event could not be persisted.",
        { runId: input.runId, eventType: input.eventType },
      );
    }
  }

  listEvents(
    runId: string,
    afterSequence = 0,
    limit = 50,
  ): PaperRuntimeOperationalEventPage {
    if (
      !Number.isInteger(afterSequence) ||
      afterSequence < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new PaperRuntimeSupervisorError(
        "PAPER_RUNTIME_SUPERVISOR_REQUEST_INVALID",
        "Operational event pagination is outside its bounded contract.",
        { runId },
      );
    }
    const rows = this.database
      .prepare(
        `SELECT record_json
         FROM paper_runtime_operational_events
         WHERE run_id = ? AND sequence > ?
         ORDER BY sequence ASC
         LIMIT ?`,
      )
      .all(runId, afterSequence, limit + 1) as unknown as JsonRow[];
    const parsed = rows.map((row) =>
      PaperRuntimeOperationalEventSchema.parse(JSON.parse(row.record_json)),
    );
    const hasMore = parsed.length > limit;
    const events = parsed.slice(0, limit);
    return PaperRuntimeOperationalEventPageSchema.parse({
      schemaVersion: "1.0.0",
      runId,
      events,
      limit,
      ...(hasMore && events.length > 0
        ? { nextAfterSequence: events.at(-1)!.sequence }
        : {}),
    });
  }

  listIncidents(runId: string): readonly PaperRuntimeIncident[] {
    const rows = this.database
      .prepare(
        `SELECT record_json FROM paper_runtime_incidents
         WHERE run_id = ?
         ORDER BY opened_at ASC, incident_id ASC`,
      )
      .all(runId) as unknown as JsonRow[];
    return rows.map((row) =>
      PaperRuntimeIncidentSchema.parse(JSON.parse(row.record_json)),
    );
  }

  getIncident(incidentId: string): PaperRuntimeIncident {
    const row = this.database
      .prepare(
        "SELECT record_json FROM paper_runtime_incidents WHERE incident_id = ?",
      )
      .get(incidentId) as JsonRow | undefined;
    if (!row) {
      throw new PaperRuntimeSupervisorError(
        "PAPER_RUNTIME_INCIDENT_NOT_FOUND",
        "Paper Runtime incident was not found.",
        { incidentId },
      );
    }
    return PaperRuntimeIncidentSchema.parse(JSON.parse(row.record_json));
  }

  findAcknowledgementByIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimeIncidentAcknowledgeRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT record_json
         FROM paper_runtime_incident_acknowledgements
         WHERE actor_id = ? AND idempotency_key = ?`,
      )
      .get(actorId, idempotencyKey) as JsonRow | undefined;
    return row
      ? PaperRuntimeIncidentAcknowledgeRecordSchema.parse(
          JSON.parse(row.record_json),
        )
      : undefined;
  }

  saveAcknowledgement(
    record: PaperRuntimeIncidentAcknowledgeRecord,
    idempotencyKey: string,
  ): PaperRuntimeIncidentAcknowledgeRecord {
    const parsed = PaperRuntimeIncidentAcknowledgeRecordSchema.parse(record);
    const incident = this.getIncident(parsed.incidentId);
    if (incident.status !== "open") {
      throw new PaperRuntimeSupervisorError(
        "PAPER_RUNTIME_INCIDENT_CONFLICT",
        "Only an open Paper Runtime incident can be acknowledged.",
        { incidentId: incident.incidentId, status: incident.status },
      );
    }
    const updated = PaperRuntimeIncidentSchema.parse({
      ...incident,
      status: "acknowledged",
      acknowledgedAt: parsed.acknowledgedAt,
      acknowledgedByActorId: parsed.actorId,
      acknowledgedByDisplayName: parsed.actorDisplayName,
    });
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO paper_runtime_incident_acknowledgements (
             acknowledgement_id, actor_id, idempotency_key, incident_id,
             record_json
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.acknowledgementId,
          parsed.actorId,
          idempotencyKey,
          parsed.incidentId,
          JSON.stringify(parsed),
        );
      this.database
        .prepare(
          `UPDATE paper_runtime_incidents
           SET status = 'acknowledged', record_json = ?
           WHERE incident_id = ? AND status = 'open'`,
        )
        .run(JSON.stringify(updated), updated.incidentId);
      this.database.exec("COMMIT");
      return parsed;
    } catch {
      this.database.exec("ROLLBACK");
      throw new PaperRuntimeSupervisorError(
        "PAPER_RUNTIME_INCIDENT_CONFLICT",
        "Paper Runtime acknowledgement conflicts with an immutable record.",
        { incidentId: parsed.incidentId },
      );
    }
  }

  findClearanceByIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimeOrphanClearanceRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT record_json FROM paper_runtime_orphan_clearances
         WHERE actor_id = ? AND idempotency_key = ?`,
      )
      .get(actorId, idempotencyKey) as JsonRow | undefined;
    return row
      ? PaperRuntimeOrphanClearanceRecordSchema.parse(
          JSON.parse(row.record_json),
        )
      : undefined;
  }

  findClearance(runId: string): PaperRuntimeOrphanClearanceRecord | undefined {
    const row = this.database
      .prepare(
        "SELECT record_json FROM paper_runtime_orphan_clearances WHERE run_id = ?",
      )
      .get(runId) as JsonRow | undefined;
    return row
      ? PaperRuntimeOrphanClearanceRecordSchema.parse(
          JSON.parse(row.record_json),
        )
      : undefined;
  }

  saveClearance(
    record: PaperRuntimeOrphanClearanceRecord,
    idempotencyKey: string,
  ): PaperRuntimeOrphanClearanceRecord {
    const parsed = PaperRuntimeOrphanClearanceRecordSchema.parse(record);
    const incident = this.getIncident(parsed.incidentId);
    if (
      incident.runId !== parsed.runId ||
      !["run_orphaned", "lease_lost"].includes(incident.incidentType) ||
      incident.status === "cleared"
    ) {
      throw new PaperRuntimeSupervisorError(
        "PAPER_RUNTIME_INCIDENT_CONFLICT",
        "Orphan clearance requires an uncleared orphan or lease incident.",
        { incidentId: incident.incidentId, runId: parsed.runId },
      );
    }
    const cleared = PaperRuntimeIncidentSchema.parse({
      ...incident,
      status: "cleared",
      clearedAt: parsed.clearedAt,
      clearedByActorId: parsed.actorId,
    });
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO paper_runtime_orphan_clearances (
             clearance_id, actor_id, idempotency_key, run_id, record_json
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.clearanceId,
          parsed.actorId,
          idempotencyKey,
          parsed.runId,
          JSON.stringify(parsed),
        );
      this.database
        .prepare(
          `UPDATE paper_runtime_incidents
           SET status = 'cleared', record_json = ?
           WHERE incident_id = ? AND status != 'cleared'`,
        )
        .run(JSON.stringify(cleared), cleared.incidentId);
      this.database.exec("COMMIT");
      return parsed;
    } catch {
      this.database.exec("ROLLBACK");
      throw new PaperRuntimeSupervisorError(
        "PAPER_RUNTIME_INCIDENT_CONFLICT",
        "Paper Runtime orphan clearance conflicts with an immutable record.",
        { runId: parsed.runId },
      );
    }
  }
}

export class PaperRuntimeSupervisorService {
  constructor(
    private readonly repository: SqlitePaperRuntimeSupervisorRepository,
    private readonly runs: PaperRuntimeRunRepository,
    private readonly operations: PaperRuntimeOperationsRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  listEvents(
    runId: string,
    rawPagination: Readonly<Record<string, string | undefined>> = {},
  ): PaperRuntimeOperationalEventPage {
    this.runs.getRun(runId);
    const afterSequence = rawPagination.afterSequence
      ? Number(rawPagination.afterSequence)
      : 0;
    const limit = rawPagination.limit ? Number(rawPagination.limit) : 50;
    return this.repository.listEvents(runId, afterSequence, limit);
  }

  listIncidents(runId: string): readonly PaperRuntimeIncident[] {
    this.runs.getRun(runId);
    return this.repository.listIncidents(runId);
  }

  acknowledge(
    incidentId: string,
    rawRequest: unknown,
    actor: OrchestrationActor,
  ): PaperRuntimeIncidentAcknowledgeRecord {
    requireOperator(actor);
    const parsed =
      PaperRuntimeIncidentAcknowledgeRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new PaperRuntimeSupervisorError(
        "PAPER_RUNTIME_SUPERVISOR_REQUEST_INVALID",
        "Paper Runtime incident acknowledgement is invalid.",
        { zodIssueCount: String(parsed.error.issues.length) },
      );
    }
    const idempotent = this.repository.findAcknowledgementByIdempotency(
      actor.actorId,
      parsed.data.idempotencyKey,
    );
    if (idempotent) return idempotent;
    const incident = this.repository.getIncident(incidentId);
    return this.repository.saveAcknowledgement(
      PaperRuntimeIncidentAcknowledgeRecordSchema.parse({
        schemaVersion: "1.0.0",
        acknowledgementId: `paper-runtime-ack:${randomUUID()}`,
        incidentId,
        runId: incident.runId,
        actorId: actor.actorId,
        actorDisplayName: actor.displayName,
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
        acknowledgedAt: this.now().toISOString(),
        runtimeMutationAllowed: false,
        exchangeWriteAllowed: false,
      }),
      parsed.data.idempotencyKey,
    );
  }

  clearOrphan(
    runId: string,
    rawRequest: unknown,
    actor: OrchestrationActor,
  ): PaperRuntimeOrphanClearanceRecord {
    requireOperator(actor);
    const parsed =
      PaperRuntimeOrphanClearanceRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new PaperRuntimeSupervisorError(
        "PAPER_RUNTIME_SUPERVISOR_REQUEST_INVALID",
        "Paper Runtime orphan clearance is invalid.",
        { zodIssueCount: String(parsed.error.issues.length) },
      );
    }
    const idempotent = this.repository.findClearanceByIdempotency(
      actor.actorId,
      parsed.data.idempotencyKey,
    );
    if (idempotent) return idempotent;
    const run = this.runs.getRun(runId);
    if (run.status !== "orphaned") {
      throw new PaperRuntimeSupervisorError(
        "PAPER_RUNTIME_ORPHAN_CLEARANCE_NOT_ALLOWED",
        "Only a terminal orphaned run can receive clearance.",
        { runId, status: run.status },
      );
    }
    const lease = this.operations.getLease(runId);
    if (!["orphaned", "lost"].includes(lease.status)) {
      throw new PaperRuntimeSupervisorError(
        "PAPER_RUNTIME_ORPHAN_LEASE_NOT_TERMINAL",
        "Orphan clearance requires an orphaned or lost lease.",
        { runId, leaseStatus: lease.status },
      );
    }
    const incident = this.repository
      .listIncidents(runId)
      .find(
        (item) =>
          ["run_orphaned", "lease_lost"].includes(item.incidentType) &&
          item.status !== "cleared",
      );
    if (!incident) {
      throw new PaperRuntimeSupervisorError(
        "PAPER_RUNTIME_INCIDENT_NOT_FOUND",
        "No uncleared orphan incident exists for this run.",
        { runId },
      );
    }
    const clearedAt = this.now();
    const clearance = this.repository.saveClearance(
      PaperRuntimeOrphanClearanceRecordSchema.parse({
        schemaVersion: "1.0.0",
        clearanceId: `paper-runtime-clearance:${randomUUID()}`,
        runId,
        planId: run.planId,
        incidentId: incident.incidentId,
        actorId: actor.actorId,
        actorDisplayName: actor.displayName,
        reason: parsed.data.reason,
        clearedAt: clearedAt.toISOString(),
        runStatusBefore: "orphaned",
        runStatusAfter: "orphaned",
        cycleStarted: false,
        executionTriggered: false,
        paperAccountMutated: false,
        runtimeResumed: false,
        exchangeWriteAllowed: false,
      }),
      parsed.data.idempotencyKey,
    );
    this.repository.appendOperationalEvent({
      runId,
      planId: run.planId,
      eventType: "orphan_cleared",
      occurredAt: clearedAt,
      fields: {
        clearanceId: clearance.clearanceId,
        incidentId: clearance.incidentId,
        actorId: actor.actorId,
      },
    });
    return clearance;
  }

  getClearance(runId: string): PaperRuntimeOrphanClearanceRecord {
    this.runs.getRun(runId);
    const clearance = this.repository.findClearance(runId);
    if (!clearance) {
      throw new PaperRuntimeSupervisorError(
        "PAPER_RUNTIME_INCIDENT_NOT_FOUND",
        "Paper Runtime orphan clearance was not found.",
        { runId },
      );
    }
    return clearance;
  }
}
