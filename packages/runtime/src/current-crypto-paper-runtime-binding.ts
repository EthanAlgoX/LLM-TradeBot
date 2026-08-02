import { DatabaseSync } from "node:sqlite";
import {
  RuleAnalysisPipelineAgent,
  RuleBearCaseAgent,
  RuleBullCaseAgent,
  RuleDataQualityGate,
  RuleDecisionAgent,
  RulePortfolioRiskGuard,
  RulePositionMonitorAgent,
  RuleReflectionAgent,
  RuleRiskAgent,
  SingleBestPortfolioAgent,
} from "../../agents/src/index.js";
import {
  BinanceFuturesMarketDataSource,
  BinanceFuturesReadClient,
  HistoricalDataSyncAgent,
  MarketOpportunitySelectorAgent,
  PersistentPaperExecutionAgent,
  SQLiteAgentArtifactLedger,
  SQLitePaperAccountStore,
  SQLiteReflectionStore,
  SQLiteRuntimeSafetyStore,
  SQLiteTraceSink,
  type HistoricalCandleSource,
  type SelectorMetricsPort,
} from "../../adapters/src/index.js";
import {
  loadStrategyProfile,
  strategyProfileFingerprint,
} from "../../config/src/index.js";
import type {
  PaperRuntimePreflightCheck,
  StrategyProfile,
} from "../../contracts/src/index.js";
import { DecisionPipeline } from "../../core/src/trading-application.js";
import { PaperSafetyGuard } from "./paper-safety-guard.js";
import type { RegisteredPaperRuntimeBinding } from "./paper-runtime-activation.js";

export interface CurrentCryptoPublicMarketData
  extends HistoricalCandleSource,
    SelectorMetricsPort {}

export interface CurrentCryptoPaperRuntimeBindingConfig {
  profilePath: string;
  symbols: readonly string[];
  paperDatabasePath: string;
  accountId: string;
  safetyDatabasePath: string;
  traceDatabasePath?: string;
  artifactDatabasePath?: string;
  reflectionDatabasePath?: string;
  maxCycles?: number;
  continuous?: boolean;
  intervalMs?: number;
  maxConsecutiveFailures?: number;
  cooldownMs?: number;
}

export interface CurrentCryptoPaperRuntimeBindingDependencies {
  marketDataFactory?: () => CurrentCryptoPublicMarketData;
  now?: () => Date;
  lifecycleObserver?: {
    opened(bindingId: string): void;
    closed(bindingId: string): void;
  };
}

export interface CurrentCryptoPaperRuntimeBinding
  extends RegisteredPaperRuntimeBinding {
  profileFingerprint: string;
  profile: StrategyProfile;
}

const registeredPaperCadences = [
  "1m",
  "5m",
  "10m",
  "15m",
  "30m",
  "1h",
  "3h",
  "5h",
] as const;

const cadenceByInterval = new Map<number, typeof registeredPaperCadences[number]>([
  [60_000, "1m"],
  [5 * 60_000, "5m"],
  [10 * 60_000, "10m"],
  [15 * 60_000, "15m"],
  [30 * 60_000, "30m"],
  [60 * 60_000, "1h"],
  [3 * 60 * 60_000, "3h"],
  [5 * 60 * 60_000, "5h"],
]);

export class CurrentCryptoPaperRuntimeBindingError extends Error {
  constructor(
    readonly code:
      | "PAPER_BINDING_CONFIG_INCOMPLETE"
      | "PAPER_BINDING_CONFIG_INVALID"
      | "PAPER_BINDING_PROFILE_LLM_NOT_ALLOWED"
      | "PAPER_BINDING_PROFILE_INCOMPATIBLE",
    message: string,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "CurrentCryptoPaperRuntimeBindingError";
  }
}

const requiredEnvironmentKeys = [
  "TRADEBOT_PAPER_PROFILE_PATH",
  "TRADEBOT_PAPER_SYMBOLS",
  "TRADEBOT_PAPER_DB_PATH",
  "TRADEBOT_PAPER_ACCOUNT_ID",
  "TRADEBOT_PAPER_SAFETY_DB_PATH",
] as const;

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new CurrentCryptoPaperRuntimeBindingError(
      "PAPER_BINDING_CONFIG_INVALID",
      `${field} must be a non-empty server-owned value.`,
      { field },
    );
  }
  return normalized;
}

function positiveInteger(
  value: number,
  field: string,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new CurrentCryptoPaperRuntimeBindingError(
      "PAPER_BINDING_CONFIG_INVALID",
      `${field} must be an integer from 1 to ${maximum}.`,
      { field },
    );
  }
  return value;
}

function nonnegativeInteger(
  value: number,
  field: string,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new CurrentCryptoPaperRuntimeBindingError(
      "PAPER_BINDING_CONFIG_INVALID",
      `${field} must be an integer from 0 to ${maximum}.`,
      { field },
    );
  }
  return value;
}

function normalizedSymbols(rawSymbols: readonly string[]): readonly string[] {
  const symbols = rawSymbols.map((symbol) => symbol.trim());
  if (
    symbols.length === 0 ||
    symbols.some(
      (symbol) => !/^[A-Z0-9]{3,30}$/.test(symbol),
    ) ||
    new Set(symbols).size !== symbols.length
  ) {
    throw new CurrentCryptoPaperRuntimeBindingError(
      "PAPER_BINDING_CONFIG_INVALID",
      "Paper symbols must be a non-empty, unique uppercase server allowlist.",
      { field: "symbols" },
    );
  }
  return symbols;
}

function preflightCheck(
  checkId: string,
  component: PaperRuntimePreflightCheck["component"],
  status: "passed" | "failed",
  code: string,
  checkedAt: Date,
  startedAt: number,
  fields: Readonly<Record<string, string>> = {},
): PaperRuntimePreflightCheck {
  return {
    checkId,
    component,
    status,
    code,
    checkedAt: checkedAt.toISOString(),
    latencyMs: Math.max(0, Date.now() - startedAt),
    fields: { ...fields },
  };
}

function probeDatabase(
  path: string,
  component: PaperRuntimePreflightCheck["component"],
  checkedAt: Date,
): PaperRuntimePreflightCheck {
  const startedAt = Date.now();
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path);
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TEMP TABLE tradebot_preflight_write_probe (value TEXT NOT NULL);
      INSERT INTO tradebot_preflight_write_probe (value) VALUES ('probe');
      ROLLBACK;
    `);
    return preflightCheck(
      `${component}:read-write`,
      component,
      "passed",
      "PREFLIGHT_DATABASE_READ_WRITE_OK",
      checkedAt,
      startedAt,
    );
  } catch (error) {
    try {
      database?.exec("ROLLBACK");
    } catch {
      // The probe may fail before a transaction begins.
    }
    return preflightCheck(
      `${component}:read-write`,
      component,
      "failed",
      "PREFLIGHT_DATABASE_READ_WRITE_FAILED",
      checkedAt,
      startedAt,
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
    );
  } finally {
    database?.close();
  }
}

export async function createCurrentCryptoPaperRuntimeBinding(
  rawConfig: CurrentCryptoPaperRuntimeBindingConfig,
  dependencies: CurrentCryptoPaperRuntimeBindingDependencies = {},
): Promise<CurrentCryptoPaperRuntimeBinding> {
  const profilePath = requireText(rawConfig.profilePath, "profilePath");
  const paperDatabasePath = requireText(
    rawConfig.paperDatabasePath,
    "paperDatabasePath",
  );
  const accountId = requireText(rawConfig.accountId, "accountId");
  const safetyDatabasePath = requireText(
    rawConfig.safetyDatabasePath,
    "safetyDatabasePath",
  );
  const symbols = normalizedSymbols(rawConfig.symbols);
  const maxCycles = positiveInteger(
    rawConfig.maxCycles ?? 3,
    "maxCycles",
    100,
  );
  const intervalMs = nonnegativeInteger(
    rawConfig.intervalMs ?? 60_000,
    "intervalMs",
    86_400_000,
  );
  const defaultCadence = cadenceByInterval.get(intervalMs);
  const maxConsecutiveFailures = positiveInteger(
    rawConfig.maxConsecutiveFailures ?? 3,
    "maxConsecutiveFailures",
    100,
  );
  const cooldownMs = nonnegativeInteger(
    rawConfig.cooldownMs ?? 300_000,
    "cooldownMs",
    86_400_000,
  );
  const profile = await loadStrategyProfile(profilePath);
  if (profile.llm.enabled) {
    throw new CurrentCryptoPaperRuntimeBindingError(
      "PAPER_BINDING_PROFILE_LLM_NOT_ALLOWED",
      "Current Crypto Paper Binding does not implicitly authorize an LLM provider.",
      { profileId: profile.profileId },
    );
  }
  if (profile.selector.topN !== 1) {
    throw new CurrentCryptoPaperRuntimeBindingError(
      "PAPER_BINDING_PROFILE_INCOMPATIBLE",
      "Current Crypto Paper Binding preserves Selector topN=1.",
      {
        profileId: profile.profileId,
        selectorTopN: String(profile.selector.topN),
      },
    );
  }
  const profileFingerprint = strategyProfileFingerprint(profile);
  const strategyProfileRef = `${profile.profileId}@${profile.profileVersion}:${profileFingerprint}`;
  const paperAccountRef = `paper-account:${accountId}`;
  const riskPolicyRefs = [
    `risk-policy:${profile.profileId}@${profile.profileVersion}:${profileFingerprint}`,
  ];
  const bindingId = `paper-runtime-binding:current-crypto:${accountId}:${profileFingerprint}`;
  const marketDataFactory =
    dependencies.marketDataFactory ??
    (() =>
      new BinanceFuturesMarketDataSource(
        new BinanceFuturesReadClient(),
      ));

  return {
    bindingId,
    bindingFingerprint: profileFingerprint,
    preflightRequired: true,
    paperAccountRef,
    strategyProfileRef,
    profileFingerprint,
    profile,
    riskPolicyRefs,
    candidateSymbols: [...symbols],
    initialCash: profile.execution.initialCash,
    maxCycles,
    continuous: rawConfig.continuous === true,
    ...(defaultCadence
      ? {
          allowedCadences: registeredPaperCadences,
          defaultCadence,
        }
      : {}),
    intervalMs,
    exchangeWriteAllowed: false,
    async preflight({ now }) {
      const checks: PaperRuntimePreflightCheck[] = [
        probeDatabase(paperDatabasePath, "paper_database", now),
        probeDatabase(safetyDatabasePath, "safety_database", now),
        ...(rawConfig.traceDatabasePath
          ? [probeDatabase(rawConfig.traceDatabasePath, "trace_database", now)]
          : []),
        ...(rawConfig.artifactDatabasePath
          ? [
              probeDatabase(
                rawConfig.artifactDatabasePath,
                "artifact_database",
                now,
              ),
            ]
          : []),
        ...(rawConfig.reflectionDatabasePath
          ? [
              probeDatabase(
                rawConfig.reflectionDatabasePath,
                "reflection_database",
                now,
              ),
            ]
          : []),
      ];
      const market = marketDataFactory();
      const metricsStartedAt = Date.now();
      try {
        const metrics = await market.getMetrics(now, symbols);
        const returned = new Set(metrics.map((metric) => metric.symbol));
        const complete =
          symbols.every((symbol) => returned.has(symbol)) &&
          metrics.every(
            (metric) =>
              Number.isFinite(metric.price) &&
              metric.price > 0 &&
              Number.isFinite(metric.quoteVolume24h),
          );
        checks.push(
          preflightCheck(
            "market-ticker:candidate-pool",
            "market_ticker",
            complete ? "passed" : "failed",
            complete
              ? "PREFLIGHT_MARKET_TICKER_OK"
              : "PREFLIGHT_MARKET_TICKER_INCOMPLETE",
            now,
            metricsStartedAt,
            {
              requestedSymbols: symbols.join(","),
              returnedSymbols: [...returned].sort().join(","),
            },
          ),
        );
      } catch (error) {
        checks.push(
          preflightCheck(
            "market-ticker:candidate-pool",
            "market_ticker",
            "failed",
            "PREFLIGHT_MARKET_TICKER_UNAVAILABLE",
            now,
            metricsStartedAt,
            {
              errorName: error instanceof Error ? error.name : "UnknownError",
            },
          ),
        );
      }

      const intervals = [
        ["5m", 5 * 60_000],
        ["15m", 15 * 60_000],
        ["1h", 60 * 60_000],
      ] as const;
      for (const symbol of symbols) {
        for (const [timeframe, timeframeMs] of intervals) {
          const startedAt = Date.now();
          try {
            const bars = await market.loadBars(symbol, timeframe);
            const latest = bars.at(-1);
            const ageMs = latest
              ? now.getTime() - latest.closeTime.getTime()
              : Number.POSITIVE_INFINITY;
            const passed =
              Boolean(latest) &&
              latest!.closeTime.getTime() <= now.getTime() &&
              ageMs >= 0 &&
              ageMs <= timeframeMs * 3;
            checks.push(
              preflightCheck(
                `market-bars:${symbol}:${timeframe}`,
                "market_bars",
                passed ? "passed" : "failed",
                passed
                  ? "PREFLIGHT_MARKET_BARS_CLOSED_FRESH"
                  : latest
                    ? "PREFLIGHT_MARKET_BARS_STALE_OR_OPEN"
                    : "PREFLIGHT_MARKET_BARS_MISSING",
                now,
                startedAt,
                {
                  symbol,
                  timeframe,
                  barCount: String(bars.length),
                  ...(latest
                    ? {
                        latestCloseTime: latest.closeTime.toISOString(),
                        ageMs: String(ageMs),
                      }
                    : {}),
                },
              ),
            );
          } catch (error) {
            checks.push(
              preflightCheck(
                `market-bars:${symbol}:${timeframe}`,
                "market_bars",
                "failed",
                "PREFLIGHT_MARKET_BARS_UNAVAILABLE",
                now,
                startedAt,
                {
                  symbol,
                  timeframe,
                  errorName:
                    error instanceof Error ? error.name : "UnknownError",
                },
              ),
            );
          }
        }
      }
      return { checks };
    },
    async createRuntime(context) {
      const closers: Array<() => void> = [];
      let closed = false;
      try {
        const scopedAccountId = context?.scope?.accountId ?? accountId;
        const scopedInitialCash = context?.scope?.initialCash ?? profile.execution.initialCash;
        // Safety is deliberately deployment-scoped rather than merely
        // account-scoped so a recycled account id cannot inherit a stale
        // cooldown. Trace ids carry deployment/run/cycle identity too.
        const safetyScope = context?.scope?.deploymentId ?? scopedAccountId;
        const paperStore = new SQLitePaperAccountStore(paperDatabasePath);
        closers.push(() => paperStore.close());
        const safetyStore = new SQLiteRuntimeSafetyStore(safetyDatabasePath);
        closers.push(() => safetyStore.close());
        const reflectionStore = rawConfig.reflectionDatabasePath
          ? new SQLiteReflectionStore(rawConfig.reflectionDatabasePath)
          : undefined;
        if (reflectionStore) {
          closers.push(() => reflectionStore.close());
        }
        const traceSink = rawConfig.traceDatabasePath
          ? new SQLiteTraceSink(rawConfig.traceDatabasePath)
          : undefined;
        if (traceSink) {
          closers.push(() => traceSink.close());
        }
        const artifactLedger = rawConfig.artifactDatabasePath
          ? new SQLiteAgentArtifactLedger(rawConfig.artifactDatabasePath)
          : undefined;
        if (artifactLedger) {
          closers.push(() => artifactLedger.close());
        }
        await paperStore.initialize(scopedAccountId, scopedInitialCash);
        const executor = await PersistentPaperExecutionAgent.open(
          scopedAccountId,
          paperStore,
          {
            initialCash: scopedInitialCash,
            feeBps: profile.execution.feeBps,
            slippageBps: profile.execution.slippageBps,
          },
        );
        const market = marketDataFactory();
        const reflection = new RuleReflectionAgent({
          semanticCandidate: {
            marketPackRef: {
              id: "market-pack:crypto:v1",
              version: "1.0.0",
              fingerprint: "sha256:e0f5f3522ac99c6598eebc0693162aa62d9f5f674a590e9404c6c7118d15bdf7",
            },
            reflectionAgentConfigRef: {
              id: "agent-config:rule-reflection:v1",
              version: "1.0.0",
              fingerprint: "sha256:de2e927d143973643bce184231a844c25eaefa77476981e5853321e4b12c88ae",
            },
          },
        });
        const fencedExecution = context?.scope?.assertFenced
          ? {
              name: executor.name,
              version: executor.version,
              run: async (input: Parameters<typeof executor.run>[0]) => {
                await context.scope!.assertFenced!();
                return executor.run(input);
              },
            }
          : executor;
        const application = new DecisionPipeline({
          selector: new MarketOpportunitySelectorAgent(market, {
            candidates: symbols,
            ...profile.selector,
          }),
          dataSync: new HistoricalDataSyncAgent(market),
          dataQuality: new RuleDataQualityGate(profile.dataQuality),
          analysis: new RuleAnalysisPipelineAgent(),
          bullCase: new RuleBullCaseAgent(),
          bearCase: new RuleBearCaseAgent(),
          decision: new RuleDecisionAgent(profile.decision),
          portfolio: new SingleBestPortfolioAgent(),
          risk: new RuleRiskAgent(profile.risk),
          execution: fencedExecution,
          positionState: executor,
          portfolioState: executor,
          portfolioRisk: new RulePortfolioRiskGuard(profile.accountRisk),
          positionMonitor: new RulePositionMonitorAgent(
            context?.scope?.closeOnly ? { maxHoldingMs: 0 } : {},
          ),
          reflection,
          tradeHistory: executor,
          ...(reflectionStore
            ? { reflectionStore, reflectionAccountId: scopedAccountId }
            : {}),
          ...(traceSink ? { traceSink } : {}),
          ...(artifactLedger ? { artifactLedger } : {}),
          maxExecutionsPerCycle:
            profile.execution.maxExecutionsPerCycle,
          ...(dependencies.now ? { now: dependencies.now } : {}),
        });
        const safety = new PaperSafetyGuard(
          safetyScope,
          safetyStore,
          {
            maxConsecutiveFailures,
            cooldownMs,
            maxExecutionsPerCycle:
              profile.execution.maxExecutionsPerCycle,
          },
          dependencies.now,
        );
        dependencies.lifecycleObserver?.opened(bindingId);
        return {
          application,
          safety,
          portfolioState: (markPrices) =>
            executor.markToMarket(markPrices),
          hasOpenPositions: async () =>
            (await executor.getOpenPositions()).length > 0,
          ...(traceSink ? { loadTrace: (traceId: string) => traceSink.load(traceId) } : {}),
          ...(artifactLedger
            ? { loadArtifacts: (traceId: string) => artifactLedger.query({ traceId, limit: 500 }) }
            : {}),
          close() {
            if (closed) {
              return;
            }
            closed = true;
            for (const close of [...closers].reverse()) {
              close();
            }
            dependencies.lifecycleObserver?.closed(bindingId);
          },
        };
      } catch (error) {
        for (const close of [...closers].reverse()) {
          close();
        }
        throw error;
      }
    },
  };
}

export async function loadCurrentCryptoPaperRuntimeBindingFromEnv(
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: CurrentCryptoPaperRuntimeBindingDependencies = {},
): Promise<CurrentCryptoPaperRuntimeBinding | undefined> {
  const configuredKeys = requiredEnvironmentKeys.filter(
    (key) => Boolean(environment[key]),
  );
  if (configuredKeys.length === 0) {
    return undefined;
  }
  const missingKeys = requiredEnvironmentKeys.filter(
    (key) => !environment[key],
  );
  if (missingKeys.length > 0) {
    throw new CurrentCryptoPaperRuntimeBindingError(
      "PAPER_BINDING_CONFIG_INCOMPLETE",
      "All required TRADEBOT_PAPER_* settings must be configured together.",
      { missingKeys: missingKeys.join(",") },
    );
  }
  return createCurrentCryptoPaperRuntimeBinding(
    {
      profilePath: environment.TRADEBOT_PAPER_PROFILE_PATH!,
      symbols: environment.TRADEBOT_PAPER_SYMBOLS!
        .split(",")
        .map((symbol) => symbol.trim()),
      paperDatabasePath: environment.TRADEBOT_PAPER_DB_PATH!,
      accountId: environment.TRADEBOT_PAPER_ACCOUNT_ID!,
      safetyDatabasePath: environment.TRADEBOT_PAPER_SAFETY_DB_PATH!,
      ...(environment.TRADEBOT_PAPER_TRACE_DB_PATH
        ? { traceDatabasePath: environment.TRADEBOT_PAPER_TRACE_DB_PATH }
        : {}),
      ...(environment.TRADEBOT_PAPER_ARTIFACT_DB_PATH
        ? {
            artifactDatabasePath:
              environment.TRADEBOT_PAPER_ARTIFACT_DB_PATH,
          }
        : {}),
      ...(environment.TRADEBOT_PAPER_REFLECTION_DB_PATH
        ? {
            reflectionDatabasePath:
              environment.TRADEBOT_PAPER_REFLECTION_DB_PATH,
          }
        : {}),
      maxCycles: Number(
        environment.TRADEBOT_PAPER_MAX_CYCLES ?? 3,
      ),
      continuous:
        environment.TRADEBOT_PAPER_CONTINUOUS !== "false",
      intervalMs:
        Number(environment.TRADEBOT_PAPER_INTERVAL_SECONDS ?? 60) *
        1_000,
      maxConsecutiveFailures: Number(
        environment.TRADEBOT_PAPER_MAX_CONSECUTIVE_FAILURES ?? 3,
      ),
      cooldownMs:
        Number(environment.TRADEBOT_PAPER_COOLDOWN_SECONDS ?? 300) *
        1_000,
    },
    dependencies,
  );
}
