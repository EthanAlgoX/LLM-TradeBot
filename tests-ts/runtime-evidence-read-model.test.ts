import assert from "node:assert/strict";
import test from "node:test";
import {
  RuntimeEvidenceDashboardSchema,
  type AgentArtifact,
  type PaperRuntimeCycleAudit,
  type PaperRuntimeRun,
} from "../packages/contracts/src/index.js";
import {
  RuntimeEvidenceReadModelService,
} from "../packages/runtime/src/runtime-evidence-read-model.js";
import {
  RuntimeEvidenceHttpHandler,
} from "../packages/runtime/src/runtime-evidence-http.js";

const now = new Date("2026-07-26T12:00:00.000Z");

function run(status: PaperRuntimeRun["status"]): PaperRuntimeRun {
  return {
    schemaVersion: "1.0.0",
    runId: "paper-runtime-run:test",
    planId: "paper-plan:test",
    planFingerprint: `sha256:${"a".repeat(64)}`,
    activationId: "activation:test",
    bindingId: "binding:test",
    paperAccountRef: "paper-account:test",
    strategyProfileRef: "strategy:test",
    candidateSymbols: ["BTCUSDT"],
    requestedByActorId: "actor:test",
    status,
    plannedCycles: 6,
    processedCycles: 1,
    intervalMs: 1_000,
    lastControlMode: "normal",
    lastControlApplied: true,
    requestedAt: "2026-07-26T11:59:00.000Z",
    startedAt: "2026-07-26T11:59:01.000Z",
    ...(status === "completed"
      ? { finishedAt: "2026-07-26T11:59:50.000Z" }
      : {}),
    paperRuntimeApplied: true,
    exchangeWriteAllowed: false,
    clientRuntimeParametersAccepted: false,
  };
}

const cycle: PaperRuntimeCycleAudit = {
  schemaVersion: "1.0.0",
  runId: "paper-runtime-run:test",
  cycle: 1,
  traceId: "paper-runtime-run:test:cycle:1",
  startedAt: "2026-07-26T11:59:02.000Z",
  finishedAt: "2026-07-26T11:59:03.000Z",
  status: "ok",
  controlMode: "normal",
  controlApplied: true,
  decisionCount: 1,
  riskDecisionCount: 1,
  executionCount: 0,
  safety: {
    consecutiveFailures: 0,
    updatedAt: "2026-07-26T11:59:03.000Z",
  },
};

const artifacts: AgentArtifact[] = [
  {
    schemaVersion: "v1",
    artifactId: "artifact:decision",
    traceId: cycle.traceId,
    asOf: now,
    symbol: "BTCUSDT",
    stage: "decision",
    agent: "RuleDecisionAgent",
    agentVersion: "v1",
    status: "success",
    startedAt: now,
    completedAt: now,
    durationMs: 12,
    input: { prompt: "MUST_NOT_LEAK" },
    output: {
      action: "hold",
      confidence: 71,
      reason: "multi-window evidence is not aligned",
      prompt: "MUST_NOT_LEAK",
    },
  },
  {
    schemaVersion: "v1",
    artifactId: "artifact:risk",
    traceId: cycle.traceId,
    asOf: now,
    symbol: "BTCUSDT",
    stage: "risk",
    agent: "RuleRiskAgent",
    agentVersion: "v1",
    status: "success",
    startedAt: now,
    completedAt: now,
    durationMs: 4,
    input: {},
    output: { passed: true },
  },
];

function service(status: PaperRuntimeRun["status"]) {
  return new RuntimeEvidenceReadModelService(
    {
      paperAccountRef: "paper-account:test",
      accountId: "test",
      marketPackRef: "market-pack:crypto:v1",
      sourceMode: "local_fixture",
      candidateSymbols: ["BTCUSDT"],
      paperDatabasePath: "unused.sqlite",
      now: () => now,
    },
    {
      runs: {
        findLatestRun: () => run(status),
        getCycles: () => [cycle],
      },
      accounts: {
        load: async () => ({
          schemaVersion: "v1",
          cash: 10_000,
          realizedPnl: 40,
          fees: 2,
          positions: [],
          closedTrades: [],
          orders: [],
        }),
      },
      artifacts: {
        query: async () => artifacts,
      },
      reflections: {
        latest: async () => ({
          reflectionId: "reflection:test",
          asOf: now,
          sampleSize: 1,
          winRatePct: 0,
          averageWin: 0,
          averageLoss: 10,
          longTradeCount: 0,
          shortTradeCount: 1,
          confidenceCalibration: "overconfident_losses",
          recommendations: ["Avoid late volume confirmation."],
          adjustments: [],
        }),
      },
    },
  );
}

test("Runtime evidence aggregates only bounded semantic read data", async () => {
  const evidence = await service("running").read();
  assert.equal(evidence.evidenceStatus, "active");
  assert.equal(evidence.selection?.topN, 1);
  assert.equal(evidence.decisionRiskExecution.decisionAction, "hold");
  assert.equal(evidence.decisionRiskExecution.riskPassed, true);
  assert.equal(evidence.reflection.candidateOnly, true);
  assert.equal(evidence.reflection.runtimeApplied, false);
  assert.equal(evidence.exchangeWriteAllowed, false);
  assert.equal(JSON.stringify(evidence).includes("MUST_NOT_LEAK"), false);

  assert.equal(
    RuntimeEvidenceDashboardSchema.safeParse({
      ...evidence,
      accountId: "client-injected",
    }).success,
    false,
  );
});

test("terminal evidence is recent and never presented as active", async () => {
  const evidence = await service("completed").read();
  assert.equal(evidence.evidenceStatus, "recent");
  assert.equal(evidence.run?.status, "completed");
});

test("Runtime evidence HTTP is authenticated, read-only, and selector-free", async () => {
  let authenticated = 0;
  const handler = new RuntimeEvidenceHttpHandler(
    {
      authenticate: (authorization) => {
        assert.equal(authorization, "Bearer operator");
        authenticated += 1;
        return {
          actorId: "actor:test",
          displayName: "Test Operator",
          roles: ["operator"],
        };
      },
    },
    service("running"),
  );
  const selected = await handler.handle({
    method: "GET",
    url: "/api/orchestration/paper-runtime/evidence?runId=forged",
    authorization: "Bearer operator",
  });
  assert.equal(selected.statusCode, 400);
  assert.equal(
    (selected.payload as { error: { code: string } }).error.code,
    "RUNTIME_EVIDENCE_SELECTORS_FORBIDDEN",
  );
  const mutation = await handler.handle({
    method: "POST",
    url: "/api/orchestration/paper-runtime/evidence",
    authorization: "Bearer operator",
  });
  assert.equal(mutation.statusCode, 405);
  const valid = await handler.handle({
    method: "GET",
    url: "/api/orchestration/paper-runtime/evidence",
    authorization: "Bearer operator",
  });
  assert.equal(valid.statusCode, 200);
  assert.equal(authenticated, 3);
});
