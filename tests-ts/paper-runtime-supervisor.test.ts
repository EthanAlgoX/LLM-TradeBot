import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  PaperRuntimeIncidentAcknowledgeRequestSchema,
  PaperRuntimeOrphanClearanceRequestSchema,
  type ApprovedPaperPlan,
  type OrchestrationActor,
  type PaperActivationRecord,
  type PaperRuntimeRun,
  type RuntimeSafetyState,
} from "../packages/contracts/src/index.js";
import type { ApprovedPaperPlanService } from "../packages/core/src/approved-paper-plan-service.js";
import type { TradingApplication } from "../packages/core/src/trading-application.js";
import {
  PaperRuntimeActivationError,
  PaperRuntimeActivationService,
  PaperRuntimeBindingRegistry,
  PaperRuntimeSupervisorError,
  PaperRuntimeSupervisorService,
  SqlitePaperRuntimeOperationsRepository,
  SqlitePaperRuntimeRunRepository,
  SqlitePaperRuntimeSupervisorRepository,
  createCurrentPipelineOrchestrationRuntime,
  type PaperRuntimeOperationalEventSink,
  type RegisteredPaperRuntimeBinding,
} from "../packages/runtime/src/index.js";

const operator: OrchestrationActor = {
  actorId: "operator:supervisor",
  displayName: "Runtime Supervisor",
  roles: ["operator"],
};

const viewer: OrchestrationActor = {
  actorId: "viewer:supervisor",
  displayName: "Runtime Viewer",
  roles: [],
};

const plan = {
  schemaVersion: "1.0.0",
  planId: "paper-plan:supervisor",
  planVersion: "supervisor-v1",
  fingerprint: `sha256:${"2".repeat(64)}`,
  lifecycleStatus: "approved_ready",
  draftId: "draft:supervisor",
  graphId: "pipeline:current-crypto",
  graphVersion: "1.0.0",
  graphFingerprint: "graph-fingerprint-supervisor",
  marketPackRefs: ["market-pack:crypto:v1"],
  dataSourceRef: "data-source:binance-futures-public",
  strategyProfileRef: "profile:supervisor:v1",
  dataFingerprint: "data-fingerprint-supervisor",
  paperAccountRef: "paper-account:supervisor",
  candidateSymbols: ["BTCUSDT"],
  riskPolicyRefs: ["risk-policy:supervisor"],
  approvalId: "approval:supervisor",
  approvedByActorId: "approver:supervisor",
  evidence: {
    backtest: {
      kind: "backtest",
      evidenceId: "evidence:supervisor:backtest",
      jobId: "job:supervisor:backtest",
      artifactId: "artifact:supervisor:backtest",
      artifactRef: "artifact-ref:supervisor:backtest",
      artifactSha256: "a".repeat(64),
      manifestSha256: "b".repeat(64),
      resultSha256: "c".repeat(64),
    },
    walkForward: {
      kind: "walk_forward",
      evidenceId: "evidence:supervisor:walk-forward",
      jobId: "job:supervisor:walk-forward",
      artifactId: "artifact:supervisor:walk-forward",
      artifactRef: "artifact-ref:supervisor:walk-forward",
      artifactSha256: "d".repeat(64),
      manifestSha256: "e".repeat(64),
      resultSha256: "f".repeat(64),
    },
  },
  compiledStepCount: 12,
  createdAt: "2026-07-26T05:00:00.000Z",
  createdBy: "tradebot-server",
  runtimeApplied: false,
} as unknown as ApprovedPaperPlan;

const activation = {
  schemaVersion: "1.0.0",
  activationId: "paper-activation:supervisor",
  planId: plan.planId,
  planFingerprint: plan.fingerprint,
  draftId: plan.draftId,
  graphFingerprint: plan.graphFingerprint,
  actorId: "approver:supervisor",
  actorDisplayName: "Supervisor Approver",
  status: "activated_not_applied",
  activatedAt: "2026-07-26T05:01:00.000Z",
  runtimeApplied: false,
} as PaperActivationRecord;

function planService(): ApprovedPaperPlanService {
  return {
    assertReadyForRuntime(requestedPlanId: string) {
      assert.equal(requestedPlanId, plan.planId);
      return { plan, activation };
    },
    findCurrentControl() {
      return undefined;
    },
  } as unknown as ApprovedPaperPlanService;
}

function application(onCycle: () => void = () => undefined): TradingApplication {
  return {
    async runCycle() {
      onCycle();
      return {
        status: "ok",
        decisions: [],
        riskDecisions: [],
        executions: [],
      };
    },
  } as unknown as TradingApplication;
}

function safetyState(now: Date): RuntimeSafetyState {
  return {
    consecutiveFailures: 0,
    updatedAt: now,
  } as RuntimeSafetyState;
}

function binding(
  runtimeApplication: TradingApplication,
  now: () => Date,
  onCreate: () => void = () => undefined,
): RegisteredPaperRuntimeBinding {
  return {
    bindingId: "paper-runtime-binding:supervisor",
    paperAccountRef: plan.paperAccountRef,
    strategyProfileRef: plan.strategyProfileRef,
    riskPolicyRefs: [...plan.riskPolicyRefs],
    candidateSymbols: [...plan.candidateSymbols],
    maxCycles: 1,
    intervalMs: 0,
    exchangeWriteAllowed: false,
    async createRuntime() {
      onCreate();
      return {
        application: runtimeApplication,
        safety: {
          async beforeCycle() {
            return { allowed: true, state: safetyState(now()) };
          },
          async recordSuccess() {
            return safetyState(now());
          },
          async recordFailure() {
            return safetyState(now());
          },
        },
        close() {},
      };
    },
  };
}

function runRecord(
  runId: string,
  status: PaperRuntimeRun["status"],
  lease?: {
    ownerId: string;
    fencingToken: number;
    heartbeatAt: string;
  },
): PaperRuntimeRun {
  return {
    schemaVersion: "1.0.0",
    runId,
    planId: plan.planId,
    planFingerprint: plan.fingerprint,
    activationId: activation.activationId,
    bindingId: "paper-runtime-binding:supervisor",
    paperAccountRef: plan.paperAccountRef,
    strategyProfileRef: plan.strategyProfileRef,
    candidateSymbols: [...plan.candidateSymbols],
    requestedByActorId: operator.actorId,
    status,
    plannedCycles: 1,
    processedCycles: 0,
    intervalMs: 0,
    lastControlMode: "normal",
    lastControlApplied: false,
    requestedAt: "2026-07-26T05:00:00.000Z",
    ...(lease
      ? {
          leaseOwnerId: lease.ownerId,
          leaseFencingToken: lease.fencingToken,
          heartbeatAt: lease.heartbeatAt,
        }
      : {}),
    ...(status === "orphaned" || status === "completed"
      ? { finishedAt: "2026-07-26T05:02:00.000Z" }
      : {}),
    paperRuntimeApplied: false,
    exchangeWriteAllowed: false,
    clientRuntimeParametersAccepted: false,
  };
}

async function waitFor(
  predicate: () => boolean,
  label: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

test("operational events are ordered, bounded, immutable, and reject sensitive fields", () => {
  const database = new DatabaseSync(":memory:");
  const repository = new SqlitePaperRuntimeSupervisorRepository(database);
  const occurredAt = new Date("2026-07-26T06:00:00.000Z");
  for (const eventType of [
    "run_queued",
    "run_started",
    "run_failed",
  ] as const) {
    repository.appendOperationalEvent({
      runId: "run:event-order",
      planId: plan.planId,
      eventType,
      occurredAt,
      fields: { errorCode: eventType === "run_failed" ? "TEST_FAILURE" : "" },
    });
  }
  repository.appendOperationalEvent({
    runId: "run:event-order",
    planId: plan.planId,
    eventType: "run_failed",
    occurredAt,
    fields: { errorCode: "TEST_FAILURE_AGAIN" },
  });

  const firstPage = repository.listEvents("run:event-order", 0, 2);
  assert.deepEqual(
    firstPage.events.map((event) => event.sequence),
    [1, 2],
  );
  assert.equal(firstPage.nextAfterSequence, 2);
  const secondPage = repository.listEvents(
    "run:event-order",
    firstPage.nextAfterSequence,
    2,
  );
  assert.deepEqual(
    secondPage.events.map((event) => event.sequence),
    [3, 4],
  );
  assert.equal(secondPage.nextAfterSequence, undefined);
  assert.equal(
    firstPage.events.every(
      (event) =>
        event.outboxStatus === "pending" &&
        event.deliveryConfigured === false &&
        event.exchangeWriteAllowed === false,
    ),
    true,
  );
  const incidents = repository.listIncidents("run:event-order");
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0]?.incidentType, "runtime_failure");
  assert.equal(incidents[0]?.lastEventId, secondPage.events[1]?.eventId);
  assert.throws(() =>
    repository.appendOperationalEvent({
      runId: "run:sensitive",
      planId: plan.planId,
      eventType: "run_queued",
      occurredAt,
      fields: { token: "must-not-persist" },
    }),
  );
  assert.throws(() => repository.listEvents("run:event-order", 0, 101));
  database.close();
});

test("incident acknowledgement is authenticated, strict, and idempotent", () => {
  const database = new DatabaseSync(":memory:");
  const operations = new SqlitePaperRuntimeOperationsRepository(database);
  const runs = new SqlitePaperRuntimeRunRepository(database);
  const repository = new SqlitePaperRuntimeSupervisorRepository(database);
  const service = new PaperRuntimeSupervisorService(
    repository,
    runs,
    operations,
    () => new Date("2026-07-26T06:30:00.000Z"),
  );
  const run = runRecord("run:incident-ack", "completed");
  runs.createRun(run, operator.actorId, "incident-ack-run");
  repository.appendOperationalEvent({
    runId: run.runId,
    planId: run.planId,
    eventType: "run_failed",
    occurredAt: new Date("2026-07-26T06:20:00.000Z"),
  });
  const incident = repository.listIncidents(run.runId)[0]!;
  const request = {
    schemaVersion: "1.0.0",
    idempotencyKey: "ack-idempotency",
    confirmation: "acknowledge_paper_runtime_incident",
    note: "reviewed by operator",
  };
  assert.throws(
    () => service.acknowledge(incident.incidentId, request, viewer),
    (error) =>
      error instanceof PaperRuntimeSupervisorError &&
      error.code === "PAPER_RUNTIME_SUPERVISOR_ACTOR_ROLE_REQUIRED",
  );
  const first = service.acknowledge(incident.incidentId, request, operator);
  const replay = service.acknowledge(incident.incidentId, request, operator);
  assert.equal(replay.acknowledgementId, first.acknowledgementId);
  assert.equal(
    repository.getIncident(incident.incidentId).status,
    "acknowledged",
  );
  assert.equal(first.runtimeMutationAllowed, false);
  assert.equal(first.exchangeWriteAllowed, false);
  database.close();
});

test("orphan clearance requires terminal run and lease and never resumes execution", () => {
  const database = new DatabaseSync(":memory:");
  const operations = new SqlitePaperRuntimeOperationsRepository(database);
  const runs = new SqlitePaperRuntimeRunRepository(database);
  const repository = new SqlitePaperRuntimeSupervisorRepository(database);
  const service = new PaperRuntimeSupervisorService(
    repository,
    runs,
    operations,
    () => new Date("2026-07-26T07:00:00.000Z"),
  );
  const activeLease = operations.acquireLease(
    "run:orphan-clearance",
    plan.planId,
    "owner:orphan",
    new Date("2026-07-26T06:50:00.000Z"),
    30_000,
  );
  const orphan = runRecord(activeLease.runId, "orphaned", activeLease);
  runs.createRun(orphan, operator.actorId, "orphan-run");
  repository.appendOperationalEvent({
    runId: orphan.runId,
    planId: orphan.planId,
    eventType: "run_orphaned",
    occurredAt: new Date("2026-07-26T06:55:00.000Z"),
  });
  const request = {
    schemaVersion: "1.0.0",
    idempotencyKey: "orphan-clearance",
    confirmation: "clear_terminal_orphan_incident",
    reason: "lease reviewed and process confirmed stopped",
  };
  assert.throws(
    () => service.clearOrphan(orphan.runId, request, operator),
    (error) =>
      error instanceof PaperRuntimeSupervisorError &&
      error.code === "PAPER_RUNTIME_ORPHAN_LEASE_NOT_TERMINAL",
  );
  operations.releaseLease(
    activeLease.runId,
    activeLease.ownerId,
    activeLease.fencingToken,
    "orphaned",
    new Date("2026-07-26T06:56:00.000Z"),
  );
  const clearance = service.clearOrphan(orphan.runId, request, operator);
  assert.equal(clearance.runStatusAfter, "orphaned");
  assert.equal(clearance.runtimeResumed, false);
  assert.equal(clearance.executionTriggered, false);
  assert.equal(clearance.paperAccountMutated, false);
  assert.equal(runs.getRun(orphan.runId).status, "orphaned");
  assert.equal(runs.getCycles(orphan.runId).length, 0);
  assert.equal(service.getClearance(orphan.runId).clearanceId, clearance.clearanceId);
  assert.equal(
    repository.listIncidents(orphan.runId)[0]?.status,
    "cleared",
  );
  assert.equal(
    repository.listEvents(orphan.runId).events.at(-1)?.eventType,
    "orphan_cleared",
  );

  const completed = runRecord("run:not-orphaned", "completed");
  runs.createRun(completed, operator.actorId, "completed-run");
  assert.throws(
    () =>
      service.clearOrphan(
        completed.runId,
        { ...request, idempotencyKey: "not-orphaned-clearance" },
        operator,
      ),
    (error) =>
      error instanceof PaperRuntimeSupervisorError &&
      error.code === "PAPER_RUNTIME_ORPHAN_CLEARANCE_NOT_ALLOWED",
  );
  database.close();
});

test("activation writes a durable ordered event lifecycle", async () => {
  const database = new DatabaseSync(":memory:");
  const operations = new SqlitePaperRuntimeOperationsRepository(database);
  const runs = new SqlitePaperRuntimeRunRepository(database);
  const supervisor = new SqlitePaperRuntimeSupervisorRepository(database);
  const now = new Date("2026-07-26T08:00:00.000Z");
  let cycles = 0;
  const registered = binding(application(() => (cycles += 1)), () => now);
  const activationService = new PaperRuntimeActivationService(
    planService(),
    new PaperRuntimeBindingRegistry([registered]),
    runs,
    operations,
    {
      ownerId: "owner:event-lifecycle",
      leaseTtlMs: 5_000,
      now: () => now,
      supervisor,
    },
  );
  const queued = activationService.startRun(
    plan.planId,
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "event-lifecycle-run",
      confirmation: "start_bounded_paper_run",
    },
    operator,
  );
  await waitFor(
    () => activationService.getRun(queued.runId).status === "completed",
    "completed supervised run",
  );
  const events = supervisor.listEvents(queued.runId, 0, 50).events;
  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      "lease_acquired",
      "run_queued",
      "run_started",
      "lease_heartbeat",
      "lease_heartbeat",
      "cycle_completed",
      "run_completed",
      "runtime_resources_closed",
    ],
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(cycles, 1);
  database.close();
});

test("operational journal failure blocks Runtime creation and client injection contracts are strict", () => {
  assert.equal(
    PaperRuntimeIncidentAcknowledgeRequestSchema.safeParse({
      schemaVersion: "1.0.0",
      idempotencyKey: "ack-injection",
      confirmation: "acknowledge_paper_runtime_incident",
      actorId: "attacker",
      provider: "arbitrary",
    }).success,
    false,
  );
  assert.equal(
    PaperRuntimeOrphanClearanceRequestSchema.safeParse({
      schemaVersion: "1.0.0",
      idempotencyKey: "clearance-injection",
      confirmation: "clear_terminal_orphan_incident",
      reason: "attempt",
      symbols: ["ETHUSDT"],
      cycles: 99,
      databasePath: "/tmp/attacker.db",
      sourceCode: "execute()",
    }).success,
    false,
  );

  const database = new DatabaseSync(":memory:");
  const operations = new SqlitePaperRuntimeOperationsRepository(database);
  const runs = new SqlitePaperRuntimeRunRepository(database);
  let runtimeCreated = 0;
  const now = new Date("2026-07-26T09:00:00.000Z");
  const failingSink: PaperRuntimeOperationalEventSink = {
    appendOperationalEvent() {
      throw new PaperRuntimeSupervisorError(
        "PAPER_RUNTIME_SUPERVISOR_PERSISTENCE_FAILED",
        "Injected persistence failure.",
      );
    },
  };
  const activationService = new PaperRuntimeActivationService(
    planService(),
    new PaperRuntimeBindingRegistry([
      binding(application(), () => now, () => (runtimeCreated += 1)),
    ]),
    runs,
    operations,
    {
      ownerId: "owner:failing-outbox",
      leaseTtlMs: 5_000,
      now: () => now,
      supervisor: failingSink,
    },
  );
  assert.throws(
    () =>
      activationService.startRun(
        plan.planId,
        {
          schemaVersion: "1.0.0",
          idempotencyKey: "failing-outbox-run",
          confirmation: "start_bounded_paper_run",
        },
        operator,
      ),
    (error) =>
      error instanceof PaperRuntimeActivationError &&
      error.code === "PAPER_RUNTIME_SUPERVISOR_FAILED",
  );
  assert.equal(runtimeCreated, 0);
  assert.equal(
    runs.findByIdempotency(operator.actorId, "failing-outbox-run")?.status,
    "failed",
  );
  assert.equal(
    operations.getLease(
      runs.findByIdempotency(operator.actorId, "failing-outbox-run")!.runId,
    ).status,
    "released",
  );
  database.close();
});

test("supervisor HTTP derives actor from bearer auth and rejects injected control fields", async () => {
  const runtime = createCurrentPipelineOrchestrationRuntime({
    databasePath: ":memory:",
    operatorToken: "supervisor-http-token",
    operatorActor: operator,
  });
  try {
    const run = runRecord("run:supervisor-http", "completed");
    runtime.paperRuntimeRunRepository.createRun(
      run,
      operator.actorId,
      "supervisor-http-run",
    );
    runtime.paperRuntimeSupervisorRepository.appendOperationalEvent({
      runId: run.runId,
      planId: run.planId,
      eventType: "run_failed",
      occurredAt: new Date("2026-07-26T10:00:00.000Z"),
    });
    const incident =
      runtime.paperRuntimeSupervisorRepository.listIncidents(run.runId)[0]!;
    await new Promise<void>((resolve) => {
      runtime.server.listen(0, "127.0.0.1", resolve);
    });
    const address = runtime.server.address();
    assert.equal(typeof address, "object");
    const base = `http://127.0.0.1:${(address as { port: number }).port}`;
    const endpoint = `${base}/api/orchestration/paper-incidents/${encodeURIComponent(
      incident.incidentId,
    )}/acknowledgement`;

    const unauthenticated = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: "1.0.0",
        idempotencyKey: "supervisor-http-unauthenticated",
        confirmation: "acknowledge_paper_runtime_incident",
      }),
    });
    assert.equal(unauthenticated.status, 401);

    const injected = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer supervisor-http-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        schemaVersion: "1.0.0",
        idempotencyKey: "supervisor-http-injected",
        confirmation: "acknowledge_paper_runtime_incident",
        actorId: "attacker",
        symbols: ["ETHUSDT"],
      }),
    });
    assert.equal(injected.status, 422);

    const accepted = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer supervisor-http-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        schemaVersion: "1.0.0",
        idempotencyKey: "supervisor-http-accepted",
        confirmation: "acknowledge_paper_runtime_incident",
        note: "authenticated operator review",
      }),
    });
    assert.equal(accepted.status, 201);
    const body = (await accepted.json()) as {
      data: { actorId: string; exchangeWriteAllowed: false };
    };
    assert.equal(body.data.actorId, operator.actorId);
    assert.equal(body.data.exchangeWriteAllowed, false);
  } finally {
    await runtime.close();
  }
});
