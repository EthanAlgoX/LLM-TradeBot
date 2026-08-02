import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { BoundedMultiPaperScheduler, MultiPaperDeploymentService, MultiPaperRuntimeError, SqliteMultiPaperDeploymentRepository, downsampleOverview } from "../packages/runtime/src/index.js";

const materializer = { materialize(actor: string, id: string) { return actor === "actor:one" && ["strategy:one", "strategy:two"].includes(id) ? { sourceFingerprint: `source:${id}:fingerprint`, datasetFingerprint: "dataset:0001", graphFingerprint: "graph:0000001", executionFingerprint: "execution:0001", riskFingerprint: "risk:00000001" } : undefined; } };
function fixture() { const db = new DatabaseSync(":memory:"); const repository = new SqliteMultiPaperDeploymentRepository(db); return { db, repository, service: new MultiPaperDeploymentService(repository, materializer) }; }
const request = (name: string, strategyVersionId = "strategy:one") => ({ idempotencyKey: `key:${name}:12345678`, name, strategyVersionId, initialCapital: 10000, intervalMs: 1000 });
const action = (key: string, sourceFingerprint?: string) => ({ idempotencyKey: `action:${key}:12345678`, ...(sourceFingerprint ? { sourceFingerprint } : {}) });

test("M4 contracts reject unknown deployment facts and isolated actors cannot read", () => {
  const { service, repository } = fixture();
  assert.throws(() => service.create("actor:one", { ...request("bad"), pnl: 10 }), /unrecognized/i);
  const deployment = service.create("actor:one", request("one"));
  assert.equal(deployment.definition.runtimeApplied, false);
  assert.equal(deployment.definition.exchangeWriteAllowed, false);
  assert.throws(() => repository.get("actor:two", deployment.definition.deploymentId), /DEPLOYMENT_NOT_FOUND/);
});

test("M4 create preflight start stop archive state machine fails closed", () => {
  const { service } = fixture(); const deployment = service.create("actor:one", request("one")); const id = deployment.definition.deploymentId;
  assert.throws(() => service.action("actor:one", id, "start", action("start")), /DEPLOYMENT_TRANSITION_INVALID/);
  assert.equal(service.action("actor:one", id, "preflight", action("preflight", deployment.definition.sourceFingerprint)).state.lifecycle, "preflight_passed");
  assert.equal(service.action("actor:one", id, "start", action("start", deployment.definition.sourceFingerprint)).state.lifecycle, "running");
  assert.equal(service.action("actor:one", id, "stop", action("stop-request")).state.lifecycle, "stopping");
  assert.equal(service.action("actor:one", id, "stop", action("stop")).state.lifecycle, "stopped");
  assert.equal(service.action("actor:one", id, "archive", action("archive")).state.lifecycle, "archived");
  assert.throws(() => service.action("actor:one", id, "start", action("again")), /DEPLOYMENT_TRANSITION_INVALID/);
});

test("M4 rejects stale source and preserves independent virtual accounts", () => {
  const { service } = fixture(); const a = service.create("actor:one", request("one", "strategy:one")); const b = service.create("actor:one", request("two", "strategy:two"));
  assert.notEqual(a.definition.accountId, b.definition.accountId);
  assert.throws(() => service.action("actor:one", a.definition.deploymentId, "preflight", action("stale", "source:other:000")), /SOURCE_FINGERPRINT_STALE/);
});

test("M4 scheduler bounds global concurrency and never overlaps a deployment", async () => {
  const { service } = fixture(); const a=service.create("actor:one",request("one")); const b=service.create("actor:one",request("two","strategy:two"));
  for (const d of [a,b]) { service.action("actor:one",d.definition.deploymentId,"preflight",action(`pf-${d.definition.name}`,d.definition.sourceFingerprint)); service.action("actor:one",d.definition.deploymentId,"start",action(`st-${d.definition.name}`,d.definition.sourceFingerprint)); }
  const scheduler = new BoundedMultiPaperScheduler(1); let current=0, maximum=0, executions=0;
  await Promise.all([scheduler.tick([a,b].map((d)=>service.action("actor:one",d.definition.deploymentId,"start",action(`noop-${d.definition.name}`))), async()=>{current++;maximum=Math.max(maximum,current);await Promise.resolve();current--;executions++;}), scheduler.tick([], async()=>{})]);
  assert.equal(maximum, 1); assert.equal(executions, 1);
});

test("M4 overview is persistent-fact shaped and bounded", () => {
  const points = Array.from({length: 1000}, (_, index) => ({ at: new Date(1_700_000_000_000 + index).toISOString(), equity: 100 + index }));
  const overview = downsampleOverview(points, 100, 25);
  assert.ok(overview.length <= 26); assert.equal(overview.at(-1)?.equity, 1099); assert.equal(overview[0]?.normalizedReturnPct, 0);
});

test("M4 projections are immutable, actor/kind-bound and cursor paginated", () => {
  const { service, repository } = fixture(); const deployment = service.create("actor:one", request("projection")); const id = deployment.definition.deploymentId;
  repository.appendProjection("actor:one", id, "cycle", { cycleId: "cycle:1", equity: 10001 });
  repository.appendProjection("actor:one", id, "cycle", { cycleId: "cycle:2", equity: 10002 });
  const first = repository.projections("actor:one", id, "cycle", 1);
  assert.equal(first.data.length, 1); assert.ok(first.nextCursor);
  assert.equal(repository.projections("actor:one", id, "cycle", 1, first.nextCursor).data.length, 1);
  assert.throws(() => repository.projections("actor:one", id, "trade", 1, first.nextCursor), /CURSOR_INVALID/);
  assert.throws(() => repository.projections("actor:two", id, "cycle"), /DEPLOYMENT_NOT_FOUND/);
});
