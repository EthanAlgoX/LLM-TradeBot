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
    sourceArtifactIds: string[];
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

type RuntimeTransfer = RuntimeEvidenceResponse["semanticTransfers"][number];

interface RuntimeTransferPosition {
  x: number;
  y: number;
  depth: number;
}

function layoutRuntimeTransfers(transfers: RuntimeTransfer[]): {
  width: number;
  height: number;
  positions: Map<string, RuntimeTransferPosition>;
} {
  const nodeWidth = 252;
  const nodeHeight = 190;
  const columnGap = 84;
  const rowGap = 20;
  const padding = 24;
  const byId = new Map(transfers.map((item) => [item.artifactId, item]));
  const depths = new Map<string, number>();

  const findDepth = (item: RuntimeTransfer, visiting = new Set<string>()): number => {
    const cached = depths.get(item.artifactId);
    if (cached !== undefined) return cached;
    if (visiting.has(item.artifactId)) return 0;
    const nextVisiting = new Set(visiting).add(item.artifactId);
    const parents = item.sourceArtifactIds
      .map((id) => byId.get(id))
      .filter((parent): parent is RuntimeTransfer => Boolean(parent));
    const depth = parents.length === 0
      ? 0
      : Math.max(...parents.map((parent) => findDepth(parent, nextVisiting))) + 1;
    depths.set(item.artifactId, depth);
    return depth;
  };

  const columns = new Map<number, RuntimeTransfer[]>();
  for (const item of transfers) {
    const depth = findDepth(item);
    columns.set(depth, [...(columns.get(depth) ?? []), item]);
  }

  const positions = new Map<string, RuntimeTransferPosition>();
  for (const [depth, items] of columns) {
    items.forEach((item, row) => {
      positions.set(item.artifactId, {
        depth,
        x: padding + depth * (nodeWidth + columnGap),
        y: padding + row * (nodeHeight + rowGap),
      });
    });
  }

  const maxDepth = Math.max(0, ...columns.keys());
  const maxRows = Math.max(1, ...[...columns.values()].map((items) => items.length));
  return {
    width: padding * 2 + (maxDepth + 1) * nodeWidth + maxDepth * columnGap,
    height: padding * 2 + maxRows * nodeHeight + (maxRows - 1) * rowGap,
    positions,
  };
}

function renderAgentTransfers(): string {
  const transfers = evidence?.semanticTransfers ?? [];
  const layout = layoutRuntimeTransfers(transfers);
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
  const edges = transfers.flatMap((target) =>
    target.sourceArtifactIds.flatMap((sourceId) => {
      const source = layout.positions.get(sourceId);
      const destination = layout.positions.get(target.artifactId);
      if (!source || !destination) return [];
      const sourceX = source.x + 252;
      const sourceY = source.y + 95;
      const targetX = destination.x;
      const targetY = destination.y + 95;
      const bend = Math.max(28, (targetX - sourceX) / 2);
      return [`<path d="M ${sourceX} ${sourceY} C ${sourceX + bend} ${sourceY}, ${targetX - bend} ${targetY}, ${targetX} ${targetY}" />`];
    }),
  );
  const edgeCount = edges.length;
  return `
    <section class="runtime-agent-conversation" aria-labelledby="runtime-agent-conversation-title">
      <header>
        <div>
          <span>${zh() ? "当前周期 · 语义协作对话" : "CURRENT CYCLE · SEMANTIC COLLABORATION"}</span>
          <h3 id="runtime-agent-conversation-title">${zh() ? "子 Agent 运行对话" : "Sub-agent runtime dialogue"}</h3>
          <p>${zh() ? "主体展示各节点的真实语义输出；输入来源、并行分支和汇聚关系均取自 Artifact lineage，而不是消息出现顺序。" : "The dialogue centers on real semantic outputs. Inputs, parallel branches, and joins come from Artifact lineage rather than message order."}</p>
        </div>
        <code>${transfers.length} ARTIFACTS</code>
      </header>
      ${transfers.length > 0 ? `
        <details class="runtime-conversation-topology">
          <summary>
            <span>${zh() ? "展开 Graph 关系概览" : "Expand Graph relationship overview"}</span>
            <code>${transfers.length} ${zh() ? "节点" : "NODES"} · ${edgeCount} ${zh() ? "连线" : "EDGES"}</code>
          </summary>
          <div class="runtime-agent-graph-scroll" tabindex="0" aria-label="${zh() ? "可横向滚动的 Agent 运行拓扑" : "Scrollable Agent runtime topology"}">
            <div class="runtime-agent-graph" style="width:${layout.width}px;height:${layout.height}px">
              <svg aria-hidden="true" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}">
                <defs><marker id="runtime-agent-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
                <g>${edges.join("")}</g>
              </svg>
              ${transfers.map((artifact) => {
                const position = layout.positions.get(artifact.artifactId)!;
                return `
                <a class="runtime-agent-map-node" data-status="${artifact.status}" style="left:${position.x}px;top:${position.y}px" href="#${anchorById.get(artifact.artifactId)}">
                  <span>${escapeHtml(artifact.stage)}</span>
                  <strong>${escapeHtml(agentLabel(artifact.stage, artifact.agent))}</strong>
                  <small>${artifact.sourceArtifactIds.filter((id) => transferById.has(id)).length} ${zh() ? "个上游" : "UPSTREAM"}</small>
                </a>`;
              }).join("")}
            </div>
          </div>
        </details>
        <div class="runtime-agent-room" role="log" aria-live="polite">
          <div class="runtime-agent-room__status">
            <span></span>${zh() ? "Agent 语义频道" : "Agent semantic channel"}
          </div>
          ${transfers.map((artifact) => {
            const knownParents = artifact.sourceArtifactIds
              .map((id) => transferById.get(id))
              .filter((item): item is RuntimeTransfer => Boolean(item));
            const externalParentIds = artifact.sourceArtifactIds.filter((id) => !transferById.has(id));
            const children = childrenById.get(artifact.artifactId) ?? [];
            const branchParent = knownParents.find((parent) => (childrenById.get(parent.artifactId)?.length ?? 0) > 1);
            const siblings = branchParent ? childrenById.get(branchParent.artifactId) ?? [] : [];
            const branchIndex = siblings.findIndex((item) => item.artifactId === artifact.artifactId);
            const displayName = agentLabel(artifact.stage, artifact.agent);
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
                  <span>${transferStatusLabel(artifact.status)}</span>
                </header>
                ${knownParents.length > 0 ? `
                  <div class="runtime-agent-room-message__reply">↳ ${zh() ? "回复" : "Replying to"} ${parentLinks}${siblings.length > 1 ? ` · ${zh() ? `并行 ${branchIndex + 1}/${siblings.length}` : `parallel ${branchIndex + 1}/${siblings.length}`}` : ""}</div>
                ` : externalParentIds.length > 0 ? `
                  <div class="runtime-agent-room-message__reply">↳ ${zh() ? "回复前序语义" : "Replying to prior semantics"}</div>
                ` : ""}
                <div class="runtime-agent-room-message__bubble">
                  <p>${escapeHtml(artifact.semanticSummary)}</p>
                </div>
                <footer>
                  <span>→ ${zh() ? "发送给" : "Send to"}</span>
                  ${children.length > 0 ? childLinks : `<span>${zh() ? "无下游 Agent" : "No downstream Agent"}</span>`}
                </footer>
              </div>
            </article>`;
          }).join("")}
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
        <span>${view.live ? "LIVE READ MODEL" : "RECENT RUN EVIDENCE"}</span>
        <h2>${zh() ? "真实交易运行证据" : "Runtime trading evidence"}</h2>
        <p>${escapeHtml(evidence.selection?.selectedSymbols[0] ?? (zh() ? "无入选标的" : "No admitted symbol"))} · ${escapeHtml(evidence.run.runId)} · ${escapeHtml(evidence.sourceMode)}</p>
      </div>
      <strong>${escapeHtml(evidence.run.status.toUpperCase())}</strong>
    </header>
    <div class="runtime-evidence-metrics">
      <div><span>${zh() ? "现金" : "Cash"}</span><strong>${money(account?.cash)}</strong></div>
      <div><span>${zh() ? "已实现盈亏" : "Realized PnL"}</span><strong>${money(account?.realizedPnl)}</strong></div>
      <div><span>${zh() ? "已用保证金" : "Deployed margin"}</span><strong>${money(account?.deployedMargin)}</strong></div>
      <div><span>${zh() ? "手续费" : "Fees"}</span><strong>${money(account?.fees)}</strong></div>
      <div><span>${zh() ? "当前持仓" : "Open positions"}</span><strong>${account?.openPositionCount ?? "-"}</strong></div>
      <div><span>${zh() ? "运行周期" : "Run cycles"}</span><strong>${evidence.run.processedCycles}/${evidence.run.plannedCycles}</strong></div>
    </div>
    ${renderAgentTransfers()}
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
