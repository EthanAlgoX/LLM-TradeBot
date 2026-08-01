import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveConversationViewState,
  type ConversationViewState,
} from "../apps/web/src/orchestration-conversation-view-state.js";

test("conversation view state distinguishes all orchestration outcomes", () => {
  assert.equal(
    deriveConversationViewState({
      busy: true,
      responseStatus: "proposal",
      unavailable: false,
    }),
    "loading",
  );
  for (const status of [
    "proposal",
    "validation_failed",
    "evidence_required",
    "approval_ready",
    "unavailable",
  ] as const satisfies readonly ConversationViewState[]) {
    assert.equal(
      deriveConversationViewState({
        busy: false,
        responseStatus: status,
        unavailable: false,
      }),
      status,
    );
  }
  assert.equal(
    deriveConversationViewState({
      busy: false,
      unavailable: true,
    }),
    "offline",
  );
  assert.equal(deriveConversationViewState({ busy: false, unavailable: false }), "empty");
  assert.equal(deriveConversationViewState({ busy: false, unavailable: false, hasTurns: true }), "ready");
  assert.equal(deriveConversationViewState({ busy: false, unavailable: false, unauthorized: true }), "unauthorized");
});
