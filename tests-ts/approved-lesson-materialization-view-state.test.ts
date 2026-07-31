import assert from "node:assert/strict";
import test from "node:test";

import { deriveApprovedLessonMaterializationViewState } from "../apps/web/src/approved-lesson-materialization-view-state.js";

test("Materialization view distinguishes unavailable, stale, materialized, and Shadow status without applying Runtime", () => {
  assert.deepEqual(deriveApprovedLessonMaterializationViewState({}), { mode: "unavailable", shadowMode: "unavailable", decisionContextApplied: false, runtimeApplied: false });
  assert.deepEqual(deriveApprovedLessonMaterializationViewState({ lifecycleStatus: "stale" }), { mode: "stale", shadowMode: "unavailable", decisionContextApplied: false, runtimeApplied: false });
  assert.deepEqual(deriveApprovedLessonMaterializationViewState({ lifecycleStatus: "materialized", shadowStatus: "validated" }), { mode: "materialized", shadowMode: "validated", decisionContextApplied: false, runtimeApplied: false });
});
