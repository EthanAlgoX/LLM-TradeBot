import assert from "node:assert/strict";
import test from "node:test";

import { deriveLessonEvidenceGateViewState } from "../apps/web/src/lesson-evidence-gate-view-state.js";

test("lesson evidence gate view state preserves every server lifecycle and only its allowed action", () => {
  const states = [
    ["binding_required", "none"],
    ["evidence_unavailable", "none"],
    ["backtest_required", "run_backtest"],
    ["walk_forward_required", "run_walk_forward"],
    ["approval_required", "none"],
    ["stale", "none"],
  ] as const;
  for (const [lifecycleStatus, allowedAction] of states) {
    assert.deepEqual(
      deriveLessonEvidenceGateViewState({ lifecycleStatus, allowedAction }),
      { mode: lifecycleStatus, action: allowedAction, runtimeApplied: false },
    );
  }
});
