import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  CurrentCryptoReadOnlyShadowAdapter,
  MultiPaperDeploymentService,
  ShadowPromotionService,
  SqliteMultiPaperDeploymentRepository,
  SqliteShadowPromotionRepository,
} from "../packages/runtime/src/index.js";

let drifted = false;
const materializer = {
  materialize(actorId: string, strategyVersionId: string) {
    if (actorId !== "actor:one" || !["strategy:champion", "strategy:challenger"].includes(strategyVersionId)) return undefined;
    return {
      sourceFingerprint: drifted && strategyVersionId === "strategy:champion" ? "source:stale:0001" : `source:${strategyVersionId}:0001`,
      datasetFingerprint: "dataset:0001",
      graphFingerprint: "graph:00000001",
      executionFingerprint: "execution:0001",
      riskFingerprint: "risk:00000001",
    };
  },
};

const request = (name: string, strategyVersionId: string) => ({ idempotencyKey: `deployment:${name}:12345678`, name, strategyVersionId, initialCapital: 10_000, intervalMs: 1_000 });
const cycleId = (index: number) => `run:source:cycle:${index}`;

function fixture() {
  drifted = false;
  const database = new DatabaseSync(":memory:");
  const deployments = new SqliteMultiPaperDeploymentRepository(database);
  const deploymentService = new MultiPaperDeploymentService(deployments, materializer);
  const champion = deploymentService.create("actor:one", request("champion", "strategy:champion"));
  deploymentService.create("actor:one", request("challenger", "strategy:challenger"));
  const shadows = new SqliteShadowPromotionRepository(database);
  return { database, deployments, champion, service: new ShadowPromotionService({ shadows, deployments, versions: materializer, now: () => new Date("2026-08-02T00:00:00.000Z") }) };
}

function appendSnapshot(repository: SqliteMultiPaperDeploymentRepository, deploymentId: string, index: number, options: { artifact?: boolean } = {}) {
  const actorId = "actor:one";
  const id = cycleId(index);
  repository.appendProjection(actorId, deploymentId, "cycle", {
    cycleId: id, runId: "run:source", deploymentId, accountId: "account:source",
    startedAt: `2026-08-02T00:0${index}:00.000Z`, finishedAt: `2026-08-02T00:0${index}:01.000Z`, status: "ok",
    decision: [{ action: "open_long", orderIntent: { notional: 250 } }],
    risk: [{ passed: true }], account: { cash: 9_750, equity: 10_000, positions: [] }, safety: { status: "healthy" }, execution: [],
  }, id);
  if (options.artifact !== false) repository.appendProjection(actorId, deploymentId, "artifact", {
    runId: "run:source", cycleId: id, deploymentId,
    artifacts: [{ artifactId: `artifact:data:${index}`, stage: "data", agent: "fixture", status: "success" }], trace: [],
  }, id);
}

test("M5 consumes an explicit persisted M4 snapshot and writes only independent Shadow facts", () => {
  const { database, deployments, champion, service } = fixture();
  try {
    appendSnapshot(deployments, champion.definition.deploymentId, 1);
    const beforeCycles = deployments.projections("actor:one", champion.definition.deploymentId, "cycle").data;
    const beforeArtifacts = deployments.projections("actor:one", champion.definition.deploymentId, "artifact").data;
    const record = service.observe("actor:one", champion.definition.deploymentId, { idempotencyKey: "shadow:one:12345678", sourceRunId: "run:source", sourceCycleId: cycleId(1) });
    assert.equal(record.run.status, "succeeded");
    assert.equal(record.definition.source.sourceCycleId, cycleId(1));
    assert.equal(record.cycle.champion?.expectedExposure.grossNotional, 250);
    assert.equal(record.comparison?.decision, "same");
    assert.equal(record.recommendation.status, "insufficient_data");
    assert.equal(record.definition.runtimeApplied, false);
    assert.equal(record.definition.executionReachable, false);
    assert.equal(record.recommendation.readOnly, true);
    assert.deepEqual(deployments.projections("actor:one", champion.definition.deploymentId, "cycle").data, beforeCycles);
    assert.deepEqual(deployments.projections("actor:one", champion.definition.deploymentId, "artifact").data, beforeArtifacts);
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'shadow_%' ORDER BY name").all() as { name: string }[];
    assert.deepEqual(tables.map(row => row.name), ["shadow_definitions", "shadow_events", "shadow_projection_events"]);
  } finally { database.close(); }
});

test("M5 scopes history, pagination, idempotency, concurrent recovery, and terminal recommendations independently", async () => {
  const { database, deployments, champion, service } = fixture();
  try {
    appendSnapshot(deployments, champion.definition.deploymentId, 1);
    const concurrent = await Promise.all([
      Promise.resolve().then(() => service.observe("actor:one", champion.definition.deploymentId, { idempotencyKey: "shadow:concurrent-a:12345678", sourceRunId: "run:source", sourceCycleId: cycleId(1) })),
      Promise.resolve().then(() => service.observe("actor:one", champion.definition.deploymentId, { idempotencyKey: "shadow:concurrent-b:12345678", sourceRunId: "run:source", sourceCycleId: cycleId(1) })),
    ]);
    assert.equal(concurrent[0].definition.shadowId, concurrent[1].definition.shadowId);
    const recovered = new ShadowPromotionService({ shadows: new SqliteShadowPromotionRepository(database), deployments, versions: materializer, now: () => new Date("2026-08-02T00:00:00.000Z") });
    const afterRestart = recovered.observe("actor:one", champion.definition.deploymentId, { idempotencyKey: "shadow:recovery:12345678", sourceRunId: "run:source", sourceCycleId: cycleId(1) });
    assert.equal(afterRestart.definition.shadowId, concurrent[0].definition.shadowId);
    for (let index = 2; index <= 5; index += 1) {
      appendSnapshot(deployments, champion.definition.deploymentId, index);
      const record = service.observe("actor:one", champion.definition.deploymentId, { idempotencyKey: `shadow:${index}:12345678`, sourceRunId: "run:source", sourceCycleId: cycleId(index) });
      if (index === 5) {
        assert.equal(record.recommendation.status, "observe");
        assert.equal(record.recommendation.comparableCycleCount, 5);
        assert.equal(record.recommendation.terminal, true);
      }
    }
    const replay = service.observe("actor:one", champion.definition.deploymentId, { idempotencyKey: "shadow:replacement:12345678", sourceRunId: "run:source", sourceCycleId: cycleId(5) });
    assert.equal(replay.recommendation.comparableCycleCount, 5);
    const first = service.list("actor:one", champion.definition.deploymentId, 2);
    assert.equal(first.data.length, 2);
    assert.ok(first.nextCursor);
    const second = service.list("actor:one", champion.definition.deploymentId, 2, first.nextCursor);
    assert.equal(second.data.length, 2);
    assert.throws(() => service.list("actor:one", champion.definition.deploymentId, 2, Buffer.from(`actor:one|other:${champion.definition.deploymentId}|x,y`).toString("base64url")), /SHADOW_CURSOR_INVALID/);
    assert.throws(() => service.observe("actor:two", champion.definition.deploymentId, { idempotencyKey: "shadow:actor-two:12345678", sourceRunId: "run:source", sourceCycleId: cycleId(1) }), /DEPLOYMENT_NOT_FOUND/);
    assert.throws(() => service.observe("actor:one", champion.definition.deploymentId, { idempotencyKey: "shadow:unknown:12345678", sourceRunId: "run:source", sourceCycleId: cycleId(1), candidateVersion: "client-provided" }), /unrecognized/i);
  } finally { database.close(); }
});

test("M5 fails closed for stale and missing M4 lineage, with no Execution adapter", () => {
  const { database, deployments, champion, service } = fixture();
  try {
    const adapter = new CurrentCryptoReadOnlyShadowAdapter();
    assert.equal(adapter.executionReachable, false);
    assert.equal(adapter.exchangeWriteAllowed, false);
    appendSnapshot(deployments, champion.definition.deploymentId, 3);
    assert.throws(() => service.observe("actor:one", champion.definition.deploymentId, { idempotencyKey: "shadow:ambiguous:12345678", sourceRunId: "run:other", sourceCycleId: cycleId(3) }), /SHADOW_SOURCE_SCOPE_AMBIGUOUS/);
    appendSnapshot(deployments, champion.definition.deploymentId, 1, { artifact: false });
    const missing = service.observe("actor:one", champion.definition.deploymentId, { idempotencyKey: "shadow:missing:12345678", sourceRunId: "run:source", sourceCycleId: cycleId(1) });
    assert.equal(missing.run.status, "unavailable");
    assert.ok(missing.run.issueCodes.includes("SHADOW_ARTIFACT_LINEAGE_UNAVAILABLE"));
    appendSnapshot(deployments, champion.definition.deploymentId, 2);
    drifted = true;
    const stale = service.observe("actor:one", champion.definition.deploymentId, { idempotencyKey: "shadow:stale:12345678", sourceRunId: "run:source", sourceCycleId: cycleId(2) });
    assert.equal(stale.run.status, "stale");
    assert.equal(stale.cycle.dataQuality, "stale");
    assert.equal(stale.recommendation.status, "insufficient_data");
  } finally { drifted = false; database.close(); }
});
