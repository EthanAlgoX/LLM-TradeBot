import "./strategy-workspace.css";
import {
  deriveConversationViewState,
  type ConversationViewState,
} from "./orchestration-conversation-view-state.js";

type Locale = "zh-CN" | "en";
type ConnectionMode = "connecting" | "live" | "readonly" | "offline";

interface IntentCatalogEntry {
  preset: {
    id: string;
    displayName: string;
    observationWindows: Array<{ unit: string; value: number }>;
  };
  compilationAvailable: boolean;
}

interface DraftReference {
  draftId: string;
  versionId: string;
  fingerprint: string;
}

interface WindowDefinition {
  kind: string;
  unit: string;
  value: number;
}

interface ConversationResponse {
  status:
    | "proposal"
    | "validation_failed"
    | "evidence_required"
    | "approval_ready"
    | "unavailable";
  assistantMessage: string;
  context: {
    actor: { actorId: string; roles: string[] };
    selected: {
      marketPackId?: string;
      dataSourceIds: string[];
      presetId?: string;
      agentTemplateId?: string;
      draftReference?: DraftReference;
    };
  };
  proposal?: {
    draftId: string;
    versionId: string;
    humanVersion: string;
    fingerprint: string;
    parentFingerprint?: string;
    lifecycleStatus: "draft" | "validated" | "approved_not_applied";
    evidenceStatus: "none" | "current" | "stale";
    marketRef: { id: string };
    sourceRefs: Array<{ id: string }>;
    presetRef: { id: string };
    agentRefs: Array<{ id: string }>;
    graphRef: { id: string; humanVersion: string; fingerprint: string };
    changes: Array<{
      changeId: string;
      operation: "add" | "replace" | "remove";
      entityId: string;
      path: Array<string | number>;
      before?: unknown;
      after?: unknown;
    }>;
    runtimeApplied: false;
  };
  validation: {
    valid: boolean;
    issues: Array<{
      issueId: string;
      code: string;
      path: Array<string | number>;
      details: Record<string, unknown>;
    }>;
    capabilities: Array<{
      capabilityId: string;
      dataSourceId: string;
      nativeObservationWindows: WindowDefinition[];
      requestedObservationWindows: WindowDefinition[];
      lineage: Array<{
        sourceWindow: WindowDefinition;
        targetWindow: WindowDefinition;
        transformerVersion: string;
      }>;
    }>;
  };
  evidenceGates: {
    nextGate?: string;
    gates: Array<{
      gate: string;
      status:
        | "passed"
        | "required"
        | "blocked"
        | "running"
        | "ready"
        | "not_applied";
    }>;
  };
  runtimeApplied: false;
}

interface Operation {
  id: string;
  message: string;
  response: ConversationResponse;
}

interface ApiError {
  error?: { code?: string };
}

const apiBase =
  (
    globalThis as typeof globalThis & {
      __TRADEBOT_ORCHESTRATION_API__?: string;
    }
  ).__TRADEBOT_ORCHESTRATION_API__ ?? "http://127.0.0.1:8787";
let token = (
  globalThis as typeof globalThis & {
    __TRADEBOT_ORCHESTRATION_TOKEN__?: string;
  }
).__TRADEBOT_ORCHESTRATION_TOKEN__;

const state: {
  open: boolean;
  busy: boolean;
  mode: ConnectionMode;
  conversationId: string;
  catalog: IntentCatalogEntry[];
  operations: Operation[];
  currentDraft?: DraftReference;
  errorCode?: string;
} = {
  open: false,
  busy: false,
  mode: "connecting",
  conversationId: `conversation.${crypto.randomUUID()}`,
  catalog: [],
  operations: [],
};

const copy = {
  "zh-CN": {
    kicker: "CONVERSATION ORCHESTRATION / DRAFT ONLY",
    title: "编排 Copilot",
    subtitle:
      "用自然语言选择服务端注册能力，创建不可变 Draft Version，并推进验证门禁。",
    connected: "真实后端已连接",
    readonly: "需要操作员身份",
    offline: "编排服务不可用",
    connecting: "正在连接",
    close: "关闭",
    token: "本机操作员令牌",
    tokenPlaceholder: "仅保存在当前页面内存",
    connect: "连接",
    input: "编排指令",
    inputPlaceholder:
      "例如：基于当前 Crypto Multi-Agent Preset 创建一个策略草案。",
    send: "提交 Draft 指令",
    sending: "正在调用注册工具",
    createPrompt: "基于当前 Crypto Multi-Agent Preset 创建一个策略草案。",
    invalidPrompt: "数据源只有 1d，但给 Trigger Agent 配置 5m。",
    updatePrompt:
      "修改 Analysis Agent 的 confidenceThreshold，设置为 0.72。",
    currentSelection: "当前选择",
    market: "市场",
    source: "数据源",
    preset: "预设",
    agent: "Agent",
    draft: "Draft",
    none: "尚未选择",
    operationLog: "结构化操作结果",
    emptyTitle: "从对话创建，而不是从画布开始",
    emptyBody:
      "普通用户只需描述市场、数据源、观察窗口、Agent 或允许策略字段。Graph 保持为稀疏只读预览。",
    proposal: "Draft Proposal",
    diff: "字段级 Diff",
    capability: "Data Source Capability",
    nativeWindows: "原生窗口",
    requestedWindows: "请求窗口",
    lineage: "聚合 Lineage",
    validation: "Contract Validation",
    noIssues: "没有验证问题",
    gates: "Evidence / Approval Gates",
    graphPreview: "高级：Graph 只读预览",
    runtimeIsolation: "DRAFT 未应用到 Runtime",
    runtimeIsolationBody:
      "Copilot 不提供 Start、Pause、Safe Stop、下单或 Runtime Apply。运行控制继续走独立受控链路。",
    directEdit: "直接编辑允许字段",
    field: "字段",
    value: "值",
    applyEdit: "创建新 Draft Version",
    editNeedsDraft: "先创建一个 Draft，才能产生父 fingerprint 与字段 Diff。",
    presets: "已注册 Pipeline Preset",
    registered: "可编译",
    unavailable: "能力未注册",
    stateLegend: "状态边界",
    mock: "MOCK",
    draftState: "DRAFT",
    validated: "VALIDATED",
    approved: "APPROVED_NOT_APPLIED",
    activeRuntime: "ACTIVE PAPER RUNTIME",
    terminalRun: "RECENT TERMINAL RUN",
    externalControl: "独立 Runtime 链路",
    unavailableView: "服务或能力不可用",
    footer:
      "消息合同拒绝 Actor、Runner、Evidence、代码、SQL、URL、路径、Runtime 与 Risk bypass 字段。",
  },
  en: {
    kicker: "CONVERSATION ORCHESTRATION / DRAFT ONLY",
    title: "Orchestration Copilot",
    subtitle:
      "Use natural language to select server-registered capabilities, create immutable Draft Versions, and advance validation gates.",
    connected: "Real backend connected",
    readonly: "Operator identity required",
    offline: "Orchestration unavailable",
    connecting: "Connecting",
    close: "Close",
    token: "Local operator token",
    tokenPlaceholder: "Kept in this page's memory only",
    connect: "Connect",
    input: "Orchestration command",
    inputPlaceholder:
      "Example: create a strategy Draft from the Current Crypto Multi-Agent Preset.",
    send: "Submit Draft command",
    sending: "Calling registered tools",
    createPrompt:
      "Create a strategy Draft from the Current Crypto Multi-Agent Preset.",
    invalidPrompt:
      "The data source has only native 1d data, but configure the Trigger Agent for 5m.",
    updatePrompt:
      "Modify the Analysis Agent confidenceThreshold and set it to 0.72.",
    currentSelection: "Current selection",
    market: "Market",
    source: "Data Source",
    preset: "Preset",
    agent: "Agent",
    draft: "Draft",
    none: "Not selected",
    operationLog: "Structured operation results",
    emptyTitle: "Create through conversation, not a canvas",
    emptyBody:
      "Describe a market, source, observation window, Agent, or allowed strategy field. The Graph remains a sparse read-only preview.",
    proposal: "Draft Proposal",
    diff: "Field-level Diff",
    capability: "Data Source Capability",
    nativeWindows: "Native windows",
    requestedWindows: "Requested windows",
    lineage: "Aggregation lineage",
    validation: "Contract Validation",
    noIssues: "No validation issues",
    gates: "Evidence / Approval Gates",
    graphPreview: "Advanced: read-only Graph preview",
    runtimeIsolation: "DRAFT NOT APPLIED TO RUNTIME",
    runtimeIsolationBody:
      "Copilot exposes no Start, Pause, Safe Stop, order, or Runtime Apply tools. Runtime Controls remain on the separate controlled path.",
    directEdit: "Edit an allowed field",
    field: "Field",
    value: "Value",
    applyEdit: "Create new Draft Version",
    editNeedsDraft:
      "Create a Draft first so the parent fingerprint and field Diff are available.",
    presets: "Registered Pipeline Presets",
    registered: "Compilable",
    unavailable: "Capability unavailable",
    stateLegend: "State boundary",
    mock: "MOCK",
    draftState: "DRAFT",
    validated: "VALIDATED",
    approved: "APPROVED_NOT_APPLIED",
    activeRuntime: "ACTIVE PAPER RUNTIME",
    terminalRun: "RECENT TERMINAL RUN",
    externalControl: "Separate Runtime path",
    unavailableView: "Service or capability unavailable",
    footer:
      "The message contract rejects Actor, Runner, Evidence, code, SQL, URL, path, Runtime, and Risk-bypass fields.",
  },
} as const;

function locale(): Locale {
  return document.documentElement.lang.toLowerCase().startsWith("zh")
    ? "zh-CN"
    : "en";
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}

function valueLabel(value: unknown): string {
  if (value === undefined) return "∅";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function windowLabel(window: { unit: string; value: number }): string {
  const aliases: Record<string, string> = {
    second: "s",
    minute: "m",
    hour: "h",
    day: "d",
    week: "w",
    month: "M",
    quarter: "Q",
  };
  return `${window.value}${aliases[window.unit] ?? window.unit}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const body = (await response.json()) as { data?: T } & ApiError;
    if (!response.ok) {
      throw new Error(body.error?.code ?? `HTTP_${response.status}`);
    }
    return body.data as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

function statusText(): string {
  const text = copy[locale()];
  if (state.mode === "live") return text.connected;
  if (state.mode === "readonly") return text.readonly;
  if (state.mode === "offline") return text.offline;
  return text.connecting;
}

function latestResponse(): ConversationResponse | undefined {
  return state.operations.at(-1)?.response;
}

function viewState(): ConversationViewState {
  return deriveConversationViewState({
    busy: state.busy,
    responseStatus: latestResponse()?.status,
    unavailable: state.mode === "offline",
  });
}

function stateLabel(status: ConversationResponse["status"]): string {
  const text = copy[locale()];
  return {
    proposal: text.draftState,
    validation_failed: "VALIDATION_FAILED",
    evidence_required: "EVIDENCE_REQUIRED",
    approval_ready: text.approved,
    unavailable: "UNAVAILABLE",
  }[status];
}

function renderSelection(): string {
  const text = copy[locale()];
  const selected = latestResponse()?.context.selected;
  const rows = [
    [text.market, selected?.marketPackId],
    [text.source, selected?.dataSourceIds.join(" / ")],
    [text.preset, selected?.presetId],
    [text.agent, selected?.agentTemplateId],
    [text.draft, selected?.draftReference?.versionId],
  ];
  return rows
    .map(
      ([label, value]) => `
        <div>
          <dt>${label}</dt>
          <dd>${escapeHtml(value || text.none)}</dd>
        </div>
      `,
    )
    .join("");
}

function renderDiff(response: ConversationResponse): string {
  const text = copy[locale()];
  const changes = response.proposal?.changes ?? [];
  if (changes.length === 0) return "";
  return `
    <section class="copilot-result__section">
      <h4>${text.diff}</h4>
      <div class="copilot-diff">
        ${changes
          .map(
            (change) => `
              <div class="copilot-diff__row">
                <code>${escapeHtml(change.path.join("."))}</code>
                <span class="is-before">${escapeHtml(valueLabel(change.before))}</span>
                <i>→</i>
                <span class="is-after">${escapeHtml(valueLabel(change.after))}</span>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderCapabilities(response: ConversationResponse): string {
  const text = copy[locale()];
  if (response.validation.capabilities.length === 0) return "";
  return `
    <section class="copilot-result__section">
      <h4>${text.capability}</h4>
      ${response.validation.capabilities
        .map(
          (capability) => `
            <div class="copilot-capability">
              <code>${escapeHtml(capability.dataSourceId)}</code>
              <dl>
                <div><dt>${text.nativeWindows}</dt><dd>${capability.nativeObservationWindows.map(windowLabel).join(" / ")}</dd></div>
                <div><dt>${text.requestedWindows}</dt><dd>${capability.requestedObservationWindows.map(windowLabel).join(" / ")}</dd></div>
                ${
                  capability.lineage.length
                    ? `<div><dt>${text.lineage}</dt><dd>${capability.lineage
                        .map(
                          (lineage) =>
                            `${windowLabel(lineage.sourceWindow)} → ${windowLabel(lineage.targetWindow)} · ${lineage.transformerVersion}`,
                        )
                        .join("<br>")}</dd></div>`
                    : ""
                }
              </dl>
            </div>
          `,
        )
        .join("")}
    </section>
  `;
}

function renderValidation(response: ConversationResponse): string {
  const text = copy[locale()];
  return `
    <section class="copilot-result__section">
      <h4>${text.validation}</h4>
      ${
        response.validation.issues.length === 0
          ? `<p class="copilot-validation-pass">${text.noIssues}</p>`
          : `<div class="copilot-issues">${response.validation.issues
              .map(
                (issue) => `
                  <article>
                    <code>${escapeHtml(issue.code)}</code>
                    <span>${escapeHtml(issue.path.join("."))}</span>
                  </article>
                `,
              )
              .join("")}</div>`
      }
    </section>
  `;
}

function gateLabel(gate: string): string {
  return gate
    .replace("contract_validation", "Contract")
    .replace("walk_forward", "Walk-Forward")
    .replace("human_approval", "Approval")
    .replace("paper_running", "Paper")
    .replace("backtest", "Backtest");
}

function renderGates(response: ConversationResponse): string {
  const text = copy[locale()];
  return `
    <section class="copilot-result__section">
      <h4>${text.gates}</h4>
      <ol class="copilot-gates">
        ${response.evidenceGates.gates
          .map(
            (gate) => `
              <li class="is-${gate.status}">
                <span>${gateLabel(gate.gate)}</span>
                <small>${gate.status.replaceAll("_", " ")}</small>
              </li>
            `,
          )
          .join("")}
      </ol>
    </section>
  `;
}

function renderProposal(response: ConversationResponse): string {
  const text = copy[locale()];
  if (!response.proposal) return "";
  const proposal = response.proposal;
  return `
    <section class="copilot-proposal">
      <header>
        <div>
          <span>${text.proposal}</span>
          <strong>${escapeHtml(proposal.versionId)}</strong>
        </div>
        <mark>${proposal.lifecycleStatus.toUpperCase()}</mark>
      </header>
      <dl>
        <div><dt>fingerprint</dt><dd>${escapeHtml(proposal.fingerprint)}</dd></div>
        ${
          proposal.parentFingerprint
            ? `<div><dt>parent</dt><dd>${escapeHtml(proposal.parentFingerprint)}</dd></div>`
            : ""
        }
        <div><dt>evidence</dt><dd class="is-${proposal.evidenceStatus}">${proposal.evidenceStatus.toUpperCase()}</dd></div>
      </dl>
      <details>
        <summary>${text.graphPreview}</summary>
        <p>${escapeHtml(proposal.graphRef.id)} · ${escapeHtml(proposal.graphRef.humanVersion)}</p>
        <div>${proposal.agentRefs
          .slice(0, 8)
          .map((agent) => `<code>${escapeHtml(agent.id)}</code>`)
          .join("<i>→</i>")}</div>
      </details>
    </section>
  `;
}

function renderOperation(operation: Operation): string {
  const response = operation.response;
  return `
    <article class="copilot-operation is-${response.status}">
      <header>
        <span>${stateLabel(response.status)}</span>
        <code>${escapeHtml(operation.id.slice(-8))}</code>
      </header>
      <p class="copilot-operation__command">${escapeHtml(operation.message)}</p>
      <p class="copilot-operation__summary">${escapeHtml(response.assistantMessage)}</p>
      ${renderProposal(response)}
      ${renderDiff(response)}
      ${renderCapabilities(response)}
      ${renderValidation(response)}
      ${renderGates(response)}
      <aside class="copilot-runtime-boundary">
        <strong>${copy[locale()].runtimeIsolation}</strong>
        <p>${copy[locale()].runtimeIsolationBody}</p>
      </aside>
    </article>
  `;
}

function renderOperations(): string {
  const text = copy[locale()];
  if (state.operations.length === 0) {
    return `
      <section class="copilot-empty">
        <span>CONVERSATION → TOOLS → DRAFT</span>
        <h2>${text.emptyTitle}</h2>
        <p>${text.emptyBody}</p>
        <div class="copilot-prompts">
          ${[text.createPrompt, text.invalidPrompt, text.updatePrompt]
            .map(
              (prompt) =>
                `<button type="button" data-copilot-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`,
            )
            .join("")}
        </div>
      </section>
    `;
  }
  return state.operations.map(renderOperation).join("");
}

function renderCatalog(): string {
  const text = copy[locale()];
  return state.catalog
    .map(
      (entry) => `
        <div class="copilot-preset">
          <div>
            <strong>${escapeHtml(entry.preset.displayName)}</strong>
            <span>${entry.preset.observationWindows.map(windowLabel).join(" / ")}</span>
          </div>
          <small class="${entry.compilationAvailable ? "is-ready" : ""}">
            ${entry.compilationAvailable ? text.registered : text.unavailable}
          </small>
        </div>
      `,
    )
    .join("");
}

function ensureRoot(): HTMLElement {
  let root = document.querySelector<HTMLElement>(
    "#orchestration-copilot-root",
  );
  if (!root) {
    root = document.createElement("div");
    root.id = "orchestration-copilot-root";
    document.body.append(root);
  }
  return root;
}

function workspaceHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#orchestration-workspace-host");
}

function render(): void {
  const root = ensureRoot();
  const host = workspaceHost();
  const embedded = host !== null;
  if (host && root.parentElement !== host) host.append(root);
  if (!host && root.parentElement !== document.body) document.body.append(root);
  const visible = state.open || embedded;
  root.classList.toggle("is-embedded", embedded);
  root.hidden = !visible;
  document.body.classList.toggle("orchestration-copilot-open", state.open && !embedded);
  if (!visible) {
    root.innerHTML = "";
    return;
  }
  const text = copy[locale()];
  const canSend = state.mode === "live" && !state.busy;
  const currentView = viewState();
  root.innerHTML = `
    <button class="copilot-backdrop" type="button" data-copilot-close aria-label="${text.close}"></button>
    <section class="copilot-drawer is-${currentView}" role="${embedded ? "region" : "dialog"}" aria-modal="${embedded ? "false" : "true"}" aria-labelledby="copilot-title">
      <header class="copilot-header">
        <div>
          <span>${text.kicker}</span>
          <h1 id="copilot-title">${text.title}</h1>
          <p>${text.subtitle}</p>
        </div>
        <div>
          <strong class="is-${state.mode}">${statusText()}</strong>
          <button type="button" data-copilot-close aria-label="${text.close}">×</button>
        </div>
      </header>
      ${
        state.mode !== "live"
          ? `
            <form class="copilot-auth" data-copilot-auth>
              <label for="copilot-token">${text.token}</label>
              <input id="copilot-token" name="token" type="password" autocomplete="off" placeholder="${text.tokenPlaceholder}" required>
              <button type="submit">${text.connect}</button>
            </form>
          `
          : ""
      }
      <div class="copilot-layout">
        <main class="copilot-results" aria-live="polite" aria-busy="${state.busy}">
          <div class="copilot-results__title">
            <span>${text.operationLog}</span>
            <code>${currentView.toUpperCase()}</code>
          </div>
          ${renderOperations()}
          ${
            state.busy
              ? `<div class="copilot-loading"><i></i><span>${text.sending}</span></div>`
              : ""
          }
          ${
            state.errorCode
              ? `<p class="copilot-api-error"><code>${escapeHtml(state.errorCode)}</code></p>`
              : ""
          }
        </main>
        <aside class="copilot-inspector">
          <section>
            <h2>${text.currentSelection}</h2>
            <dl class="copilot-selection">${renderSelection()}</dl>
          </section>
          <section>
            <h2>${text.directEdit}</h2>
            <form class="copilot-edit" data-copilot-edit>
              <label>${text.field}
                <select name="field" ${state.currentDraft ? "" : "disabled"}>
                  <option value="confidenceThreshold">confidenceThreshold</option>
                  <option value="lookbackPeriods">lookbackPeriods</option>
                  <option value="minimumSignalScore">minimumSignalScore</option>
                </select>
              </label>
              <label>${text.value}
                <input name="value" value="0.72" ${state.currentDraft ? "" : "disabled"} required>
              </label>
              <button type="submit" ${state.currentDraft && canSend ? "" : "disabled"}>${text.applyEdit}</button>
              ${state.currentDraft ? "" : `<small>${text.editNeedsDraft}</small>`}
            </form>
          </section>
          <section>
            <h2>${text.presets}</h2>
            <div class="copilot-presets">${renderCatalog()}</div>
          </section>
          <section>
            <h2>${text.stateLegend}</h2>
            <div class="copilot-state-legend">
              <span>${text.mock}</span>
              <span>${text.draftState}</span>
              <span>${text.validated}</span>
              <span>${text.approved}</span>
              <span class="is-external">${text.activeRuntime}<small>${text.externalControl}</small></span>
              <span class="is-external">${text.terminalRun}<small>${text.externalControl}</small></span>
            </div>
          </section>
        </aside>
      </div>
      <form class="copilot-composer" data-copilot-form>
        <label for="copilot-input">${text.input}</label>
        <div>
          <textarea id="copilot-input" name="message" rows="2" maxlength="2000" placeholder="${text.inputPlaceholder}" required ${canSend ? "" : "disabled"}></textarea>
          <button type="submit" ${canSend ? "" : "disabled"}>${state.busy ? text.sending : text.send}</button>
        </div>
        <small>${text.footer}</small>
      </form>
    </section>
  `;
}

async function connect(): Promise<void> {
  state.mode = "connecting";
  render();
  try {
    state.catalog = await request<IntentCatalogEntry[]>(
      "/api/orchestration/intent-catalog",
    );
    if (token) {
      await request("/api/orchestration/session");
      state.mode = "live";
    } else {
      state.mode = "readonly";
    }
    state.errorCode = undefined;
  } catch (error) {
    state.mode = state.catalog.length > 0 ? "readonly" : "offline";
    state.errorCode =
      error instanceof Error ? error.message : "COPILOT_API_UNAVAILABLE";
  }
  render();
}

function open(): void {
  state.open = true;
  render();
  window.setTimeout(() => {
    document.querySelector<HTMLTextAreaElement>("#copilot-input")?.focus();
  });
}

function close(): void {
  state.open = false;
  render();
  document.querySelector<HTMLButtonElement>("#open-copilot")?.focus();
}

async function sendMessage(message: string): Promise<void> {
  const normalized = message.trim();
  if (!normalized || state.mode !== "live" || state.busy) return;
  state.busy = true;
  state.errorCode = undefined;
  render();
  try {
    const response = await request<ConversationResponse>(
      "/api/orchestration/copilot/messages",
      {
        method: "POST",
        body: JSON.stringify({
          schemaVersion: "1.0.0",
          conversationId: state.conversationId,
          idempotencyKey: `idempotency.${crypto.randomUUID()}`,
          locale: locale(),
          message: normalized,
          ...(state.currentDraft
            ? { draftReference: state.currentDraft }
            : {}),
        }),
      },
    );
    if (response.runtimeApplied !== false) {
      throw new Error("RUNTIME_MUTATION_INVARIANT_FAILED");
    }
    state.currentDraft =
      response.context.selected.draftReference ?? state.currentDraft;
    state.operations.push({
      id: `operation.${crypto.randomUUID()}`,
      message: normalized,
      response,
    });
  } catch (error) {
    state.errorCode =
      error instanceof Error ? error.message : "COPILOT_MESSAGE_FAILED";
  } finally {
    state.busy = false;
    render();
    window.setTimeout(() => {
      const results = document.querySelector(".copilot-results");
      results?.scrollTo({ top: results.scrollHeight, behavior: "smooth" });
      document.querySelector<HTMLTextAreaElement>("#copilot-input")?.focus();
    });
  }
}

window.addEventListener("tradebot:orchestration-session", (event: Event) => {
  const detail = (event as CustomEvent<{ token?: string }>).detail;
  if (!detail?.token) return;
  token = detail.token;
  void connect();
});

document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("#open-copilot")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      open();
      return;
    }
    if (target.closest("[data-copilot-close]")) {
      close();
      return;
    }
    const prompt = target.closest<HTMLElement>("[data-copilot-prompt]");
    if (prompt?.dataset.copilotPrompt) {
      void sendMessage(prompt.dataset.copilotPrompt);
    }
  },
  true,
);

document.addEventListener(
  "submit",
  (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.matches("[data-copilot-auth]")) {
      event.preventDefault();
      token = String(new FormData(form).get("token") ?? "").trim() || undefined;
      void connect();
      return;
    }
    if (form.matches("[data-copilot-edit]")) {
      event.preventDefault();
      const data = new FormData(form);
      const field = String(data.get("field") ?? "");
      const value = String(data.get("value") ?? "");
      const message =
        locale() === "zh-CN"
          ? `修改 Analysis Agent 的 ${field}，设置为 ${value}。`
          : `Modify the Analysis Agent ${field} and set it to ${value}.`;
      void sendMessage(message);
      return;
    }
    if (form.matches("[data-copilot-form]")) {
      event.preventDefault();
      const message = String(new FormData(form).get("message") ?? "");
      form.reset();
      void sendMessage(message);
    }
  },
  true,
);

document.addEventListener(
  "keydown",
  (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const host = workspaceHost();
      if (host) {
        host.querySelector<HTMLTextAreaElement>("[data-copilot-form] textarea")?.focus();
        return;
      }
      if (state.open) close();
      else open();
      return;
    }
    if (event.key === "Escape" && state.open) {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }
  },
  true,
);

new MutationObserver((records) => {
  if (
    state.open &&
    records.some(
      (record) =>
        record.type === "attributes" &&
        record.target === document.documentElement &&
        record.attributeName === "lang",
    )
  ) {
    render();
  }
}).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["lang"],
});

let embeddedHostPresent = false;
new MutationObserver(() => {
  const host = workspaceHost();
  const root = document.querySelector<HTMLElement>("#orchestration-copilot-root");
  const hostPresent = host !== null;
  if (hostPresent !== embeddedHostPresent || (host && root?.parentElement !== host)) {
    embeddedHostPresent = hostPresent;
    render();
  }
}).observe(document.querySelector("#app") ?? document.body, {
  childList: true,
  subtree: true,
});

void connect();
