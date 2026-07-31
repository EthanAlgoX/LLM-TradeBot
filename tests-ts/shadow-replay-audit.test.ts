import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ShadowReplayAuditAppendInputSchema, ShadowReplayAuditHistoryRequestSchema } from "../packages/contracts/src/index.js";
import { ComparativeTradeReviewHttpHandler } from "../packages/runtime/src/comparative-trade-review-http.js";
import { SQLiteShadowReplayAuditRepository } from "../packages/runtime/src/sqlite-shadow-replay-audit-repository.js";

const fp = (c: string): `sha256:${string}` => `sha256:${c.repeat(64)}`;
const at = "2026-07-31T12:00:00.000Z";
function input(key = "audit:key:1", materializationFingerprint = fp("1")) {
  return ShadowReplayAuditAppendInputSchema.parse({
    selectedTradeId: "trade:audit", createdAt: at, actorId: "actor:audit", idempotencyKey: key,
    materializationRef: { id: "materialization:audit", versionId: "materialization:audit:v1", fingerprint: materializationFingerprint },
    approvalRef: { id: "approval:audit", versionId: "approval:audit:v1", fingerprint: fp("2") },
    candidateRef: { id: "candidate:audit", fingerprint: fp("3") },
    approvedLessonRef: { id: "lesson:audit", version: "1.0.0", fingerprint: fp("4") },
    shadowProjectionRef: { id: "shadow:audit", versionId: "shadow:audit:v1", fingerprint: fp("5") },
    decisionContextRef: { id: "context:audit", version: "1.0.0", fingerprint: fp("6") },
    historicalLineageFingerprints: [fp("7")], lifecycleStatus: "validated", readOnly: true,
    decisionContextApplied: false, strategyMutationCreated: false, runtimeApplied: false, exchangeWriteAllowed: false,
  });
}

test("Shadow audit contracts reject client Context, Artifact, Market, Runtime, and executable injection", () => {
  for (const field of ["context", "artifact", "market", "actorId", "fingerprint", "code", "path", "url", "sql", "symbols", "cycles", "executionMode"]) {
    assert.equal(ShadowReplayAuditHistoryRequestSchema.safeParse({ selectedTradeId: "trade:audit", [field]: "injected" }).success, false, field);
  }
});

test("SQLite Shadow audit is append-only and idempotent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tradebot-shadow-audit-"));
  const repo = new SQLiteShadowReplayAuditRepository(join(dir, "audit.sqlite"));
  const first = await repo.append(input());
  const replay = await repo.append(input());
  assert.deepEqual(replay, first);
  await assert.rejects(repo.append(input("audit:key:1", fp("9"))), /SHADOW_REPLAY_AUDIT_IDEMPOTENCY_CONFLICT/u);
  repo.close(); rmSync(dir, { recursive: true, force: true });
});

test("Shadow audit versions paginate and survive restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tradebot-shadow-history-"));
  const path = join(dir, "audit.sqlite");
  const repo = new SQLiteShadowReplayAuditRepository(path);
  await repo.append(input("audit:key:1", fp("1")));
  await repo.append(input("audit:key:2", fp("8")));
  const first = await repo.listBySelectedTradeId({ selectedTradeId: "trade:audit", limit: 1 });
  assert.equal(first.records[0]?.versionIndex, 2);
  assert.ok(first.nextCursor);
  repo.close();
  const reopened = new SQLiteShadowReplayAuditRepository(path);
  const second = await reopened.listBySelectedTradeId({ selectedTradeId: "trade:audit", cursor: first.nextCursor, limit: 1 });
  assert.equal(second.records[0]?.versionIndex, 1);
  reopened.close(); rmSync(dir, { recursive: true, force: true });
});

test("Shadow audit history HTTP derives Bearer actor and rejects payload injection", async () => {
  const repo = { async listBySelectedTradeId() { return { records: [] }; } };
  const handler = new ComparativeTradeReviewHttpHandler({ create: async () => { throw new Error("unused"); } }, {} as never, { authenticate: async (authorization) => { if (authorization !== "Bearer audit-token") throw new Error("UNAUTHENTICATED"); return { actorId: "actor:audit", role: "approver", authenticatedAt: at }; } }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, repo);
  const denied = await handler.handle(new Request("http://localhost/api/orchestration/lesson-candidates/materializations/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ selectedTradeId: "trade:audit" }) }));
  assert.equal(denied.status, 401);
  const injected = await handler.handle(new Request("http://localhost/api/orchestration/lesson-candidates/materializations/history", { method: "POST", headers: { authorization: "Bearer audit-token", "content-type": "application/json" }, body: JSON.stringify({ selectedTradeId: "trade:audit", context: {} }) }));
  assert.equal(injected.status, 400);
  const accepted = await handler.handle(new Request("http://localhost/api/orchestration/lesson-candidates/materializations/history", { method: "POST", headers: { authorization: "Bearer audit-token", "content-type": "application/json" }, body: JSON.stringify({ selectedTradeId: "trade:audit", limit: 10 }) }));
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json() as { runtimeApplied: boolean }).runtimeApplied, false);
});
