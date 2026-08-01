import assert from "node:assert/strict";
import test from "node:test";
import { createDataCenterHostLifecycle } from "../apps/web/src/data-center-host-lifecycle.js";

test("Data Center mounts once for repeated mutations inside the same host", () => {
  const events: string[] = [];
  type Host = { id: string };
  const firstHost: Host = { id: "first" };
  const secondHost: Host = { id: "second" };
  const lifecycle = createDataCenterHostLifecycle<Host>(
    (host) => events.push(`mount:${host.id}`),
    (host) => events.push(`unmount:${host.id}`),
  );

  assert.equal(lifecycle.sync(null), "unchanged");
  assert.equal(lifecycle.sync(firstHost), "mounted");
  assert.equal(lifecycle.sync(firstHost), "unchanged");
  assert.equal(lifecycle.sync(firstHost), "unchanged");
  assert.deepEqual(events, ["mount:first"]);

  assert.equal(lifecycle.sync(secondHost), "mounted");
  assert.deepEqual(events, [
    "mount:first",
    "unmount:first",
    "mount:second",
  ]);

  assert.equal(lifecycle.sync(null), "unmounted");
  assert.deepEqual(events, [
    "mount:first",
    "unmount:first",
    "mount:second",
    "unmount:second",
  ]);
});
