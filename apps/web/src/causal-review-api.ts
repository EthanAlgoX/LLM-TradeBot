import "./causal-review.css";
import {
  deriveCausalReviewViewState,
} from "./causal-review-view-state.js";

interface EvidenceField {
  key: string;
  value: string | number | boolean | null;
}

interface CausalReviewResponse {
  reviewId: string;
  fingerprint: string;
  evidenceStatus: "active" | "recent" | "partial" | "unavailable";
  dataClass: "runtime" | "sample";
  context: {
    marketPackRef: string;
    dataSourceRef: string;
    graphRef?: string;
  };
  run?: {
    runId: string;
    status: string;
    processedCycles: number;
    plannedCycles: number;
    strategyProfileRef: string;
  };
  cycles: Array<{
    cycle: number;
    traceId: string;
    status: string;
    finishedAt: string;
    evidenceAvailability: string;
  }>;
  selectedCycle?: {
    cycle: {
      cycle: number;
      traceId: string;
      status: string;
      evidenceAvailability: string;
    };
    agentEvidence: Array<{
      artifactId: string;
      stage: string;
      agentRef: string;
      agentVersion: string;
      status: string;
      symbol?: string;
      durationMs: number;
      inputFields: EvidenceField[];
      outputFields: EvidenceField[];
    }>;
    actionChain: Record<string, string[]>;
    lineage: Array<{
      linkId: string;
      fromArtifactId: string;
      toArtifactId: string;
      relationship: "explicit_reference" | "observed_sequence";
      causal: boolean;
    }>;
    tradeReviews: Array<{
      tradeRef: string;
      symbol?: string;
      matchedArtifactIds: string[];
      singleTradeReview?: {
        reviewId: string;
        lifecycleStatus:
          | "active_position"
          | "closed_trade"
          | "partial_evidence"
          | "unavailable";
        availability: "available" | "partial" | "unavailable";
        tradeId?: string;
        positionId?: string;
        symbol?: string;
        side?: "long" | "short";
        quantity?: number;
        realizedPnl?: number;
        fees?: number;
        reflectionId?: string;
        entry?: {
          orderId?: string;
          traceId?: string;
          decisionArtifactId?: string;
          portfolioArtifactId?: string;
          riskArtifactId?: string;
          executionArtifactId?: string;
          fillId?: string;
          fillPrice?: number;
          fee?: number;
          occurredAt?: string;
          reason?: string;
        };
        exit?: {
          orderId?: string;
          traceId?: string;
          decisionArtifactId?: string;
          portfolioArtifactId?: string;
          riskArtifactId?: string;
          executionArtifactId?: string;
          fillId?: string;
          fillPrice?: number;
          fee?: number;
          occurredAt?: string;
          reason?: string;
        };
        links: Array<{
          linkId: string;
          fromRef: string;
          toRef: string;
          relationship: string;
          causal: boolean;
        }>;
        issues: Array<{
          code: string;
          severity: string;
          message: string;
        }>;
        runtimeApplied: false;
      };
    }>;
    selectedTradeRef?: string;
    reflection: {
      availability: string;
      candidateOnly: true;
      runtimeApplied: false;
      recommendations: string[];
    };
    issues: Array<{
      code: string;
      severity: string;
      message: string;
    }>;
  };
  pagination: {
    limit: number;
    nextCursor?: string;
  };
  readOnly: true;
  runtimeApplied: false;
  exchangeWriteAllowed: false;
}

const viteEnvironment = (
  import.meta as unknown as {
    env?: Record<string, string | undefined>;
  }
).env;
const apiBase =
  viteEnvironment?.VITE_TRADEBOT_ORCHESTRATION_API ??
  "http://127.0.0.1:8787";
let token = viteEnvironment?.VITE_TRADEBOT_ORCHESTRATION_TOKEN;
let review: CausalReviewResponse | undefined;
let loading = false;
let failed = false;

const zh = (): boolean =>
  document.documentElement.lang.toLowerCase().startsWith("zh");
const tr = (cn: string, en: string): string => zh() ? cn : en;

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function badge(value: string, className = ""): string {
  return `<span class="causal-badge ${className}">${escapeHtml(value)}</span>`;
}

function renderFields(fields: EvidenceField[]): string {
  if (fields.length === 0) {
    return `<span class="causal-muted">${tr("未记录安全可展示字段", "No safe display fields recorded")}</span>`;
  }
  return `<dl class="causal-fields">${fields.slice(0, 12).map((field) => `
    <div><dt>${escapeHtml(field.key)}</dt><dd>${escapeHtml(field.value ?? "null")}</dd></div>
  `).join("")}</dl>`;
}

function renderAgent(
  artifact: NonNullable<CausalReviewResponse["selectedCycle"]>["agentEvidence"][number],
): string {
  return `
    <article class="causal-agent">
      <header>
        <div>
          <span class="causal-stage">${escapeHtml(artifact.stage)}</span>
          <h4>${escapeHtml(artifact.agentRef)}</h4>
        </div>
        ${badge(artifact.status, `is-${artifact.status}`)}
      </header>
      <div class="causal-agent-meta">
        <span>${escapeHtml(artifact.agentVersion)}</span>
        <span>${artifact.durationMs} ms</span>
        ${artifact.symbol ? `<span>${escapeHtml(artifact.symbol)}</span>` : ""}
      </div>
      <details>
        <summary>${tr("检查安全字段", "Inspect safe fields")}</summary>
        <div class="causal-io">
          <section><h5>INPUT</h5>${renderFields(artifact.inputFields)}</section>
          <section><h5>OUTPUT</h5>${renderFields(artifact.outputFields)}</section>
        </div>
      </details>
    </article>
  `;
}

function render(): void {
  const root = document.querySelector<HTMLElement>("[data-causal-review-root]");
  if (!root) return;
  const view = deriveCausalReviewViewState({
    evidenceStatus: review?.evidenceStatus,
    dataClass: review?.dataClass,
    loading,
    failed,
  });
  if (loading && !review) {
    root.innerHTML = `
      <section class="causal-shell is-loading" aria-busy="true">
        <div class="causal-loading-bar"></div>
        <p>${tr("正在读取不可变运行证据…", "Reading immutable runtime evidence...")}</p>
      </section>`;
    return;
  }
  if (!review) {
    root.innerHTML = `
      <section class="causal-shell is-unavailable">
        <div>
          ${badge("UNAVAILABLE", "is-unavailable")}
          <h2>${tr("因果审阅服务不可用", "Causal review unavailable")}</h2>
          <p>${tr("当前仅保留下面明确标记的 SAMPLE 记录；没有从摘要推断运行事实。", "Only the explicitly marked SAMPLE records below remain; no runtime facts were inferred from summaries.")}</p>
        </div>
      </section>`;
    return;
  }
  const cycle = review.selectedCycle;
  const selectedTrade = cycle?.tradeReviews.find((item) =>
    item.tradeRef === cycle.selectedTradeRef);
  const singleTrade = selectedTrade?.singleTradeReview;
  const modeLabel = view.mode.toUpperCase();
  root.innerHTML = `
    <section class="causal-shell is-${view.mode}">
      <header class="causal-header">
        <div>
          <div class="causal-kicker">
            ${badge(modeLabel, `is-${view.mode}`)}
            ${badge(review.dataClass === "sample" ? "SAMPLE" : "RUNTIME", review.dataClass === "sample" ? "is-sample" : "")}
            ${badge("READ ONLY")}
          </div>
          <h2>${tr("Causal Run / Trade Review", "Causal Run / Trade Review")}</h2>
          <p>${review.run
            ? `${escapeHtml(review.run.runId)} · ${review.run.processedCycles}/${review.run.plannedCycles} ${tr("周期", "cycles")}`
            : tr("尚无可审阅运行", "No reviewable run")}</p>
        </div>
        <div class="causal-boundary">
          <strong>${tr("未应用到 Runtime", "NOT APPLIED TO RUNTIME")}</strong>
          <span>EXCHANGE WRITE OFF</span>
        </div>
      </header>
      <div class="causal-context">
        <div><span>MARKET</span><strong>${escapeHtml(review.context.marketPackRef)}</strong></div>
        <div><span>SOURCE</span><strong>${escapeHtml(review.context.dataSourceRef)}</strong></div>
        <div><span>GRAPH</span><strong>${escapeHtml(review.context.graphRef ?? "-")}</strong></div>
        <div><span>FINGERPRINT</span><strong>${escapeHtml(review.fingerprint.slice(0, 24))}…</strong></div>
      </div>
      <div class="causal-workbench">
        <aside class="causal-cycles">
          <h3>${tr("运行周期", "Run cycles")}</h3>
          ${review.cycles.length === 0
            ? `<p class="causal-muted">${tr("没有周期记录", "No cycle records")}</p>`
            : review.cycles.map((item) => `
              <button type="button" data-causal-cycle="${item.cycle}" class="${cycle?.cycle.cycle === item.cycle ? "is-selected" : ""}">
                <span>CYCLE ${item.cycle}</span>
                <strong>${escapeHtml(item.status)}</strong>
                <small>${escapeHtml(item.traceId)}</small>
              </button>`).join("")}
          ${review.pagination.nextCursor
            ? `<button type="button" class="causal-more" data-causal-cursor="${escapeHtml(review.pagination.nextCursor)}">${tr("加载更早周期", "Load earlier cycles")}</button>`
            : ""}
        </aside>
        <div class="causal-review">
          ${cycle ? `
            <div class="causal-review-title">
              <div>
                <span>TRACE</span>
                <h3>${escapeHtml(cycle.cycle.traceId)}</h3>
              </div>
              ${badge(cycle.cycle.evidenceAvailability.toUpperCase(), `is-${cycle.cycle.evidenceAvailability}`)}
            </div>
            <nav class="causal-chain" aria-label="${tr("动作链证据", "Action-chain evidence")}">
              ${[
                ["selectorArtifactIds", "Selector"],
                ["positionMonitorArtifactIds", "Position Monitor"],
                ["decisionArtifactIds", "Decision"],
                ["portfolioArtifactIds", "Portfolio"],
                ["riskArtifactIds", "Risk"],
                ["executionArtifactIds", "Execution"],
              ].map(([key, label]) => `
                <span class="${(cycle.actionChain[key] ?? []).length > 0 ? "has-evidence" : ""}">
                  ${label}<small>${(cycle.actionChain[key] ?? []).length}</small>
                </span>`).join("")}
            </nav>
            <section class="causal-agents">
              <div class="causal-section-heading">
                <h3>${tr("Agent 证据节点", "Agent evidence nodes")}</h3>
                <span>${cycle.agentEvidence.length} ARTIFACTS</span>
              </div>
              ${cycle.agentEvidence.length > 0
                ? cycle.agentEvidence.map(renderAgent).join("")
                : `<p class="causal-muted">${tr("未记录 Agent Artifact。", "No Agent Artifacts recorded.")}</p>`}
            </section>
            <section class="causal-trades">
              <div class="causal-section-heading">
                <h3>${tr("交易引用", "Trade references")}</h3>
                <span>${tr("仅显示显式关联", "Explicit links only")}</span>
              </div>
              ${cycle.tradeReviews.length > 0
                ? cycle.tradeReviews.map((trade) => `
                  <button type="button" data-causal-trade="${escapeHtml(trade.tradeRef)}" class="${cycle.selectedTradeRef === trade.tradeRef ? "is-selected" : ""}">
                    <strong>${escapeHtml(trade.symbol ?? tr("未知标的", "Unknown symbol"))}</strong>
                    <span>${escapeHtml(trade.tradeRef)}</span>
                    <small>${escapeHtml(trade.singleTradeReview?.lifecycleStatus ?? `${trade.matchedArtifactIds.length} ARTIFACTS`)}</small>
                  </button>`).join("")
                : `<p class="causal-muted">${tr("本周期没有显式订单或交易引用。", "No explicit order or trade reference exists for this cycle.")}</p>`}
            </section>
            ${singleTrade ? `
              <section class="single-trade-review">
                <div class="causal-section-heading">
                  <div>
                    <span>SINGLE TRADE REVIEW</span>
                    <h3>${escapeHtml(singleTrade.tradeId ?? selectedTrade?.tradeRef ?? "-")}</h3>
                  </div>
                  ${badge(singleTrade.lifecycleStatus.replaceAll("_", " ").toUpperCase(), `is-${singleTrade.availability}`)}
                </div>
                <div class="single-trade-facts">
                  <div><span>POSITION</span><strong>${escapeHtml(singleTrade.positionId ?? "-")}</strong></div>
                  <div><span>${tr("方向 / 数量", "SIDE / QUANTITY")}</span><strong>${escapeHtml(singleTrade.side ?? "-")} · ${escapeHtml(singleTrade.quantity ?? "-")}</strong></div>
                  <div><span>REALIZED PNL</span><strong>${singleTrade.realizedPnl === undefined ? "-" : singleTrade.realizedPnl.toFixed(4)}</strong></div>
                  <div><span>FEES</span><strong>${singleTrade.fees === undefined ? "-" : singleTrade.fees.toFixed(4)}</strong></div>
                </div>
                <div class="single-trade-legs">
                  ${[
                    [tr("开仓证据", "ENTRY EVIDENCE"), singleTrade.entry],
                    [tr("平仓证据", "EXIT EVIDENCE"), singleTrade.exit],
                  ].map(([label, leg]) => {
                    const value = leg as typeof singleTrade.entry;
                    return `
                      <article>
                        <h4>${label as string}</h4>
                        ${value ? `
                          <dl>
                            <div><dt>ORDER</dt><dd>${escapeHtml(value.orderId ?? "-")}</dd></div>
                            <div><dt>DECISION</dt><dd>${escapeHtml(value.decisionArtifactId ?? "-")}</dd></div>
                            <div><dt>PORTFOLIO</dt><dd>${escapeHtml(value.portfolioArtifactId ?? "-")}</dd></div>
                            <div><dt>RISK</dt><dd>${escapeHtml(value.riskArtifactId ?? "-")}</dd></div>
                            <div><dt>EXECUTION</dt><dd>${escapeHtml(value.executionArtifactId ?? "-")}</dd></div>
                            <div><dt>FILL</dt><dd>${escapeHtml(value.fillId ?? "-")} · ${escapeHtml(value.fillPrice ?? "-")}</dd></div>
                          </dl>
                        ` : `<p class="causal-muted">${tr("未记录该阶段证据。", "Evidence for this leg was not recorded.")}</p>`}
                      </article>`;
                  }).join("")}
                </div>
                <div class="single-trade-boundary">
                  <strong>${singleTrade.reflectionId
                    ? `REFLECTION · ${escapeHtml(singleTrade.reflectionId)}`
                    : tr("没有显式关联 Reflection", "No explicitly linked Reflection")}</strong>
                  <span>LESSON CANDIDATE · runtimeApplied=false</span>
                </div>
                ${singleTrade.issues.length > 0 ? `
                  <div class="single-trade-issues">
                    ${singleTrade.issues.map((issue) => `
                      <div><code>${escapeHtml(issue.code)}</code><span>${escapeHtml(issue.message)}</span></div>
                    `).join("")}
                  </div>` : ""}
              </section>
            ` : ""}
            <section class="causal-lineage">
              <div class="causal-section-heading">
                <h3>LINEAGE</h3>
                <span>${tr("观测顺序不等于因果关系", "Observed order is not causality")}</span>
              </div>
              ${cycle.lineage.slice(0, 12).map((link) => `
                <div>
                  ${badge(link.causal ? "EXPLICIT" : "SEQUENCE", link.causal ? "is-explicit" : "")}
                  <span>${escapeHtml(link.fromArtifactId)} → ${escapeHtml(link.toArtifactId)}</span>
                </div>`).join("")}
            </section>
            <section class="causal-reflection">
              <div>
                <span>REFLECTION · LESSON CANDIDATE</span>
                <strong>${escapeHtml(cycle.reflection.availability)}</strong>
              </div>
              <p>${cycle.reflection.recommendations[0]
                ? escapeHtml(cycle.reflection.recommendations[0])
                : tr("没有 Reflection Candidate；不会自动改变策略。", "No Reflection Candidate; strategy remains unchanged.")}</p>
              <small>runtimeApplied=false</small>
            </section>
            <section class="causal-issues">
              <div class="causal-section-heading"><h3>${tr("证据问题", "Evidence issues")}</h3></div>
              ${cycle.issues.length > 0
                ? cycle.issues.map((issue) => `
                  <div class="is-${issue.severity}">
                    <code>${escapeHtml(issue.code)}</code>
                    <span>${escapeHtml(issue.message)}</span>
                  </div>`).join("")
                : `<p class="causal-muted">${tr("没有记录证据问题。", "No evidence issues recorded.")}</p>`}
            </section>
          ` : `
            <div class="causal-empty-selection">
              <span>RUN → CYCLE → TRADE</span>
              <h3>${tr("选择一个周期检查真实证据链", "Select a cycle to inspect its evidence chain")}</h3>
              <p>${tr("不会从运行摘要推断 Agent 输入、Risk 决策或成交原因。", "Agent input, Risk decisions, and fill reasons are never inferred from run summaries.")}</p>
            </div>`}
        </div>
      </div>
    </section>`;
  window.dispatchEvent(new CustomEvent("tradebot:causal-selected-trade", {
    detail: {
      tradeId: singleTrade?.tradeId,
      lifecycleStatus: singleTrade?.lifecycleStatus,
    },
  }));
  bind();
}

async function load(path = "/api/orchestration/causal-review/runs/latest"): Promise<void> {
  if (!token || loading) return;
  loading = true;
  failed = false;
  render();
  try {
    const response = await fetch(`${apiBase}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.json() as {
      data?: CausalReviewResponse;
      error?: { code: string };
    };
    if (!response.ok || !body.data) {
      throw new Error(body.error?.code ?? String(response.status));
    }
    review = body.data;
  } catch {
    failed = true;
  } finally {
    loading = false;
    render();
  }
}

function bind(): void {
  const runId = review?.run?.runId;
  document.querySelectorAll<HTMLElement>("[data-causal-cycle]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!runId) return;
      const cycle = button.dataset.causalCycle;
      void load(`/api/orchestration/causal-review/runs/${encodeURIComponent(runId)}/cycles/${cycle}`);
    });
  });
  document.querySelectorAll<HTMLElement>("[data-causal-trade]").forEach((button) => {
    button.addEventListener("click", () => {
      const cycle = review?.selectedCycle?.cycle.cycle;
      const tradeRef = button.dataset.causalTrade;
      if (!runId || !cycle || !tradeRef) return;
      void load(`/api/orchestration/causal-review/runs/${encodeURIComponent(runId)}/cycles/${cycle}/trades/${encodeURIComponent(tradeRef)}`);
    });
  });
  document.querySelectorAll<HTMLElement>("[data-causal-cursor]").forEach((button) => {
    button.addEventListener("click", () => {
      const cursor = button.dataset.causalCursor;
      if (!runId || !cursor) return;
      void load(`/api/orchestration/causal-review/runs/${encodeURIComponent(runId)}?cursor=${encodeURIComponent(cursor)}&limit=8`);
    });
  });
}

window.addEventListener("tradebot:orchestration-session", (event) => {
  token = (event as CustomEvent<{ token?: string }>).detail.token ?? token;
  void load();
});
window.addEventListener("tradebot:runtime-context", () => void load());
window.addEventListener("tradebot:runtime-evidence-remount", () => {
  render();
  if (!review) void load();
});

queueMicrotask(() => {
  render();
  void load();
});
