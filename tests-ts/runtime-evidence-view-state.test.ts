import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveRuntimeEvidenceViewState,
} from "../apps/web/src/runtime-evidence-view-state.js";

test("Runtime evidence view distinguishes live, recent, and sample modes", () => {
  assert.deepEqual(deriveRuntimeEvidenceViewState("active"), {
    mode: "active",
    hydrate: true,
    live: true,
    pollIntervalMs: 1_000,
  });
  assert.deepEqual(deriveRuntimeEvidenceViewState("recent"), {
    mode: "recent",
    hydrate: true,
    live: false,
    pollIntervalMs: 5_000,
  });
  assert.equal(
    deriveRuntimeEvidenceViewState("unavailable").mode,
    "sample",
  );
});
