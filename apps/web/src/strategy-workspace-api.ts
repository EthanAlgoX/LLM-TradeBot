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
    agentGroups: {
      inputAgents: Array<{
        id: string;
        orchestrationClass: "input_agent";
        configurationKind: "input_source" | "prompt_strategy" | "controlled_policy";
      }>;
      analysisAgents: Array<{
        id: string;
        orchestrationClass: "analysis_agent";
        configurationKind: "input_source" | "prompt_strategy" | "controlled_policy";
      }>;
      decisionReflectionAgents: Array<{
        id: string;
        orchestrationClass: "decision_reflection_agent";
        configurationKind: "input_source" | "prompt_strategy" | "controlled_policy";
      }>;
    };
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
  composerValue: string;
  currentDraft?: DraftReference;
  errorCode?: string;
} = {
  open: false,
  busy: false,
  mode: "connecting",
  conversationId: `conversation.${crypto.randomUUID()}`,
  catalog: [],
  operations: [],
  composerValue: "",
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
    validation_failed:
      locale() === "zh-CN" ? "验证失败" : "VALIDATION_FAILED",
    evidence_required:
      locale() === "zh-CN" ? "需要证据" : "EVIDENCE_REQUIRED",
    approval_ready: text.approved,
    unavailable: locale() === "zh-CN" ? "不可用" : "UNAVAILABLE",
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
    [
      text.draft,
      selected?.draftReference?.versionId ?? state.currentDraft?.versionId,
    ],
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
  const labels: Record<string, [string, string]> = {
    contract_validation: ["合同验证", "Contract"],
    backtest: ["回测", "Backtest"],
    walk_forward: ["样本外验证", "Walk-Forward"],
    human_approval: ["人工审批", "Approval"],
    paper_running: ["模拟运行", "Paper"],
  };
  const label = labels[gate];
  return label ? label[locale() === "zh-CN" ? 0 : 1] : gate;
}

function gateStatusLabel(status: string): string {
  if (locale() !== "zh-CN") return status.replaceAll("_", " ");
  return {
    passed: "已通过",
    required: "待完成",
    blocked: "已阻断",
    running: "运行中",
    ready: "已就绪",
    not_applied: "未应用",
  }[status] ?? status;
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
                <small>${gateStatusLabel(gate.status)}</small>
              </li>
            `,
          )
          .join("")}
      </ol>
    </section>
  `;
}

function friendlyEntityName(id: string): string {
  return id
    .replace(/^(?:agent-template|data-source|market-pack|preset)[:.]/u, "")
    .replace(/[:.]v\d+$/u, "")
    .split(/[-_.:]/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function renderJourney(): string {
  const text = copy[locale()];
  const response = latestResponse();
  const current = !response?.proposal
    ? 1
    : !response.validation.valid
      ? 2
      : response.status === "approval_ready"
        ? 4
        : 3;
  const steps = [
    locale() === "zh-CN" ? "输入需求" : "Describe need",
    locale() === "zh-CN" ? "确认连接与策略" : "Confirm connections",
    locale() === "zh-CN" ? "试运行与回测" : "Dry run & backtest",
    locale() === "zh-CN" ? "审批并上线" : "Approve & release",
  ];
  return `
    <ol class="orchestration-journey">
      ${steps
        .map(
          (step, index) => `
            <li class="${index + 1 < current ? "is-done" : index + 1 === current ? "is-current" : ""}">
              <span>0${index + 1}</span>
              <strong>${step}</strong>
            </li>
          `,
        )
        .join("")}
    </ol>
  `;
}

function renderWorkflow(response: ConversationResponse): string {
  const text = copy[locale()];
  const proposal = response.proposal;
  if (!proposal) return "";
  const groupCopy = {
    input: locale() === "zh-CN" ? "输入 Agent" : "Input Agents",
    analysis: locale() === "zh-CN" ? "分析 Agent" : "Analysis Agents",
    decision:
      locale() === "zh-CN"
        ? "决策与反思 Agent"
        : "Decision & Reflection Agents",
    source: locale() === "zh-CN" ? "数据源与输入处理" : "Sources & ingestion",
    prompt: locale() === "zh-CN" ? "系统提示词与策略" : "System prompt & strategy",
    controlled: locale() === "zh-CN" ? "受控策略" : "Controlled policy",
  };
  const configurationLabel = (kind: string): string =>
    kind === "input_source"
      ? groupCopy.source
      : kind === "prompt_strategy"
        ? groupCopy.prompt
        : groupCopy.controlled;
  const promptLanguageDirective = locale() === "zh-CN"
    ? "使用中文回答；使用中文输出语义"
    : "Answer in English; output semantics in English";
  const renderGroup = (
    label: string,
    agents: Array<{ id: string; configurationKind: string }>,
    extra: string[] = [],
  ): string => `
    <div class="copilot-workflow__group">
      <small>${label}</small>
      <div>
        ${extra
          .map(
            (item) => `<span class="is-source"><strong>${escapeHtml(item)}</strong><small>${groupCopy.source}</small></span>`,
          )
          .join("")}
        ${agents
          .map(
            (agent) => `
              <span>
                <strong>${escapeHtml(friendlyEntityName(agent.id))}</strong>
                <small>${configurationLabel(agent.configurationKind)}</small>
                ${agent.configurationKind === "prompt_strategy"
                  ? `<em>${escapeHtml(promptLanguageDirective)}</em>`
                  : ""}
              </span>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
  return `
    <section class="copilot-workflow">
      <header>
        <div>
          <span>${locale() === "zh-CN" ? "生成的工作流" : "Generated Workflow"}</span>
          <strong>${escapeHtml(proposal.presetRef.id)}</strong>
        </div>
        <mark>${locale() === "zh-CN"
          ? proposal.lifecycleStatus === "draft"
            ? "草案"
            : proposal.lifecycleStatus === "validated"
              ? "已验证"
              : "已批准但未应用"
          : proposal.lifecycleStatus.toUpperCase()}</mark>
      </header>
      <div class="copilot-workflow__path">
        ${renderGroup(
          groupCopy.input,
          proposal.agentGroups.inputAgents,
          proposal.sourceRefs.map((source) => friendlyEntityName(source.id)),
        )}
        <i>→</i>
        ${renderGroup(groupCopy.analysis, proposal.agentGroups.analysisAgents)}
        <i>→</i>
        ${renderGroup(
          groupCopy.decision,
          proposal.agentGroups.decisionReflectionAgents,
        )}
      </div>
      <details>
        <summary>${text.graphPreview}</summary>
        <code>${escapeHtml(proposal.graphRef.id)} · ${escapeHtml(proposal.graphRef.humanVersion)} · ${escapeHtml(proposal.graphRef.fingerprint)}</code>
      </details>
    </section>
  `;
}

function renderProposal(response: ConversationResponse): string {
  const text = copy[locale()];
  if (!response.proposal) return "";
  const proposal = response.proposal;
  return `
    ${renderWorkflow(response)}
    <section class="copilot-proposal-meta">
      <div>
        <span>Draft</span>
        <strong>${escapeHtml(proposal.versionId)}</strong>
      </div>
      <div>
        <span>fingerprint</span>
        <code>${escapeHtml(proposal.fingerprint)}</code>
      </div>
      ${
        proposal.parentFingerprint
          ? `<div><span>parent</span><code>${escapeHtml(proposal.parentFingerprint)}</code></div>`
          : ""
      }
      <div>
        <span>evidence</span>
        <strong class="is-${proposal.evidenceStatus}">${proposal.evidenceStatus.toUpperCase()}</strong>
      </div>
    </section>
  `;
}

function renderCompactDetails(response: ConversationResponse): string {
  const text = copy[locale()];
  return `
    <details class="copilot-technical">
      <summary>${locale() === "zh-CN" ? "查看验证、数据能力与字段 Diff" : "View validation, capabilities, and field Diff"}</summary>
      ${renderDiff(response)}
      ${renderCapabilities(response)}
      ${renderValidation(response)}
    </details>
  `;
}

function renderReleaseActions(response: ConversationResponse): string {
  const text = copy[locale()];
  const nextGate = response.evidenceGates.nextGate;
  const backtestEnabled = nextGate === "backtest";
  const walkForwardEnabled = nextGate === "walk_forward";
  const approvalEnabled = nextGate === "human_approval";
  return `
    <section class="copilot-release-actions">
      <div>
        <span>${locale() === "zh-CN" ? "下一步" : "Next step"}</span>
        <strong>${
          response.validation.valid
            ? locale() === "zh-CN"
              ? "Draft 试运行检查已通过"
              : "Draft dry validation passed"
            : locale() === "zh-CN"
              ? "先修复验证问题"
              : "Resolve validation issues first"
        }</strong>
      </div>
      <button type="button" data-copilot-prompt="${locale() === "zh-CN" ? "为当前 Draft 请求回测。" : "Request a backtest for the current Draft."}" ${backtestEnabled ? "" : "disabled"}>${locale() === "zh-CN" ? "请求回测" : "Request backtest"}</button>
      <button type="button" data-copilot-prompt="${locale() === "zh-CN" ? "为当前 Draft 请求 Walk-Forward。" : "Request Walk-Forward for the current Draft."}" ${walkForwardEnabled ? "" : "disabled"}>Walk-Forward</button>
      <button type="button" data-copilot-prompt="${locale() === "zh-CN" ? "提交当前 Draft 进行人工审批。" : "Submit the current Draft for human approval."}" ${approvalEnabled ? "" : "disabled"}>${locale() === "zh-CN" ? "提交审批" : "Submit approval"}</button>
      <button type="button" class="is-release" data-view="lab" ${response.status === "approval_ready" ? "" : "disabled"}>${locale() === "zh-CN" ? "审批与 Paper 上线" : "Approval & Paper release"}</button>
    </section>
  `;
}

function renderOperation(operation: Operation): string {
  const response = operation.response;
  const text = copy[locale()];
  return `
    <article class="copilot-operation is-${response.status}">
      <div class="copilot-message is-user">
        <span>${locale() === "zh-CN" ? "你" : "You"}</span>
        <p>${escapeHtml(operation.message)}</p>
      </div>
      <div class="copilot-message is-assistant">
        <header>
          <span>${text.title}</span>
          <code>${escapeHtml(operation.id.slice(-8))}</code>
        </header>
        <p>${escapeHtml(response.assistantMessage)}</p>
        ${renderProposal(response)}
        ${renderCompactDetails(response)}
        ${renderGates(response)}
        <aside class="copilot-runtime-boundary">
          <strong>${text.runtimeIsolation}</strong>
          <p>${text.runtimeIsolationBody}</p>
        </aside>
        ${renderReleaseActions(response)}
      </div>
    </article>
  `;
}

function renderOperations(): string {
  const text = copy[locale()];
  if (state.operations.length === 0) {
    const connectionPrompt =
      locale() === "zh-CN"
        ? "让短、中、长周期 Agent 并行分析，结果交给 Decision Agent 汇总。"
        : "Run short, medium, and long-horizon Agents in parallel, then send their results to the Decision Agent.";
    return `
      <section class="copilot-empty">
        <span>YOU → ORCHESTRATION AGENT → WORKFLOW DRAFT</span>
        <h2>${locale() === "zh-CN" ? "先描述你想要的 Agent 协作方式" : "Describe how the Agents should work together"}</h2>
        <p>${locale() === "zh-CN"
          ? "可以说明数据输入、Agent 职责、连接顺序和策略要求。系统只使用已注册能力，不执行用户代码，也不会直接修改运行中的交易 Agent。"
          : "Include data inputs, Agent responsibilities, connections, and strategy requirements. Only registered capabilities are used; user code is never executed and the running Trading Agent is never changed directly."}</p>
        <div class="copilot-prompts">
          ${[text.createPrompt, connectionPrompt, text.updatePrompt]
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
          <span>AGENT WORKFLOW / DRAFT ONLY</span>
          <h1 id="copilot-title">${text.title}</h1>
          <p>${locale() === "zh-CN"
            ? "说出需求，系统自动组织子 Agent 的连接与策略，并在对话中返回可验证方案。"
            : "Describe the need. The system organizes sub-Agent connections and strategies, then returns a verifiable plan in the conversation."}</p>
        </div>
        <div>
          <strong class="is-${state.mode}">${statusText()}</strong>
          <button type="button" data-copilot-close aria-label="${text.close}">×</button>
        </div>
      </header>
      ${renderJourney()}
      <section class="copilot-context-strip">
        <div>
          <span>${locale() === "zh-CN" ? "当前选择" : "Current selection"}</span>
          <strong>${state.currentDraft?.versionId ?? (locale() === "zh-CN" ? "尚未生成 Draft" : "No Draft yet")}</strong>
        </div>
        <dl class="copilot-selection">${renderSelection()}</dl>
        <mark>runtimeApplied=false</mark>
      </section>
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
      <main class="copilot-results" aria-live="polite" aria-busy="${state.busy}">
        ${renderOperations()}
        ${state.busy ? `<div class="copilot-loading"><i></i><span>${text.sending}</span></div>` : ""}
        ${state.errorCode ? `<p class="copilot-api-error"><code>${escapeHtml(state.errorCode)}</code></p>` : ""}
      </main>
      <details class="copilot-strategy-editor">
        <summary>
          <strong>${locale() === "zh-CN" ? "策略配置" : "Strategy configuration"}</strong>
          <span>${locale() === "zh-CN"
            ? "策略与 Prompt 要求通过对话描述；只有注册模板允许的字段会进入 Draft。"
            : "Describe strategy and Prompt requirements in conversation; only fields allowed by registered templates enter the Draft."}</span>
        </summary>
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
      </details>
      <form class="copilot-composer" data-copilot-form>
        <label for="copilot-input">${locale() === "zh-CN" ? "告诉编排 Agent 你想怎么做" : "Tell the Orchestration Agent what you need"}</label>
        <div>
          <textarea id="copilot-input" name="message" rows="3" maxlength="2000" placeholder="${locale() === "zh-CN" ? "例如：使用 5m、15m、1h 数据，让三个分析 Agent 并行判断，再交给 Decision Agent 汇总。" : "Example: use 5m, 15m, and 1h data; run three analysis Agents in parallel, then send results to Decision."}" required ${canSend ? "" : "disabled"}>${escapeHtml(state.composerValue)}</textarea>
          <button type="submit" ${canSend ? "" : "disabled"}>${state.busy ? text.sending : locale() === "zh-CN" ? "生成方案" : "Generate plan"}</button>
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
  state.composerValue = normalized;
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
    state.composerValue = "";
  } catch (error) {
    state.composerValue = normalized;
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
  "input",
  (event) => {
    const input = event.target;
    if (input instanceof HTMLTextAreaElement && input.id === "copilot-input") {
      state.composerValue = input.value;
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
