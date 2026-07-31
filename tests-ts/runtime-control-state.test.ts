import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveRuntimeControlState,
} from "../apps/web/src/runtime-control-state.js";

test("offline and unauthenticated Runtime controls fail closed", () => {
  const offline = deriveRuntimeControlState({
    mode: "offline",
    busy: false,
    hasActivatedPlan: false,
  });
  assert.equal(offline.state, "offline");
  assert.equal(offline.canStart, false);
  assert.equal(offline.canPause, false);
  assert.equal(offline.canStop, false);

  const readonly = deriveRuntimeControlState({
    mode: "readonly",
    busy: false,
    hasActivatedPlan: true,
    preflightStatus: "passed",
  });
  assert.equal(readonly.state, "auth_required");
  assert.equal(readonly.canStart, false);
});

test("an activated Paper Plan requires preflight before start", () => {
  const pending = deriveRuntimeControlState({
    mode: "live",
    busy: false,
    hasActivatedPlan: true,
  });
  assert.equal(pending.state, "preflight");
  assert.equal(pending.canPreflight, true);
  assert.equal(pending.canStart, false);

  const ready = deriveRuntimeControlState({
    mode: "live",
    busy: false,
    hasActivatedPlan: true,
    preflightStatus: "passed",
  });
  assert.equal(ready.state, "ready");
  assert.equal(ready.canPreflight, true);
  assert.equal(ready.canStart, true);
});

test("running, close-only, and draining states expose only safe controls", () => {
  const running = deriveRuntimeControlState({
    mode: "live",
    busy: false,
    hasActivatedPlan: true,
    preflightStatus: "passed",
    runStatus: "running",
    controlMode: "normal",
  });
  assert.equal(running.state, "running");
  assert.equal(running.canPause, true);
  assert.equal(running.canResume, false);
  assert.equal(running.canStop, true);
  assert.equal(running.canStart, false);

  const closeOnly = deriveRuntimeControlState({
    mode: "live",
    busy: false,
    hasActivatedPlan: true,
    preflightStatus: "passed",
    runStatus: "running",
    controlMode: "pause_new_openings_close_only",
  });
  assert.equal(closeOnly.state, "only_close");
  assert.equal(closeOnly.canPause, false);
  assert.equal(closeOnly.canResume, true);
  assert.equal(closeOnly.canStop, true);

  const draining = deriveRuntimeControlState({
    mode: "live",
    busy: false,
    hasActivatedPlan: true,
    preflightStatus: "passed",
    runStatus: "stop_requested",
    controlMode: "pause_new_openings_close_only",
    stopStatus: "requested",
  });
  assert.equal(draining.state, "draining");
  assert.equal(draining.canPause, false);
  assert.equal(draining.canResume, false);
  assert.equal(draining.canStop, false);
});

test("persisted close-only blocks a new run until the operator resumes", () => {
  const pausedBetweenRuns = deriveRuntimeControlState({
    mode: "live",
    busy: false,
    hasActivatedPlan: true,
    preflightStatus: "passed",
    runStatus: "completed",
    controlMode: "pause_new_openings_close_only",
  });
  assert.equal(pausedBetweenRuns.state, "only_close");
  assert.equal(pausedBetweenRuns.canStart, false);
  assert.equal(pausedBetweenRuns.canResume, true);
  assert.equal(pausedBetweenRuns.canStop, false);

  const resumed = deriveRuntimeControlState({
    mode: "live",
    busy: false,
    hasActivatedPlan: true,
    preflightStatus: "passed",
    controlMode: "normal",
  });
  assert.equal(resumed.state, "ready");
  assert.equal(resumed.canStart, true);
});

test("failed preflight and fail-closed run states remain blocked", () => {
  const preflightFailure = deriveRuntimeControlState({
    mode: "live",
    busy: false,
    hasActivatedPlan: true,
    preflightStatus: "failed",
  });
  assert.equal(preflightFailure.state, "blocked");
  assert.equal(preflightFailure.canStart, false);

  for (const runStatus of ["failed", "safety_blocked", "orphaned"] as const) {
    const result = deriveRuntimeControlState({
      mode: "live",
      busy: false,
      hasActivatedPlan: true,
      preflightStatus: "passed",
      runStatus,
    });
    assert.equal(result.state, "blocked");
    assert.equal(result.canStart, false);
    assert.equal(result.canPause, false);
    assert.equal(result.canStop, false);
  }
});
