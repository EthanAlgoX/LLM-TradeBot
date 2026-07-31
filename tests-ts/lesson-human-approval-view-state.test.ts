import assert from "node:assert/strict";
import test from "node:test";

import { deriveLessonHumanApprovalViewState } from "../apps/web/src/lesson-human-approval-view-state.js";

test("Lesson Approval view exposes decisions only for approval-ready evidence and remains not applied", () => {
  assert.deepEqual(deriveLessonHumanApprovalViewState({ evidenceLifecycle: "walk_forward_required" }), { mode: "blocked", canDecide: false, decisionContextApplied: false, runtimeApplied: false });
  assert.deepEqual(deriveLessonHumanApprovalViewState({ evidenceLifecycle: "approval_required" }), { mode: "approval_ready", canDecide: true, decisionContextApplied: false, runtimeApplied: false });
  assert.deepEqual(deriveLessonHumanApprovalViewState({ evidenceLifecycle: "approval_required", approvalLifecycle: "approved" }), { mode: "approved", canDecide: false, decisionContextApplied: false, runtimeApplied: false });
  assert.deepEqual(deriveLessonHumanApprovalViewState({ evidenceLifecycle: "approval_required", approvalLifecycle: "rejected" }), { mode: "rejected", canDecide: false, decisionContextApplied: false, runtimeApplied: false });
});
