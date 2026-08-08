import assert from "node:assert/strict";
import test from "node:test";
import { hydrateWorkbenchF4Turns, mergeWorkbenchF4Action, mergeWorkbenchF4History, mergeWorkbenchF4Projection, reconcileWorkbenchF4Action, rereadWorkbenchF4Action } from "../apps/web/src/workbench-f4-hydration.js";

test("F4 hydration isolates a legacy draft failure and resolves current drafts", async () => {
  const hydrated = await hydrateWorkbenchF4Turns([{ id: "legacy", draft: { draftId: "legacy" } }, { id: "current", draft: { draftId: "current" } }], async (draftId) => {
    if (draftId === "legacy") throw new Error("PROVENANCE_UNAVAILABLE");
    return { nextAction: "preflight" };
  });
  assert.deepEqual(hydrated, [{ id: "legacy", draft: { draftId: "legacy" }, f4: { error: "PROVENANCE_UNAVAILABLE" } }, { id: "current", draft: { draftId: "current" }, f4: { nextAction: "preflight" } }]);
});

test("F4 action result is merged by immutable version, never by history position", () => {
  const initial = [
    { id: "legacy", draft: { draftId: "legacy", versionId: "config:v0" }, f4: { error: "PROVENANCE_UNAVAILABLE" } },
    { id: "v1", draft: { draftId: "same-draft", versionId: "config:v1" }, f4: { nextAction: "backtest" } },
    { id: "v2", draft: { draftId: "same-draft", versionId: "config:v2" }, f4: { nextAction: "preflight" } },
  ];
  const merged = mergeWorkbenchF4Action(initial, "config:v2", { gates: [{ id: "preflight", status: "passed" }], nextAction: "backtest" });
  assert.deepEqual(merged.map((turn) => turn.f4), [
    { error: "PROVENANCE_UNAVAILABLE" },
    { nextAction: "backtest" },
    { gates: [{ id: "preflight", status: "passed" }], nextAction: "backtest" },
  ]);
});

test("a completed action remains authoritative when an older hydration is discarded", async () => {
  const initial = [{ id: "v1", draft: { draftId: "same-draft", versionId: "config:v1" }, f4: { nextAction: "preflight" } }];
  const oldHydration = hydrateWorkbenchF4Turns(initial, async () => ({ nextAction: "preflight" }));
  const actionResult = mergeWorkbenchF4Action(initial, "config:v1", { gates: [{ id: "preflight", status: "passed" }], nextAction: "backtest" });
  await oldHydration;
  assert.deepEqual(actionResult[0]?.f4, { gates: [{ id: "preflight", status: "passed" }], nextAction: "backtest" });
});

test("history renders first and a delayed legacy projection cannot block or remove a healthy immutable F4 card", async () => {
  const v1: { id: string; draft: { draftId: string; versionId: string; fingerprint: string }; f4?: unknown } = { id: "v1", draft: { draftId: "same-draft", versionId: "config:v1", fingerprint: "sha256:v1" }, f4: { nextAction: "walk-forward" } };
  const v2: { id: string; draft: { draftId: string; versionId: string; fingerprint: string }; f4?: unknown } = { id: "v2", draft: { draftId: "same-draft", versionId: "config:v2", fingerprint: "sha256:v2" } };
  const fromHistory = mergeWorkbenchF4History([v1], [v1, v2]);
  assert.deepEqual(fromHistory.map((turn) => turn.f4), [{ nextAction: "walk-forward" }, undefined]);
  const merged = mergeWorkbenchF4Projection(fromHistory, v2.draft, { nextAction: "preflight" });
  assert.deepEqual(merged.map((turn) => turn.f4), [{ nextAction: "walk-forward" }, { nextAction: "preflight" }]);
  assert.deepEqual(mergeWorkbenchF4Projection(merged, { ...v2.draft, fingerprint: "sha256:other" }, { error: "STALE" }), merged);
});

test("an F4 POST result is followed by one same-version authoritative reread", async () => {
  const afterPost = mergeWorkbenchF4Action(
    [{ id: "v1", draft: { draftId: "same-draft", versionId: "config:v1" }, f4: { nextAction: "backtest" } }],
    "config:v1",
    { nextAction: "backtest" },
  );
  const reads: string[] = [];
  const reconciled = await rereadWorkbenchF4Action(afterPost, "config:v1", async (versionId) => {
    reads.push(versionId);
    return { gates: [{ id: "backtest", status: "succeeded" }], nextAction: "walk-forward" };
  });
  assert.deepEqual(reads, ["config:v1"]);
  assert.deepEqual(reconciled[0]?.f4, { gates: [{ id: "backtest", status: "succeeded" }], nextAction: "walk-forward" });
});

test("F4 reconciliation is bounded and distinguishes terminal, failure, and timeout", async () => {
  const terminal = await reconcileWorkbenchF4Action("backtest", async () => ({ gates: [{ id: "backtest", status: "succeeded" }] }));
  assert.deepEqual(terminal, { status: "terminal", projection: { gates: [{ id: "backtest", status: "succeeded" }] }, attempts: 1 });
  const failed = await reconcileWorkbenchF4Action("walk-forward", async () => ({ gates: [{ id: "walk_forward", status: "failed" }] }));
  assert.equal(failed.status, "failed");
  const reads: number[] = [];
  const timeout = await reconcileWorkbenchF4Action("backtest", async () => { reads.push(1); return { gates: [{ id: "backtest", status: "running" }] }; });
  assert.equal(timeout.status, "timeout");
  assert.deepEqual(reads, [1, 1, 1]);
});
