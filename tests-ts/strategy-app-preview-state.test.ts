import assert from "node:assert/strict";
import test from "node:test";
import {
  activeSimulationCount,
  createInitialStrategyAppPreviewState,
  createPrototypeStrategyApp,
  previewBoundaryLabel,
  requestSimulationStart,
} from "../apps/web/src/strategy-app-preview-state.js";

test("Strategy App preview allows at most three active simulation slots", () => {
  const base = createInitialStrategyAppPreviewState();
  const full = {
    ...base,
    apps: base.apps.map((app, index) => index < 3 ? { ...app, status: "Paper Running" as const } : app),
  };
  assert.equal(activeSimulationCount(full), 3);
  assert.deepEqual(requestSimulationStart(full), {
    accepted: false,
    reason: "SIMULATION_CAPACITY_REACHED",
    runtimeCall: "none",
  });
});

test("Strategy App creation changes only page-memory preview state", () => {
  const before = createInitialStrategyAppPreviewState();
  const after = createPrototypeStrategyApp(before, {
    id: "hk-quality-trend",
    name: "HK Quality Trend",
    market: "Hong Kong equities",
  });
  assert.equal(before.apps.length, 5);
  assert.equal(after.apps.length, 6);
  assert.equal(after.apps[0]?.origin, "PROTOTYPE");
  assert.match(previewBoundaryLabel(after.apps[0]!.origin), /PROTOTYPE/);
  assert.match(previewBoundaryLabel(before.apps[0]!.origin), /SAMPLE/);
});
