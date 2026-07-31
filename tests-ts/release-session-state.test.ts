import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveRecoveredPromotionState,
  parseReleaseSessionRefs,
  releaseReferenceChainMatches,
  serializeReleaseSessionRefs,
} from "../apps/web/src/release-session-state.js";

test("release session stores only strict opaque server references", () => {
  const raw = serializeReleaseSessionRefs({
    schemaVersion: "1.0.0",
    draftId: "pipeline:current-crypto@1.0.0",
    paperPlanId: "paper-plan:123",
    paperRunId: "paper-run:456",
  });
  const parsed = parseReleaseSessionRefs(raw);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.refs, {
      schemaVersion: "1.0.0",
      draftId: "pipeline:current-crypto@1.0.0",
      paperPlanId: "paper-plan:123",
      paperRunId: "paper-run:456",
    });
  }
  assert.equal(raw.includes("token"), false);
  assert.equal(raw.includes("evidence"), false);
  assert.equal(raw.includes("risk"), false);
});

test("release session rejects unknown, executable, and secret fields", () => {
  for (const value of [
    {
      schemaVersion: "1.0.0",
      draftId: "draft:1",
      token: "secret",
    },
    {
      schemaVersion: "1.0.0",
      draftId: "draft:1",
      runtimeParameters: { maxCycles: 999 },
    },
    {
      schemaVersion: "1.0.0",
      draftId: "draft:1",
      code: "execute()",
    },
  ]) {
    const parsed = parseReleaseSessionRefs(JSON.stringify(value));
    assert.deepEqual(parsed, {
      ok: false,
      code: "RELEASE_SESSION_REFERENCE_INVALID",
    });
  }
});

test("release session enforces reference hierarchy and bounded IDs", () => {
  for (const value of [
    {
      schemaVersion: "1.0.0",
      paperPlanId: "paper-plan:orphan",
    },
    {
      schemaVersion: "1.0.0",
      draftId: "draft:1",
      paperRunId: "paper-run:orphan",
    },
    {
      schemaVersion: "1.0.0",
      draftId: "x".repeat(501),
    },
    {
      schemaVersion: "2.0.0",
      draftId: "draft:1",
    },
  ]) {
    assert.equal(
      parseReleaseSessionRefs(JSON.stringify(value)).ok,
      false,
    );
  }
});

test("server-restored Plan and Run must belong to the restored chain", () => {
  assert.equal(
    releaseReferenceChainMatches({
      draftId: "draft:1",
      planId: "plan:1",
      planDraftId: "draft:1",
      runPlanId: "plan:1",
    }),
    true,
  );
  assert.equal(
    releaseReferenceChainMatches({
      draftId: "draft:1",
      planId: "plan:other",
      planDraftId: "draft:2",
    }),
    false,
  );
  assert.equal(
    releaseReferenceChainMatches({
      draftId: "draft:1",
      planId: "plan:1",
      planDraftId: "draft:1",
      runPlanId: "plan:other",
    }),
    false,
  );
});

test("promotion recovery derives status only from server promotion stage", () => {
  assert.deepEqual(deriveRecoveredPromotionState("draft"), {});
  assert.deepEqual(
    deriveRecoveredPromotionState("contract_validated"),
    { validationValid: true },
  );
  assert.deepEqual(
    deriveRecoveredPromotionState("backtested"),
    {
      validationValid: true,
      backtestStatus: "succeeded",
    },
  );
  assert.deepEqual(
    deriveRecoveredPromotionState("human_approved"),
    {
      validationValid: true,
      backtestStatus: "succeeded",
      walkForwardStatus: "succeeded",
    },
  );
  assert.deepEqual(deriveRecoveredPromotionState("forged"), {});
});
