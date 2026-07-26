import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  PaperRuntimePreflightReportSchema,
  PaperRuntimeStopRequestSchema,
  type ApprovedPaperPlan,
  type OrchestrationActor,
  type PaperActivationRecord,
  type PaperRuntimePreflightCheck,
  type PaperRuntimeRun,
  type RuntimeSafetyState,
} from "../packages/contracts/src/index.js";
import type { ApprovedPaperPlanService } from "../packages/core/src/approved-paper-plan-service.js";
import type { TradingApplication } from "../packages/core/src/trading-application.js";
import {
  PaperRuntimeActivationError,
  PaperRuntimeActivationService,
  PaperRuntimeBindingRegistry,
  SqlitePaperRuntimeOperationsRepository,
  SqlitePaperRuntimeRunRepository,
  type RegisteredPaperRuntimeBinding,
} from "../packages/runtime/src/index.js";

const actor: OrchestrationActor = {
  actorId: "operator:runtime-operations",
  displayName: "Runtime Operations",
  roles: ["operator"],
};

const plan = {
  schemaVersion: "1.0.0",
  planId: "paper-plan:operations",
  planVersion: "operations-v1",
  fingerprint: `sha256:${"1".repeat(64)}`,
  lifecycleStatus: "approved_ready",
  draftId: "draft:operations",
  graphId: "pipeline:current-crypto",
  graphVersion: "1.0.0",
  graphFingerprint: "graph-fingerprint",
  marketPackRefs: ["market-pack:crypto:v1"],
  dataSourceRef: "data-source:binance-futures-public",
  strategyProfileRef: "profile:operations:v1",
  dataFingerprint: "data-fingerprint",
  paperAccountRef: "paper-account:operations",
  candidateSymbols: ["BTCUSDT"],
  riskPolicyRefs: ["risk-policy:operations"],
  approvalId: "approval:operations",
  approvedByActorId: "approver:operations",
  evidence: {
    backtest: {
      kind: "backtest",
      evidenceId: "evidence:backtest",
      jobId: "job:backtest",
      artifactId: "artifact:backtest",
      artifactRef: "artifact-ref:backtest",
      artifactSha256: "a".repeat(64),
      manifestSha256: "b".repeat(64),
      resultSha256: "c".repeat(64),
    },
    walkForward: {
      kind: "walk_forward",
      evidenceId: "evidence:walk-forward",
      jobId: "job:walk-forward",
      artifactId: "artifact:walk-forward",
      artifactRef: "artifact-ref:walk-forward",
      artifactSha256: "d".repeat(64),
      manifestSha256: "e".repeat(64),
      resultSha256: "f".repeat(64),
    },
  },
  compiledStepCount: 12,
  createdAt: "2026-07-26T00:00:00.000Z",
  createdBy: "tradebot-server",
  runtimeApplied: false,
} as unknown as ApprovedPaperPlan;

const activation = {
  schemaVersion: "1.0.0",
  activationId: "paper-activation:operations",
  planId: plan.planId,
  planFingerprint: plan.fingerprint,
  draftId: plan.draftId,
  graphFingerprint: plan.graphFingerprint,
  actorId: "approver:operations",
  actorDisplayName: "Approver",
  status: "activated_not_applied",
  activatedAt: "2026-07-26T00:01:00.000Z",
  runtimeApplied: false,
} as PaperActivationRecord;

function safetyState(now: Date): RuntimeSafetyState {
  return {
    consecutiveFailures: 0,
    updatedAt: now,
  } as RuntimeSafetyState;
}

function passedCheck(
  now: Date,
  checkId = "binding:ready",
): PaperRuntimePreflightCheck {
  return {
    checkId,
    component: "binding",
    status: "passed",
    code: "PREFLIGHT_BINDING_READY",
    checkedAt: now.toISOString(),
    latencyMs: 0,
    fields: {},
  };
}

function paperPlanStub(controlMode?: "pause_new_openings_close_only") {
  return {
    assertReadyForRuntime(requestedPlanId: string) {
      assert.equal(requestedPlanId, plan.planId);
      return { plan, activation };
    },
    findCurrentControl() {
      return controlMode
        ? {
            controlId: "control:close-only",
            mode: controlMode,
          }
        : undefined;
    },
  } as unknown as ApprovedPaperPlanService;
}

function binding(
  application: TradingApplication,
  now: () => Date,
  preflightStatus: "passed" | "failed" = "passed",
): RegisteredPaperRuntimeBinding {
  return {
    bindingId: "paper-runtime-binding:operations",
    bindingFingerprint: "binding-fingerprint-operations",
    preflightRequired: true,
    paperAccountRef: plan.paperAccountRef,
    strategyProfileRef: plan.strategyProfileRef,
    riskPolicyRefs: [...plan.riskPolicyRefs],
    candidateSymbols: [...plan.candidateSymbols],
    maxCycles: 3,
    intervalMs: 0,
    exchangeWriteAllowed: false,
    async preflight() {
      return {
        checks: [
          {
            ...passedCheck(now()),
            status: preflightStatus,
            code:
              preflightStatus === "passed"
                ? "PREFLIGHT_BINDING_READY"
                : "PREFLIGHT_MARKET_BARS_MISSING",
            component:
              preflightStatus === "passed" ? "binding" : "market_bars",
          },
        ],
      };
    },
    async createRuntime() {
      return {
        application,
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
      };
    },
  };
}

function inertApplication(): TradingApplication {
  return {
    async runCycle() {
      return {
        status: "ok",
        decisions: [],
        riskDecisions: [],
        executions: [],
      };
    },
  } as unknown as TradingApplication;
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

function runRecord(
  runId: string,
  lease: {
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
    bindingId: "paper-runtime-binding:operations",
    paperAccountRef: plan.paperAccountRef,
    strategyProfileRef: plan.strategyProfileRef,
    candidateSymbols: [...plan.candidateSymbols],
    requestedByActorId: actor.actorId,
    status: "running",
    plannedCycles: 3,
    processedCycles: 0,
    intervalMs: 0,
    lastControlMode: "normal",
    lastControlApplied: false,
    requestedAt: "2026-07-26T00:00:00.000Z",
    startedAt: "2026-07-26T00:00:00.000Z",
    leaseOwnerId: lease.ownerId,
    leaseFencingToken: lease.fencingToken,
    heartbeatAt: lease.heartbeatAt,
    paperRuntimeApplied: false,
    exchangeWriteAllowed: false,
    clientRuntimeParametersAccepted: false,
  };
}

test("strict preflight and stop contracts reject runtime parameter and actor injection", () => {
  assert.equal(
    PaperRuntimeStopRequestSchema.safeParse({
      schemaVersion: "1.0.0",
      idempotencyKey: "stop-key",
      confirmation: "stop_after_current_paper_cycle",
      reason: "operator request",
      actorId: "attacker",
      symbols: ["ETHUSDT"],
      cycles: 999,
    }).success,
    false,
  );
  assert.equal(
    PaperRuntimeStopRequestSchema.safeParse({
      schemaVersion: "1.0.0",
      idempotencyKey: "stop-key",
      confirmation: "stop_after_current_paper_cycle",
      reason: "operator request",
    }).success,
    true,
  );
});

test("SQLite lease heartbeat is fenced and a second owner cannot overlap", () => {
  const database = new DatabaseSync(":memory:");
  const operations = new SqlitePaperRuntimeOperationsRepository(database);
  const acquiredAt = new Date("2026-07-26T00:00:00.000Z");
  const first = operations.acquireLease(
    "run:first",
    plan.planId,
    "owner:first",
    acquiredAt,
    1_000,
  );
  assert.equal(first.fencingToken, 1);
  assert.throws(
    () =>
      operations.acquireLease(
        "run:second",
        plan.planId,
        "owner:second",
        new Date(acquiredAt.getTime() + 500),
        1_000,
      ),
    (error) =>
      error instanceof PaperRuntimeActivationError &&
      error.code === "PAPER_RUNTIME_LEASE_CONFLICT",
  );
  const heartbeat = operations.heartbeatLease(
    first.runId,
    first.ownerId,
    first.fencingToken,
    new Date(acquiredAt.getTime() + 500),
    1_000,
  );
  assert.equal(heartbeat.heartbeatAt, "2026-07-26T00:00:00.500Z");
  assert.throws(
    () =>
      operations.heartbeatLease(
        first.runId,
        "owner:second",
        first.fencingToken,
        new Date(acquiredAt.getTime() + 600),
        1_000,
      ),
    (error) =>
      error instanceof PaperRuntimeActivationError &&
      error.code === "PAPER_RUNTIME_LEASE_LOST",
  );
  const second = operations.acquireLease(
    "run:second",
    plan.planId,
    "owner:second",
    new Date(acquiredAt.getTime() + 2_000),
    1_000,
  );
  assert.equal(second.fencingToken, 2);
  assert.equal(operations.getLease(first.runId).status, "orphaned");
  database.close();
});

test("preflight is read-only, gates start, heartbeats, and drains after the current close-only cycle", async () => {
  const database = new DatabaseSync(":memory:");
  const operations = new SqlitePaperRuntimeOperationsRepository(database);
  const runs = new SqlitePaperRuntimeRunRepository(database);
  let now = new Date("2026-07-26T01:00:00.000Z");
  let executions = 0;
  let observedExecutionMode: string | undefined;
  let releaseCycle!: () => void;
  const cycleGate = new Promise<void>((resolve) => {
    releaseCycle = resolve;
  });
  let cycleStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    cycleStarted = resolve;
  });
  const application = {
    async runCycle(request: { executionMode?: string }) {
      executions += 1;
      observedExecutionMode = request.executionMode;
      cycleStarted();
      await cycleGate;
      return {
        status: "ok",
        decisions: [],
        riskDecisions: [],
        executions: [],
      };
    },
  } as unknown as TradingApplication;
  const registered = binding(application, () => now);
  const service = new PaperRuntimeActivationService(
    paperPlanStub("pause_new_openings_close_only"),
    new PaperRuntimeBindingRegistry([registered]),
    runs,
    operations,
    {
      ownerId: "owner:drain",
      leaseTtlMs: 5_000,
      preflightTtlMs: 60_000,
      now: () => now,
    },
  );

  assert.throws(
    () =>
      service.startRun(
        plan.planId,
        {
          schemaVersion: "1.0.0",
          idempotencyKey: "run-before-preflight",
          confirmation: "start_bounded_paper_run",
        },
        actor,
      ),
    (error) =>
      error instanceof PaperRuntimeActivationError &&
      error.code === "PAPER_RUNTIME_PREFLIGHT_REQUIRED",
  );

  const preflight = await service.runPreflight(
    plan.planId,
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "preflight-read-only",
      confirmation: "run_paper_runtime_preflight",
    },
    actor,
  );
  assert.equal(preflight.status, "passed");
  assert.equal(preflight.paperAccountMutationAllowed, false);
  assert.equal(preflight.exchangeWriteAllowed, false);
  assert.equal(executions, 0);

  const queued = service.startRun(
    plan.planId,
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "run-after-preflight",
      confirmation: "start_bounded_paper_run",
    },
    actor,
  );
  await started;
  now = new Date(now.getTime() + 100);
  const stop = service.requestStop(
    queued.runId,
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "stop-after-current",
      confirmation: "stop_after_current_paper_cycle",
      reason: "integration test drain",
    },
    actor,
  );
  assert.equal(stop.currentCycleMayComplete, true);
  assert.equal(service.getRun(queued.runId).status, "stop_requested");
  releaseCycle();
  await waitFor(
    () => service.getRun(queued.runId).status === "drained",
    "drained run",
  );

  const drained = service.getRun(queued.runId);
  assert.equal(drained.processedCycles, 1);
  assert.equal(executions, 1);
  assert.equal(observedExecutionMode, "close_only");
  assert.equal(service.getCycles(queued.runId).length, 1);
  assert.equal(service.getStop(queued.runId).status, "drained");
  assert.equal(service.getLease(queued.runId).status, "released");
  assert.equal(drained.exchangeWriteAllowed, false);
  database.close();
});

test("failed, expired, and fingerprint-mismatched preflights fail closed", async () => {
  const database = new DatabaseSync(":memory:");
  const operations = new SqlitePaperRuntimeOperationsRepository(database);
  const runs = new SqlitePaperRuntimeRunRepository(database);
  let now = new Date("2026-07-26T02:00:00.000Z");
  const failedBinding = binding(inertApplication(), () => now, "failed");
  const failedService = new PaperRuntimeActivationService(
    paperPlanStub(),
    new PaperRuntimeBindingRegistry([failedBinding]),
    runs,
    operations,
    {
      ownerId: "owner:preflight-fail",
      leaseTtlMs: 5_000,
      preflightTtlMs: 1_000,
      now: () => now,
    },
  );
  const failed = await failedService.runPreflight(
    plan.planId,
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "failed-preflight",
      confirmation: "run_paper_runtime_preflight",
    },
    actor,
  );
  assert.equal(failed.status, "failed");
  assert.throws(
    () =>
      failedService.startRun(
        plan.planId,
        {
          schemaVersion: "1.0.0",
          idempotencyKey: "failed-preflight-run",
          confirmation: "start_bounded_paper_run",
        },
        actor,
      ),
    (error) =>
      error instanceof PaperRuntimeActivationError &&
      error.code === "PAPER_RUNTIME_PREFLIGHT_FAILED",
  );

  now = new Date(now.getTime() + 1);
  const passingBinding = binding(inertApplication(), () => now);
  const passingService = new PaperRuntimeActivationService(
    paperPlanStub(),
    new PaperRuntimeBindingRegistry([passingBinding]),
    runs,
    operations,
    {
      ownerId: "owner:preflight-pass",
      leaseTtlMs: 5_000,
      preflightTtlMs: 1_000,
      now: () => now,
    },
  );
  await passingService.runPreflight(
    plan.planId,
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "passing-preflight",
      confirmation: "run_paper_runtime_preflight",
    },
    actor,
  );
  now = new Date(now.getTime() + 1_001);
  assert.throws(
    () =>
      passingService.startRun(
        plan.planId,
        {
          schemaVersion: "1.0.0",
          idempotencyKey: "expired-preflight-run",
          confirmation: "start_bounded_paper_run",
        },
        actor,
      ),
    (error) =>
      error instanceof PaperRuntimeActivationError &&
      error.code === "PAPER_RUNTIME_PREFLIGHT_EXPIRED",
  );

  const mismatched = PaperRuntimePreflightReportSchema.parse({
    schemaVersion: "1.0.0",
    reportId: "paper-runtime-preflight:mismatched",
    fingerprint: "mismatched-report-fingerprint",
    planId: plan.planId,
    planFingerprint: plan.fingerprint,
    activationId: activation.activationId,
    bindingId: passingBinding.bindingId,
    bindingFingerprint: "binding-fingerprint-replaced",
    status: "passed",
    checks: [passedCheck(now, "binding:replaced")],
    requestedByActorId: actor.actorId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10_000).toISOString(),
    paperAccountMutationAllowed: false,
    exchangeWriteAllowed: false,
  });
  operations.savePreflight(mismatched, actor.actorId, "mismatch-preflight");
  assert.throws(
    () =>
      passingService.startRun(
        plan.planId,
        {
          schemaVersion: "1.0.0",
          idempotencyKey: "mismatched-preflight-run",
          confirmation: "start_bounded_paper_run",
        },
        actor,
      ),
    (error) =>
      error instanceof PaperRuntimeActivationError &&
      error.code === "PAPER_RUNTIME_PREFLIGHT_MISMATCH",
  );
  database.close();
});

test("restart marks an expired leased run orphaned instead of resuming trading", () => {
  const database = new DatabaseSync(":memory:");
  const operations = new SqlitePaperRuntimeOperationsRepository(database);
  const runs = new SqlitePaperRuntimeRunRepository(database);
  const acquiredAt = new Date("2026-07-26T03:00:00.000Z");
  const lease = operations.acquireLease(
    "run:restart-orphan",
    plan.planId,
    "owner:old-process",
    acquiredAt,
    1_000,
  );
  runs.createRun(
    runRecord(lease.runId, lease),
    actor.actorId,
    "restart-run",
  );

  const restoredRuns = new SqlitePaperRuntimeRunRepository(database);
  new PaperRuntimeActivationService(
    paperPlanStub(),
    new PaperRuntimeBindingRegistry([]),
    restoredRuns,
    operations,
    {
      ownerId: "owner:new-process",
      leaseTtlMs: 5_000,
      now: () => new Date(acquiredAt.getTime() + 2_000),
    },
  );
  const orphaned = restoredRuns.getRun(lease.runId);
  assert.equal(orphaned.status, "orphaned");
  assert.equal(orphaned.failureCode, "PAPER_RUNTIME_ORPHANED_LEASE");
  assert.equal(operations.getLease(lease.runId).status, "orphaned");
  database.close();
});
