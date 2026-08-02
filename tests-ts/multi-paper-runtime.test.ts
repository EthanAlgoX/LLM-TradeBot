import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { BoundedMultiPaperScheduler, DeploymentScopedPaperRuntimeSupervisor, MultiPaperDeploymentService, MultiPaperRuntimeError, SqliteMultiPaperDeploymentRepository, createCurrentCryptoPaperRuntimeBinding, downsampleOverview } from "../packages/runtime/src/index.js";
import { LocalPaperFixtureMarketData } from "../packages/runtime/src/local-paper-market-data.js";
import { prepareLocalPaperWorkspace } from "../packages/runtime/src/local-paper-workspace.js";

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
  const { service, repository } = fixture(); const deployment = service.create("actor:one", request("one")); const id = deployment.definition.deploymentId;
  assert.throws(() => service.action("actor:one", id, "start", action("start")), /DEPLOYMENT_TRANSITION_INVALID/);
  assert.equal(service.action("actor:one", id, "preflight", action("preflight", deployment.definition.sourceFingerprint)).state.lifecycle, "preflight_passed");
  assert.equal(service.action("actor:one", id, "start", action("start", deployment.definition.sourceFingerprint)).state.lifecycle, "running");
  assert.equal(service.action("actor:one", id, "stop", action("stop-request")).state.lifecycle, "stopping");
  // Stop is idempotent while the background worker decides whether a
  // persisted position needs a close-only cycle or can become terminal.
  assert.equal(service.action("actor:one", id, "stop", action("stop")).state.lifecycle, "stopping");
  assert.equal(repository.updateRuntimeState("actor:one", id, "stopped", { lifecycle: "stopped", health: "stopped" }).state.lifecycle, "stopped");
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

test("M4 leases fence stale workers and deduplicate retried immutable facts", () => {
  const { service, repository } = fixture(); const deployment = service.create("actor:one", request("lease")); const id = deployment.definition.deploymentId;
  const run = service.action("actor:one", id, "preflight", action("pf-lease", deployment.definition.sourceFingerprint));
  const started = service.action("actor:one", id, "start", action("start-lease", run.state.sourceFingerprint));
  const at = new Date("2026-08-02T00:00:00.000Z"); const first = repository.acquireLease("actor:one", id, started.state.latestRunId!, "worker:one", at, 1_000);
  assert.throws(() => repository.acquireLease("actor:one", id, started.state.latestRunId!, "worker:two", at, 1_000), /LEASE_CONFLICT/);
  const second = repository.acquireLease("actor:one", id, started.state.latestRunId!, "worker:two", new Date(at.getTime() + 1_001), 1_000);
  assert.ok(second.fencingToken > first.fencingToken);
  assert.throws(() => repository.assertFence("actor:one", first, new Date(at.getTime() + 1_001)), /LEASE_FENCED/);
  repository.appendProjection("actor:one", id, "cycle", { cycleId: "once" }, "run:once");
  repository.appendProjection("actor:one", id, "cycle", { cycleId: "duplicate" }, "run:once");
  assert.equal(repository.projections("actor:one", id, "cycle").data.length, 1);
});

test("M4 supervisor runs two isolated real Paper chains and drains only the stopped deployment", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-m4-"));
  try {
    const workspace = prepareLocalPaperWorkspace(directory);
    let clock = new Date("2026-08-02T00:00:00.000Z");
    const binding = await createCurrentCryptoPaperRuntimeBinding({
      profilePath: workspace.profilePath, symbols: workspace.symbols,
      paperDatabasePath: join(directory, "paper.sqlite"), accountId: "bootstrap-account",
      safetyDatabasePath: join(directory, "safety.sqlite"), traceDatabasePath: join(directory, "trace.sqlite"),
      artifactDatabasePath: join(directory, "artifacts.sqlite"), reflectionDatabasePath: join(directory, "reflection.sqlite"),
      continuous: true, intervalMs: 1_000,
    }, { now: () => clock, marketDataFactory: () => new LocalPaperFixtureMarketData(() => clock) });
    const db = new DatabaseSync(":memory:");
    const repository = new SqliteMultiPaperDeploymentRepository(db);
    const service = new MultiPaperDeploymentService(repository, materializer);
    const a = service.create("actor:one", request("real-one"));
    const b = service.create("actor:one", request("real-two", "strategy:two"));
    for (const deployment of [a, b]) {
      service.action("actor:one", deployment.definition.deploymentId, "preflight", action(`pf-${deployment.definition.name}`, deployment.definition.sourceFingerprint));
      service.action("actor:one", deployment.definition.deploymentId, "start", action(`start-${deployment.definition.name}`, deployment.definition.sourceFingerprint));
    }
    let supervisor = new DeploymentScopedPaperRuntimeSupervisor({ repository, deployments: service, binding, maximumConcurrency: 2, now: () => clock });
    assert.equal(repository.recoverable().length, 2);
    await supervisor.tick();
    const aAfterOpen = repository.get("actor:one", a.definition.deploymentId);
    const bAfterOpen = repository.get("actor:one", b.definition.deploymentId);
    assert.equal(aAfterOpen.state.latestCycle, 1); assert.equal(bAfterOpen.state.latestCycle, 1);
    const aCycle = repository.projections("actor:one", a.definition.deploymentId, "cycle").data[0]!;
    const bCycle = repository.projections("actor:one", b.definition.deploymentId, "cycle").data[0]!;
    assert.match(String(aCycle.traceId), new RegExp(a.definition.deploymentId));
    assert.match(String(bCycle.traceId), new RegExp(b.definition.deploymentId));
    assert.notEqual(a.definition.accountId, b.definition.accountId);
    assert.ok(Array.isArray(aCycle.decision)); assert.ok(Array.isArray(aCycle.risk)); assert.ok(Array.isArray(aCycle.execution));
    assert.ok(repository.projections("actor:one", a.definition.deploymentId, "artifact").data.length > 0);
    // A new supervisor reads the persistent aggregate and resumes both active
    // deployments without reusing the previous worker's handle.
    await supervisor.stop();
    supervisor = new DeploymentScopedPaperRuntimeSupervisor({ repository, deployments: service, binding, maximumConcurrency: 2, now: () => clock });
    clock = new Date(clock.getTime() + 1_000);
    await supervisor.tick();
    assert.equal(repository.get("actor:one", a.definition.deploymentId).state.latestCycle, 2);
    assert.equal(repository.get("actor:one", b.definition.deploymentId).state.latestCycle, 2);
    service.action("actor:one", a.definition.deploymentId, "stop", action("stop-real-one", a.definition.sourceFingerprint));
    clock = new Date(clock.getTime() + 1_000);
    await supervisor.tick();
    assert.equal(repository.get("actor:one", a.definition.deploymentId).state.lifecycle, "stopped");
    assert.equal(repository.get("actor:one", b.definition.deploymentId).state.lifecycle, "running");
    assert.ok(repository.get("actor:one", b.definition.deploymentId).state.latestCycle >= 2);
    const aTrades = repository.projections("actor:one", a.definition.deploymentId, "trade").data;
    assert.ok(aTrades.some((item) => String((item.execution as { action?: string } | undefined)?.action) === "close_long"));
    await supervisor.stop(); db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
