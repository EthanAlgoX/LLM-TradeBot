import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SQLitePaperAccountStore,
  SQLiteRuntimeSafetyStore,
} from "../packages/adapters/src/index.js";
import type {
  MarketBar,
  OrchestrationActor,
} from "../packages/contracts/src/index.js";
import {
  CURRENT_CRYPTO_PIPELINE_GRAPH,
} from "../packages/core/src/index.js";
import {
  createCurrentPipelineOrchestrationRuntime,
  createCurrentCryptoPaperRuntimeBinding,
  CurrentCryptoPaperRuntimeBindingError,
  type CurrentCryptoPublicMarketData,
  loadCurrentCryptoPaperRuntimeBindingFromEnv,
  PaperRuntimeActivationError,
  type CurrentCryptoPaperRuntimeBinding,
  type CurrentPipelineOrchestrationRuntime,
  type RegisteredHistoricalEvidenceRunner,
} from "../packages/runtime/src/index.js";

const actor: OrchestrationActor = {
  actorId: "test:concrete-paper-operator",
  displayName: "Concrete Paper Operator",
  roles: ["operator", "approver"],
};

function profileOverride(extra: object = {}): object {
  return {
    selector: {
      topN: 1,
      minQuoteVolume24h: 0,
      minPrice: 0.00000001,
      minTrendStrength: 0,
      minVolatilityPct: 0,
      maxVolatilityPct: 100,
    },
    dataQuality: {
      minBars5m: 1,
      minBars15m: 1,
      minBars1h: 1,
      requireAlignment: true,
      maxQuoteAgeMs: 86_400_000,
    },
    decision: {
      perTradeNotional: 100,
      leverage: 1,
      minimumConfidence: 0,
    },
    llm: {
      enabled: false,
      timeoutMs: 1_000,
      fallbackToRules: true,
    },
    ...extra,
  };
}

class FakePublicMarketData implements CurrentCryptoPublicMarketData {
  readonly loadedSymbols: string[] = [];
  readonly metricRequests: string[][] = [];

  async getMetrics(_asOf: Date, symbols: readonly string[]) {
    this.metricRequests.push([...symbols]);
    return symbols.map((symbol) => ({
      symbol,
      quoteVolume24h: symbol === "ETHUSDT" ? 2_000_000 : 1_000_000,
      price: 90,
      momentum30mPct: symbol === "ETHUSDT" ? 5 : 2,
      trendStrength: symbol === "ETHUSDT" ? 90 : 70,
      volatilityPct: 2,
    }));
  }

  async loadBars(
    symbol: string,
    timeframe: "5m" | "15m" | "1h",
  ): Promise<readonly MarketBar[]> {
    this.loadedSymbols.push(symbol);
    const intervalMs =
      timeframe === "5m"
        ? 300_000
        : timeframe === "15m"
          ? 900_000
          : 3_600_000;
    const now = Date.now();
    return Array.from({ length: 60 }, (_, index) => {
      const closeTime = new Date(
        now - (60 - index) * intervalMs,
      );
      const open = 100 - index * 0.15;
      const close = open - 0.1;
      return {
        timeframe,
        openTime: new Date(closeTime.getTime() - intervalMs),
        closeTime,
        open,
        high: open + 0.2,
        low: close - 0.2,
        close,
        volume: 1_000 + index,
      };
    });
  }
}

function historicalRunner(
  binding: CurrentCryptoPaperRuntimeBinding,
  kind: "backtest" | "walk_forward",
): RegisteredHistoricalEvidenceRunner {
  return {
    runnerId: `concrete-binding-evidence:${kind}`,
    kind,
    allowedParameterKeys: [],
    strategyProfileRef: binding.strategyProfileRef,
    dataSourceRef: "data-source:csv-historical",
    dataFingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    timezone: "UTC",
    tradingCalendarRef: "calendar:crypto-24x7",
    costModel: { feeBps: 4, slippageBps: 2 },
    requestedAsOf: () => "2026-07-26T00:00:00.000Z",
    async run() {
      return {
        schemaVersion: "1.0.0",
        metrics: { score: kind === "backtest" ? 1 : 2 },
        summary: `${kind} concrete binding evidence`,
        observations: [],
      };
    },
  };
}

async function readyPlan(
  runtime: CurrentPipelineOrchestrationRuntime,
) {
  const draft = runtime.service.createDraft(CURRENT_CRYPTO_PIPELINE_GRAPH);
  runtime.evidenceWorkflow.validateContract(draft.draftId, actor);
  await runtime.evidenceWorkflow.runEvidenceJob(
    draft.draftId,
    "backtest",
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "concrete-backtest-key",
      parameters: {},
    },
    actor,
  );
  await runtime.evidenceWorkflow.runEvidenceJob(
    draft.draftId,
    "walk_forward",
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "concrete-walk-forward-key",
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
      idempotencyKey: "concrete-plan-key",
    },
    actor,
  );
  runtime.paperPlanService.activate(
    plan.planId,
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "concrete-activation-key",
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
  for (let attempt = 0; attempt < 200; attempt += 1) {
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
  throw new Error("Concrete Paper Runtime test timed out.");
}

test("trusted env is all-or-nothing and LLM-enabled profiles fail closed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-binding-config-"));
  try {
    assert.equal(
      await loadCurrentCryptoPaperRuntimeBindingFromEnv({}),
      undefined,
    );
    await assert.rejects(
      () =>
        loadCurrentCryptoPaperRuntimeBindingFromEnv({
          TRADEBOT_PAPER_PROFILE_PATH: join(directory, "profile.json"),
        }),
      (error: unknown) =>
        error instanceof CurrentCryptoPaperRuntimeBindingError &&
        error.code === "PAPER_BINDING_CONFIG_INCOMPLETE",
    );
    const llmProfile = join(directory, "llm-profile.json");
    writeFileSync(
      llmProfile,
      JSON.stringify(
        profileOverride({
          llm: {
            enabled: true,
            timeoutMs: 1_000,
            fallbackToRules: true,
          },
        }),
      ),
    );
    await assert.rejects(
      () =>
        loadCurrentCryptoPaperRuntimeBindingFromEnv({
          TRADEBOT_PAPER_PROFILE_PATH: llmProfile,
          TRADEBOT_PAPER_SYMBOLS: "BTCUSDT",
          TRADEBOT_PAPER_DB_PATH: join(directory, "paper.db"),
          TRADEBOT_PAPER_ACCOUNT_ID: "main",
          TRADEBOT_PAPER_SAFETY_DB_PATH: join(
            directory,
            "safety.db",
          ),
        }),
      (error: unknown) =>
        error instanceof CurrentCryptoPaperRuntimeBindingError &&
        error.code === "PAPER_BINDING_PROFILE_LLM_NOT_ALLOWED",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concrete binding restores a position, applies close-only, and closes resources", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-binding-run-"));
  const profilePath = join(directory, "profile.json");
  const paperPath = join(directory, "paper.db");
  const safetyPath = join(directory, "safety.db");
  const artifactDirectory = join(directory, "evidence");
  writeFileSync(profilePath, JSON.stringify(profileOverride()));
  const market = new FakePublicMarketData();
  const lifecycle = { opened: 0, closed: 0 };
  const binding = await createCurrentCryptoPaperRuntimeBinding(
    {
      profilePath,
      symbols: ["BTCUSDT", "ETHUSDT"],
      paperDatabasePath: paperPath,
      accountId: "main",
      safetyDatabasePath: safetyPath,
      traceDatabasePath: join(directory, "trace.db"),
      artifactDatabasePath: join(directory, "agent-artifacts.db"),
      reflectionDatabasePath: join(directory, "reflection.db"),
      maxCycles: 1,
      intervalMs: 0,
    },
    {
      marketDataFactory: () => market,
      lifecycleObserver: {
        opened() {
          lifecycle.opened += 1;
        },
        closed() {
          lifecycle.closed += 1;
        },
      },
    },
  );
  const accountStore = new SQLitePaperAccountStore(paperPath);
  await accountStore.save("main", {
    schemaVersion: "v1",
    cash: 9_900,
    realizedPnl: 0,
    fees: 0,
    positions: [
      {
        symbol: "BTCUSDT",
        side: "long",
        qty: 1,
        entryPrice: 100,
        leverage: 1,
        margin: 100,
        stopLoss: 95,
        takeProfit: 120,
        openedAt: new Date(Date.now() - 3_600_000),
        openingFee: 0,
      },
    ],
    closedTrades: [],
    orders: [],
  });
  accountStore.close();
  const runtime = createCurrentPipelineOrchestrationRuntime({
    databasePath: ":memory:",
    operatorToken: "concrete-binding-token",
    operatorActor: actor,
    artifactDirectory,
    historicalRunners: [
      historicalRunner(binding, "backtest"),
      historicalRunner(binding, "walk_forward"),
    ],
    paperRuntimeBindings: [binding],
    paperPlanPolicy: {
      planVersion: `concrete:${binding.profileFingerprint}`,
      marketPackRefs: ["market-pack:crypto:v1"],
      paperAccountRef: binding.paperAccountRef,
      candidateSymbols: [...binding.candidateSymbols],
      riskPolicyRefs: [...binding.riskPolicyRefs],
    },
  });
  try {
    const plan = await readyPlan(runtime);
    runtime.paperPlanService.recordCloseOnly(
      plan.planId,
      {
        schemaVersion: "1.0.0",
        idempotencyKey: "concrete-close-only-key",
        mode: "pause_new_openings_close_only",
        confirmation: "pause_new_openings_close_only",
      },
      actor,
    );
    const preflight = await runtime.paperRuntimeActivationService.runPreflight(
      plan.planId,
      {
        schemaVersion: "1.0.0",
        idempotencyKey: "concrete-preflight-key",
        confirmation: "run_paper_runtime_preflight",
      },
      actor,
    );
    assert.equal(preflight.status, "passed");
    assert.equal(preflight.paperAccountMutationAllowed, false);
    const queued = runtime.paperRuntimeActivationService.startRun(
      plan.planId,
      {
        schemaVersion: "1.0.0",
        idempotencyKey: "concrete-run-key",
        confirmation: "start_bounded_paper_run",
      },
      actor,
    );
    const completed = await waitForTerminal(runtime, queued.runId);
    assert.equal(completed.status, "completed");
    assert.equal(completed.exchangeWriteAllowed, false);
    assert.equal(completed.lastControlApplied, true);
    assert.equal(lifecycle.opened, 1);
    assert.equal(lifecycle.closed, 1);
    assert.deepEqual(market.metricRequests[0], [
      "BTCUSDT",
      "ETHUSDT",
    ]);
    assert.equal(market.loadedSymbols.includes("BTCUSDT"), true);
    assert.equal(market.loadedSymbols.includes("ETHUSDT"), true);
    const restoredStore = new SQLitePaperAccountStore(paperPath);
    const restored = await restoredStore.load("main");
    restoredStore.close();
    assert.equal(restored?.positions.length, 0);
    assert.deepEqual(
      restored?.orders.map((order) => order.action),
      ["close_long"],
    );
    const cycles = runtime.paperRuntimeActivationService.getCycles(
      completed.runId,
    );
    assert.equal(cycles[0]?.executionCount, 1);
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concrete binding restores persisted Safety cooldown before market access", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-binding-safety-"));
  const profilePath = join(directory, "profile.json");
  const safetyPath = join(directory, "safety.db");
  writeFileSync(profilePath, JSON.stringify(profileOverride()));
  const market = new FakePublicMarketData();
  const binding = await createCurrentCryptoPaperRuntimeBinding(
    {
      profilePath,
      symbols: ["BTCUSDT"],
      paperDatabasePath: join(directory, "paper.db"),
      accountId: "safety-account",
      safetyDatabasePath: safetyPath,
      maxCycles: 1,
      intervalMs: 0,
    },
    { marketDataFactory: () => market },
  );
  const safetyStore = new SQLiteRuntimeSafetyStore(safetyPath);
  await safetyStore.save("safety-account", {
    consecutiveFailures: 3,
    cooldownUntil: new Date(Date.now() + 60_000),
    lastFailure: "persisted failure",
    updatedAt: new Date(),
  });
  safetyStore.close();
  const runtime = createCurrentPipelineOrchestrationRuntime({
    databasePath: ":memory:",
    operatorActor: actor,
    artifactDirectory: join(directory, "evidence"),
    historicalRunners: [
      historicalRunner(binding, "backtest"),
      historicalRunner(binding, "walk_forward"),
    ],
    paperRuntimeBindings: [binding],
    paperPlanPolicy: {
      planVersion: `safety:${binding.profileFingerprint}`,
      marketPackRefs: ["market-pack:crypto:v1"],
      paperAccountRef: binding.paperAccountRef,
      candidateSymbols: [...binding.candidateSymbols],
      riskPolicyRefs: [...binding.riskPolicyRefs],
    },
  });
  try {
    const plan = await readyPlan(runtime);
    const preflight = await runtime.paperRuntimeActivationService.runPreflight(
      plan.planId,
      {
        schemaVersion: "1.0.0",
        idempotencyKey: "persisted-safety-preflight-key",
        confirmation: "run_paper_runtime_preflight",
      },
      actor,
    );
    assert.equal(preflight.status, "passed");
    market.loadedSymbols.length = 0;
    const queued = runtime.paperRuntimeActivationService.startRun(
      plan.planId,
      {
        schemaVersion: "1.0.0",
        idempotencyKey: "persisted-safety-run-key",
        confirmation: "start_bounded_paper_run",
      },
      actor,
    );
    const blocked = await waitForTerminal(runtime, queued.runId);
    assert.equal(blocked.status, "safety_blocked");
    assert.equal(blocked.paperRuntimeApplied, false);
    assert.equal(market.loadedSymbols.length, 0);
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime rejects a concrete binding whose Profile differs from evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-binding-mismatch-"));
  const profilePath = join(directory, "profile.json");
  writeFileSync(profilePath, JSON.stringify(profileOverride()));
  const binding = await createCurrentCryptoPaperRuntimeBinding(
    {
      profilePath,
      symbols: ["BTCUSDT"],
      paperDatabasePath: join(directory, "paper.db"),
      accountId: "mismatch",
      safetyDatabasePath: join(directory, "safety.db"),
      maxCycles: 1,
      intervalMs: 0,
    },
    { marketDataFactory: () => new FakePublicMarketData() },
  );
  const mismatchedRunner = (
    kind: "backtest" | "walk_forward",
  ): RegisteredHistoricalEvidenceRunner => ({
    ...historicalRunner(binding, kind),
    strategyProfileRef: "strategy-profile:different:v9",
  });
  const runtime = createCurrentPipelineOrchestrationRuntime({
    databasePath: ":memory:",
    operatorActor: actor,
    artifactDirectory: join(directory, "evidence"),
    historicalRunners: [
      mismatchedRunner("backtest"),
      mismatchedRunner("walk_forward"),
    ],
    paperRuntimeBindings: [binding],
    paperPlanPolicy: {
      planVersion: "mismatch",
      marketPackRefs: ["market-pack:crypto:v1"],
      paperAccountRef: binding.paperAccountRef,
      candidateSymbols: [...binding.candidateSymbols],
      riskPolicyRefs: [...binding.riskPolicyRefs],
    },
  });
  try {
    const plan = await readyPlan(runtime);
    assert.throws(
      () =>
        runtime.paperRuntimeActivationService.startRun(
          plan.planId,
          {
            schemaVersion: "1.0.0",
            idempotencyKey: "mismatched-profile-run-key",
            confirmation: "start_bounded_paper_run",
          },
          actor,
        ),
      (error: unknown) =>
        error instanceof PaperRuntimeActivationError &&
        error.code === "PAPER_RUNTIME_BINDING_MISMATCH",
    );
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concrete preflight rejects an unwritable Paper DB and missing or stale bars without opening Runtime", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-binding-preflight-fail-"));
  const profilePath = join(directory, "profile.json");
  writeFileSync(profilePath, JSON.stringify(profileOverride()));
  const now = new Date("2026-07-26T04:00:00.000Z");
  const lifecycle = { opened: 0, closed: 0 };
  const staleBar = {
    openTime: new Date(now.getTime() - 3_900_000),
    closeTime: new Date(now.getTime() - 3_600_000),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
  };
  const market = {
    async getMetrics(_asOf: Date, symbols: readonly string[]) {
      return symbols.map((symbol) => ({
        symbol,
        quoteVolume24h: 1_000_000,
        price: 100,
        momentum30mPct: 0,
        trendStrength: 1,
        volatilityPct: 1,
      }));
    },
    async loadBars(_symbol: string, timeframe: "5m" | "15m" | "1h") {
      return timeframe === "15m" ? [] : [staleBar];
    },
  };
  try {
    const binding = await createCurrentCryptoPaperRuntimeBinding(
      {
        profilePath,
        symbols: ["BTCUSDT"],
        paperDatabasePath: join(directory, "missing-parent", "paper.db"),
        accountId: "preflight-fail",
        safetyDatabasePath: join(directory, "safety.db"),
        maxCycles: 1,
        intervalMs: 0,
      },
      {
        marketDataFactory: () => market,
        lifecycleObserver: {
          opened() {
            lifecycle.opened += 1;
          },
          closed() {
            lifecycle.closed += 1;
          },
        },
      },
    );
    const result = await binding.preflight!({
      plan: {} as never,
      activation: {} as never,
      now,
    });
    const codes = result.checks.map((check) => check.code);
    assert.equal(codes.includes("PREFLIGHT_DATABASE_READ_WRITE_FAILED"), true);
    assert.equal(codes.includes("PREFLIGHT_MARKET_BARS_MISSING"), true);
    assert.equal(codes.includes("PREFLIGHT_MARKET_BARS_STALE_OR_OPEN"), true);
    assert.deepEqual(lifecycle, { opened: 0, closed: 0 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
