import assert from "node:assert/strict";
import test from "node:test";
import {
  createRuntimeDashboardSnapshot,
  createRuntimeOperationKeys,
  partitionRuntimeRun,
  rotateRuntimeOperationKey,
} from "../apps/web/src/runtime-operation-session.js";

test("successful operations rotate only their own idempotency key", () => {
  let sequence = 0;
  const createKey = (): string => `key-${sequence += 1}`;
  const initial = createRuntimeOperationKeys(createKey);
  const next = rotateRuntimeOperationKey(initial, "run", createKey);

  assert.notEqual(next.run, initial.run);
  assert.equal(next.preflight, initial.preflight);
  assert.equal(next.stop, initial.stop);
  assert.equal(initial.run, "key-4");
  assert.equal(next.run, "key-9");
});

test("terminal runs are separated before a second active run is accepted", () => {
  const completed = {
    runId: "run-1",
    status: "completed" as const,
    plannedCycles: 6,
    processedCycles: 6,
  };
  const second = {
    runId: "run-2",
    status: "running" as const,
    plannedCycles: 6,
    processedCycles: 1,
  };

  assert.equal(partitionRuntimeRun(completed).activeRun, undefined);
  assert.equal(partitionRuntimeRun(completed).terminalRun?.runId, "run-1");
  assert.equal(partitionRuntimeRun(second).activeRun?.runId, "run-2");
});

test("dashboard recovery never exposes a terminal run as active", () => {
  const stopped = createRuntimeDashboardSnapshot({
    connectionMode: "live",
    uiState: "ready",
    canPause: false,
    canResume: false,
    canStop: false,
    run: {
      runId: "run-completed",
      status: "completed",
      plannedCycles: 6,
      processedCycles: 6,
    },
    heartbeatAt: "2026-07-26T10:00:00.000Z",
    events: [
      {
        eventType: "paper_run_completed",
        occurredAt: "2026-07-26T10:00:01.000Z",
      },
    ],
  });

  assert.equal(stopped.activeRun, false);
  assert.equal(stopped.runId, undefined);
  assert.equal(stopped.heartbeatAt, undefined);
  assert.equal(stopped.latestEvent?.eventType, "paper_run_completed");
});
