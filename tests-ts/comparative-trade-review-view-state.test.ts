import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveComparativeTradeReviewViewState,
} from "../apps/web/src/comparative-trade-review-view-state.js";

test("comparative review view state distinguishes the complete review lifecycle", () => {
  assert.equal(
    deriveComparativeTradeReviewViewState({ loading: true }).mode,
    "loading",
  );
  assert.equal(
    deriveComparativeTradeReviewViewState({ available: true }).mode,
    "comparison",
  );
  assert.equal(
    deriveComparativeTradeReviewViewState({ insufficient: true }).mode,
    "insufficient",
  );
  assert.equal(
    deriveComparativeTradeReviewViewState({
      available: true,
      candidateAvailable: true,
    }).mode,
    "candidate",
  );
  assert.equal(
    deriveComparativeTradeReviewViewState({ reviewed: true }).mode,
    "reviewed",
  );
  assert.equal(
    deriveComparativeTradeReviewViewState({ unavailable: true }).mode,
    "unavailable",
  );
});

test("comparative review UI never represents evidence as causal or applied", () => {
  const state = deriveComparativeTradeReviewViewState({
    available: true,
    candidateAvailable: true,
  });
  assert.equal(state.reviewAllowed, true);
  assert.equal(state.causalClaim, false);
  assert.equal(state.readOnlyEvidence, true);
  assert.equal(state.runtimeApplied, false);
  assert.equal(state.exchangeWriteAllowed, false);
});

