import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  OperationalDeadLetterReplayRequestSchema,
  OperationalDeliveryTemplateSchema,
  OperationalDispatchRequestSchema,
} from "../packages/contracts/src/index.js";
import {
  InMemoryOperationalDeliverySink,
  LocalJsonlOperationalAuditSink,
  OperationalOutboxDispatcherError,
  SqliteOperationalOutboxDispatcher,
  createOperationalDeliveryTemplate,
  createOperationalOutboxHttpHandler,
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
    )
  `);
  return database;
};

const appendEvent = (
  database: DatabaseSync,
  eventId = "runtime-event:1",
  sequence = 1,
): void => {
  database
    .prepare(
      `INSERT INTO paper_runtime_operational_events(
        event_id, run_id, sequence, event_type, occurred_at, machine_fields_json
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      eventId,
      "paper-run:1",
      sequence,
      "run_started",
      "2026-07-26T00:00:00.000Z",
      JSON.stringify({ pipelineVersion: "crypto-v1", cycle: 1 }),
    );
};

const template = (
  overrides: Partial<{
    templateId: string;
    maxAttempts: number;
    initialBackoffMs: number;
    maxBackoffMs: number;
    sinkKind: "in_memory_test" | "local_jsonl_audit";
  }> = {},
) =>
  createOperationalDeliveryTemplate({
    templateId: overrides.templateId ?? "delivery-template:test",
    humanVersion: "1.0.0",
    lifecycleStatus: "active",
    sinkKind: overrides.sinkKind ?? "in_memory_test",
    maxAttempts: overrides.maxAttempts ?? 3,
    initialBackoffMs: overrides.initialBackoffMs ?? 100,
    maxBackoffMs: overrides.maxBackoffMs ?? 400,
    createdAt: "2026-07-26T00:00:00.000Z",
  });

test("default dispatcher has zero configured delivery and performs no work", async () => {
  const database = createDatabase();
  appendEvent(database);
  const dispatcher = new SqliteOperationalOutboxDispatcher({ database });
  const result = await dispatcher.dispatchAvailable("dispatcher-owner:one");
  assert.equal(result.processed.length, 0);
  assert.equal(dispatcher.listAttempts().length, 0);
  assert.deepEqual(dispatcher.getState().registeredTemplateIds, []);
  assert.equal(dispatcher.getState().networkRequestCount, 0);
  assert.equal(dispatcher.getState().externalDeliveryConfigured, false);
});

test("registered event/template delivery is durable and idempotent", async () => {
  const database = createDatabase();
  appendEvent(database);
  const sink = new InMemoryOperationalDeliverySink();
  const dispatcher = new SqliteOperationalOutboxDispatcher({ database });
  dispatcher.registerTemplate(template(), sink);
  const first = await dispatcher.dispatchAvailable("dispatcher-owner:one");
  const second = await dispatcher.dispatchAvailable("dispatcher-owner:one");
  assert.equal(first.processed[0]?.status, "delivered");
  assert.equal(second.processed.length, 0);
  assert.equal(sink.events.length, 1);
  assert.equal(dispatcher.listAttempts().length, 1);
  assert.equal(sink.events[0]?.exchangeWriteAllowed, false);
});

test("bounded exponential retry becomes a durable delivery_failure dead letter", async () => {
  const database = createDatabase();
  appendEvent(database);
  let nowMs = Date.parse("2026-07-26T00:00:00.000Z");
  const sink = new InMemoryOperationalDeliverySink();
  sink.failuresRemaining = 3;
  const dispatcher = new SqliteOperationalOutboxDispatcher({
    database,
    now: () => new Date(nowMs),
  });
  dispatcher.registerTemplate(template({ maxAttempts: 2 }), sink);
  const first = await dispatcher.dispatchAvailable("dispatcher-owner:one");
  assert.equal(first.processed[0]?.status, "retry_wait");
  assert.equal(
    first.processed[0]?.nextAttemptAt,
    "2026-07-26T00:00:00.100Z",
  );
  assert.equal(
    (await dispatcher.dispatchAvailable("dispatcher-owner:one")).processed.length,
    0,
  );
  nowMs += 100;
  const second = await dispatcher.dispatchAvailable("dispatcher-owner:one");
  assert.equal(second.processed[0]?.status, "dead_letter");
  const deadLetter = dispatcher.listDeadLetters()[0]!;
  assert.equal(deadLetter.incidentType, "delivery_failure");
  assert.equal(deadLetter.incidentStatus, "open");
});

test("dispatcher lease fences a second owner and restart recovers delivering", async () => {
  const database = createDatabase();
  appendEvent(database);
  const first = new SqliteOperationalOutboxDispatcher({ database });
  first.registerTemplate(template(), new InMemoryOperationalDeliverySink());
  await first.dispatchAvailable("dispatcher-owner:first");
  const second = new SqliteOperationalOutboxDispatcher({ database });
  await assert.rejects(
    second.dispatchAvailable("dispatcher-owner:second"),
    (error: unknown) =>
      error instanceof OperationalOutboxDispatcherError &&
      error.code === "DISPATCHER_LEASE_HELD",
  );
  database
    .prepare(
      `UPDATE operational_delivery_attempts
       SET status = 'delivering', delivered_at = NULL`,
    )
    .run();
  const recovered = new SqliteOperationalOutboxDispatcher({ database });
  assert.equal(recovered.listAttempts()[0]?.status, "retry_wait");
  assert.equal(
    recovered.listAttempts()[0]?.errorCode,
    "dispatcher_restart_recovery",
  );
});

test("operator replay preserves the original event fingerprint and is idempotent", async () => {
  const database = createDatabase();
  appendEvent(database);
  const sink = new InMemoryOperationalDeliverySink();
  sink.failuresRemaining = 1;
  const dispatcher = new SqliteOperationalOutboxDispatcher({ database });
  dispatcher.registerTemplate(template({ maxAttempts: 1 }), sink);
  await dispatcher.dispatchAvailable("dispatcher-owner:one");
  const deadLetter = dispatcher.listDeadLetters()[0]!;
  const replayRequest = {
    confirmation: "REPLAY_REGISTERED_DELIVERY" as const,
    idempotencyKey: "replay:one",
    reason: "Operator confirmed registered local audit replay",
  };
  const replayed = dispatcher.replayDeadLetter(
    deadLetter.deadLetterId,
    replayRequest,
    { actorId: "operator:alice", roles: ["operator"] },
  );
  const replayedAgain = dispatcher.replayDeadLetter(
    deadLetter.deadLetterId,
    replayRequest,
    { actorId: "operator:alice", roles: ["operator"] },
  );
  assert.equal(replayed.eventFingerprint, deadLetter.eventFingerprint);
  assert.equal(replayedAgain.attemptId, replayed.attemptId);
  await dispatcher.dispatchAvailable("dispatcher-owner:one");
  assert.equal(sink.events[0]?.fingerprint, deadLetter.eventFingerprint);
  assert.equal(dispatcher.listAttempts()[0]?.status, "delivered");
});

test("local JSONL sink writes only the fixed server-owned audit file", async () => {
  const database = createDatabase();
  appendEvent(database);
  const directory = await mkdtemp(join(tmpdir(), "tradebot-audit-"));
  const dispatcher = new SqliteOperationalOutboxDispatcher({ database });
  dispatcher.registerTemplate(
    template({
      templateId: "delivery-template:local-audit",
      sinkKind: "local_jsonl_audit",
    }),
    new LocalJsonlOperationalAuditSink(directory),
  );
  await dispatcher.dispatchAvailable("dispatcher-owner:one");
  const text = await readFile(
    join(directory, "tradebot-operational-audit.jsonl"),
    "utf8",
  );
  const record = JSON.parse(text.trim()) as Record<string, unknown>;
  assert.equal(record.eventId, "runtime-event:1");
  assert.equal(record.exchangeWriteAllowed, false);
  assert.equal("path" in record, false);
  assert.equal("token" in record, false);
});

test("strict contracts reject target, actor and executable injection", () => {
  assert.equal(
    OperationalDeliveryTemplateSchema.safeParse({
      ...template(),
      url: "https://example.invalid/hook",
    }).success,
    false,
  );
  assert.equal(
    OperationalDispatchRequestSchema.safeParse({
      confirmation: "DISPATCH_REGISTERED_OUTBOX",
      idempotencyKey: "dispatch:one",
      actor: "attacker",
      provider: "webhook",
    }).success,
    false,
  );
  assert.equal(
    OperationalDeadLetterReplayRequestSchema.safeParse({
      confirmation: "REPLAY_REGISTERED_DELIVERY",
      idempotencyKey: "replay:one",
      reason: "retry",
      headers: { authorization: "secret" },
      code: "process.exit()",
    }).success,
    false,
  );
});

test("controlled HTTP derives actor and rejects body injection", async () => {
  const database = createDatabase();
  appendEvent(database);
  const dispatcher = new SqliteOperationalOutboxDispatcher({ database });
  dispatcher.registerTemplate(template(), new InMemoryOperationalDeliverySink());
  const handler = createOperationalOutboxHttpHandler({
    dispatcher,
    authenticate: (request) =>
      request.headers.authorization === "Bearer operator-token"
        ? { actorId: "operator:server-derived", roles: ["operator"] }
        : null,
  });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const unauthenticated = await fetch(
      `${origin}/api/orchestration/operational-outbox`,
    );
    assert.equal(unauthenticated.status, 401);
    const injected = await fetch(
      `${origin}/api/orchestration/operational-outbox/dispatch`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer operator-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          confirmation: "DISPATCH_REGISTERED_OUTBOX",
          idempotencyKey: "dispatch:one",
          actor: "attacker",
          url: "https://example.invalid",
        }),
      },
    );
    assert.equal(injected.status, 422);
    const valid = await fetch(
      `${origin}/api/orchestration/operational-outbox/dispatch`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer operator-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          confirmation: "DISPATCH_REGISTERED_OUTBOX",
          idempotencyKey: "dispatch:two",
        }),
      },
    );
    assert.equal(valid.status, 200);
    const stateResponse = await fetch(
      `${origin}/api/orchestration/operational-outbox`,
      { headers: { authorization: "Bearer operator-token" } },
    );
    const payload = (await stateResponse.json()) as {
      state: { networkRequestCount: number };
      externalChannels: Record<string, string>;
    };
    assert.equal(payload.state.networkRequestCount, 0);
    assert.deepEqual(payload.externalChannels, {
      slack: "not_configured",
      email: "not_configured",
      webhook: "not_configured",
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
