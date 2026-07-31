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
    processedCycles: number;
    plannedCycles: number;
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
    artifactId: string;
    stage: string;
    agent: string;
    agentVersion: string;
    status: "success" | "fallback" | "error";
    symbol?: string;
    durationMs: number;
    semanticSummary: string;
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

const viteEnvironment = (
  import.meta as unknown as {
    env?: Record<string, string | undefined>;
  }
).env;
const apiBase =
  viteEnvironment?.VITE_TRADEBOT_ORCHESTRATION_API ??
  "http://127.0.0.1:8787";
let token =
  viteEnvironment?.VITE_TRADEBOT_ORCHESTRATION_TOKEN;
let evidence: RuntimeEvidenceResponse | undefined;
let timer: number | undefined;
let loading = false;

const zh = (): boolean =>
  document.documentElement.lang.toLowerCase().startsWith("zh");

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
        <span>${view.live ? "LIVE READ MODEL" : "RECENT RUN EVIDENCE"}</span>
        <h2>${zh() ? "真实交易运行证据" : "Runtime trading evidence"}</h2>
        <p>${escapeHtml(evidence.run.runId)} · ${escapeHtml(evidence.sourceMode)}</p>
      </div>
      <strong>${escapeHtml(evidence.run.status.toUpperCase())}</strong>
    </header>
    <div class="runtime-evidence-metrics">
      <div><span>${zh() ? "现金" : "Cash"}</span><strong>${money(account?.cash)}</strong></div>
      <div><span>${zh() ? "已用保证金" : "Deployed margin"}</span><strong>${money(account?.deployedMargin)}</strong></div>
      <div><span>${zh() ? "已实现盈亏" : "Realized PnL"}</span><strong>${money(account?.realizedPnl)}</strong></div>
      <div><span>${zh() ? "运行周期" : "Run cycles"}</span><strong>${evidence.run.processedCycles}/${evidence.run.plannedCycles}</strong></div>
    </div>
    <div class="runtime-evidence-grid">
      <section>
        <header><span>SELECTOR · TOP N = 1</span><strong>${escapeHtml(evidence.selection?.selectedSymbols[0] ?? (zh() ? "无入选标的" : "No admitted symbol"))}</strong></header>
        <p>${zh() ? "服务端候选池" : "Server candidate pool"} · ${escapeHtml(evidence.selection?.candidateSymbols.join(", ") ?? "-")}</p>
        <dl>
          <div><dt>${zh() ? "最新 Trace" : "Latest trace"}</dt><dd>${escapeHtml(cycle?.traceId ?? "-")}</dd></div>
          <div><dt>${zh() ? "周期状态" : "Cycle status"}</dt><dd>${escapeHtml(cycle?.status ?? "-")}</dd></div>
          <div><dt>Decision / Risk / Execution</dt><dd>${cycle ? `${cycle.decisionCount} / ${cycle.riskDecisionCount} / ${cycle.executionCount}` : "-"}</dd></div>
        </dl>
      </section>
      <section>
        <header><span>POSITION MONITOR</span><strong>${escapeHtml(evidence.positionMonitor.status.toUpperCase())}</strong></header>
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
        <header><span>DECISION → RISK → EXECUTION</span><strong>${escapeHtml(review.decisionAction?.toUpperCase() ?? "-")}</strong></header>
        <dl>
          <div><dt>${zh() ? "决策置信度" : "Decision confidence"}</dt><dd>${review.decisionConfidence ?? "-"}</dd></div>
          <div><dt>Risk Gate</dt><dd>${review.riskPassed === undefined ? "-" : review.riskPassed ? "PASSED" : "BLOCKED"}</dd></div>
          <div><dt>Execution</dt><dd>${escapeHtml(review.executionStatus ?? "-")}</dd></div>
        </dl>
      </section>
      <section>
        <header><span>REFLECTION</span><strong>${evidence.reflection.status === "available" ? "LESSON CANDIDATE" : "UNAVAILABLE"}</strong></header>
        <p>${zh() ? "仅生成候选经验，不修改运行策略。" : "Candidate lesson only. The running strategy is never mutated."}</p>
        <ul>
          ${evidence.reflection.recommendations.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || `<li>${zh() ? "暂无候选经验" : "No lesson candidate"}</li>`}
        </ul>
      </section>
    </div>
    <section class="runtime-semantic-transfer">
      <header>
        <div><span>${zh() ? "语义交接" : "Semantic handoffs"}</span><h3>${zh() ? "Agent 输出摘要" : "Agent output summaries"}</h3></div>
        <code>${evidence.semanticTransfers.length} ARTIFACTS</code>
      </header>
      <ol>
        ${evidence.semanticTransfers.map((artifact, index) => `
          <li data-status="${artifact.status}">
            <span>${String(index + 1).padStart(2, "0")}</span>
            <div><strong>${escapeHtml(artifact.stage)} · ${escapeHtml(artifact.agent)}</strong><p>${escapeHtml(artifact.semanticSummary)}</p></div>
            <small>${artifact.durationMs} ms</small>
          </li>
        `).join("") || `<li><div><strong>${zh() ? "暂无 Agent Artifact" : "No Agent artifacts"}</strong></div></li>`}
      </ol>
    </section>
    <footer class="runtime-evidence-lineage">
      <span>TRACE ${escapeHtml(evidence.lineage.traceId ?? "-")}</span>
      <span>${evidence.lineage.artifactIds.length} ARTIFACT REFS</span>
      <span>${escapeHtml(evidence.lineage.dataSourceRef)}</span>
      <span>EXCHANGE WRITE OFF</span>
    </footer>
  `;
  const operationLayout = main.querySelector(".operation-layout");
  operationLayout?.insertAdjacentElement("beforebegin", panel);
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
