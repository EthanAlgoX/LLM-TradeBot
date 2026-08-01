import "./runtime-evidence.css";
import {
  deriveRuntimeEvidenceViewState,
} from "./runtime-evidence-view-state.js";

interface RuntimeEvidenceResponse {
  schemaVersion: "1.0.0";
  readModelId: string;
  fingerprint: string;
  generatedAt: string;
  evidenceStatus: "active" | "recent" | "unavailable";
  sourceMode:
    | "local_fixture"
    | "binance_futures_public_read_only";
  paperAccountRef: string;
  run?: {
    runId: string;
    status: string;
    strategyProfileRef: string;
    responseLocale?: "zh-CN" | "en";
    initialCash?: number;
    cadence?: "1m" | "5m" | "10m" | "15m" | "30m" | "1h" | "3h" | "5h";
    intervalMs: number;
    continuous?: boolean;
    processedCycles: number;
    plannedCycles: number;
    activeCycle?: number;
    controlMode: string;
  };
  cycle?: {
    cycle: number;
    traceId: string;
    status: string;
    decisionCount: number;
    riskDecisionCount: number;
    executionCount: number;
  };
  account?: {
    cash: number;
    realizedPnl: number;
    fees: number;
    deployedMargin: number;
    openPositionCount: number;
    closedTradeCount: number;
    positions: Array<{
      symbol: string;
      side: "long" | "short";
      qty: number;
      entryPrice: number;
      leverage: number;
      margin: number;
      stopLoss: number;
      takeProfit: number;
      openedAt: string;
    }>;
  };
  equityCurve?: {
    initialCash: number;
    currentCash: number;
    currentEquity: number;
    totalReturnPct: number;
    points: Array<{
      cycle: number;
      asOf: string;
      cash: number;
      equity: number;
      realizedPnl: number;
      unrealizedPnl: number;
      fees: number;
      returnPct: number;
    }>;
  };
  selection?: {
    topN: 1;
    candidateSymbols: string[];
    selectedSymbols: string[];
  };
  positionMonitor: {
    status: "monitoring" | "flat" | "unavailable";
    monitoringSymbols: string[];
    semanticSummary?: string;
  };
  semanticTransfers: Array<{
    cycle: number;
    artifactId: string;
    sourceArtifactIds: string[];
    stage: string;
    agent: string;
    agentVersion: string;
    status: "success" | "fallback" | "error";
    completedAt: string;
    durationMs: number;
    symbol?: string;
    semanticSummary: string;
    semanticSummaryTranslations: {
      zhCN: string;
      en: string;
    };
  }>;
  decisionRiskExecution: {
    decisionAction?: string;
    decisionConfidence?: number;
    riskPassed?: boolean;
    riskBlockedReason?: string;
    executionStatus?: string;
    executionMessage?: string;
  };
  reflection: {
    status: "available" | "unavailable";
    candidateOnly: true;
    runtimeApplied: false;
    reflectionId?: string;
    recommendations: string[];
    recommendationTranslations: {
      zhCN: string[];
      en: string[];
    };
    adjustmentCount: number;
  };
  lineage: {
    planFingerprint?: string;
    traceId?: string;
    artifactIds: string[];
    schemaRefs: string[];
    dataSourceRef: string;
  };
}

const apiBase =
  import.meta.env.VITE_TRADEBOT_ORCHESTRATION_API ??
  "http://127.0.0.1:8787";
let token = import.meta.env.DEV
  ? import.meta.env.VITE_TRADEBOT_ORCHESTRATION_TOKEN
  : undefined;
let evidence: RuntimeEvidenceResponse | undefined;
let timer: number | undefined;
let countdownTimer: number | undefined;
let loading = false;

const zh = (): boolean =>
  document.documentElement.lang.toLowerCase().startsWith("zh");

function formatCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function refreshNextCycleCountdown(): void {
  if (countdownTimer !== undefined) window.clearTimeout(countdownTimer);
  const clocks = document.querySelectorAll<HTMLElement>(
    "[data-runtime-next-cycle-at]",
  );
  for (const clock of clocks) {
    const nextCycleAt = Number(clock.dataset.runtimeNextCycleAt);
    if (!Number.isFinite(nextCycleAt)) continue;
    const remaining = nextCycleAt - Date.now();
    clock.textContent = remaining > 0
      ? formatCountdown(remaining)
      : zh() ? "即将开始" : "STARTING NOW";
  }
  if (clocks.length > 0) {
    countdownTimer = window.setTimeout(refreshNextCycleCountdown, 250);
  }
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function money(value: number | undefined): string {
  if (value === undefined) return "-";
  return new Intl.NumberFormat(zh() ? "zh-CN" : "en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function agentLabel(stage: string, agent: string): string {
  const labels: Record<string, [string, string]> = {
    selector: ["市场机会筛选 Agent", "Market opportunity Selector"],
    data: ["数据同步 Agent", "Data synchronization Agent"],
    data_quality: ["数据质量门禁", "Data quality gate"],
    analysis: ["多周期分析 Agent", "Multi-window analysis Agent"],
    bull_case: ["看多观点 Agent", "Bull case Agent"],
    bear_case: ["看空观点 Agent", "Bear case Agent"],
    position_monitor: ["持仓监控 Agent", "Position Monitor"],
    decision: ["决策 Agent", "Decision Agent"],
    portfolio: ["组合 Agent", "Portfolio Agent"],
    risk: ["风险门禁", "Risk Gate"],
    execution: ["模拟执行 Agent", "Paper Execution Agent"],
    reflection: ["反思 Agent", "Reflection Agent"],
  };
  const label = labels[stage];
  return label ? label[zh() ? 0 : 1] : agent;
}

function transferStatusLabel(status: "success" | "fallback" | "error"): string {
  if (!zh()) return status.toUpperCase();
  if (status === "success") return "已完成";
  if (status === "fallback") return "安全回退";
  return "失败";
}

function runStatusLabel(status: string): string {
  if (!zh()) return status.replaceAll("_", " ").toUpperCase();
  const labels: Record<string, string> = {
    queued: "排队中",
    running: "运行中",
    stop_requested: "正在安全停止",
    drained: "已安全停止",
    orphaned: "运行已失联",
    completed: "已完成",
    failed: "运行失败",
    safety_blocked: "已被安全机制阻断",
  };
  return labels[status] ?? status;
}

function cycleStatusLabel(status: string | undefined): string {
  if (!status || !zh()) return status?.toUpperCase() ?? "-";
  return ({
    ok: "正常",
    partial: "部分完成",
    blocked: "已阻断",
    failed: "失败",
    safety_blocked: "安全阻断",
  } as Record<string, string>)[status] ?? status;
}

function sourceModeLabel(mode: RuntimeEvidenceResponse["sourceMode"]): string {
  if (!zh()) return mode;
  return mode === "local_fixture"
    ? "本地模拟数据"
    : "币安合约公开只读数据";
}

function localizedAction(value: string): string {
  if (!zh()) return value.replaceAll("_", " ").toUpperCase();
  return ({
    hold: "持有",
    wait: "等待",
    open_long: "开多",
    open_short: "开空",
    close_long: "平多",
    close_short: "平空",
    skipped: "已跳过",
    filled: "已成交",
    rejected: "已拒绝",
    blocked: "已阻断",
  } as Record<string, string>)[value] ?? value;
}

function renderEquityCurve(): string {
  const curve = evidence?.equityCurve;
  if (!curve || curve.points.length === 0) return "";
  const width = 960;
  const height = 230;
  const padding = { top: 24, right: 24, bottom: 34, left: 24 };
  const values = curve.points.flatMap((point) => [point.cash, point.equity]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const range = Math.max(1, rawMax - rawMin);
  const min = rawMin - range * 0.12;
  const max = rawMax + range * 0.12;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (index: number): number =>
    padding.left +
    (curve.points.length === 1
      ? plotWidth / 2
      : index / (curve.points.length - 1) * plotWidth);
  const y = (value: number): number =>
    padding.top + (max - value) / (max - min) * plotHeight;
  const path = (key: "cash" | "equity"): string =>
    curve.points
      .map((point, index) =>
        `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point[key]).toFixed(2)}`)
      .join(" ");
  const latest = curve.points.at(-1)!;
  const returnClass = curve.totalReturnPct > 0
    ? "is-positive"
    : curve.totalReturnPct < 0
      ? "is-negative"
      : "";
  const signedReturn = `${curve.totalReturnPct > 0 ? "+" : ""}${curve.totalReturnPct.toFixed(2)}%`;
  return `
    <section class="runtime-equity-curve" aria-labelledby="runtime-equity-curve-title">
      <header>
        <div>
          <span>${zh() ? "模拟账户 · 每轮资金变化" : "PAPER ACCOUNT · PER-ROUND CAPITAL"}</span>
          <h4 id="runtime-equity-curve-title">${zh() ? "收益曲线" : "Return curve"}</h4>
        </div>
        <dl>
          <div><dt>${zh() ? "初始资金" : "Starting capital"}</dt><dd>${money(curve.initialCash)}</dd></div>
          <div><dt>${zh() ? "当前现金" : "Current cash"}</dt><dd>${money(curve.currentCash)}</dd></div>
          <div><dt>${zh() ? "账户权益" : "Account equity"}</dt><dd>${money(curve.currentEquity)}</dd></div>
          <div class="${returnClass}"><dt>${zh() ? "累计收益" : "Total return"}</dt><dd>${signedReturn}</dd></div>
        </dl>
      </header>
      <div class="runtime-equity-chart">
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${zh() ? "按运行轮次展示现金和账户权益变化" : "Cash and account equity by runtime round"}">
          <line class="runtime-equity-chart__grid" x1="${padding.left}" y1="${y(rawMax)}" x2="${width - padding.right}" y2="${y(rawMax)}"></line>
          <line class="runtime-equity-chart__grid" x1="${padding.left}" y1="${y(rawMin)}" x2="${width - padding.right}" y2="${y(rawMin)}"></line>
          <path class="runtime-equity-chart__line is-equity" d="${path("equity")}"></path>
          <path class="runtime-equity-chart__line is-cash" d="${path("cash")}"></path>
          <circle class="runtime-equity-chart__point is-equity" cx="${x(curve.points.length - 1)}" cy="${y(latest.equity)}" r="5"></circle>
          <circle class="runtime-equity-chart__point is-cash" cx="${x(curve.points.length - 1)}" cy="${y(latest.cash)}" r="5"></circle>
          <text x="${padding.left}" y="${height - 8}">${zh() ? "初始" : "START"}</text>
          <text x="${width - padding.right}" y="${height - 8}" text-anchor="end">${zh() ? `第 ${latest.cycle} 轮` : `ROUND ${latest.cycle}`}</text>
          <text x="${padding.left}" y="${Math.max(13, y(rawMax) - 7)}">${money(rawMax)}</text>
          <text x="${padding.left}" y="${Math.min(height - padding.bottom - 5, y(rawMin) - 7)}">${money(rawMin)}</text>
        </svg>
        <div class="runtime-equity-chart__legend">
          <span class="is-cash">${zh() ? "现金" : "Cash"}</span>
          <span class="is-equity">${zh() ? "账户权益（含持仓浮动盈亏）" : "Account equity (including unrealized PnL)"}</span>
        </div>
      </div>
    </section>`;
}

type RuntimeTransfer = RuntimeEvidenceResponse["semanticTransfers"][number];

function transferSummary(transfer: RuntimeTransfer): string {
  return zh()
    ? transfer.semanticSummaryTranslations.zhCN
    : transfer.semanticSummaryTranslations.en;
}

function renderAgentTransfers(): string {
  const transfers = evidence?.semanticTransfers ?? [];
  const cycleNumbers = [...new Set([
    ...transfers.map((item) => item.cycle),
    ...(evidence?.run?.activeCycle === undefined
      ? []
      : [evidence.run.activeCycle]),
  ])]
    .sort((left, right) => left - right);
  const currentCycle =
    evidence?.run?.activeCycle ??
    evidence?.cycle?.cycle ??
    cycleNumbers.at(-1);
  const completedCycles = evidence?.run?.processedCycles ?? 0;
  const lastCompletedAt = transfers
    .filter((item) => item.cycle === completedCycles)
    .map((item) => Date.parse(item.completedAt))
    .filter(Number.isFinite)
    .reduce<number | undefined>(
      (latest, completedAt) => latest === undefined || completedAt > latest
        ? completedAt
        : latest,
      undefined,
    );
  const nextCycleAt =
    evidence?.evidenceStatus === "active" &&
    evidence.run?.activeCycle === completedCycles + 1 &&
    lastCompletedAt !== undefined
      ? lastCompletedAt + evidence.run.intervalMs
      : undefined;
  const transferById = new Map(transfers.map((item) => [item.artifactId, item]));
  const anchorById = new Map(
    transfers.map((item, index) => [item.artifactId, `runtime-artifact-${index + 1}`]),
  );
  const childrenById = new Map<string, RuntimeTransfer[]>();
  for (const artifact of transfers) {
    for (const sourceId of artifact.sourceArtifactIds) {
      childrenById.set(sourceId, [...(childrenById.get(sourceId) ?? []), artifact]);
    }
  }
  const renderMessage = (artifact: RuntimeTransfer): string => {
    const knownParents = artifact.sourceArtifactIds
      .map((id) => transferById.get(id))
      .filter((item): item is RuntimeTransfer => Boolean(item));
    const externalParentIds = artifact.sourceArtifactIds.filter((id) => !transferById.has(id));
    const children = childrenById.get(artifact.artifactId) ?? [];
    const branchParent = knownParents.find((parent) => (childrenById.get(parent.artifactId)?.length ?? 0) > 1);
    const siblings = branchParent ? childrenById.get(branchParent.artifactId) ?? [] : [];
    const branchIndex = siblings.findIndex((item) => item.artifactId === artifact.artifactId);
    const displayName = agentLabel(artifact.stage, artifact.agent);
    const completedAt = new Date(artifact.completedAt).toLocaleString(
      zh() ? "zh-CN" : "en-US",
      {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      },
    );
    const parentLinks = knownParents
      .map((parent) => `<a href="#${anchorById.get(parent.artifactId)}">${escapeHtml(agentLabel(parent.stage, parent.agent))}</a>`)
      .join(zh() ? "、" : ", ");
    const childLinks = children
      .map((child) => `<a href="#${anchorById.get(child.artifactId)}">${escapeHtml(agentLabel(child.stage, child.agent))}</a>`)
      .join(zh() ? "、" : ", ");
    return `
      <article class="runtime-agent-room-message" id="${anchorById.get(artifact.artifactId)}" data-status="${artifact.status}">
        <div class="runtime-agent-room-message__avatar" aria-hidden="true">${escapeHtml(displayName.slice(0, 1).toUpperCase())}</div>
        <div class="runtime-agent-room-message__turn">
          <header>
            <strong>${escapeHtml(displayName)}</strong>
            <span class="runtime-agent-room-message__cycle">${zh() ? `第 ${artifact.cycle} 轮` : `ROUND ${artifact.cycle}`}</span>
            <time datetime="${escapeHtml(artifact.completedAt)}">${zh() ? `生成于 ${completedAt}` : `Generated ${completedAt}`}</time>
            <span>${transferStatusLabel(artifact.status)}</span>
          </header>
          ${knownParents.length > 0 ? `
            <div class="runtime-agent-room-message__reply">↳ ${zh() ? "回复" : "Replying to"} ${parentLinks}${siblings.length > 1 ? ` · ${zh() ? `并行 ${branchIndex + 1}/${siblings.length}` : `parallel ${branchIndex + 1}/${siblings.length}`}` : ""}</div>
          ` : externalParentIds.length > 0 ? `
            <div class="runtime-agent-room-message__reply">↳ ${zh() ? "回复前序语义" : "Replying to prior semantics"}</div>
          ` : ""}
          <div class="runtime-agent-room-message__bubble">
            <p>${escapeHtml(transferSummary(artifact))}</p>
          </div>
          <footer>
            <span>→ ${zh() ? "发送给" : "Send to"}</span>
            ${children.length > 0 ? childLinks : `<span>${zh() ? "无下游 Agent" : "No downstream Agent"}</span>`}
          </footer>
        </div>
      </article>`;
  };
  const rounds = cycleNumbers.map((cycleNumber) => {
    const roundTransfers = transfers.filter((item) => item.cycle === cycleNumber);
    const isCurrent = cycleNumber === currentCycle;
    return `
      <section class="runtime-agent-round${isCurrent ? " is-current" : ""}" data-cycle="${cycleNumber}">
        <header class="runtime-agent-round__marker">
          <span>${zh() ? `第 ${cycleNumber} 轮` : `ROUND ${cycleNumber}`}</span>
          <strong>${isCurrent
            ? evidence?.evidenceStatus === "active"
              ? zh() ? "当前运行轮" : "CURRENT RUNNING ROUND"
              : zh() ? "最后完成轮" : "LATEST COMPLETED ROUND"
            : zh() ? "已完成" : "COMPLETED"}</strong>
          <small>${roundTransfers.length} ${zh() ? "条 Agent 语义" : "AGENT MESSAGES"}</small>
        </header>
        ${roundTransfers.length > 0
          ? roundTransfers.map(renderMessage).join("")
          : `<div class="runtime-agent-round__waiting"><span></span><strong>${nextCycleAt !== undefined && cycleNumber === currentCycle ? zh() ? "下一轮将在" : "Next round starts in" : zh() ? "本轮已开始，等待第一个 Agent 输出语义" : "Round started. Waiting for the first Agent output"}</strong>${nextCycleAt !== undefined && cycleNumber === currentCycle ? `<time data-runtime-next-cycle-at="${nextCycleAt}"></time>` : ""}</div>`}
      </section>`;
  }).join("");
  const processedCycles = evidence?.run?.processedCycles ?? 0;
  const plannedCycles = evidence?.run?.plannedCycles ?? 1;
  const continuous = evidence?.run?.continuous === true;
  const progressPercent = continuous ? 100 : Math.min(
    100,
    Math.max(0, processedCycles / plannedCycles * 100),
  );
  return `
    <section class="runtime-agent-conversation" aria-labelledby="runtime-agent-conversation-title">
      <header>
        <div>
          <span>${zh() ? "多轮运行 · 语义协作对话" : "MULTI-ROUND · SEMANTIC COLLABORATION"}</span>
          <h3 id="runtime-agent-conversation-title">${zh() ? "子 Agent 运行对话" : "Sub-agent runtime dialogue"}</h3>
          <p>${zh() ? "主体展示各节点的真实语义输出；输入来源、并行分支和汇聚关系均取自 Artifact lineage，而不是消息出现顺序。" : "The dialogue centers on real semantic outputs. Inputs, parallel branches, and joins come from Artifact lineage rather than message order."}</p>
        </div>
        <code>${cycleNumbers.length} ROUNDS · ${transfers.length} ARTIFACTS</code>
      </header>
      <div class="runtime-agent-progress${continuous ? " is-continuous" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="${plannedCycles}" aria-valuenow="${processedCycles}" aria-label="${zh() ? "运行轮次进度" : "Run cycle progress"}">
        <div class="runtime-agent-progress__copy">
          <span>${zh() ? "运行进度" : "RUN PROGRESS"}</span>
          <strong>${continuous
            ? zh()
              ? `已完成 ${processedCycles} 轮 · 持续运行，点击停止后结束`
              : `${processedCycles} ROUNDS COMPLETE · RUNNING UNTIL STOPPED`
            : zh()
              ? `已完成 ${processedCycles} / ${plannedCycles} 轮`
              : `${processedCycles} / ${plannedCycles} ROUNDS COMPLETE`}</strong>
          <small>${continuous ? zh() ? "运行中" : "LIVE" : `${progressPercent.toFixed(0)}%`}</small>
        </div>
        <div class="runtime-agent-progress__track" aria-hidden="true">
          <i style="width:${progressPercent}%"></i>
        </div>
      </div>
      ${renderEquityCurve()}
      ${cycleNumbers.length > 0 ? `
        <div class="runtime-agent-room" role="log" aria-live="polite">
          <div class="runtime-agent-room__status">
            <span></span>${zh()
              ? `Agent 语义频道 · 已记录 ${cycleNumbers.length} 轮${currentCycle ? ` · 当前第 ${currentCycle} 轮` : ""}`
              : `Agent semantic channel · ${cycleNumbers.length} rounds${currentCycle ? ` · round ${currentCycle} active` : ""}`}
          </div>
          ${rounds}
        </div>
      ` : `
        <div class="runtime-agent-graph-empty">
          <strong>${zh() ? "等待当前周期产生 Agent Artifact" : "Waiting for Agent artifacts from the current cycle"}</strong>
          <span>${zh() ? "对话会在真实语义 Artifact 到达后自动形成。" : "The dialogue forms automatically as real semantic artifacts arrive."}</span>
        </div>
      `}
    </section>
  `;
}

function render(): void {
  const main = document.querySelector<HTMLElement>("#main-content");
  if (!main) return;
  main.querySelector("[data-runtime-evidence-read-model]")?.remove();
  const view = deriveRuntimeEvidenceViewState(evidence?.evidenceStatus);
  main.classList.toggle(
    "is-runtime-evidence-hydrated",
    view.hydrate,
  );
  const boundary = main.querySelector<HTMLElement>(
    "[data-runtime-evidence-boundary]",
  );
  boundary?.classList.toggle("is-recent", view.mode === "recent");
  if (!evidence || !view.hydrate || !evidence.run) return;

  if (boundary) {
    boundary.classList.toggle("is-live", view.live);
    boundary.textContent = view.live
      ? zh()
        ? "以下内容来自当前后端 Paper Runtime 的真实只读证据。"
        : "The content below is real read-only evidence from the active backend Paper Runtime."
      : zh()
        ? "以下内容来自最近一次后端 Paper Run；该运行已经结束。"
        : "The content below is from the latest backend Paper Run, which is no longer active.";
  }

  const account = evidence.account;
  const cycle = evidence.cycle;
  const review = evidence.decisionRiskExecution;
  const panel = document.createElement("section");
  panel.dataset.runtimeEvidenceReadModel = "true";
  panel.className = `runtime-evidence-panel is-${view.mode}`;
  panel.innerHTML = `
    <header class="runtime-evidence-header">
      <div>
        <span>${view.live
          ? zh() ? "实时只读运行证据" : "LIVE READ MODEL"
          : zh() ? "最近一次运行证据" : "RECENT RUN EVIDENCE"}</span>
        <h2>${zh() ? "真实交易运行证据" : "Runtime trading evidence"}</h2>
        <p>${escapeHtml(evidence.selection?.selectedSymbols[0] ?? (zh() ? "无入选标的" : "No admitted symbol"))} · ${escapeHtml(evidence.run.runId)} · ${escapeHtml(sourceModeLabel(evidence.sourceMode))}</p>
      </div>
      <strong>${escapeHtml(runStatusLabel(evidence.run.status))}</strong>
    </header>
    <div class="runtime-evidence-metrics">
      <div><span>${zh() ? "现金" : "Cash"}</span><strong>${money(account?.cash)}</strong></div>
      <div><span>${zh() ? "已实现盈亏" : "Realized PnL"}</span><strong>${money(account?.realizedPnl)}</strong></div>
      <div><span>${zh() ? "已用保证金" : "Deployed margin"}</span><strong>${money(account?.deployedMargin)}</strong></div>
      <div><span>${zh() ? "手续费" : "Fees"}</span><strong>${money(account?.fees)}</strong></div>
      <div><span>${zh() ? "当前持仓" : "Open positions"}</span><strong>${account?.openPositionCount ?? "-"}</strong></div>
      <div><span>${zh() ? "运行周期" : "Run cycles"}</span><strong>${evidence.run.continuous ? `${evidence.run.processedCycles} / ∞` : `${evidence.run.processedCycles}/${evidence.run.plannedCycles}`}</strong><small>${evidence.run.cadence ?? `${Math.round(evidence.run.intervalMs / 60_000)}m`} ${zh() ? "一轮" : "per round"}</small></div>
    </div>
    ${renderAgentTransfers()}
    <div class="runtime-evidence-grid">
      <section>
        <header><span>${zh() ? "筛选器 · 仅选择 1 个标的" : "SELECTOR · TOP N = 1"}</span><strong>${escapeHtml(evidence.selection?.selectedSymbols[0] ?? (zh() ? "无入选标的" : "No admitted symbol"))}</strong></header>
        <p>${zh() ? "服务端候选池" : "Server candidate pool"} · ${escapeHtml(evidence.selection?.candidateSymbols.join(", ") ?? "-")}</p>
        <dl>
          <div><dt>${zh() ? "最新 Trace" : "Latest trace"}</dt><dd>${escapeHtml(cycle?.traceId ?? "-")}</dd></div>
          <div><dt>${zh() ? "周期状态" : "Cycle status"}</dt><dd>${escapeHtml(cycleStatusLabel(cycle?.status))}</dd></div>
          <div><dt>${zh() ? "决策 / 风控 / 执行" : "Decision / Risk / Execution"}</dt><dd>${cycle ? `${cycle.decisionCount} / ${cycle.riskDecisionCount} / ${cycle.executionCount}` : "-"}</dd></div>
        </dl>
      </section>
      <section>
        <header><span>${zh() ? "持仓监控" : "POSITION MONITOR"}</span><strong>${zh() ? evidence.positionMonitor.status === "monitoring" ? "监控中" : evidence.positionMonitor.status === "flat" ? "当前无持仓" : "不可用" : escapeHtml(evidence.positionMonitor.status.toUpperCase())}</strong></header>
        ${
          account?.positions.length
            ? account.positions.map((position) => `
              <article class="runtime-position">
                <strong>${escapeHtml(position.symbol)} · ${escapeHtml(position.side.toUpperCase())}</strong>
                <span>${position.qty} @ ${money(position.entryPrice)} · ${position.leverage}x</span>
                <small>SL ${money(position.stopLoss)} · TP ${money(position.takeProfit)}</small>
              </article>
            `).join("")
            : `<p>${zh() ? "当前 Paper Account 无持仓。" : "The Paper Account is currently flat."}</p>`
        }
      </section>
      <section class="runtime-decision-summary">
        <header><span>${zh() ? "决策 → 组合 → 风控 → 执行" : "DECISION → PORTFOLIO → RISK → EXECUTION"}</span><strong>${escapeHtml(review.decisionAction ? localizedAction(review.decisionAction) : "-")}</strong></header>
        <dl>
          <div><dt>${zh() ? "决策置信度" : "Decision confidence"}</dt><dd>${review.decisionConfidence ?? "-"}</dd></div>
          <div><dt>${zh() ? "风险门禁" : "Risk Gate"}</dt><dd>${review.riskPassed === undefined ? "-" : review.riskPassed ? zh() ? "已通过" : "PASSED" : zh() ? "已阻断" : "BLOCKED"}</dd></div>
          <div><dt>${zh() ? "执行状态" : "Execution"}</dt><dd>${escapeHtml(review.executionStatus ? localizedAction(review.executionStatus) : "-")}</dd></div>
        </dl>
      </section>
      <section>
        <header><span>${zh() ? "反思" : "REFLECTION"}</span><strong>${evidence.reflection.status === "available" ? zh() ? "经验候选" : "LESSON CANDIDATE" : zh() ? "不可用" : "UNAVAILABLE"}</strong></header>
        <p>${zh() ? "仅生成候选经验，不修改运行策略。" : "Candidate lesson only. The running strategy is never mutated."}</p>
        <ul>
          ${(zh()
            ? evidence.reflection.recommendationTranslations.zhCN
            : evidence.reflection.recommendationTranslations.en
          ).slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || `<li>${zh() ? "暂无候选经验" : "No lesson candidate"}</li>`}
        </ul>
      </section>
    </div>
    <footer class="runtime-evidence-lineage">
      <span>${zh() ? "追踪标识" : "TRACE"} ${escapeHtml(evidence.lineage.traceId ?? "-")}</span>
      <span>${evidence.lineage.artifactIds.length} ${zh() ? "条产物引用" : "ARTIFACT REFS"}</span>
      <span>${escapeHtml(evidence.lineage.dataSourceRef)}</span>
      <span>${zh() ? "交易所写入已关闭" : "EXCHANGE WRITE OFF"}</span>
    </footer>
  `;
  const operationLayout = main.querySelector(".operation-layout");
  operationLayout?.insertAdjacentElement("beforebegin", panel);
  refreshNextCycleCountdown();
  if (view.live) {
    const room = panel.querySelector<HTMLElement>(".runtime-agent-room");
    if (room) room.scrollTop = room.scrollHeight;
  }
}

async function load(): Promise<void> {
  if (!token || loading) return;
  loading = true;
  try {
    const response = await fetch(
      `${apiBase}/api/orchestration/paper-runtime/evidence`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) throw new Error(String(response.status));
    const body = await response.json() as {
      data: RuntimeEvidenceResponse;
    };
    evidence = body.data;
    render();
    schedule();
  } catch {
    if (!evidence) render();
  } finally {
    loading = false;
  }
}

function schedule(): void {
  if (timer !== undefined) window.clearTimeout(timer);
  const view = deriveRuntimeEvidenceViewState(evidence?.evidenceStatus);
  timer = window.setTimeout(
    () => void load(),
    view.pollIntervalMs,
  );
}

window.addEventListener("tradebot:orchestration-session", (event) => {
  const detail = (
    event as CustomEvent<{ token?: string }>
  ).detail;
  token = detail.token ?? token;
  void load();
});
window.addEventListener("tradebot:runtime-context", () => {
  void load();
});
window.addEventListener("tradebot:runtime-evidence-remount", render);

queueMicrotask(() => {
  void load();
  schedule();
});
