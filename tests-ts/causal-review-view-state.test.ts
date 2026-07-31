import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveCausalReviewViewState,
} from "../apps/web/src/causal-review-view-state.js";

test("Causal review view state distinguishes loading, unavailable, and sample", () => {
  assert.equal(
    deriveCausalReviewViewState({ loading: true }).mode,
    "loading",
  );
  assert.equal(
    deriveCausalReviewViewState({ failed: true }).mode,
    "unavailable",
  );
  const sample = deriveCausalReviewViewState({
    evidenceStatus: "active",
    dataClass: "sample",
    tradeLifecycleStatus: "active_position",
  });
  assert.equal(sample.mode, "active");
  assert.equal(sample.dataTone, "sample");
  assert.equal(sample.tradeMode, "active_position");
});

test("Causal review view state keeps active, recent, partial, and runtime isolation", () => {
  for (const mode of ["active", "recent", "partial"] as const) {
    const state = deriveCausalReviewViewState({
      evidenceStatus: mode,
      dataClass: "runtime",
    });
    assert.equal(state.mode, mode);
    assert.equal(state.dataTone, "runtime");
    assert.equal(state.readOnly, true);
    assert.equal(state.runtimeApplied, false);
    assert.equal(state.tradeMode, "none");
  }
});
