import assert from "node:assert/strict";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  OperationalDispatcherScheduleSchema,
  OperationalRetentionExecutionRequestSchema,
  OperationalRetentionPolicySchema,
  OperationalRetentionPreviewRequestSchema,
} from "../packages/contracts/src/index.js";
import {
  DurableOperationalOutboxWorker,
  InMemoryOperationalDeliverySink,
  OperationalRetentionError,
  SqliteOperationalOutboxDispatcher,
  SqliteOperationalRetentionService,
  createOperationalDeliveryTemplate,
  createOperationalDispatcherSchedule,
  createOperationalOutboxHttpHandler,
  createOperationalRetentionPolicy,
  type OperationalOutboxScheduler,
} from "../packages/runtime/src/index.js";

const createDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE paper_runtime_operational_events (
      event_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      machine_fields_json TEXT NOT NULL
    );
    CREATE TABLE paper_account_sentinel (
      account_id TEXT PRIMARY KEY,
      balance INTEGER NOT NULL,
      risk_mode TEXT NOT NULL,
      execution_count INTEGER NOT NULL
    );
    INSERT INTO paper_account_sentinel VALUES ('paper:main', 100000, 'normal', 7);
  `);
  return database;
};

const appendEvent = (
  database: DatabaseSync,
  eventId: string,
  sequence: number,
  runId = "paper-run:main",
  occurredAt = "2026-05-01T00:00:00.000Z",
): void => {
  database
    .prepare(
      `INSERT INTO paper_runtime_operational_events(
        event_id, run_id, sequence, event_type, occurred_at, machine_fields_json
      ) VALUES (?, ?, ?, 'cycle_completed', ?, ?)`,
    )
    .run(
      eventId,
      runId,
      sequence,
      occurredAt,
      JSON.stringify({ cycle: sequence, result: "completed" }),
    );
};

const deliveryTemplate = () =>
  createOperationalDeliveryTemplate({
    templateId: "delivery-template:retention-test",
    humanVersion: "1.0.0",
    lifecycleStatus: "active",
    sinkKind: "in_memory_test",
    maxAttempts: 3,
    initialBackoffMs: 100,
    maxBackoffMs: 400,
    createdAt: "2026-07-26T00:00:00.000Z",
  });

const retentionPolicy = (enabled = true) =>
  createOperationalRetentionPolicy({
    policyId: "operational-retention-policy:test",
    humanVersion: "1.0.0",
    lifecycleStatus: enabled ? "enabled" : "disabled",
    retentionDays: 30,
    candidateLimit: 1_000,
    createdAt: "2026-07-26T00:00:00.000Z",
    cleanupAllowed: enabled,
  });

const createDeliveredFixture = async (): Promise<{
  database: DatabaseSync;
  dispatcher: SqliteOperationalOutboxDispatcher;
}> => {
  const database = createDatabase();
  appendEvent(database, "runtime-event:eligible", 1);
  const dispatcher = new SqliteOperationalOutboxDispatcher({
    database,
    now: () => new Date("2026-07-26T00:00:00.000Z"),
  });
  dispatcher.registerTemplate(
    deliveryTemplate(),
    new InMemoryOperationalDeliverySink(),
  );
  await dispatcher.dispatchAvailable("dispatcher-owner:test");
  return { database, dispatcher };
};

test("disabled Worker never schedules or dispatches", async () => {
  let dispatchCalls = 0;
  let scheduledCalls = 0;
  const scheduler: OperationalOutboxScheduler = {
    setTimeout: () => {
      scheduledCalls += 1;
      return 1;
    },
    clearTimeout: () => undefined,
  };
  const worker = new DurableOperationalOutboxWorker({
    dispatcher: {
      dispatchAvailable: async () => {
        dispatchCalls += 1;
        return { processed: [] };
      },
    },
    ownerId: "dispatcher-worker:test",
    schedule: createOperationalDispatcherSchedule({
      scheduleId: "operational-outbox-schedule:test",
      humanVersion: "1.0.0",
      lifecycleStatus: "disabled",
      intervalMs: 1_000,
      batchLimit: 10,
      createdAt: "2026-07-26T00:00:00.000Z",
    }),
    scheduler,
  });
  assert.equal(worker.start().enabled, false);
  assert.equal(worker.getState().running, false);
  assert.equal(scheduledCalls, 0);
  assert.equal(dispatchCalls, 0);
});

test("enabled Worker prevents overlapping ticks and stop cancels scheduling", async () => {
  let releaseDispatch: (() => void) | undefined;
  let dispatchCalls = 0;
  const callbacks: Array<() => void> = [];
  let clearCalls = 0;
  const scheduler: OperationalOutboxScheduler = {
    setTimeout: (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    clearTimeout: () => {
      clearCalls += 1;
    },
  };
  const worker = new DurableOperationalOutboxWorker({
    dispatcher: {
      dispatchAvailable: async () => {
        dispatchCalls += 1;
        await new Promise<void>((resolve) => {
          releaseDispatch = resolve;
        });
        return { processed: [{ eventId: "runtime-event:1" }] };
      },
    },
    ownerId: "dispatcher-worker:test",
    schedule: createOperationalDispatcherSchedule({
      scheduleId: "operational-outbox-schedule:test",
      humanVersion: "1.0.0",
      lifecycleStatus: "enabled",
      intervalMs: 1_000,
      batchLimit: 10,
      createdAt: "2026-07-26T00:00:00.000Z",
    }),
    scheduler,
    now: () => new Date("2026-07-26T00:00:00.000Z"),
  });
  worker.start();
  assert.equal(callbacks.length, 1);
  const first = worker.runOnce();
  const overlapping = await worker.runOnce();
  assert.equal(overlapping.tickInProgress, true);
  assert.equal(dispatchCalls, 1);
  releaseDispatch?.();
  const completed = await first;
  assert.equal(completed.totalTicks, 1);
  assert.equal(completed.totalProcessed, 1);
  worker.stop();
  assert.equal(worker.getState().running, false);
  assert.equal(clearCalls, 1);
});

test("two Worker ticks do not redeliver an event/template pair", async () => {
  const database = createDatabase();
  appendEvent(database, "runtime-event:worker", 1);
  const sink = new InMemoryOperationalDeliverySink();
  const dispatcher = new SqliteOperationalOutboxDispatcher({ database });
  dispatcher.registerTemplate(deliveryTemplate(), sink);
  const worker = new DurableOperationalOutboxWorker({
    dispatcher,
    ownerId: "dispatcher-worker:test",
    schedule: createOperationalDispatcherSchedule({
      scheduleId: "operational-outbox-schedule:test",
      humanVersion: "1.0.0",
      lifecycleStatus: "enabled",
      intervalMs: 1_000,
      batchLimit: 10,
      createdAt: "2026-07-26T00:00:00.000Z",
    }),
  });
  await worker.runOnce();
  await worker.runOnce();
  assert.equal(worker.getState().totalTicks, 2);
  assert.equal(worker.getState().totalProcessed, 1);
  assert.equal(sink.events.length, 1);
});

test("sealed manifest gates idempotent retention and preserves trading state", async () => {
  const { database, dispatcher } = await createDeliveredFixture();
  const service = new SqliteOperationalRetentionService({
    database,
    dispatcher,
    policy: retentionPolicy(),
    now: () => new Date("2026-07-26T00:00:00.000Z"),
  });
  const actor = { actorId: "operator:alice", roles: ["operator"] };
  const result = service.createPreview(
    {
      confirmation: "CREATE_RETENTION_DRY_RUN",
      idempotencyKey: "retention-preview:one",
    },
    actor,
  );
  assert.deepEqual(result.preview.eligibleEventIds, [
    "runtime-event:eligible",
  ]);
  assert.equal(result.manifest.lifecycleStatus, "sealed");
  assert.equal(result.manifest.payloadIncluded, false);
  assert.throws(() =>
    database
      .prepare(
        `UPDATE operational_audit_export_manifests
         SET event_count = 99 WHERE manifest_id = ?`,
      )
      .run(result.manifest.manifestId),
  );
  const request = {
    confirmation: "EXECUTE_CONFIRMED_RETENTION" as const,
    manifestId: result.manifest.manifestId,
    manifestFingerprint: result.manifest.manifestFingerprint,
    idempotencyKey: "retention-execution:one",
    reason: "Operator confirmed exported operational retention",
  };
  const execution = service.execute(request, actor);
  const replayed = service.execute(request, actor);
  assert.equal(execution.executionId, replayed.executionId);
  assert.equal(execution.deletedEventCount, 1);
  assert.equal(execution.deletedAttemptCount, 1);
  assert.throws(() =>
    database
      .prepare(
        `UPDATE operational_retention_executions
         SET deleted_event_count = 99 WHERE execution_id = ?`,
      )
      .run(execution.executionId),
  );
  assert.equal(
    (
      database
        .prepare(`SELECT COUNT(*) AS count FROM paper_runtime_operational_events`)
        .get() as { count: number }
    ).count,
    0,
  );
  const tradingState = database
    .prepare(`SELECT * FROM paper_account_sentinel`)
    .get() as Record<string, unknown>;
  assert.equal(tradingState.account_id, "paper:main");
  assert.equal(tradingState.balance, 100000);
  assert.equal(tradingState.risk_mode, "normal");
  assert.equal(tradingState.execution_count, 7);
});

test("retention protects retry, open failure, open incident, orphan, and new events", async () => {
  const database = createDatabase();
  appendEvent(database, "runtime-event:eligible", 1, "paper-run:eligible");
  appendEvent(database, "runtime-event:retry", 2, "paper-run:retry");
  appendEvent(database, "runtime-event:failure", 3, "paper-run:failure");
  appendEvent(database, "runtime-event:incident", 4, "paper-run:incident");
  appendEvent(database, "runtime-event:orphan", 5, "paper-run:orphan");
  appendEvent(
    database,
    "runtime-event:new",
    6,
    "paper-run:new",
    "2026-07-25T00:00:00.000Z",
  );
  database.exec(`
    CREATE TABLE paper_runtime_runs (
      run_id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );
    INSERT INTO paper_runtime_runs VALUES ('paper-run:orphan', 'orphaned');
    CREATE TABLE paper_runtime_incidents (
      incident_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    INSERT INTO paper_runtime_incidents VALUES (
      'runtime-incident:open', 'paper-run:incident', 'open'
    );
  `);
  const dispatcher = new SqliteOperationalOutboxDispatcher({
    database,
    now: () => new Date("2026-07-26T00:00:00.000Z"),
  });
  dispatcher.registerTemplate(
    deliveryTemplate(),
    new InMemoryOperationalDeliverySink(),
  );
  await dispatcher.dispatchAvailable("dispatcher-owner:test");
  database
    .prepare(
      `UPDATE operational_delivery_attempts
       SET status = 'retry_wait'
       WHERE event_id = 'runtime-event:retry'`,
    )
    .run();
  const failureAttempt = database
    .prepare(
      `SELECT * FROM operational_delivery_attempts
       WHERE event_id = 'runtime-event:failure'`,
    )
    .get() as Record<string, unknown>;
  database
    .prepare(
      `INSERT INTO operational_delivery_dead_letters(
        dead_letter_id, attempt_id, event_id, run_id, template_id,
        event_fingerprint, reason_code, incident_status,
        created_at, updated_at, replayed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL)`,
    )
    .run(
      "delivery-dead-letter:open",
      String(failureAttempt.attempt_id),
      "runtime-event:failure",
      "paper-run:failure",
      String(failureAttempt.template_id),
      String(failureAttempt.event_fingerprint),
      "registered_sink_delivery_failed",
      "2026-07-26T00:00:00.000Z",
      "2026-07-26T00:00:00.000Z",
    );
  const service = new SqliteOperationalRetentionService({
    database,
    dispatcher,
    policy: retentionPolicy(),
    now: () => new Date("2026-07-26T00:00:00.000Z"),
  });
  const { preview } = service.createPreview(
    {
      confirmation: "CREATE_RETENTION_DRY_RUN",
      idempotencyKey: "retention-preview:protected",
    },
    { actorId: "operator:alice", roles: ["operator"] },
  );
  assert.deepEqual(preview.eligibleEventIds, ["runtime-event:eligible"]);
  assert.equal(preview.protectedReasonCounts.non_terminal_attempt, 1);
  assert.equal(preview.protectedReasonCounts.open_delivery_failure, 1);
  assert.equal(preview.protectedReasonCounts.open_runtime_incident, 1);
  assert.equal(preview.protectedReasonCounts.orphaned_run, 1);
  assert.equal(preview.protectedReasonCounts.too_new, 1);
});

test("candidate drift and disabled policies fail closed", async () => {
  const { database, dispatcher } = await createDeliveredFixture();
  const service = new SqliteOperationalRetentionService({
    database,
    dispatcher,
    policy: retentionPolicy(),
    now: () => new Date("2026-07-26T00:00:00.000Z"),
  });
  const actor = { actorId: "operator:alice", roles: ["operator"] };
  const { manifest } = service.createPreview(
    {
      confirmation: "CREATE_RETENTION_DRY_RUN",
      idempotencyKey: "retention-preview:drift",
    },
    actor,
  );
  appendEvent(database, "runtime-event:late-candidate", 2);
  await dispatcher.dispatchAvailable("dispatcher-owner:test");
  assert.throws(
    () =>
      service.execute(
        {
          confirmation: "EXECUTE_CONFIRMED_RETENTION",
          manifestId: manifest.manifestId,
          manifestFingerprint: manifest.manifestFingerprint,
          idempotencyKey: "retention-execution:drift",
          reason: "Attempt execution after candidate set changed",
        },
        actor,
      ),
    (error: unknown) =>
      error instanceof OperationalRetentionError &&
      error.code === "RETENTION_CANDIDATE_DRIFT",
  );
  const disabled = new SqliteOperationalRetentionService({
    database,
    dispatcher,
    policy: retentionPolicy(false),
  });
  assert.throws(
    () =>
      disabled.execute(
        {
          confirmation: "EXECUTE_CONFIRMED_RETENTION",
          manifestId: manifest.manifestId,
          manifestFingerprint: manifest.manifestFingerprint,
          idempotencyKey: "retention-execution:disabled",
          reason: "Disabled policy must reject execution",
        },
        actor,
      ),
    (error: unknown) =>
      error instanceof OperationalRetentionError &&
      error.code === "RETENTION_POLICY_DISABLED",
  );
});

test("retention and schedule contracts reject client control injection", () => {
  assert.equal(
    OperationalDispatcherScheduleSchema.safeParse({
      ...createOperationalDispatcherSchedule({
        scheduleId: "operational-outbox-schedule:test",
        humanVersion: "1.0.0",
        lifecycleStatus: "disabled",
        intervalMs: 1_000,
        batchLimit: 10,
        createdAt: "2026-07-26T00:00:00.000Z",
      }),
      owner: "client",
      concurrency: 50,
    }).success,
    false,
  );
  assert.equal(
    OperationalRetentionPolicySchema.safeParse({
      ...retentionPolicy(false),
      sql: "DELETE FROM paper_accounts",
      path: "/tmp/export",
    }).success,
    false,
  );
  assert.equal(
    OperationalRetentionPreviewRequestSchema.safeParse({
      confirmation: "CREATE_RETENTION_DRY_RUN",
      idempotencyKey: "preview:one",
      actor: "attacker",
      retentionDays: 0,
    }).success,
    false,
  );
  assert.equal(
    OperationalRetentionExecutionRequestSchema.safeParse({
      confirmation: "EXECUTE_CONFIRMED_RETENTION",
      manifestId: "audit-manifest:test",
      manifestFingerprint: `sha256:${"0".repeat(64)}`,
      idempotencyKey: "execute:one",
      reason: "execute",
      code: "process.exit()",
      url: "https://example.invalid",
    }).success,
    false,
  );
});

test("retention HTTP is authenticated, operator-only, and strict", async () => {
  const { database, dispatcher } = await createDeliveredFixture();
  const service = new SqliteOperationalRetentionService({
    database,
    dispatcher,
    policy: retentionPolicy(),
    now: () => new Date("2026-07-26T00:00:00.000Z"),
  });
  const handler = createOperationalOutboxHttpHandler({
    dispatcher,
    retentionService: service,
    authenticate: (request) => {
      if (request.headers.authorization === "Bearer operator-token") {
        return { actorId: "operator:server", roles: ["operator"] };
      }
      if (request.headers.authorization === "Bearer viewer-token") {
        return { actorId: "viewer:server", roles: ["viewer"] };
      }
      return null;
    },
  });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/orchestration/operational-outbox/retention/previews`;
  try {
    assert.equal((await fetch(url, { method: "POST" })).status, 401);
    const viewer = await fetch(url, {
      method: "POST",
      headers: {
        authorization: "Bearer viewer-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        confirmation: "CREATE_RETENTION_DRY_RUN",
        idempotencyKey: "preview:http-viewer",
      }),
    });
    assert.equal(viewer.status, 403);
    const injected = await fetch(url, {
      method: "POST",
      headers: {
        authorization: "Bearer operator-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        confirmation: "CREATE_RETENTION_DRY_RUN",
        idempotencyKey: "preview:http-injected",
        actor: "attacker",
        path: "/tmp/archive",
        sql: "DELETE FROM paper_accounts",
      }),
    });
    assert.equal(injected.status, 422);
    const valid = await fetch(url, {
      method: "POST",
      headers: {
        authorization: "Bearer operator-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        confirmation: "CREATE_RETENTION_DRY_RUN",
        idempotencyKey: "preview:http-valid",
      }),
    });
    assert.equal(valid.status, 201);
    const payload = (await valid.json()) as {
      manifest: { payloadIncluded: boolean };
      preview: { eligibleEventCount: number };
    };
    assert.equal(payload.manifest.payloadIncluded, false);
    assert.equal(payload.preview.eligibleEventCount, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
