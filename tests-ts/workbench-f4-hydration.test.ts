import assert from "node:assert/strict";
import test from "node:test";
import { hydrateWorkbenchF4Turns } from "../apps/web/src/workbench-f4-hydration.js";

test("F4 hydration isolates a legacy draft failure and resolves current drafts", async () => {
  const hydrated = await hydrateWorkbenchF4Turns([{ id: "legacy", draft: { draftId: "legacy" } }, { id: "current", draft: { draftId: "current" } }], async (draftId) => {
    if (draftId === "legacy") throw new Error("PROVENANCE_UNAVAILABLE");
    return { nextAction: "preflight" };
  });
  assert.deepEqual(hydrated, [{ id: "legacy", draft: { draftId: "legacy" }, f4: { error: "PROVENANCE_UNAVAILABLE" } }, { id: "current", draft: { draftId: "current" }, f4: { nextAction: "preflight" } }]);
});
