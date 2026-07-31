import "./comparative-trade-review.css";
import {
  deriveComparativeTradeReviewViewState,
} from "./comparative-trade-review-view-state.js";
import {
  deriveLessonCandidateValidationViewState,
} from "./lesson-candidate-validation-view-state.js";
import {
  deriveLessonEvidenceGateViewState,
} from "./lesson-evidence-gate-view-state.js";
import { deriveLessonHumanApprovalViewState } from "./lesson-human-approval-view-state.js";
import { deriveApprovedLessonMaterializationViewState } from "./approved-lesson-materialization-view-state.js";

interface Metric {
  metric: "realized_pnl" | "fees" | "holding_duration_ms";
  unit: "account_currency" | "milliseconds";
  selectedValue: number;
  baselineValue: number;
  delta: number;
}

interface ComparativeEvidence {
  id: string;
  fingerprint: string;
  lifecycleStatus: "available" | "insufficient_evidence" | "stale";
  selectedTrade: { tradeId: string; symbol: string };
  baselineTradeId?: string;
  metrics: Metric[];
  issueCodes: string[];
  causalClaim: false;
  readOnly: true;
  runtimeApplied: false;
  exchangeWriteAllowed: false;
}

interface Candidate {
  id: string;
  fingerprint: string;
  lifecycleStatus: "candidate";
  sourceTradeId: string;
  semanticCandidateRef: { id: string; fingerprint: string };
  semanticFactsAvailable: true;
  lineageStatus: "verified";
  runtimeApplied: false;
  exchangeWriteAllowed: false;
}

interface ReviewRecord {
  id: string;
  lifecycleStatus: "accepted_for_validation" | "rejected";
  sourceTradeId: string;
  rationale: string;
  approvedLessonCreated: false;
  strategyMutationCreated: false;
  runtimeApplied: false;
  exchangeWriteAllowed: false;
}

interface ReviewHistory {
  lifecycleStatus: "available" | "empty";
  records: ReviewRecord[];
  nextCursor?: string;
  readOnly: true;
  runtimeApplied: false;
  exchangeWriteAllowed: false;
}

interface ValidationHandoff {
  lifecycleStatus:
    | "not_reviewed"
    | "candidate_closed"
    | "accepted_for_validation"
    | "validation_unavailable"
    | "validation_failed"
    | "validation_passed"
    | "stale";
  contractValidation: {
    status: "not_started" | "unavailable" | "failed" | "passed" | "stale" | "closed";
    issueCodes: string[];
  };
  nextGate:
    | "human_review"
    | "candidate_closed"
    | "draft_binding_required"
    | "contract_validation"
    | "backtest";
  binding?: {
    bindingVersionRef?: {
      bindingId: string;
      versionId: string;
      versionIndex: number;
      parentFingerprint?: string;
      fingerprint: string;
      lifecycleStatus: "validation_failed" | "validation_passed";
    };
    configurationRef: { draftId: string; versionId: string };
    pipelineGraphRef: { id: string; version: string };
  };
  approvedLessonCreated: false;
  strategyMutationCreated: false;
  runtimeApplied: false;
  exchangeWriteAllowed: false;
}

interface ApiFailure {
  code?: string;
  error?: { code?: string };
}

interface EvidenceGateProjection {
  lifecycleStatus:
    | "binding_required"
    | "evidence_unavailable"
    | "backtest_required"
    | "walk_forward_required"
    | "approval_required"
    | "stale";
  validationBindingRef?: { versionId: string; fingerprint: string };
  strategyEvidenceBindingRef?: {
    bindingId: string;
    versionId: string;
    fingerprint: string;
    datasetRef: { id: string };
    backtestProfileRef: { id: string };
    walkForwardCandidateSetRef: { id: string };
    walkForwardPlanRef: { id: string };
  };
  backtest: { status: string; jobId?: string };
  walkForward: { status: string; jobId?: string };
  approval: { status: string; approvalExecuted: false };
  issueCodes: string[];
  nextGate: string;
  allowedAction: "run_backtest" | "run_walk_forward" | "none";
  approvedLessonCreated: false;
  strategyMutationCreated: false;
  runtimeApplied: false;
  exchangeWriteAllowed: false;
}

interface LessonHumanApprovalResponse {
  approval: {
    approvalId: string;
    versionId: string;
    fingerprint: string;
    lifecycleStatus: "approved" | "rejected";
    rationale: string;
  };
  approvedLesson?: {
    lessonId: string;
    versionId: string;
    fingerprint: string;
    scope: {
      marketPackRef: { id: string };
      pipelineGraphRef: { id: string; version: string };
      applicableRegimes: string[];
      expiresAt: string;
      revocationStatus: "active";
    };
    decisionContextMaterializationStatus: "pending";
    decisionContextApplied: false;
    runtimeApplied: false;
  };
  approvedLessonCreated: boolean;
  decisionContextApplied: false;
  runtimeApplied: false;
}

interface ApprovedLessonMaterializationResponse {
  lifecycleStatus:
    | "not_approved"
    | "semantic_facts_unavailable"
    | "stale"
    | "expired"
    | "revoked"
    | "materialized";
  approvedLesson?: {
    id: string;
    version: string;
    fingerprint: string;
    semanticLesson: string;
    failurePattern: string;
    applicableRegimes: string[];
  };
  shadowDecisionContext: {
    lifecycleStatus: "unavailable" | "stale" | "validated";
    fingerprint: string;
  };
  issueCodes: string[];
  decisionContextApplied: false;
  runtimeApplied: false;
}

interface ShadowAuditRecord {
  id: string;
  versionIndex: number;
  humanVersion: string;
  fingerprint: string;
  createdAt: string;
  lifecycleStatus: "validated";
  approvalRef: { id: string; fingerprint: string };
  candidateRef: { id: string; fingerprint: string };
  decisionContextRef: { id: string; fingerprint: string };
  historicalLineageFingerprints: string[];
  runtimeApplied: false;
}

const environment = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;
const apiBase = environment?.VITE_TRADEBOT_ORCHESTRATION_API ??
  "http://127.0.0.1:8787";
let token = environment?.VITE_TRADEBOT_ORCHESTRATION_TOKEN ?? "";
let selectedTradeId: string | undefined;
let lifecycleStatus: string | undefined;
let loading = false;
let unavailable = false;
let evidence: ComparativeEvidence | undefined;
let candidate: Candidate | undefined;
let review: ReviewRecord | undefined;
let reviewHistory: ReviewRecord[] = [];
let validationHandoff: ValidationHandoff | undefined;
let validationBindingIdempotencyKey = "";
let evidenceGate: EvidenceGateProjection | undefined;
let evidenceGateActionKeys = { backtest: "", walkForward: "", inspect: "" };
let lessonApproval: LessonHumanApprovalResponse | undefined;
let lessonApprovalIdempotencyKey = "";
let lessonMaterialization: ApprovedLessonMaterializationResponse | undefined;
let lessonMaterializationIdempotencyKey = "";
let shadowAuditHistory: ShadowAuditRecord[] = [];

function tr(zh: string, en: string): string {
  return document.documentElement.lang.toLowerCase().startsWith("zh")
    ? zh
    : en;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMetric(metric: Metric, value: number): string {
  if (metric.unit === "milliseconds") {
    const minutes = value / 60_000;
    return `${minutes.toFixed(minutes < 10 ? 1 : 0)} min`;
  }
  return value.toFixed(4);
}

function codeFrom(body: ApiFailure): string {
  return body.code ?? body.error?.code ?? "REQUEST_REJECTED";
}

async function post<T>(path: string, body: object): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as T & ApiFailure;
  if (!response.ok) throw new Error(codeFrom(payload));
  return payload;
}

function mount(): HTMLElement | undefined {
  const parent = document.querySelector<HTMLElement>(".single-trade-review");
  if (!parent) return undefined;
  let root = parent.querySelector<HTMLElement>(
    "[data-comparative-trade-review-root]",
  );
  if (!root) {
    root = document.createElement("section");
    root.dataset.comparativeTradeReviewRoot = "";
    root.className = "comparative-review";
    parent.append(root);
  }
  return root;
}

function render(): void {
  const root = mount();
  if (!root) return;
  const view = deriveComparativeTradeReviewViewState({
    loading,
    available: evidence?.lifecycleStatus === "available",
    insufficient: evidence?.lifecycleStatus === "insufficient_evidence",
    candidateAvailable: Boolean(candidate),
    reviewed: Boolean(review),
    unavailable,
  });
  const statusLabel = view.mode.replaceAll("_", " ").toUpperCase();
  const validationView = deriveLessonCandidateValidationViewState({
    lifecycleStatus: validationHandoff?.lifecycleStatus,
  });
  const evidenceGateView = deriveLessonEvidenceGateViewState({
    lifecycleStatus: evidenceGate?.lifecycleStatus,
    allowedAction: evidenceGate?.allowedAction,
  });
  const lessonApprovalView = deriveLessonHumanApprovalViewState({
    evidenceLifecycle: evidenceGate?.lifecycleStatus,
    approvalLifecycle: lessonApproval?.approval.lifecycleStatus,
  });
  const materializationView = deriveApprovedLessonMaterializationViewState({
    lifecycleStatus: lessonMaterialization?.lifecycleStatus,
    shadowStatus: lessonMaterialization?.shadowDecisionContext.lifecycleStatus,
  });
  root.innerHTML = `
    <header class="comparative-review__header">
      <div>
        <span class="comparative-review__eyebrow">${tr("对照交易证据", "COMPARATIVE TRADE EVIDENCE")}</span>
        <h3>${tr("同范围最近基线", "Most recent same-scope baseline")}</h3>
      </div>
      <span class="comparative-review__status is-${view.mode}">${statusLabel}</span>
    </header>
    <div class="comparative-review__boundary">
      <strong>${tr("描述性证据，不是因果结论", "Descriptive evidence, not a causal claim")}</strong>
      <span>READ ONLY · runtimeApplied=false · exchangeWriteAllowed=false</span>
    </div>
    ${view.mode === "loading" ? `
      <p class="comparative-review__message">${tr("正在从 Paper Account 和 Reflection Store 读取证据…", "Loading evidence from Paper Account and Reflection Store…")}</p>
    ` : ""}
    ${view.mode === "unavailable" ? `
      <p class="comparative-review__message">${tr("当前交易没有可用的比较或候选证据。不会从摘要推断事实。", "No comparison or candidate evidence is available for this trade. Facts are not inferred from summaries.")}</p>
    ` : ""}
    ${view.mode === "insufficient" ? `
      <div class="comparative-review__message">
        <strong>COMPARATOR_NOT_AVAILABLE</strong>
        <span>${tr("没有更早且 Graph、Market Pack、Symbol 相同的已平仓交易。", "No earlier closed trade has the same Graph, Market Pack, and Symbol.")}</span>
      </div>
    ` : ""}
    ${evidence?.lifecycleStatus === "available" ? `
      <div class="comparative-review__scope">
        <span>${tr("当前交易", "Selected")}: <strong>${escapeHtml(evidence.selectedTrade.tradeId)}</strong></span>
        <span>${tr("服务端基线", "Server baseline")}: <strong>${escapeHtml(evidence.baselineTradeId ?? "-")}</strong></span>
      </div>
      <div class="comparative-review__metrics">
        ${evidence.metrics.map((metric) => `
          <div>
            <span>${escapeHtml(metric.metric.replaceAll("_", " "))}</span>
            <strong>${formatMetric(metric, metric.selectedValue)}</strong>
            <small>${tr("基线", "baseline")} ${formatMetric(metric, metric.baselineValue)} · Δ ${formatMetric(metric, metric.delta)}</small>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${candidate ? `
      <div class="comparative-review__candidate">
        <div>
          <span>LESSON CANDIDATE</span>
          <strong>${escapeHtml(candidate.id)}</strong>
          <small>${tr("语义事实：可用 · Lineage：已验证", "Semantic facts: available · Lineage: verified")}</small>
          <small>${tr("语义 Candidate 指纹", "Semantic Candidate fingerprint")}: ${escapeHtml(candidate.semanticCandidateRef.fingerprint)}</small>
          <small>${tr("人工操作只决定进入验证或关闭候选，不会创建已批准 Lesson。", "Human review only advances to validation or closes the candidate; it does not create an approved Lesson.")}</small>
        </div>
        ${review ? `
          <div class="comparative-review__reviewed">
            <strong>${escapeHtml(review.lifecycleStatus.replaceAll("_", " ").toUpperCase())}</strong>
            <span>${escapeHtml(review.rationale)}</span>
            <small>approvedLessonCreated=false · strategyMutationCreated=false</small>
          </div>
        ` : `
          <form data-comparative-review-form>
            <label>
              <span>${tr("复核理由", "Review rationale")}</span>
              <textarea name="rationale" rows="3" minlength="3" required placeholder="${tr("记录接受验证或拒绝的理由", "Record why this candidate should advance or be rejected")}"></textarea>
            </label>
            <div>
              <button type="submit" name="decision" value="accept_for_validation">${tr("接受并进入合同验证", "Accept for contract validation")}</button>
              <button type="submit" name="decision" value="reject" class="is-reject">${tr("拒绝候选", "Reject candidate")}</button>
            </div>
          </form>
        `}
      </div>
    ` : ""}
    ${reviewHistory.length > 0 ? `
      <details class="comparative-review__history">
        <summary>${tr("人工复核历史", "Human review history")} · ${reviewHistory.length}</summary>
        <div>
          ${reviewHistory.map((item) => `
            <article>
              <strong>${escapeHtml(item.lifecycleStatus.replaceAll("_", " ").toUpperCase())}</strong>
              <span>${escapeHtml(item.rationale)}</span>
              <small>${escapeHtml(item.id)} · runtimeApplied=false</small>
            </article>
          `).join("")}
        </div>
      </details>
    ` : ""}
    ${validationHandoff ? `
      <section class="comparative-review__candidate">
        <div>
          <span>${tr("合同验证交接", "CONTRACT VALIDATION HANDOFF")}</span>
          <strong>${escapeHtml(validationView.mode.replaceAll("_", " ").toUpperCase())}</strong>
          <small>${tr(
            validationView.mode === "validation_unavailable"
              ? "人工已接受，但尚无服务端 Draft / Graph 绑定；没有执行或通过合同验证。"
              : validationView.mode === "validation_passed"
                ? "现有 Graph Validator 已对绑定版本返回通过；下一门禁是 Backtest。"
                : validationView.mode === "stale"
                  ? "候选、对照证据或验证绑定已经变化，交接已按失败关闭处理。"
                  : "该状态来自服务端不可变复核记录和现有验证边界。",
            validationView.mode === "validation_unavailable"
              ? "Human review accepted the candidate, but no server-owned Draft / Graph binding exists; contract validation has not run or passed."
              : validationView.mode === "validation_passed"
                ? "The existing Graph Validator passed the bound version; Backtest is the next gate."
                : validationView.mode === "stale"
                  ? "The candidate, comparison evidence, or validation binding changed; the handoff failed closed."
                  : "This state is derived from immutable server review records and the existing validation boundary.",
          )}</small>
        </div>
        <div class="comparative-review__reviewed">
          <strong>${escapeHtml(validationHandoff.contractValidation.status.toUpperCase())}</strong>
          <span>${validationHandoff.contractValidation.issueCodes.length > 0
            ? validationHandoff.contractValidation.issueCodes.map(escapeHtml).join(" · ")
            : tr("无验证问题", "No validation issues")}</span>
          <small>${tr("下一门禁", "Next gate")}: ${escapeHtml(validationHandoff.nextGate)} · runtimeApplied=false</small>
          ${validationHandoff.binding ? `
            <small>${escapeHtml(validationHandoff.binding.configurationRef.versionId)} · ${escapeHtml(validationHandoff.binding.pipelineGraphRef.id)}@${escapeHtml(validationHandoff.binding.pipelineGraphRef.version)}</small>
            ${validationHandoff.binding.bindingVersionRef ? `
              <small>${escapeHtml(validationHandoff.binding.bindingVersionRef.versionId)} · ${tr("版本", "version")} ${validationHandoff.binding.bindingVersionRef.versionIndex} · ${escapeHtml(validationHandoff.binding.bindingVersionRef.fingerprint)}</small>
              ${validationHandoff.binding.bindingVersionRef.parentFingerprint ? `
                <small>${tr("父指纹", "Parent fingerprint")}: ${escapeHtml(validationHandoff.binding.bindingVersionRef.parentFingerprint)}</small>
              ` : ""}
            ` : ""}
          ` : ""}
          ${validationView.mode === "validation_unavailable" && review?.lifecycleStatus === "accepted_for_validation" ? `
            <button type="button" data-create-validation-binding>${tr("解析服务端 Draft 并验证", "Resolve server Draft and validate")}</button>
          ` : ""}
        </div>
      </section>
    ` : ""}
    ${evidenceGate ? `
      <section class="comparative-review__evidence-gates">
        <div class="comparative-review__gate-heading">
          <div>
            <span>${tr("Lesson 证据门禁", "LESSON EVIDENCE GATES")}</span>
            <strong>${escapeHtml(evidenceGateView.mode.replaceAll("_", " ").toUpperCase())}</strong>
          </div>
          <small>APPROVAL NOT EXECUTED · APPROVED LESSON NOT CREATED · runtimeApplied=false</small>
        </div>
        <div class="comparative-review__gate-rail">
          <article><span>BACKTEST</span><strong>${escapeHtml(evidenceGate.backtest.status.toUpperCase())}</strong><small>${escapeHtml(evidenceGate.backtest.jobId ?? tr("尚无 Job", "No job"))}</small></article>
          <article><span>WALK-FORWARD</span><strong>${escapeHtml(evidenceGate.walkForward.status.toUpperCase())}</strong><small>${escapeHtml(evidenceGate.walkForward.jobId ?? tr("尚无 Job", "No job"))}</small></article>
          <article><span>HUMAN APPROVAL</span><strong>${escapeHtml(evidenceGate.approval.status.toUpperCase())}</strong><small>${tr("本轮不执行批准", "Approval is not executed in this loop")}</small></article>
        </div>
        ${evidenceGate.strategyEvidenceBindingRef ? `
          <div class="comparative-review__evidence-scope">
            <span>${tr("证据绑定", "Evidence binding")}: <strong>${escapeHtml(evidenceGate.strategyEvidenceBindingRef.versionId)}</strong></span>
            <span>Dataset: ${escapeHtml(evidenceGate.strategyEvidenceBindingRef.datasetRef.id)}</span>
            <span>Profile: ${escapeHtml(evidenceGate.strategyEvidenceBindingRef.backtestProfileRef.id)}</span>
            <span>Candidate set: ${escapeHtml(evidenceGate.strategyEvidenceBindingRef.walkForwardCandidateSetRef.id)}</span>
          </div>
        ` : ""}
        ${evidenceGate.issueCodes.length > 0 ? `<p class="comparative-review__gate-issues">${evidenceGate.issueCodes.map(escapeHtml).join(" · ")}</p>` : ""}
        <div class="comparative-review__gate-action">
          <span>${tr("下一门禁", "Next gate")}: <strong>${escapeHtml(evidenceGate.nextGate)}</strong></span>
          ${evidenceGate.allowedAction === "run_backtest" ? `<button type="button" data-evidence-action="run_backtest">${tr("运行已注册 Backtest", "Run registered Backtest")}</button>` : ""}
          ${evidenceGate.allowedAction === "run_walk_forward" ? `<button type="button" data-evidence-action="run_walk_forward">${tr("运行已注册 Walk-Forward", "Run registered Walk-Forward")}</button>` : ""}
        </div>
        <section class="comparative-review__lesson-approval">
          <div>
            <span>LESSON HUMAN APPROVAL</span>
            <strong>${escapeHtml(lessonApprovalView.mode.replaceAll("_", " ").toUpperCase())}</strong>
            <small>${tr("Lesson Approval 与 Strategy Approval 分离；不会创建 Paper Plan。", "Lesson Approval is separate from Strategy Approval and never creates a Paper Plan.")}</small>
          </div>
          ${lessonApproval ? `
            <div class="comparative-review__approval-result">
              <strong>${escapeHtml(lessonApproval.approval.lifecycleStatus.toUpperCase())}</strong>
              <span>${escapeHtml(lessonApproval.approval.rationale)}</span>
              <small>${escapeHtml(lessonApproval.approval.versionId)} · ${escapeHtml(lessonApproval.approval.fingerprint)}</small>
              ${lessonApproval.approvedLesson ? `
                <small>${escapeHtml(lessonApproval.approvedLesson.lessonId)} · ${escapeHtml(lessonApproval.approvedLesson.scope.marketPackRef.id)} · ${escapeHtml(lessonApproval.approvedLesson.scope.pipelineGraphRef.id)}@${escapeHtml(lessonApproval.approvedLesson.scope.pipelineGraphRef.version)}</small>
                <small>${tr("适用 Regime", "Applicable regime")}: ${escapeHtml(lessonApproval.approvedLesson.scope.applicableRegimes.join(", "))} · ${tr("有效至", "Expires")}: ${escapeHtml(lessonApproval.approvedLesson.scope.expiresAt)}</small>
              ` : ""}
              <small>decisionContextApplied=false · runtimeApplied=false</small>
              ${lessonApproval.approval.lifecycleStatus === "approved" ? `
                <div class="comparative-review__materialization">
                  <span>${tr("语义物化", "SEMANTIC MATERIALIZATION")}</span>
                  <strong>${escapeHtml(materializationView.mode.replaceAll("_", " ").toUpperCase())}</strong>
                  ${lessonMaterialization?.approvedLesson ? `
                    <p>${escapeHtml(lessonMaterialization.approvedLesson.semanticLesson)}</p>
                    <small>${escapeHtml(lessonMaterialization.approvedLesson.failurePattern)} · ${escapeHtml(lessonMaterialization.approvedLesson.applicableRegimes.join(", "))}</small>
                  ` : ""}
                  ${lessonMaterialization?.issueCodes.length ? `<small>${lessonMaterialization.issueCodes.map(escapeHtml).join(" · ")}</small>` : ""}
                  <small>SHADOW ${escapeHtml(materializationView.shadowMode.toUpperCase())} · ${tr("只读历史重放", "read-only historical replay")} · decisionContextApplied=false</small>
                  ${shadowAuditHistory.length > 0 ? `
                    <details class="comparative-review__history">
                      <summary>${tr("Shadow 审计历史", "Shadow audit history")} · ${shadowAuditHistory.length}</summary>
                      <div>${shadowAuditHistory.map((item) => `<article><strong>V${item.versionIndex} · ${escapeHtml(item.lifecycleStatus.toUpperCase())}</strong><span>${escapeHtml(item.decisionContextRef.id)}</span><small>${escapeHtml(item.approvalRef.id)} · ${escapeHtml(item.candidateRef.id)} · lineage ${item.historicalLineageFingerprints.length} · runtimeApplied=false</small></article>`).join("")}</div>
                    </details>
                  ` : ""}
                </div>
              ` : ""}
            </div>
          ` : lessonApprovalView.canDecide ? `
            <form data-lesson-approval-form>
              <label>
                <span>${tr("批准理由", "Approval rationale")}</span>
                <textarea name="rationale" rows="3" minlength="8" required placeholder="${tr("记录批准或拒绝该 Lesson 的理由", "Record why this Lesson should be approved or rejected")}"></textarea>
              </label>
              <div>
                <button type="submit" name="decision" value="approve">${tr("批准 Lesson Artifact", "Approve Lesson Artifact")}</button>
                <button type="submit" name="decision" value="reject" class="is-reject">${tr("拒绝 Lesson", "Reject Lesson")}</button>
              </div>
            </form>
          ` : `
            <small>${tr("Backtest 与 Walk-Forward 尚未双通过，批准入口保持关闭。", "Approval remains closed until Backtest and Walk-Forward both pass.")}</small>
          `}
        </section>
      </section>
    ` : ""}
  `;
  root.querySelector<HTMLFormElement>("[data-comparative-review-form]")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const submitter = (event as SubmitEvent).submitter as
        | HTMLButtonElement
        | null;
      const form = event.currentTarget as HTMLFormElement;
      const rationale = new FormData(form).get("rationale")?.toString().trim();
      const decision = submitter?.value as
        | "accept_for_validation"
        | "reject"
        | undefined;
      if (!rationale || rationale.length < 3 || !decision) return;
      void submitReview(decision, rationale);
    });
  root.querySelector<HTMLButtonElement>("[data-create-validation-binding]")
    ?.addEventListener("click", () => void createValidationBinding());
  root.querySelectorAll<HTMLButtonElement>("[data-evidence-action]")
    .forEach((button) => button.addEventListener("click", () => {
      const action = button.dataset.evidenceAction as
        | "run_backtest"
        | "run_walk_forward";
      void advanceEvidenceGate(action);
    }));
  root.querySelector<HTMLFormElement>("[data-lesson-approval-form]")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
      const rationale = new FormData(form).get("rationale")?.toString().trim();
      const decision = submitter?.value as "approve" | "reject" | undefined;
      if (!rationale || rationale.length < 8 || !decision) return;
      void submitLessonApproval(decision, rationale);
    });
}

async function loadTrade(): Promise<void> {
  if (!token || !selectedTradeId || lifecycleStatus !== "closed_trade") {
    unavailable = true;
    render();
    return;
  }
  loading = true;
  unavailable = false;
  evidence = undefined;
  candidate = undefined;
  review = undefined;
  reviewHistory = [];
  validationHandoff = undefined;
  evidenceGate = undefined;
  lessonApproval = undefined;
  lessonMaterialization = undefined;
  shadowAuditHistory = [];
  validationBindingIdempotencyKey =
    `web:lesson-validation-binding:${Date.now().toString(36)}`;
  evidenceGateActionKeys = {
    inspect: `web:lesson-evidence-inspect:${Date.now().toString(36)}`,
    backtest: `web:lesson-evidence-backtest:${Date.now().toString(36)}`,
    walkForward: `web:lesson-evidence-walk-forward:${Date.now().toString(36)}`,
  };
  lessonApprovalIdempotencyKey =
    `web:lesson-human-approval:${Date.now().toString(36)}`;
  lessonMaterializationIdempotencyKey =
    `web:approved-lesson-materialization:${Date.now().toString(36)}`;
  render();
  const tradeId = selectedTradeId;
  const comparison = post<ComparativeEvidence>(
    "/api/orchestration/trade-reviews/comparisons",
    { selectedTradeId: tradeId },
  );
  const inspection = post<Candidate>(
    "/api/orchestration/lesson-candidates/inspect",
    { selectedTradeId: tradeId },
  );
  const history = post<ReviewHistory>(
    "/api/orchestration/lesson-candidates/reviews/history",
    { selectedTradeId: tradeId, limit: 10 },
  );
  const handoff = post<ValidationHandoff>(
    "/api/orchestration/lesson-candidates/validation-handoff",
    { selectedTradeId: tradeId },
  );
  const evidenceProjection = post<EvidenceGateProjection>(
    "/api/orchestration/lesson-candidates/evidence-gates",
    {
      selectedTradeId: tradeId,
      idempotencyKey: evidenceGateActionKeys.inspect,
      action: "inspect",
    },
  );
  const approvalStatus = post<LessonHumanApprovalResponse>(
    "/api/orchestration/lesson-candidates/approvals/status",
    { selectedTradeId: tradeId },
  );
  const materialization = post<ApprovedLessonMaterializationResponse>(
    "/api/orchestration/lesson-candidates/materializations",
    {
      selectedTradeId: tradeId,
      idempotencyKey: lessonMaterializationIdempotencyKey,
    },
  );
  const [comparisonResult, candidateResult, historyResult, handoffResult, evidenceResult, approvalResult, materializationResult] =
    await Promise.allSettled([
    comparison,
    inspection,
    history,
    handoff,
    evidenceProjection,
    approvalStatus,
    materialization,
  ]);
  if (comparisonResult.status === "fulfilled") {
    evidence = comparisonResult.value;
  }
  if (candidateResult.status === "fulfilled") {
    candidate = candidateResult.value;
  }
  if (historyResult.status === "fulfilled") {
    reviewHistory = historyResult.value.records;
    review = reviewHistory[0];
  }
  if (handoffResult.status === "fulfilled") {
    validationHandoff = handoffResult.value;
  }
  if (evidenceResult.status === "fulfilled") {
    evidenceGate = evidenceResult.value;
  }
  if (approvalResult.status === "fulfilled") {
    lessonApproval = approvalResult.value;
  }
  if (materializationResult.status === "fulfilled") {
    lessonMaterialization = materializationResult.value;
  }
  try {
    const audit = await post<{ records: ShadowAuditRecord[] }>(
      "/api/orchestration/lesson-candidates/materializations/history",
      { selectedTradeId: tradeId, limit: 10 },
    );
    shadowAuditHistory = audit.records;
  } catch {
    shadowAuditHistory = [];
  }
  unavailable = !evidence && !candidate;
  loading = false;
  render();
}

async function createValidationBinding(): Promise<void> {
  if (!selectedTradeId || !validationBindingIdempotencyKey) return;
  loading = true;
  render();
  try {
    await post(
      "/api/orchestration/lesson-candidates/validation-bindings",
      {
        selectedTradeId,
        idempotencyKey: validationBindingIdempotencyKey,
      },
    );
    validationHandoff = await post<ValidationHandoff>(
      "/api/orchestration/lesson-candidates/validation-handoff",
      { selectedTradeId },
    );
    evidenceGate = await post<EvidenceGateProjection>(
      "/api/orchestration/lesson-candidates/evidence-gates",
      {
        selectedTradeId,
        idempotencyKey: evidenceGateActionKeys.inspect,
        action: "inspect",
      },
    );
  } catch {
    unavailable = true;
  } finally {
    loading = false;
    render();
  }
}

async function advanceEvidenceGate(
  action: "run_backtest" | "run_walk_forward",
): Promise<void> {
  if (!selectedTradeId) return;
  loading = true;
  render();
  try {
    evidenceGate = await post<EvidenceGateProjection>(
      "/api/orchestration/lesson-candidates/evidence-gates",
      {
        selectedTradeId,
        idempotencyKey: action === "run_backtest"
          ? evidenceGateActionKeys.backtest
          : evidenceGateActionKeys.walkForward,
        action,
      },
    );
  } catch {
    unavailable = true;
  } finally {
    loading = false;
    render();
  }
}

async function submitLessonApproval(
  decision: "approve" | "reject",
  rationale: string,
): Promise<void> {
  if (!selectedTradeId || !lessonApprovalIdempotencyKey) return;
  loading = true;
  render();
  try {
    lessonApproval = await post<LessonHumanApprovalResponse>(
      "/api/orchestration/lesson-candidates/approvals",
      {
        selectedTradeId,
        decision,
        rationale,
        idempotencyKey: lessonApprovalIdempotencyKey,
      },
    );
    if (lessonApproval.approval.lifecycleStatus === "approved") {
      lessonMaterialization = await post<ApprovedLessonMaterializationResponse>(
        "/api/orchestration/lesson-candidates/materializations",
        {
          selectedTradeId,
          idempotencyKey: lessonMaterializationIdempotencyKey,
        },
      );
      const audit = await post<{ records: ShadowAuditRecord[] }>(
        "/api/orchestration/lesson-candidates/materializations/history",
        { selectedTradeId, limit: 10 },
      );
      shadowAuditHistory = audit.records;
    }
  } catch {
    unavailable = true;
  } finally {
    loading = false;
    render();
  }
}

async function submitReview(
  decision: "accept_for_validation" | "reject",
  rationale: string,
): Promise<void> {
  if (!candidate || !evidence) return;
  loading = true;
  render();
  try {
    const result = await post<{
      review: ReviewRecord;
      nextGate: "contract_validation" | "candidate_closed";
      runtimeApplied: false;
    }>("/api/orchestration/lesson-candidates/reviews", {
      candidateId: candidate.id,
      candidateFingerprint: candidate.fingerprint,
      comparativeEvidenceId: evidence.id,
      comparativeEvidenceFingerprint: evidence.fingerprint,
      decision,
      rationale,
      idempotencyKey:
        `web:${candidate.id}:${evidence.id}:${decision}`,
    });
    review = result.review;
    reviewHistory = [
      result.review,
      ...reviewHistory.filter((item) => item.id !== result.review.id),
    ].slice(0, 10);
    validationHandoff = await post<ValidationHandoff>(
      "/api/orchestration/lesson-candidates/validation-handoff",
      { selectedTradeId: result.review.sourceTradeId },
    );
  } catch {
    unavailable = true;
  } finally {
    loading = false;
    render();
  }
}

window.addEventListener("tradebot:orchestration-session", (event) => {
  token = (event as CustomEvent<{ token?: string }>).detail.token ?? token;
});
window.addEventListener("tradebot:causal-selected-trade", (event) => {
  const detail = (event as CustomEvent<{
    tradeId?: string;
    lifecycleStatus?: string;
  }>).detail;
  selectedTradeId = detail.tradeId;
  lifecycleStatus = detail.lifecycleStatus;
  void loadTrade();
});
