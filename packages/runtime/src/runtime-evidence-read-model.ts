import { createHash } from "node:crypto";
import type {
  AgentArtifact,
  AgentArtifactQuery,
  PaperAccountState,
  PaperRuntimeCycleAudit,
  PaperRuntimeRun,
  ReflectionReport,
  RuntimeEvidenceDashboard,
  RuntimeEvidenceSourceMode,
  StageEvent,
} from "../../contracts/src/index.js";
import {
  RuntimeEvidenceDashboardSchema,
} from "../../contracts/src/index.js";
import { SQLiteAgentArtifactLedger } from "../../adapters/src/sqlite-agent-artifact-ledger.js";
import { SQLitePaperAccountStore } from "../../adapters/src/sqlite-paper-account-store.js";
import { SQLiteReflectionStore } from "../../adapters/src/sqlite-reflection-store.js";
import { SQLiteTraceSink } from "../../adapters/src/sqlite-trace-sink.js";
import { buildTradeReview } from "./review-presenter.js";

export interface RuntimeEvidenceReadModelConfig {
  paperAccountRef: string;
  accountId: string;
  marketPackRef: string;
  sourceMode: RuntimeEvidenceSourceMode;
  candidateSymbols: readonly string[];
  paperDatabasePath: string;
  traceDatabasePath?: string;
  artifactDatabasePath?: string;
  reflectionDatabasePath?: string;
  now?: () => Date;
}

export interface RuntimeEvidenceReadPorts {
  runs: {
    findLatestRun(): PaperRuntimeRun | undefined;
    getCycles(runId: string): readonly PaperRuntimeCycleAudit[];
  };
  accounts: {
    load(accountId: string): Promise<PaperAccountState | undefined>;
    close?(): void;
  };
  traces?: {
    latestTraceId(): string | undefined;
    load(traceId: string): StageEvent[];
    close?(): void;
  };
  artifacts?: {
    query(query: AgentArtifactQuery): Promise<readonly AgentArtifact[]>;
    close?(): void;
  };
  reflections?: {
    latest(accountId: string): Promise<ReflectionReport | undefined>;
    close?(): void;
  };
}

const activeRunStatuses = new Set([
  "queued",
  "running",
  "stop_requested",
]);

const semanticKeys = new Set([
  "action",
  "blockedReason",
  "confidence",
  "message",
  "passed",
  "rationale",
  "reason",
  "status",
  "summary",
  "thesis",
]);

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function semanticFragments(
  value: unknown,
  depth = 0,
): string[] {
  if (depth > 3 || !value || typeof value !== "object") return [];
  const fragments: string[] = [];
  for (const [key, entry] of Object.entries(safeRecord(value))) {
    if (
      semanticKeys.has(key) &&
      (typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean")
    ) {
      fragments.push(`${key}=${String(entry)}`);
    } else if (Array.isArray(entry)) {
      for (const item of entry.slice(0, 4)) {
        fragments.push(...semanticFragments(item, depth + 1));
      }
    } else if (entry && typeof entry === "object") {
      fragments.push(...semanticFragments(entry, depth + 1));
    }
  }
  return fragments;
}

function semanticSummary(artifact: AgentArtifact): string {
  if (artifact.status === "error") {
    return (artifact.error ?? "agent_error").slice(0, 600);
  }
  const output = artifact.output;
  const record = safeRecord(output);
  if (artifact.stage === "selector") {
    const candidate = Array.isArray(record.candidates)
      ? safeRecord(record.candidates[0])
      : {};
    const reasons = Array.isArray(candidate.selectedReasons)
      ? candidate.selectedReasons
          .filter((item): item is string => typeof item === "string")
          .slice(0, 2)
      : [];
    if (typeof candidate.symbol === "string") {
      return [
        `Selected ${candidate.symbol}`,
        typeof candidate.rank === "number" ? `rank ${candidate.rank}` : "",
        typeof candidate.score === "number" ? `score ${candidate.score}` : "",
        ...reasons,
      ].filter(Boolean).join(" · ").slice(0, 600);
    }
    return "No symbol passed the Selector gate.";
  }
  if (artifact.stage === "data") {
    const stableBars = safeRecord(record.stableBars);
    const windows = Object.entries(stableBars)
      .filter(([, bars]) => Array.isArray(bars))
      .map(([window, bars]) => `${window} ${(bars as unknown[]).length} bars`);
    const quote = safeRecord(record.liveQuote);
    const quality = safeRecord(record.quality);
    return [
      typeof record.symbol === "string" ? `${record.symbol} synchronized` : "Data synchronized",
      windows.join(", "),
      typeof quote.price === "number" ? `latest ${quote.price}` : "",
      quality.alignmentOk === true ? "windows aligned" : "",
    ].filter(Boolean).join(" · ").slice(0, 600);
  }
  if (artifact.stage === "data_quality") {
    const reasons = Array.isArray(record.reasons)
      ? record.reasons.filter((item): item is string => typeof item === "string")
      : [];
    return record.passed === true
      ? "Data quality passed."
      : `Data quality blocked${reasons.length ? `: ${reasons.slice(0, 3).join("; ")}` : "."}`;
  }
  if (artifact.stage === "analysis") {
    const diagnostics = Array.isArray(record.diagnostics)
      ? record.diagnostics
          .filter((item): item is string => typeof item === "string")
          .slice(0, 3)
      : [];
    return [
      typeof record.symbol === "string" ? record.symbol : "",
      typeof record.regime === "string" ? `regime ${record.regime}` : "",
      typeof record.trend === "string" ? `trend ${record.trend}` : "",
      typeof record.setup === "string" ? `setup ${record.setup}` : "",
      typeof record.trigger === "string" ? `trigger ${record.trigger}` : "",
      ...diagnostics,
    ].filter(Boolean).join(" · ").slice(0, 600);
  }
  if (artifact.stage === "position_monitor" && output === undefined) {
    return "No structured position-exit proposal was emitted.";
  }
  if (artifact.stage === "portfolio" && Array.isArray(output)) {
    return output.length === 0
      ? "No portfolio intent was emitted."
      : `${output.length} portfolio intent${output.length === 1 ? "" : "s"} emitted.`;
  }
  if (artifact.stage === "reflection" && output === undefined) {
    return "No new Lesson Candidate was emitted.";
  }
  const fragments = semanticFragments(artifact.output);
  return (fragments.length > 0
    ? fragments.slice(0, 8).join(" · ")
    : `${artifact.stage}:${artifact.status}`
  ).slice(0, 600);
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

export class RuntimeEvidenceReadModelService {
  constructor(
    private readonly config: RuntimeEvidenceReadModelConfig,
    private readonly ports: RuntimeEvidenceReadPorts,
  ) {}

  async read(): Promise<RuntimeEvidenceDashboard> {
    const generatedAt = (this.config.now?.() ?? new Date()).toISOString();
    const run = this.ports.runs.findLatestRun();
    if (!run) {
      const unavailable = {
        schemaVersion: "1.0.0" as const,
        readModelId: `runtime-evidence:${this.config.paperAccountRef}`,
        humanVersion: "1.0.0",
        generatedAt,
        evidenceStatus: "unavailable" as const,
        sourceMode: this.config.sourceMode,
        marketPackRef: this.config.marketPackRef,
        paperAccountRef: this.config.paperAccountRef,
        paperOnly: true as const,
        exchangeWriteAllowed: false as const,
        clientSelectorsAccepted: false as const,
        positionMonitor: {
          status: "unavailable" as const,
          monitoringSymbols: [],
        },
        semanticTransfers: [],
        decisionRiskExecution: {},
        reflection: {
          status: "unavailable" as const,
          candidateOnly: true as const,
          runtimeApplied: false as const,
          recommendations: [],
          adjustmentCount: 0,
        },
        lineage: {
          artifactIds: [],
          schemaRefs: ["tradebot.runtime-evidence-read-model.v1"],
          dataSourceRef: this.config.sourceMode,
        },
      };
      return RuntimeEvidenceDashboardSchema.parse({
        ...unavailable,
        fingerprint: fingerprint(unavailable),
      });
    }

    const cycles = this.ports.runs.getCycles(run.runId);
    const cycle = cycles[cycles.length - 1];
    const traceId =
      cycle?.traceId ??
      this.ports.traces?.latestTraceId();
    const account = await this.ports.accounts.load(this.config.accountId);
    const reflection = await this.ports.reflections?.latest(
      this.config.accountId,
    );
    const artifacts = traceId && this.ports.artifacts
      ? [...await this.ports.artifacts.query({ traceId, limit: 50 })]
      : [];
    const traceEvents = traceId && this.ports.traces
      ? this.ports.traces.load(traceId)
      : [];
    const review = buildTradeReview(artifacts);
    const summaries = artifacts
      .sort(
        (left, right) =>
          left.startedAt.getTime() - right.startedAt.getTime(),
      )
      .map((artifact) => ({
        artifactId: artifact.artifactId,
        sourceArtifactIds: [...(artifact.sourceArtifactIds ?? [])],
        traceId: artifact.traceId,
        stage: artifact.stage,
        agent: artifact.agent,
        agentVersion: artifact.agentVersion,
        status: artifact.status,
        ...(artifact.symbol ? { symbol: artifact.symbol } : {}),
        completedAt: artifact.completedAt.toISOString(),
        durationMs: artifact.durationMs,
        semanticSummary: semanticSummary(artifact),
      }));
    const selectedSymbols = [
      ...new Set(
        artifacts
          .map((artifact) => artifact.symbol)
          .filter((symbol): symbol is string => Boolean(symbol)),
      ),
    ].slice(0, 1);
    const positionMonitorArtifact = [...summaries]
      .reverse()
      .find((artifact) => artifact.stage === "position_monitor");
    const deployedMargin =
      account?.positions.reduce(
        (total, position) => total + position.margin,
        0,
      ) ?? 0;

    const content = {
      schemaVersion: "1.0.0" as const,
      readModelId: `runtime-evidence:${run.runId}`,
      humanVersion: "1.0.0",
      generatedAt,
      evidenceStatus: activeRunStatuses.has(run.status)
        ? "active" as const
        : "recent" as const,
      sourceMode: this.config.sourceMode,
      marketPackRef: this.config.marketPackRef,
      paperAccountRef: this.config.paperAccountRef,
      paperOnly: true as const,
      exchangeWriteAllowed: false as const,
      clientSelectorsAccepted: false as const,
      run: {
        runId: run.runId,
        planId: run.planId,
        status: run.status,
        strategyProfileRef: run.strategyProfileRef,
        processedCycles: run.processedCycles,
        plannedCycles: run.plannedCycles,
        controlMode: run.lastControlMode,
        requestedAt: run.requestedAt,
        ...(run.startedAt ? { startedAt: run.startedAt } : {}),
        ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
        ...(run.failureCode ? { failureCode: run.failureCode } : {}),
      },
      ...(cycle
        ? {
            cycle: {
              cycle: cycle.cycle,
              traceId: cycle.traceId,
              status: cycle.status,
              startedAt: cycle.startedAt,
              finishedAt: cycle.finishedAt,
              decisionCount: cycle.decisionCount,
              riskDecisionCount: cycle.riskDecisionCount,
              executionCount: cycle.executionCount,
              controlMode: cycle.controlMode,
            },
          }
        : {}),
      ...(account
        ? {
            account: {
              cash: account.cash,
              realizedPnl: account.realizedPnl,
              fees: account.fees,
              deployedMargin,
              openPositionCount: account.positions.length,
              closedTradeCount: account.closedTrades.length,
              positions: account.positions.map((position) => ({
                symbol: position.symbol,
                side: position.side,
                qty: position.qty,
                entryPrice: position.entryPrice,
                leverage: position.leverage,
                margin: position.margin,
                stopLoss: position.stopLoss,
                takeProfit: position.takeProfit,
                openedAt: position.openedAt.toISOString(),
                ...(position.entryConfidence !== undefined
                  ? { entryConfidence: position.entryConfidence }
                  : {}),
              })),
            },
          }
        : {}),
      selection: {
        topN: 1 as const,
        candidateSymbols: [...this.config.candidateSymbols],
        selectedSymbols,
      },
      positionMonitor: {
        status: account
          ? account.positions.length > 0
            ? "monitoring" as const
            : "flat" as const
          : "unavailable" as const,
        monitoringSymbols:
          account?.positions.map((position) => position.symbol) ?? [],
        ...(positionMonitorArtifact
          ? { semanticSummary: positionMonitorArtifact.semanticSummary }
          : {}),
      },
      semanticTransfers: summaries,
      decisionRiskExecution: {
        ...(review?.decision?.action
          ? { decisionAction: review.decision.action }
          : {}),
        ...(review?.decision?.confidence !== undefined
          ? { decisionConfidence: review.decision.confidence }
          : {}),
        ...(review?.risk?.passed !== undefined
          ? { riskPassed: review.risk.passed }
          : {}),
        ...(review?.risk?.blockedReason
          ? { riskBlockedReason: review.risk.blockedReason }
          : {}),
        ...(review?.execution?.status
          ? { executionStatus: review.execution.status }
          : {}),
        ...(review?.execution?.message
          ? { executionMessage: review.execution.message }
          : {}),
      },
      reflection: reflection
        ? {
            status: "available" as const,
            candidateOnly: true as const,
            runtimeApplied: false as const,
            reflectionId: reflection.reflectionId,
            asOf: reflection.asOf.toISOString(),
            recommendations: reflection.recommendations.slice(0, 20),
            adjustmentCount: reflection.adjustments.length,
          }
        : {
            status: "unavailable" as const,
            candidateOnly: true as const,
            runtimeApplied: false as const,
            recommendations: [],
            adjustmentCount: 0,
          },
      lineage: {
        planFingerprint: run.planFingerprint,
        ...(traceId ? { traceId } : {}),
        artifactIds: summaries.map((artifact) => artifact.artifactId),
        schemaRefs: [
          "tradebot.runtime-evidence-read-model.v1",
          "tradebot.paper-runtime-cycle-audit.v1",
          "tradebot.agent-artifact.v1",
        ],
        dataSourceRef: this.config.sourceMode,
      },
    };
    void traceEvents;
    return RuntimeEvidenceDashboardSchema.parse({
      ...content,
      fingerprint: fingerprint({
        ...content,
        generatedAt: undefined,
      }),
    });
  }

  close(): void {
    this.ports.reflections?.close?.();
    this.ports.artifacts?.close?.();
    this.ports.traces?.close?.();
    this.ports.accounts.close?.();
  }
}

export function createSqliteRuntimeEvidenceReadModelService(
  config: RuntimeEvidenceReadModelConfig,
  runs: RuntimeEvidenceReadPorts["runs"],
): RuntimeEvidenceReadModelService {
  return new RuntimeEvidenceReadModelService(config, {
    runs,
    accounts: new SQLitePaperAccountStore(config.paperDatabasePath),
    ...(config.traceDatabasePath
      ? { traces: new SQLiteTraceSink(config.traceDatabasePath) }
      : {}),
    ...(config.artifactDatabasePath
      ? {
          artifacts: new SQLiteAgentArtifactLedger(
            config.artifactDatabasePath,
          ),
        }
      : {}),
    ...(config.reflectionDatabasePath
      ? {
          reflections: new SQLiteReflectionStore(
            config.reflectionDatabasePath,
          ),
        }
      : {}),
  });
}
