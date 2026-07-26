import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  CycleRequest,
  OrchestrationActor,
  RuntimeSafetyState,
} from "../packages/contracts/src/index.js";
import {
  ApprovedPaperPlanError,
  CURRENT_CRYPTO_PIPELINE_GRAPH,
  DecisionPipeline,
  type TradingApplication,
} from "../packages/core/src/index.js";
import {
  SimulatedExecutionAgent,
} from "../packages/adapters/src/index.js";
import {
  createCurrentPipelineOrchestrationRuntime,
  PaperRuntimeActivationError,
  SqlitePaperRuntimeRunRepository,
  type CurrentPipelineOrchestrationRuntime,
  type RegisteredHistoricalEvidenceRunner,
  type RegisteredPaperRuntimeBinding,
} from "../packages/runtime/src/index.js";

const actor: OrchestrationActor = {
  actorId: "test:runtime-operator",
  displayName: "Runtime Operator",
  roles: ["operator", "approver"],
};

function historicalRunner(
  kind: "backtest" | "walk_forward",
): RegisteredHistoricalEvidenceRunner {
  return {
    runnerId: `runtime-evidence:${kind}`,
    kind,
    allowedParameterKeys: [],
    strategyProfileRef: "strategy-profile:runtime:v1",
    dataSourceRef: "data-source:csv-historical",
    dataFingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    timezone: "UTC",
    tradingCalendarRef: "calendar:crypto-24x7",
    costModel: { feeBps: 4, slippageBps: 2 },
    requestedAsOf: () => "2026-07-26T00:00:00.000Z",
    async run() {
      return {
        schemaVersion: "1.0.0",
        metrics: { score: kind === "backtest" ? 1 : 2 },
        summary: `${kind} runtime evidence`,
        observations: [],
      };
    },
  };
}

function safety(options: { blocked?: boolean } = {}) {
  let state: RuntimeSafetyState = {
    consecutiveFailures: 0,
    updatedAt: new Date(),
  };
  return {
    async beforeCycle() {
      return {
        allowed: !options.blocked,
        ...(options.blocked ? { reason: "cooldown" as const } : {}),
        state,
      };
    },
    async recordSuccess() {
      state = { consecutiveFailures: 0, updatedAt: new Date() };
      return state;
    },
    async recordFailure(error: unknown) {
      state = {
        consecutiveFailures: state.consecutiveFailures + 1,
        lastFailure: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      };
      return state;
    },
  };
}

function createDecisionApplication(options: {
  requests?: CycleRequest[];
  hold?: Promise<void>;
} = {}): {
  application: TradingApplication;
  executor: SimulatedExecutionAgent;
  syncedSymbols: string[];
} {
  const executor = new SimulatedExecutionAgent({
    initialCash: 10_000,
    feeBps: 0,
    slippageBps: 0,
  });
  const syncedSymbols: string[] = [];
  const base = {
    schemaVersion: "v1" as const,
    name: "test-agent",
    version: "v1",
  };
  const pipeline = new DecisionPipeline({
    selector: {
      ...base,
      async run({ request }) {
        return {
          schemaVersion: "v1",
          traceId: request.traceId,
          asOf: request.asOf,
          candidates: [
            {
              symbol: "BTCUSDT",
              rank: 1,
              score: 100,
              tradable: true,
              selectedReasons: ["topN=1"],
              rejectionReasons: [],
            },
            {
              symbol: "ETHUSDT",
              rank: 0,
              score: 50,
              tradable: false,
              selectedReasons: [],
              rejectionReasons: ["not selected"],
            },
          ],
        };
      },
    },
    dataSync: {
      ...base,
      async run(input) {
        syncedSymbols.push(input.symbol);
        return {
          schemaVersion: "v1",
          traceId: input.traceId,
          asOf: input.asOf,
          symbol: input.symbol,
          stableBars: { "5m": [], "15m": [], "1h": [] },
          liveQuote: { price: 100, observedAt: input.asOf },
          quality: {
            alignmentOk: true,
            missingTimeframes: [],
            warnings: [],
          },
        };
      },
    },
    analysis: {
      ...base,
      async run(snapshot) {
        return {
          schemaVersion: "v1",
          traceId: snapshot.traceId,
          asOf: snapshot.asOf,
          symbol: snapshot.symbol,
          regime: "trending_up" as const,
          trend: "long" as const,
          setup: "ready" as const,
          trigger: "confirmed" as const,
          diagnostics: [],
        };
      },
    },
    bullCase: {
      ...base,
      async run(analysis) {
        return {
          schemaVersion: "v1",
          traceId: analysis.traceId,
          symbol: analysis.symbol,
          side: "long" as const,
          confidence: 90,
          evidence: ["test"],
          invalidationConditions: [],
          veto: false,
        };
      },
    },
    bearCase: {
      ...base,
      async run(analysis) {
        return {
          schemaVersion: "v1",
          traceId: analysis.traceId,
          symbol: analysis.symbol,
          side: "short" as const,
          confidence: 10,
          evidence: ["test"],
          invalidationConditions: [],
          veto: false,
        };
      },
    },
    decision: {
      ...base,
      async run({ request, snapshot }) {
        return {
          schemaVersion: "v1",
          traceId: request.traceId,
          asOf: request.asOf,
          symbol: snapshot.symbol,
          action: "open_long" as const,
          confidence: 90,
          reason: "test opening",
          evidence: [],
          missingConfirmations: [],
          orderIntent: {
            symbol: snapshot.symbol,
            action: "open_long" as const,
            entryPrice: 100,
            notional: 100,
            stopLoss: 90,
            takeProfit: 120,
            leverage: 1,
          },
        };
      },
    },
    portfolio: {
      ...base,
      async run(decisions) {
        return [...decisions];
      },
    },
    risk: {
      ...base,
      async run({ decision }) {
        return {
          schemaVersion: "v1",
          traceId: decision.traceId,
          symbol: decision.symbol,
          passed: true,
          riskLevel: "safe" as const,
          corrections: {},
          warnings: [],
        };
      },
    },
    execution: executor,
    positionState: executor,
    positionMonitor: {
      ...base,
      async run({ request, position }) {
        return {
          schemaVersion: "v1",
          traceId: request.traceId,
          asOf: request.asOf,
          symbol: position.symbol,
          action:
            position.side === "long"
              ? ("close_long" as const)
              : ("close_short" as const),
          confidence: 100,
          reason: "test close",
          evidence: [],
          missingConfirmations: [],
          orderIntent: {
            symbol: position.symbol,
            action:
              position.side === "long"
                ? ("close_long" as const)
                : ("close_short" as const),
            entryPrice: 100,
            notional: position.qty * 100,
            stopLoss: 0,
            takeProfit: 0,
            leverage: position.leverage,
          },
        };
      },
    },
  });
  const application: TradingApplication = {
    async runCycle(request) {
      options.requests?.push(request);
      if (options.hold) {
        await options.hold;
      }
      return pipeline.runCycle(request);
    },
  };
  return { application, executor, syncedSymbols };
}

interface Context {
  runtime: CurrentPipelineOrchestrationRuntime;
  directory: string;
}

function setup(
  bindings: readonly RegisteredPaperRuntimeBinding[] = [],
): Context {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-paper-runtime-"));
  return {
    directory,
    runtime: createCurrentPipelineOrchestrationRuntime({
      databasePath: ":memory:",
      operatorToken: "paper-runtime-test-token",
      operatorActor: actor,
      artifactDirectory: directory,
      historicalRunners: [
        historicalRunner("backtest"),
        historicalRunner("walk_forward"),
      ],
      paperPlanPolicy: {
        planVersion: "1.0.0-runtime",
        marketPackRefs: ["market-pack:crypto:v1"],
        paperAccountRef: "paper-account:runtime-test",
        candidateSymbols: ["BTCUSDT", "ETHUSDT"],
        riskPolicyRefs: ["risk-policy:runtime-test"],
      },
      paperRuntimeBindings: bindings,
    }),
  };
}

async function readyPlan(runtime: CurrentPipelineOrchestrationRuntime) {
  const draft = runtime.service.createDraft(CURRENT_CRYPTO_PIPELINE_GRAPH);
  runtime.evidenceWorkflow.validateContract(draft.draftId, actor);
  await runtime.evidenceWorkflow.runEvidenceJob(
    draft.draftId,
    "backtest",
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "runtime-backtest-key",
      parameters: {},
    },
    actor,
  );
  await runtime.evidenceWorkflow.runEvidenceJob(
    draft.draftId,
    "walk_forward",
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "runtime-walk-forward-key",
      parameters: {},
    },
    actor,
  );
  runtime.evidenceWorkflow.approve(
    draft.draftId,
    { schemaVersion: "1.0.0", decision: "approve" },
    actor,
  );
  const plan = runtime.paperPlanService.createPlan(
    draft.draftId,
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "runtime-paper-plan-key",
    },
    actor,
  );
  runtime.paperPlanService.activate(
    plan.planId,
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "runtime-activation-key",
      confirmation: "activate_paper_plan",
    },
    actor,
  );
  return plan;
}

async function waitForTerminal(
  runtime: CurrentPipelineOrchestrationRuntime,
  runId: string,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = runtime.paperRuntimeActivationService.getRun(runId);
    if (
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "safety_blocked"
    ) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("Paper Runtime test timed out.");
}

function binding(
  factory: RegisteredPaperRuntimeBinding["createRuntime"],
  overrides: Partial<RegisteredPaperRuntimeBinding> = {},
): RegisteredPaperRuntimeBinding {
  return {
    bindingId: "paper-binding:test",
    paperAccountRef: "paper-account:runtime-test",
    strategyProfileRef: "strategy-profile:runtime:v1",
    riskPolicyRefs: ["risk-policy:runtime-test"],
    candidateSymbols: ["BTCUSDT", "ETHUSDT"],
    maxCycles: 1,
    intervalMs: 0,
    exchangeWriteAllowed: false,
    createRuntime: factory,
    ...overrides,
  };
}

test("DecisionPipeline close_only blocks openings but preserves Position Monitor closes", async () => {
  const built = createDecisionApplication();
  const request = {
    schemaVersion: "v1" as const,
    runMode: "paper" as const,
    asOf: new Date("2026-07-26T00:00:00.000Z"),
    strategyId: "strategy:test",
    configVersion: "config:test",
    symbols: ["BTCUSDT", "ETHUSDT"],
    executionEnabled: true,
  };
  const opened = await built.application.runCycle({
    ...request,
    traceId: "trace:normal",
    executionMode: "normal",
  });
  assert.equal(opened.executions.length, 1);
  assert.equal((await built.executor.getOpenPositions()).length, 1);
  const closed = await built.application.runCycle({
    ...request,
    traceId: "trace:close-only",
    executionMode: "close_only",
  });
  assert.deepEqual(
    built.executor.getOrderJournal().map((order) => order.action),
    ["open_long", "close_long"],
  );
  assert.equal(closed.executions.length, 1);
  assert.equal((await built.executor.getOpenPositions()).length, 0);
  assert.equal(
    built.syncedSymbols.filter((symbol) => symbol === "BTCUSDT").length,
    2,
  );
});

test("activated plan runs a bounded server binding and applies close-only per cycle", async () => {
  const requests: CycleRequest[] = [];
  const built = createDecisionApplication({ requests });
  const context = setup([
    binding(async () => ({
      application: built.application,
      safety: safety(),
    })),
  ]);
  try {
    const plan = await readyPlan(context.runtime);
    context.runtime.paperPlanService.recordCloseOnly(
      plan.planId,
      {
        schemaVersion: "1.0.0",
        idempotencyKey: "runtime-close-only-key",
        mode: "pause_new_openings_close_only",
        confirmation: "pause_new_openings_close_only",
      },
      actor,
    );
    const queued = context.runtime.paperRuntimeActivationService.startRun(
      plan.planId,
      {
        schemaVersion: "1.0.0",
        idempotencyKey: "runtime-start-key",
        confirmation: "start_bounded_paper_run",
      },
      actor,
    );
    const completed = await waitForTerminal(context.runtime, queued.runId);
    assert.equal(completed.status, "completed");
    assert.equal(completed.paperRuntimeApplied, true);
    assert.equal(completed.exchangeWriteAllowed, false);
    assert.equal(completed.processedCycles, 1);
    assert.equal(completed.lastControlApplied, true);
    assert.equal(
      completed.lastControlMode,
      "pause_new_openings_close_only",
    );
    assert.equal(requests[0]?.executionMode, "close_only");
    assert.equal(built.executor.getOrderJournal().length, 0);
    const cycles =
      context.runtime.paperRuntimeActivationService.getCycles(queued.runId);
    assert.equal(cycles[0]?.controlApplied, true);
    assert.equal(cycles[0]?.executionCount, 0);

    const normal = context.runtime.paperPlanService.recordNormal(
      plan.planId,
      {
        schemaVersion: "1.0.0",
        idempotencyKey: "runtime-resume-normal-key",
        mode: "normal",
        confirmation: "resume_normal_paper_cycles",
      },
      actor,
    );
    assert.equal(normal.mode, "normal");
    assert.equal(
      context.runtime.paperPlanService.findCurrentControl(plan.planId)?.mode,
      "normal",
    );
  } finally {
    await context.runtime.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test("runtime fails closed without binding and Safety blocks before application", async () => {
  const unbound = setup();
  try {
    const plan = await readyPlan(unbound.runtime);
    assert.throws(
      () =>
        unbound.runtime.paperRuntimeActivationService.startRun(
          plan.planId,
          {
            schemaVersion: "1.0.0",
            idempotencyKey: "unbound-runtime-key",
            confirmation: "start_bounded_paper_run",
          },
          actor,
        ),
      (error: unknown) =>
        error instanceof PaperRuntimeActivationError &&
        error.code === "PAPER_RUNTIME_BINDING_NOT_FOUND",
    );
  } finally {
    await unbound.runtime.close();
    rmSync(unbound.directory, { recursive: true, force: true });
  }

  let applicationCalls = 0;
  const blocked = setup([
    binding(async () => ({
      application: {
        async runCycle() {
          applicationCalls += 1;
          throw new Error("must not run");
        },
      },
      safety: safety({ blocked: true }),
    })),
  ]);
  try {
    const plan = await readyPlan(blocked.runtime);
    const queued = blocked.runtime.paperRuntimeActivationService.startRun(
      plan.planId,
      {
        schemaVersion: "1.0.0",
        idempotencyKey: "safety-blocked-key",
        confirmation: "start_bounded_paper_run",
      },
      actor,
    );
    const run = await waitForTerminal(blocked.runtime, queued.runId);
    assert.equal(run.status, "safety_blocked");
    assert.equal(run.paperRuntimeApplied, false);
    assert.equal(run.failureCode, "PAPER_RUNTIME_SAFETY_BLOCKED");
    assert.equal(applicationCalls, 0);
  } finally {
    await blocked.runtime.close();
    rmSync(blocked.directory, { recursive: true, force: true });
  }
});

test("runtime start is idempotent, locks concurrent runs, and recovers interruption", async () => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const built = createDecisionApplication({ hold });
  const context = setup([
    binding(async () => ({
      application: built.application,
      safety: safety(),
    })),
  ]);
  try {
    const plan = await readyPlan(context.runtime);
    const request = {
      schemaVersion: "1.0.0",
      idempotencyKey: "concurrent-runtime-key",
      confirmation: "start_bounded_paper_run",
    };
    const first = context.runtime.paperRuntimeActivationService.startRun(
      plan.planId,
      request,
      actor,
    );
    const same = context.runtime.paperRuntimeActivationService.startRun(
      plan.planId,
      request,
      actor,
    );
    assert.equal(same.runId, first.runId);
    assert.throws(
      () =>
        context.runtime.paperRuntimeActivationService.startRun(
          plan.planId,
          {
            ...request,
            idempotencyKey: "different-concurrent-key",
          },
          actor,
        ),
      (error: unknown) =>
        error instanceof PaperRuntimeActivationError &&
        error.code === "PAPER_RUNTIME_RUN_IN_PROGRESS",
    );
    release();
    const completed = await waitForTerminal(context.runtime, first.runId);
    assert.equal(completed.status, "completed");

    const interrupted = {
      ...completed,
      status: "running" as const,
      finishedAt: undefined,
      failureCode: undefined,
    };
    context.runtime.database
      .prepare(`
        UPDATE paper_runtime_runs
        SET status = 'running', record_json = ?
        WHERE run_id = ?
      `)
      .run(JSON.stringify(interrupted), completed.runId);
    const restored = new SqlitePaperRuntimeRunRepository(
      context.runtime.database,
    );
    assert.equal(restored.getRun(completed.runId).status, "failed");
    assert.equal(
      restored.getRun(completed.runId).failureCode,
      "PAPER_RUNTIME_RESTART_INTERRUPTED",
    );
  } finally {
    release();
    await context.runtime.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test("HTTP rejects client runtime parameters and exposes audited run state", async () => {
  const built = createDecisionApplication();
  const context = setup([
    binding(async () => ({
      application: built.application,
      safety: safety(),
    })),
  ]);
  try {
    const plan = await readyPlan(context.runtime);
    context.runtime.server.listen(0, "127.0.0.1");
    await once(context.runtime.server, "listening");
    const address = context.runtime.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;
    const path = `/api/orchestration/paper-plans/${encodeURIComponent(
      plan.planId,
    )}/runs`;
    const post = (body: unknown, authenticated = true) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authenticated
            ? { authorization: "Bearer paper-runtime-test-token" }
            : {}),
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await post(
          {
            schemaVersion: "1.0.0",
            idempotencyKey: "http-runtime-key",
            confirmation: "start_bounded_paper_run",
          },
          false,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await post({
          schemaVersion: "1.0.0",
          idempotencyKey: "http-runtime-key",
          confirmation: "start_bounded_paper_run",
          symbols: ["FORGED"],
          cycles: 999,
          module: "client-code.js",
        })
      ).status,
      422,
    );
    const accepted = await post({
      schemaVersion: "1.0.0",
      idempotencyKey: "http-runtime-key",
      confirmation: "start_bounded_paper_run",
    });
    assert.equal(accepted.status, 202);
    const queued = (await accepted.json()) as {
      data: { runId: string; exchangeWriteAllowed: false };
    };
    assert.equal(queued.data.exchangeWriteAllowed, false);
    const completed = await waitForTerminal(
      context.runtime,
      queued.data.runId,
    );
    const response = await fetch(
      `${base}/api/orchestration/paper-runs/${encodeURIComponent(
        completed.runId,
      )}`,
      {
        headers: {
          authorization: "Bearer paper-runtime-test-token",
        },
      },
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: {
        status: string;
        paperRuntimeApplied: boolean;
        exchangeWriteAllowed: false;
      };
    };
    assert.equal(body.data.status, "completed");
    assert.equal(body.data.paperRuntimeApplied, true);
    assert.equal(body.data.exchangeWriteAllowed, false);
  } finally {
    await context.runtime.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});
