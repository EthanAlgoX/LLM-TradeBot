import assert from "node:assert/strict";
import test from "node:test";
import {
  appendWorkbenchExchange,
  activeSimulationCount,
  createInitialStrategyAppPreviewState,
  createPrototypeStrategyApp,
  previewBoundaryLabel,
  requestSimulationStart,
} from "../apps/web/src/strategy-app-preview-state.js";
import { inferWorkbenchScenarioId } from "../apps/web/src/strategy-app-preview.js";

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

test("workbench recommendations append a bounded conversational plan history", () => {
  const before = createInitialStrategyAppPreviewState();
  const after = appendWorkbenchExchange(before, {
    scenarioId: "crypto-trend",
    proposalId: "crypto-trend-guard",
    prompt: "做一个加密趋势策略，单独检查资金费率",
  });
  assert.equal(after.workbenchExchanges.length, 2);
  assert.equal(after.workbenchExchanges.at(-1)?.scenarioId, "crypto-trend");
  assert.equal(after.selectedProposalId, "crypto-trend-guard");
  assert.equal(inferWorkbenchScenarioId("研究美股 earnings 事件"), "us-earnings");
  assert.equal(inferWorkbenchScenarioId("BTC 资金费率趋势"), "crypto-trend");
});
