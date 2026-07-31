import assert from "node:assert/strict";
import test from "node:test";
import {
  CausalRunReviewResponseSchema,
  type AgentArtifact,
  type PaperRuntimeCycleAudit,
  type PaperRuntimeRun,
  type StageEvent,
} from "../packages/contracts/src/index.js";
import {
  CausalTradeReviewError,
  CausalTradeReviewReadModelService,
} from "../packages/runtime/src/causal-trade-review-read-model.js";
import {
  CausalTradeReviewHttpHandler,
} from "../packages/runtime/src/causal-trade-review-http.js";

const at = new Date("2026-07-27T08:00:00.000Z");

function runtimeRun(status: PaperRuntimeRun["status"] = "running"): PaperRuntimeRun {
  return {
    schemaVersion: "1.0.0",
    runId: "run:causal",
    planId: "plan:causal",
    planFingerprint: `sha256:${"a".repeat(64)}`,
    activationId: "activation:causal",
    bindingId: "binding:causal",
    paperAccountRef: "paper-account:test",
    strategyProfileRef: "graph:current-crypto",
    candidateSymbols: ["BTCUSDT", "ETHUSDT"],
    requestedByActorId: "server:operator",
    status,
    plannedCycles: 3,
    processedCycles: 3,
    intervalMs: 1_000,
    lastControlMode: "normal",
    lastControlApplied: true,
    requestedAt: "2026-07-27T07:59:00.000Z",
    startedAt: "2026-07-27T07:59:01.000Z",
    paperRuntimeApplied: true,
    exchangeWriteAllowed: false,
    clientRuntimeParametersAccepted: false,
  };
}

function cycle(number: number): PaperRuntimeCycleAudit {
  return {
    schemaVersion: "1.0.0",
    runId: "run:causal",
    cycle: number,
    traceId: `trace:cycle:${number}`,
    startedAt: `2026-07-27T08:00:0${number}.000Z`,
    finishedAt: `2026-07-27T08:00:1${number}.000Z`,
    status: "ok",
    controlMode: "normal",
    controlApplied: true,
    decisionCount: 1,
    riskDecisionCount: 1,
    executionCount: 1,
    safety: {
      consecutiveFailures: 0,
      updatedAt: `2026-07-27T08:00:1${number}.000Z`,
    },
  };
}

function artifact(
  artifactId: string,
  stage: string,
  options: Partial<AgentArtifact> = {},
): AgentArtifact {
  return {
    schemaVersion: "v1",
    artifactId,
    traceId: "trace:cycle:3",
    asOf: at,
    symbol: "BTCUSDT",
    stage,
    agent: `${stage}:agent`,
    agentVersion: "v1",
    status: "success",
    startedAt: at,
    completedAt: at,
    durationMs: 4,
    input: {},
    output: { status: "ok" },
    ...options,
  };
}

const trace: StageEvent[] = [{
  schemaVersion: "v1",
  traceId: "trace:cycle:3",
  stage: "decision",
  agent: "decision:agent",
  phase: "end",
  at,
  data: { action: "hold" },
}];

function reader(options: {
  artifacts?: AgentArtifact[];
  trace?: StageEvent[];
  run?: PaperRuntimeRun;
} = {}) {
  const run = options.run ?? runtimeRun();
  return new CausalTradeReviewReadModelService(
    {
      paperAccountRef: "paper-account:test",
      accountId: "test",
      marketPackRef: "market-pack:crypto:v1",
      sourceMode: "local_fixture",
      candidateSymbols: ["BTCUSDT", "ETHUSDT"],
      paperDatabasePath: "unused.sqlite",
      now: () => at,
    },
    {
      runs: {
        findLatestRun: () => run,
        getRun: (runId) => runId === run.runId ? run : undefined,
        getCycles: () => [cycle(1), cycle(2), cycle(3)],
      },
      traces: {
        load: () => options.trace ?? trace,
      },
      artifacts: {
        query: async () => options.artifacts ?? [
          artifact("artifact:decision", "decision"),
          artifact("artifact:risk", "risk", {
            input: { sourceArtifactId: "artifact:decision" },
            orderId: "order:1",
          }),
          artifact("artifact:execution", "execution", {
            orderId: "order:1",
          }),
        ],
      },
    },
  );
}

test("Causal review contracts reject unknown fields", async () => {
  const value = await reader().readRun({ cycle: 3 });
  assert.equal(CausalRunReviewResponseSchema.safeParse(value).success, true);
  assert.equal(
    CausalRunReviewResponseSchema.safeParse({
      ...value,
      actorId: "client:forged",
    }).success,
    false,
  );
  assert.equal(
    CausalRunReviewResponseSchema.safeParse({
      ...value,
      selectedCycle: {
        ...value.selectedCycle,
        sql: "select * from runtime_events",
      },
    }).success,
    false,
  );
});

test("Causal run review uses bounded opaque cycle pagination", async () => {
  const first = await reader().readRun({
    page: { schemaVersion: "1.0.0", limit: 2 },
  });
  assert.deepEqual(first.cycles.map((item) => item.cycle), [3, 2]);
  assert.ok(first.pagination.nextCursor);
  const second = await reader().readRun({
    page: {
      schemaVersion: "1.0.0",
      limit: 2,
      cursor: first.pagination.nextCursor,
    },
  });
  assert.deepEqual(second.cycles.map((item) => item.cycle), [1]);
  assert.equal(first.dataClass, "sample");
  assert.equal(first.evidenceStatus, "active");
  assert.equal(first.runtimeApplied, false);
});

test("Cycle review preserves explicit artifact lineage and the fixed action chain", async () => {
  const value = await reader().readRun({ runId: "run:causal", cycle: 3 });
  const selected = value.selectedCycle!;
  assert.deepEqual(selected.actionChain.decisionArtifactIds, ["artifact:decision"]);
  assert.deepEqual(selected.actionChain.riskArtifactIds, ["artifact:risk"]);
  assert.deepEqual(selected.actionChain.executionArtifactIds, ["artifact:execution"]);
  assert.ok(selected.lineage.some((link) =>
    link.relationship === "explicit_reference" &&
    link.fromArtifactId === "artifact:decision" &&
    link.toArtifactId === "artifact:risk" &&
    link.causal));
  assert.equal(value.exchangeWriteAllowed, false);
});

test("Observed artifact order is not inferred as causal lineage", async () => {
  const value = await reader({
    artifacts: [
      artifact("artifact:a", "decision"),
      artifact("artifact:b", "risk"),
    ],
  }).readRun({ cycle: 3 });
  const selected = value.selectedCycle!;
  assert.ok(selected.lineage.every((link) => link.causal === false));
  assert.ok(selected.issues.some((issue) =>
    issue.code === "EXPLICIT_LINEAGE_NOT_RECORDED"));
});

test("Missing and degraded evidence remain explicit", async () => {
  const missing = await reader({
    artifacts: [],
    trace: [],
  }).readRun({ cycle: 3 });
  assert.equal(missing.evidenceStatus, "unavailable");
  assert.ok(missing.selectedCycle?.issues.some((issue) =>
    issue.code === "TRACE_NOT_RECORDED"));
  assert.ok(missing.selectedCycle?.issues.some((issue) =>
    issue.code === "ARTIFACTS_NOT_RECORDED"));

  const degraded = await reader({
    artifacts: [
      artifact("artifact:fallback", "selector", { status: "fallback" }),
    ],
  }).readRun({ cycle: 3 });
  assert.ok(degraded.selectedCycle?.issues.some((issue) =>
    issue.code === "ARTIFACT_DEGRADED"));
});

test("Trade review accepts only an explicitly recorded order or trade reference", async () => {
  const value = await reader().readRun({
    runId: "run:causal",
    cycle: 3,
    tradeRef: "order:1",
  });
  assert.equal(value.selectedCycle?.selectedTradeRef, "order:1");
  assert.deepEqual(
    value.selectedCycle?.tradeReviews[0]?.matchedArtifactIds,
    ["artifact:risk", "artifact:execution"],
  );
  await assert.rejects(
    reader().readRun({
      runId: "run:causal",
      cycle: 3,
      tradeRef: "order:forged",
    }),
    (error) =>
      error instanceof CausalTradeReviewError &&
      error.code === "TRADE_NOT_FOUND",
  );
});

test("Unknown run and cycle references fail closed", async () => {
  await assert.rejects(
    reader().readRun({ runId: "run:unknown" }),
    (error) =>
      error instanceof CausalTradeReviewError &&
      error.code === "RUN_NOT_FOUND",
  );
  await assert.rejects(
    reader().readRun({ runId: "run:causal", cycle: 99 }),
    (error) =>
      error instanceof CausalTradeReviewError &&
      error.code === "CYCLE_NOT_FOUND",
  );
});

test("Causal review HTTP authenticates first and rejects selector injection", async () => {
  let authenticated = 0;
  const handler = new CausalTradeReviewHttpHandler(
    {
      authenticate: (authorization) => {
        assert.equal(authorization, "Bearer operator");
        authenticated += 1;
        return {
          actorId: "server:operator",
          displayName: "Server Operator",
          roles: ["operator"],
        };
      },
    },
    reader(),
  );
  const injected = await handler.handle({
    method: "GET",
    url: "/api/orchestration/causal-review/runs/latest?actorId=x&sql=select&path=/tmp&runtimeSymbols=BTCUSDT",
    authorization: "Bearer operator",
  });
  assert.equal(injected.statusCode, 400);
  assert.equal(
    (injected.payload as { error: { code: string } }).error.code,
    "CAUSAL_REVIEW_QUERY_REJECTED",
  );
  const mutation = await handler.handle({
    method: "POST",
    url: "/api/orchestration/causal-review/runs/latest",
    authorization: "Bearer operator",
  });
  assert.equal(mutation.statusCode, 405);
  const valid = await handler.handle({
    method: "GET",
    url: "/api/orchestration/causal-review/runs/run%3Acausal/cycles/3",
    authorization: "Bearer operator",
  });
  assert.equal(valid.statusCode, 200);
  const latest = await handler.handle({
    method: "GET",
    url: "/api/orchestration/causal-review/runs/latest?limit=2",
    authorization: "Bearer operator",
  });
  assert.equal(latest.statusCode, 200);
  assert.equal(
    (latest.payload as { data: { run: { runId: string } } }).data.run.runId,
    "run:causal",
  );
  assert.equal(authenticated, 4);
});
