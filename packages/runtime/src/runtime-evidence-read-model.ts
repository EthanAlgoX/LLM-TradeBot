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

type SemanticLocale = "zh-CN" | "en";

const semanticKeyTranslations: Readonly<Record<string, string>> = {
  action: "动作",
  blockedReason: "阻断原因",
  confidence: "置信度",
  message: "消息",
  passed: "是否通过",
  rationale: "依据",
  reason: "原因",
  status: "状态",
  summary: "摘要",
  thesis: "观点",
};

const semanticValueTranslations: Readonly<Record<string, string>> = {
  long: "多头",
  short: "空头",
  neutral: "中性",
  trending_up: "上升趋势",
  trending_down: "下降趋势",
  choppy: "震荡",
  ready: "就绪",
  wait: "等待",
  waiting: "等待确认",
  confirmed: "已确认",
  hold: "持有",
  passed: "已通过",
  blocked: "已阻断",
  success: "成功",
  fallback: "安全回退",
  error: "失败",
};

function localizedSemanticValue(value: unknown, locale: SemanticLocale): string {
  const raw = String(value);
  return locale === "zh-CN"
    ? semanticValueTranslations[raw] ?? raw
    : raw;
}

function localizedSemanticText(
  value: string,
  locale: SemanticLocale,
): string {
  if (locale === "en") return value;
  const exact: Readonly<Record<string, string>> = {
    "no directional case reached the minimum confidence": "没有方向观点达到最低置信度",
    "long case selected": "已选择多头观点",
    "short case selected": "已选择空头观点",
    "trend/setup/trigger confirmation": "趋势、形态与触发条件确认",
    "simulated closing fill": "模拟平仓已成交",
    "consecutive losses": "连续亏损",
    "wait for directional regime": "等待出现明确方向的市场状态",
    "1h trend score reverses": "1 小时趋势评分发生反转",
    "regime becomes volatile or choppy": "市场状态转为高波动或震荡",
  };
  const direct = exact[value];
  if (direct) return direct;
  const replacements: ReadonlyArray<[RegExp, string]> = [
    [/^30m directional score=(.+)$/u, "30 分钟方向评分=$1"],
    [/^trend strength=(.+)$/u, "趋势强度=$1"],
    [/^1h trend score=(.+)$/u, "1 小时趋势评分=$1"],
    [/^1h trend score (.+)$/u, "1 小时趋势评分 $1"],
    [/^1h volatility (.+)% exceeds safety threshold$/u, "1 小时波动率 $1% 超过安全阈值"],
    [/^regime=(.+)$/u, "市场状态=$1"],
    [/^15m RSI=(.+)$/u, "15 分钟 RSI=$1"],
    [/^trend stance=(.+)$/u, "趋势方向=$1"],
    [/^5m pattern=(.+)$/u, "5 分钟形态=$1"],
    [/^relative volume=(.+)$/u, "相对成交量=$1"],
    [/^setup=(.+)$/u, "形态状态=$1"],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(value)) {
      const translated = value.replace(pattern, replacement);
      const [label, rawValue] = translated.split("=");
      return rawValue === undefined
        ? translated
        : `${label}=${localizedSemanticValue(rawValue, locale)}`;
    }
  }
  return value;
}

function localizedReflectionRecommendation(
  value: string,
  locale: SemanticLocale,
): string {
  if (locale === "en") return value;
  const exact: Readonly<Record<string, string>> = {
    "Tighten entry filters until the next reflection window.": "在下一次反思窗口前收紧入场过滤条件。",
    "Average loss exceeds average win; prioritize cleaner setup and trigger confirmation.": "平均亏损大于平均盈利，应优先选择更清晰的形态并等待触发条件确认。",
    "Losing trades carry higher confidence; avoid confidence-based overrides.": "亏损交易的置信度偏高，应避免仅凭置信度覆盖其他门禁。",
    "Maintain current filters; continue monitoring confidence calibration.": "保持当前过滤条件，并继续监控置信度校准情况。",
  };
  const direct = exact[value];
  if (direct) return direct;
  const streak = /^Recent (\d+)-trade loss streak; reduce new-entry aggressiveness temporarily\.$/u.exec(value);
  return streak
    ? `最近连续 ${streak[1]} 笔交易亏损，应暂时降低新开仓的激进程度。`
    : value;
}

function semanticFragments(
  value: unknown,
  locale: SemanticLocale,
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
      const label = locale === "zh-CN"
        ? semanticKeyTranslations[key] ?? key
        : key;
      fragments.push(`${label}=${
        typeof entry === "string"
          ? localizedSemanticText(entry, locale)
          : localizedSemanticValue(entry, locale)
      }`);
    } else if (Array.isArray(entry)) {
      for (const item of entry.slice(0, 4)) {
        fragments.push(...semanticFragments(item, locale, depth + 1));
      }
    } else if (entry && typeof entry === "object") {
      fragments.push(...semanticFragments(entry, locale, depth + 1));
    }
  }
  return fragments;
}

function semanticSummary(
  artifact: AgentArtifact,
  locale: SemanticLocale,
): string {
  if (artifact.status === "error") {
    return (locale === "zh-CN"
      ? `Agent 运行失败：${artifact.error ?? "未知错误"}`
      : artifact.error ?? "agent_error").slice(0, 600);
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
        locale === "zh-CN" ? `已选择 ${candidate.symbol}` : `Selected ${candidate.symbol}`,
        typeof candidate.rank === "number" ? locale === "zh-CN" ? `排名 ${candidate.rank}` : `rank ${candidate.rank}` : "",
        typeof candidate.score === "number" ? locale === "zh-CN" ? `评分 ${candidate.score}` : `score ${candidate.score}` : "",
        ...reasons.map((reason) => localizedSemanticText(reason, locale)),
      ].filter(Boolean).join(" · ").slice(0, 600);
    }
    return locale === "zh-CN"
      ? "没有标的通过筛选门禁。"
      : "No symbol passed the Selector gate.";
  }
  if (artifact.stage === "data") {
    const stableBars = safeRecord(record.stableBars);
    const windows = Object.entries(stableBars)
      .filter(([, bars]) => Array.isArray(bars))
      .map(([window, bars]) => `${window} ${(bars as unknown[]).length} bars`);
    const quote = safeRecord(record.liveQuote);
    const quality = safeRecord(record.quality);
    return [
      typeof record.symbol === "string"
        ? locale === "zh-CN" ? `${record.symbol} 数据已同步` : `${record.symbol} synchronized`
        : locale === "zh-CN" ? "数据已同步" : "Data synchronized",
      locale === "zh-CN" ? windows.join("，").replaceAll("bars", "根 K 线") : windows.join(", "),
      typeof quote.price === "number" ? locale === "zh-CN" ? `最新价格 ${quote.price}` : `latest ${quote.price}` : "",
      quality.alignmentOk === true ? locale === "zh-CN" ? "观察窗口已对齐" : "windows aligned" : "",
    ].filter(Boolean).join(" · ").slice(0, 600);
  }
  if (artifact.stage === "data_quality") {
    const reasons = Array.isArray(record.reasons)
      ? record.reasons.filter((item): item is string => typeof item === "string")
      : [];
    return record.passed === true
      ? locale === "zh-CN" ? "数据质量检查已通过。" : "Data quality passed."
      : locale === "zh-CN"
        ? `数据质量检查已阻断${reasons.length ? `：${reasons.slice(0, 3).join("；")}` : "。"}`
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
      typeof record.regime === "string" ? locale === "zh-CN" ? `市场状态 ${localizedSemanticValue(record.regime, locale)}` : `regime ${record.regime}` : "",
      typeof record.trend === "string" ? locale === "zh-CN" ? `趋势 ${localizedSemanticValue(record.trend, locale)}` : `trend ${record.trend}` : "",
      typeof record.setup === "string" ? locale === "zh-CN" ? `形态 ${localizedSemanticValue(record.setup, locale)}` : `setup ${record.setup}` : "",
      typeof record.trigger === "string" ? locale === "zh-CN" ? `触发条件 ${localizedSemanticValue(record.trigger, locale)}` : `trigger ${record.trigger}` : "",
      ...diagnostics.map((item) => localizedSemanticText(item, locale)),
    ].filter(Boolean).join(" · ").slice(0, 600);
  }
  if (artifact.stage === "position_monitor" && output === undefined) {
    return locale === "zh-CN"
      ? "本轮未产生结构化持仓退出建议。"
      : "No structured position-exit proposal was emitted.";
  }
  if (artifact.stage === "portfolio" && Array.isArray(output)) {
    return output.length === 0
      ? locale === "zh-CN" ? "本轮未产生组合意图。" : "No portfolio intent was emitted."
      : locale === "zh-CN" ? `已产生 ${output.length} 条组合意图。` : `${output.length} portfolio intent${output.length === 1 ? "" : "s"} emitted.`;
  }
  if (artifact.stage === "reflection" && output === undefined) {
    return locale === "zh-CN"
      ? "本轮未产生新的经验候选。"
      : "No new Lesson Candidate was emitted.";
  }
  const fragments = semanticFragments(artifact.output, locale);
  return (fragments.length > 0
    ? fragments.slice(0, 8).join(" · ")
    : locale === "zh-CN"
      ? `${artifact.stage}：${localizedSemanticValue(artifact.status, locale)}`
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
          recommendationTranslations: {
            zhCN: [],
            en: [],
          },
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

    const cycles = [...this.ports.runs.getCycles(run.runId)]
      .sort((left, right) => left.cycle - right.cycle);
    const cycle = cycles[cycles.length - 1];
    const activeCycle =
      activeRunStatuses.has(run.status) &&
      (run.continuous === true ||
        run.processedCycles < run.plannedCycles)
        ? run.processedCycles + 1
        : undefined;
    const activeTraceId = activeCycle === undefined
      ? undefined
      : `${run.runId}:cycle:${activeCycle}`;
    const traceId =
      activeTraceId ??
      cycle?.traceId ??
      this.ports.traces?.latestTraceId();
    const account = await this.ports.accounts.load(this.config.accountId);
    const reflection = await this.ports.reflections?.latest(
      this.config.accountId,
    );
    const visibleCycles = cycles.slice(-12);
    const auditedArtifactRequests = visibleCycles.map((item) => ({
      cycle: item.cycle,
      traceId: item.traceId,
    }));
    const artifactRequests = [
      ...auditedArtifactRequests,
      ...(activeCycle !== undefined && activeTraceId
        ? [{ cycle: activeCycle, traceId: activeTraceId }]
        : auditedArtifactRequests.length === 0 && traceId
          ? [{
              cycle: Math.max(1, run.processedCycles),
              traceId,
            }]
          : []),
    ];
    const artifactBatches = this.ports.artifacts
      ? await Promise.all(artifactRequests.map(async (request) => ({
          ...request,
          artifacts: [
            ...await this.ports.artifacts!.query({
              traceId: request.traceId,
              limit: 50,
            }),
          ],
        })))
      : [];
    const currentArtifacts = artifactBatches
      .find((batch) => batch.traceId === traceId)?.artifacts ?? [];
    const latestArtifacts = currentArtifacts.length > 0
      ? currentArtifacts
      : [...artifactBatches]
          .reverse()
          .find((batch) => batch.artifacts.length > 0)?.artifacts ?? [];
    const traceEvents = traceId && this.ports.traces
      ? this.ports.traces.load(traceId)
      : [];
    const review = buildTradeReview(latestArtifacts);
    const summaries = artifactBatches.flatMap((batch) =>
      batch.artifacts
        .sort(
          (left, right) =>
            left.startedAt.getTime() - right.startedAt.getTime(),
        )
        .map((artifact) => ({
          cycle: batch.cycle,
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
          semanticSummary: semanticSummary(artifact, "en"),
          semanticSummaryTranslations: {
            zhCN: semanticSummary(artifact, "zh-CN"),
            en: semanticSummary(artifact, "en"),
          },
        })),
    );
    const selectedSymbols = [
      ...new Set(
        latestArtifacts
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
        ...(run.responseLocale
          ? { responseLocale: run.responseLocale }
          : {}),
        ...(run.initialCash !== undefined
          ? { initialCash: run.initialCash }
          : {}),
        ...(run.cadence ? { cadence: run.cadence } : {}),
        intervalMs: run.intervalMs,
        ...(run.continuous !== undefined
          ? { continuous: run.continuous }
          : {}),
        processedCycles: run.processedCycles,
        plannedCycles: run.plannedCycles,
        ...(activeCycle !== undefined ? { activeCycle } : {}),
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
      equityCurve: (() => {
        const derivedInitialCash =
          run.initialCash ??
          (account
            ? account.cash + deployedMargin - account.realizedPnl + account.fees
            : 1);
        const initialCash = Math.max(0.01, derivedInitialCash);
        const auditedPoints = cycles
          .filter((item) => item.accountSnapshot !== undefined)
          .map((item) => {
            const snapshot = item.accountSnapshot!;
            return {
              cycle: item.cycle,
              asOf: item.finishedAt,
              cash: snapshot.cash,
              equity: snapshot.equity,
              realizedPnl: snapshot.realizedPnl,
              unrealizedPnl: snapshot.unrealizedPnl,
              fees: snapshot.fees,
              returnPct:
                ((snapshot.equity - initialCash) / initialCash) * 100,
            };
          });
        const points = [
          {
            cycle: 0,
            asOf: run.startedAt ?? run.requestedAt,
            cash: initialCash,
            equity: initialCash,
            realizedPnl: 0,
            unrealizedPnl: 0,
            fees: 0,
            returnPct: 0,
          },
          ...auditedPoints,
        ].slice(-120);
        if (
          account &&
          (auditedPoints.length === 0 ||
            auditedPoints.at(-1)!.cycle < run.processedCycles)
        ) {
          const equity = account.cash + deployedMargin;
          points.push({
            cycle: run.processedCycles,
            asOf: generatedAt,
            cash: account.cash,
            equity,
            realizedPnl: account.realizedPnl,
            unrealizedPnl: 0,
            fees: account.fees,
            returnPct: ((equity - initialCash) / initialCash) * 100,
          });
        }
        const current = points.at(-1)!;
        return {
          initialCash,
          currentCash: current.cash,
          currentEquity: current.equity,
          totalReturnPct: current.returnPct,
          points,
        };
      })(),
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
            recommendationTranslations: {
              zhCN: reflection.recommendations
                .slice(0, 20)
                .map((item) =>
                  localizedReflectionRecommendation(item, "zh-CN")),
              en: reflection.recommendations.slice(0, 20),
            },
            adjustmentCount: reflection.adjustments.length,
          }
        : {
            status: "unavailable" as const,
            candidateOnly: true as const,
            runtimeApplied: false as const,
            recommendations: [],
            recommendationTranslations: {
              zhCN: [],
              en: [],
            },
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
