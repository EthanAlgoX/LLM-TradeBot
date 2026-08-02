import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveConversationViewState,
  type ConversationViewState,
} from "../apps/web/src/orchestration-conversation-view-state.js";
import {
  authorityFromNewestTurn,
  canApplyConversationLoad,
  mergeTurnDisplay,
} from "../apps/web/src/conversation-history-authority.js";

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

test("conversation authority comes from newest server turn, not display or pagination order", () => {
  const newest = { draftId: "draft:csv", versionId: "version:csv-bound", fingerprint: "sha256:csv" };
  const old = { draftId: "draft:binance", versionId: "version:old", fingerprint: "sha256:old" };
  assert.deepEqual(authorityFromNewestTurn([{ id: "binding", draft: newest }, { id: "older", draft: old }]), newest);
  assert.deepEqual(
    mergeTurnDisplay(
      [{ id: "older", draft: old }],
      [{ id: "binding", draft: newest }],
      true,
    ).map((turn) => turn.id),
    ["older", "binding"],
  );
});

test("a stale conversation response cannot overwrite the active selection", () => {
  assert.equal(canApplyConversationLoad({ requestConversationId: "conversation.a", requestEpoch: 4, activeConversationId: "conversation.b", activeEpoch: 5 }), false);
  assert.equal(canApplyConversationLoad({ requestConversationId: "conversation.b", requestEpoch: 4, activeConversationId: "conversation.b", activeEpoch: 5 }), false);
  assert.equal(canApplyConversationLoad({ requestConversationId: "conversation.b", requestEpoch: 5, activeConversationId: "conversation.b", activeEpoch: 5 }), true);
});
