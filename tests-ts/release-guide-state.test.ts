import assert from "node:assert/strict";
import test from "node:test";
import { deriveReleaseGuideState } from "../apps/web/src/release-guide-state.js";

const base = {
  mode: "live" as const,
  busy: false,
  hasDraft: false,
  hasApproval: false,
  hasPaperPlan: false,
  hasActivation: false,
};

test("release guide fails closed while offline or unauthenticated", () => {
  const offline = deriveReleaseGuideState({
    ...base,
    mode: "offline",
  });
  assert.equal(offline.phase, "disconnected");
  assert.equal(offline.nextStepId, "draft");
  assert.equal(offline.nextAction, "retry");
  assert.equal(offline.reasonCode, "RUNTIME_API_OFFLINE");
  assert.equal(offline.steps[0]?.status, "blocked");

  const readonly = deriveReleaseGuideState({
    ...base,
    mode: "readonly",
  });
  assert.equal(readonly.nextAction, undefined);
  assert.equal(readonly.reasonCode, "OPERATOR_AUTH_REQUIRED");
});

test("release guide exposes only the next backend-controlled action", () => {
  const validation = deriveReleaseGuideState({
    ...base,
    hasDraft: true,
    promotionStage: "draft",
  });
  assert.equal(validation.nextStepId, "validation");
  assert.equal(validation.nextAction, "validate");

  const backtest = deriveReleaseGuideState({
    ...base,
    hasDraft: true,
    promotionStage: "contract_validated",
    validationValid: true,
  });
  assert.equal(backtest.nextStepId, "backtest");
  assert.equal(backtest.nextAction, "backtest");
});

test("human approval remains an explicit human-only gate", () => {
  const approval = deriveReleaseGuideState({
    ...base,
    hasDraft: true,
    promotionStage: "walk_forward_validated",
    validationValid: true,
    backtestStatus: "succeeded",
    walkForwardStatus: "succeeded",
  });
  assert.equal(approval.nextStepId, "approval");
  assert.equal(approval.nextAction, "approve");
  assert.equal(approval.requiresHumanAction, true);
});

test("plan creation and activation remain separate controlled actions", () => {
  const createPlan = deriveReleaseGuideState({
    ...base,
    hasDraft: true,
    promotionStage: "human_approved",
    hasApproval: true,
  });
  assert.equal(createPlan.nextStepId, "activation");
  assert.equal(createPlan.nextAction, "paper-plan");

  const activate = deriveReleaseGuideState({
    ...base,
    hasDraft: true,
    promotionStage: "human_approved",
    hasApproval: true,
    hasPaperPlan: true,
  });
  assert.equal(activate.nextAction, "activate-paper");
});

test("failed evidence, preflight, and Runtime states remain blocked", () => {
  const failedBacktest = deriveReleaseGuideState({
    ...base,
    hasDraft: true,
    promotionStage: "contract_validated",
    backtestStatus: "failed",
  });
  assert.equal(failedBacktest.phase, "blocked");
  assert.equal(failedBacktest.nextAction, undefined);
  assert.equal(failedBacktest.reasonCode, "BACKTEST_JOB_FAILED");

  const failedPreflight = deriveReleaseGuideState({
    ...base,
    hasDraft: true,
    promotionStage: "human_approved",
    hasApproval: true,
    hasPaperPlan: true,
    hasActivation: true,
    preflightStatus: "failed",
  });
  assert.equal(failedPreflight.nextStepId, "preflight");
  assert.equal(failedPreflight.nextAction, undefined);
  assert.equal(failedPreflight.reasonCode, "PAPER_PREFLIGHT_FAILED");

  const safetyBlocked = deriveReleaseGuideState({
    ...base,
    hasDraft: true,
    promotionStage: "human_approved",
    hasApproval: true,
    hasPaperPlan: true,
    hasActivation: true,
    preflightStatus: "passed",
    runStatus: "safety_blocked",
  });
  assert.equal(safetyBlocked.phase, "blocked");
  assert.equal(safetyBlocked.reasonCode, "PAPER_RUN_SAFETY_BLOCKED");
});

test("a passed preflight exposes Start and a created run completes the path", () => {
  const ready = deriveReleaseGuideState({
    ...base,
    hasDraft: true,
    promotionStage: "human_approved",
    hasApproval: true,
    hasPaperPlan: true,
    hasActivation: true,
    preflightStatus: "passed",
  });
  assert.equal(ready.phase, "ready");
  assert.equal(ready.nextStepId, "start");
  assert.equal(ready.nextAction, "start-paper-run");

  const running = deriveReleaseGuideState({
    ...base,
    hasDraft: true,
    promotionStage: "human_approved",
    hasApproval: true,
    hasPaperPlan: true,
    hasActivation: true,
    preflightStatus: "passed",
    runStatus: "running",
  });
  assert.equal(running.phase, "running");
  assert.equal(running.nextStepId, undefined);
  assert.equal(running.steps.every((step) => step.status === "complete"), true);
});
