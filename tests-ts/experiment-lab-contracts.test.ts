import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ExperimentCreateRequestSchema, ExperimentSchema } from "../packages/contracts/src/index.js";
import { SqliteExperimentRepository } from "../packages/runtime/src/experiment-lab.js";

const fp = (n: string) => `sha256:${"a".repeat(63)}${n.length.toString(16).slice(-1)}`;
const time = "2026-08-01T00:00:00.000Z";
const request = () => ({ schemaVersion: "1.0.0", idempotencyKey: "experiment-request-1", participantVersionIds: ["strategy:one", "strategy:two"], datasetId: "dataset:one", startAt: time, endAt: "2026-08-02T00:00:00.000Z", walkForwardPlanId: "plan:one", comparisonMode: "STRATEGY_COMPARISON", objective: { kind: "maximize_total_return" }, constraints: {} });
const experiment = (id: string, actor = "actor:one") => ExperimentSchema.parse({ schemaVersion: "1.0.0", experimentId: id, fingerprint: fp(id.replace(/[^a-z]/g, "a").slice(0, 8)), createdAt: time, actorId: actor, lifecycleStatus: "draft", comparability: { status: "CONTROLLED", requestedMode: "STRATEGY_COMPARISON", changedDimensions: [], lockedDimensions: ["dataset"], issueCodes: [] }, lock: { datasetRef: { id: "dataset:one", version: "v1", fingerprint: fp("dataset") }, startAt: time, endAt: "2026-08-02T00:00:00.000Z", walkForwardPlanRef: { id: "plan:one", version: "v1", fingerprint: fp("plan") }, objective: { kind: "maximize_total_return" }, constraints: {}, executionModel: "graph_trading", riskLockFingerprint: fp("risk"), modelMode: "rule", failurePolicy: "fail_closed", runtimeApplied: false, exchangeWriteAllowed: false }, participants: ["one", "two"].map((suffix, index) => ({ participantId: `participant:${suffix}`, label: suffix, strategyVersionRef: { id: `strategy:${suffix}`, version: "v1", fingerprint: fp(`strategy${suffix}`) }, strategyFingerprint: fp(`strategy${suffix}`), executableFingerprint: fp(`exec${suffix}`), profileRef: { id: `profile:${suffix}`, version: "v1", fingerprint: fp(`profile${suffix}`) }, candidateSetRef: { id: `set:${suffix}`, version: "v1", fingerprint: fp(`set${suffix}`) }, sourceRefs: [{ id: `plan:${suffix}`, version: "v1", fingerprint: fp(`plan${suffix}`) }], configProjection: { marketPackId: "market:one", modelMode: "rule", executionModel: "graph_trading", riskFingerprint: fp(`risk${suffix}`), graphFingerprint: fp(`graph${suffix}`) }, constraintResults: [], issueCodes: [] })) });

test("experiment create contracts reject unknown fields, duplicate participants, and invalid ranges", () => {
  assert.throws(() => ExperimentCreateRequestSchema.parse({ ...request(), unexpected: true }));
  assert.throws(() => ExperimentCreateRequestSchema.parse({ ...request(), participantVersionIds: ["strategy:one", "strategy:one"] }));
  assert.throws(() => ExperimentCreateRequestSchema.parse({ ...request(), startAt: "2026-08-03T00:00:00.000Z" }));
});

test("experiment contracts require between two and five participants", () => {
  assert.throws(() => ExperimentCreateRequestSchema.parse({ ...request(), participantVersionIds: ["strategy:one"] }));
  assert.throws(() => ExperimentCreateRequestSchema.parse({ ...request(), participantVersionIds: ["a:one", "a:two", "a:three", "a:four", "a:five", "a:six"] }));
});

test("experiment repository is actor isolated and binds cursors to the actor", () => {
  const db = new DatabaseSync(":memory:"); const repo = new SqliteExperimentRepository(db);
  const one = experiment("experiment:one"); const two = experiment("experiment:two", "actor:two");
  repo.save(one, "key:one"); repo.save(two, "key:two");
  assert.throws(() => repo.get(one.experimentId, "actor:two"), /EXPERIMENT_NOT_FOUND/);
  const page = repo.list("actor:one", 1); assert.equal(page.data[0]?.experimentId, one.experimentId);
  assert.ok(page.nextCursor === undefined);
});

test("experiment definitions and events are append-only", () => {
  const db = new DatabaseSync(":memory:"); const repo = new SqliteExperimentRepository(db); const e = experiment("experiment:immutable");
  repo.save(e, "key:immutable"); repo.append(e);
  assert.throws(() => db.prepare("UPDATE experiment_definitions SET created_at = ?").run(time), /EXPERIMENT_IMMUTABLE/);
  assert.throws(() => db.prepare("DELETE FROM experiment_events").run(), /EXPERIMENT_IMMUTABLE/);
});

test("experiment idempotency conflicts on request fingerprint and returns the current definition", () => {
  const db = new DatabaseSync(":memory:"); const repo = new SqliteExperimentRepository(db); const e = experiment("experiment:idem");
  assert.equal(repo.save(e, "key:idem").experimentId, e.experimentId);
  assert.equal(repo.save(e, "key:idem").experimentId, e.experimentId);
  assert.throws(() => repo.save({ ...e, fingerprint: fp("changed") }, "key:idem"), /EXPERIMENT_IDEMPOTENCY_CONFLICT/);
});
