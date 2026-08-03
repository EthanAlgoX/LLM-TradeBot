import "./style.css";
import "./orchestration-api.js";
import "./runtime-evidence-api.js";
import "./causal-review-api.js";
import "./comparative-trade-review-api.js";
import "./strategy-workspace-api.js";
import "./data-center-api.js";
import "./experiment-workspace-api.js";
import "./multi-paper-runtime-center.js";
import "./runtime-dashboard.css";
import "./strategy-app-preview.css";
import type {
  RuntimeDashboardSnapshot,
} from "./runtime-operation-session.js";
import {
  appendWorkbenchExchange,
  createInitialStrategyAppPreviewState,
  createPrototypeStrategyApp,
  selectPreviewApp,
  selectPreviewProposal,
  selectPreviewScenario,
  type StrategyAppPreviewState,
  type StrategyAppStatus,
} from "./strategy-app-preview-state.js";
import {
  proposalById,
  renderAgentCenter,
  renderConnectionSettingsPreview,
  renderDataCenterPrelude,
  renderExperimentHandoff,
  renderMyStrategyApps,
  renderStrategyAdvisor,
  renderStrategyAppDetail,
  renderStrategyOverview,
  renderStrategyWorkbench,
  renderTradeCenterPreview,
  inferWorkbenchScenarioId,
  type AgentCategory,
  type ConnectionPreviewTab,
  type StrategyDetailTab,
  type StrategyDetailTarget,
} from "./strategy-app-preview.js";

type Locale = "zh-CN" | "en";
type ViewId = "overview" | "advisor" | "strategy-apps" | "strategy-app-detail" | "agent-center" | "trade-center" | "data-center" | "orchestration" | "lab" | "experiment" | "activity" | "connections";
type AgentMode = "paper" | "only-close";
type CapabilityId = "selector" | "data" | "analysis" | "decision" | "risk" | "execution";
type CapabilityStatus = "passed" | "active" | "idle" | "fallback";
type PanelId = "capability" | "candidate" | "universe" | "review" | "thesis" | "proposal" | "pause" | null;
type ActivityKind = "selection" | "decision" | "trade" | "exception" | "configuration";
type ConnectionSection = "llm" | "exchange" | "security";
type ProviderId = "deepseek" | "openai" | "anthropic" | "gemini" | "openrouter" | "ollama" | "compatible";
type PipelineTemplateId = "current" | "single" | "multi" | "event";
type ValidationPreview = "passed" | "window-error" | "schema-error";

interface LocalizedText {
  zh: string;
  en: string;
}

interface Candidate {
  symbol: string;
  rank: number;
  score: number;
  state: "selected" | "qualified" | "rejected";
  momentum: string;
  volume: string;
  reason: LocalizedText;
}

interface Capability {
  id: CapabilityId;
  name: LocalizedText;
  owner: string;
  version: string;
  status: CapabilityStatus;
  latency: string;
  output: LocalizedText;
  inputs: LocalizedText[];
  evidence: LocalizedText[];
  artifacts: number;
}

interface Position {
  symbol: string;
  side: "SHORT" | "LONG";
  quantity: number;
  notional: number;
  margin: number;
  entry: number;
  mark: number;
  stop: number;
  takeProfit: number;
  openedAt: LocalizedText;
  pnl: number;
  pnlPercent: number;
}

interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  time: LocalizedText;
  title: LocalizedText;
  summary: LocalizedText;
  meta: string;
  status: "success" | "fallback" | "review";
}

interface HumanMarketThesisDraft {
  marketView: string;
  symbols: string;
  validUntil: string;
  confidence: number;
  bias: string;
  riskConstraint: string;
  notes: string;
  createdAt: string;
}

interface StrategyProposalDraft {
  minimumConfidence: number;
  maxLeverage: number;
  maxPositions: number;
  perTradeNotional: number;
  maxHoldingHours: number;
  reason: string;
  createdAt: string;
}

interface Workspace {
  stage: number;
  backtestRunning: boolean;
  approvalRequested: boolean;
  approvalApproved: boolean;
  paperReleased: boolean;
  attachedEvidence: LocalizedText[];
  thesis?: HumanMarketThesisDraft;
  proposal?: StrategyProposalDraft;
}

interface LlmConnectionDraft {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  authorizedScopes: string[];
  validatedAt: string;
}

interface ExchangeConnectionDraft {
  exchange: "binance-futures";
  environment: "testnet" | "live";
  accountLabel: string;
  accountId: string;
  validatedAt: string;
}

interface ConnectionSettings {
  section: ConnectionSection;
  provider: ProviderId;
  llm?: LlmConnectionDraft;
  exchange?: ExchangeConnectionDraft;
}

interface PipelinePreviewNode {
  id: string;
  name: LocalizedText;
  role: string;
  window?: string;
  input: LocalizedText;
  output: LocalizedText;
  permission: LocalizedText;
}

interface PipelineTemplatePreview {
  id: PipelineTemplateId;
  name: LocalizedText;
  description: LocalizedText;
  mode: LocalizedText;
  nodes: PipelinePreviewNode[];
}

interface AppState {
  locale: Locale;
  view: ViewId;
  mode: AgentMode;
  copilotOpen: boolean;
  panel: PanelId;
  capabilityId: CapabilityId;
  candidateSymbol: string;
  activityFilter: "all" | ActivityKind;
  toast: LocalizedText | null;
  workspace: Workspace;
  connections: ConnectionSettings;
  orchestrationTemplate: PipelineTemplateId;
  orchestrationNodeId: string;
  orchestrationValidation: ValidationPreview;
  orchestrationDraftCreated: boolean;
  strategyPreview: StrategyAppPreviewState;
  strategyAppFilter: "all" | StrategyAppStatus;
  strategyDetailTarget: StrategyDetailTarget;
  strategyDetailTab: StrategyDetailTab;
  agentCenterCategory: AgentCategory;
  selectedPreviewAgentId: string;
  agentCenterSearch: string;
  connectionPreviewTab: ConnectionPreviewTab;
  experimentHandoffAppName?: string;
  workbenchDraft: string;
  simulationDialogueId: string;
  realAgents: Array<{ definition: { definitionId: string; category: AgentCategory; sourceLineage?: { definitionId: string; versionId: string; fingerprint: string } }; version: { versionId: string; versionIndex: number; fingerprint: string; payload: { name: string; dataRef?: string; upstreamArtifactSchemaRefs: string[]; modelRef?: string } }; lifecycle?: { status: string } }>;
  agentCenterToken: string;
  selectedRealAgent?: { definition: { definitionId: string; category: AgentCategory; sourceLineage?: { definitionId: string; versionId: string; fingerprint: string } }; version: { versionId: string; versionIndex: number; fingerprint: string; payload: { name: string; dataRef?: string; upstreamArtifactSchemaRefs: string[]; modelRef?: string; userInstructionPrompt: string } }; lifecycle?: { status: string } };
  agentVersions: Array<{ versionId: string; versionIndex: number; fingerprint: string; parentVersionId: string | null }>;
}

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("app root is missing");
const app = appRoot;
const localeStorageKey = "tradebot.locale";
let overlayReturnFocusSelector: string | null = null;

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(localeStorageKey);
    if (saved === "zh-CN" || saved === "en") return saved;
  } catch {
    // The interface still works when browser storage is restricted.
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function initialView(): ViewId {
  const hashView = window.location.hash.slice(1);
  if (["advisor", "strategy-apps", "strategy-app-detail", "orchestration"].includes(hashView)) return "orchestration";
  if (["data-center", "connections"].includes(hashView)) return "connections";
  if (hashView === "agent-center") return "agent-center";
  return "trade-center";
}

const state: AppState = {
  locale: initialLocale(),
  view: initialView(),
  mode: "paper",
  copilotOpen: false,
  panel: null,
  capabilityId: "selector",
  candidateSymbol: "BTCUSDT",
  activityFilter: "all",
  toast: null,
  connections: {
    section: "llm",
    provider: "deepseek",
  },
  orchestrationTemplate: "current",
  orchestrationNodeId: "data-sync",
  orchestrationValidation: "passed",
  orchestrationDraftCreated: false,
  strategyPreview: createInitialStrategyAppPreviewState(),
  strategyAppFilter: "all",
  strategyDetailTarget: "app",
  strategyDetailTab: "overview",
  agentCenterCategory: "input",
  selectedPreviewAgentId: "market-input",
  agentCenterSearch: "",
  connectionPreviewTab: "data",
  workbenchDraft: "",
  simulationDialogueId: "hk-quality-trend",
  realAgents: [],
  agentCenterToken: "",
  agentVersions: [],
  workspace: {
    stage: 2,
    backtestRunning: false,
    approvalRequested: false,
    approvalApproved: false,
    paperReleased: false,
    attachedEvidence: [
      {
        zh: "3 笔亏损交易都出现成交量确认偏晚的问题。",
        en: "Late volume confirmation appeared in three losing trades.",
      },
    ],
  },
};

let runtimeDashboard: RuntimeDashboardSnapshot = {
  connectionMode: "connecting",
  uiState: "connecting",
  activeRun: false,
  canPause: false,
  canResume: false,
  canStop: false,
  controlMode: "normal",
  eventCount: 0,
};

window.addEventListener("tradebot:runtime-context", (event) => {
  runtimeDashboard = (
    event as CustomEvent<RuntimeDashboardSnapshot>
  ).detail;
  applyRuntimeDashboardToDom();
});

function tr(zh: string, en: string): string {
  return state.locale === "zh-CN" ? zh : en;
}

function runtimeStatusLabel(): string {
  switch (runtimeDashboard.uiState) {
    case "running":
      return tr("模拟运行中", "Paper Running");
    case "only_close":
      return tr("仅允许平仓", "Only Close");
    case "draining":
      return tr("安全停止中", "Safe stop in progress");
    case "ready":
      return tr("已就绪", "Ready");
    case "preflight":
      return tr("等待运行预检", "Preflight required");
    case "blocked":
      return tr("运行已阻止", "Runtime blocked");
    case "auth_required":
      return tr("需要认证", "Authentication required");
    case "offline":
      return tr("Runtime 离线", "Runtime offline");
    case "connecting":
      return tr("正在连接 Runtime", "Connecting to Runtime");
    default:
      return tr("已停止", "Stopped");
  }
}

function runtimeHeartbeatLabel(): string {
  if (!runtimeDashboard.heartbeatAt) return "-";
  return new Date(runtimeDashboard.heartbeatAt).toLocaleTimeString(
    state.locale === "zh-CN" ? "zh-CN" : "en-US",
    { hour12: false },
  );
}

function runtimeEvidenceBoundaryLabel(): string {
  if (runtimeDashboard.activeRun) {
    const latest = runtimeDashboard.latestEvent
      ? ` · ${runtimeDashboard.latestEvent.eventType}`
      : "";
    return tr(
      `真实 Paper Runtime 已连接。下方策略证据用于解释当前受控运行${latest}。`,
      `The real Paper Runtime is connected. The strategy evidence below explains the controlled run${latest}.`,
    );
  }
  return tr(
    "下方 Atlas、持仓与周期数据是产品示例证据，不代表 Runtime 正在运行；真实状态以上方运行控制台为准。",
    "The Atlas, position, and cycle data below are sample evidence, not an active Runtime. The Runtime control above is authoritative.",
  );
}

function environmentBannerLabel(): string {
  if (runtimeDashboard.connectionMode === "live") {
    return runtimeDashboard.activeRun
      ? tr(
          "真实 Paper Runtime 正在运行；页面中未标为 Runtime 的交易证据仍是 MOCK。",
          "The real Paper Runtime is active; trading evidence not marked as Runtime remains MOCK.",
        )
      : tr(
          "真实 Runtime 控制已连接；Atlas 交易证据是明确标注的 MOCK，不代表当前运行。",
          "Real Runtime controls are connected; Atlas trading evidence is explicitly MOCK and does not represent an active run.",
        );
  }
  if (runtimeDashboard.connectionMode === "readonly") {
    return tr(
      "Runtime API 已连接但需要 Operator 认证；交易控制不可用，页面证据为 MOCK。",
      "Runtime API connected but Operator authentication is required; controls are unavailable and page evidence is MOCK.",
    );
  }
  if (runtimeDashboard.connectionMode === "connecting") {
    return tr(
      "正在连接 Runtime API；连接确认前，页面交易证据均为 MOCK。",
      "Connecting to the Runtime API; page trading evidence is MOCK until the connection is confirmed.",
    );
  }
  return tr(
    "Runtime API 离线；页面仅展示 MOCK 交易证据，所有真实运行控制均已禁用。",
    "Runtime API is offline; the page shows MOCK trading evidence only and all real Runtime controls are disabled.",
  );
}

function applyRuntimeDashboardToDom(): void {
  const setText = (selector: string, value: string): void => {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.textContent = value;
  };
  setText("[data-runtime-status-label]", runtimeStatusLabel());
  setText("[data-runtime-run-id]", runtimeDashboard.runId ?? "-");
  setText(
    "[data-runtime-cycle]",
    runtimeDashboard.activeRun
      ? runtimeDashboard.continuous
        ? `${runtimeDashboard.processedCycles ?? 0} / ∞`
        : `${runtimeDashboard.processedCycles ?? 0}/${runtimeDashboard.plannedCycles ?? 0}`
      : "-",
  );
  setText("[data-runtime-heartbeat]", runtimeHeartbeatLabel());
  setText(
    "[data-runtime-control-mode]",
    runtimeDashboard.controlMode === "pause_new_openings_close_only"
      ? "ONLY CLOSE"
      : "NORMAL",
  );
  setText("[data-runtime-evidence-boundary]", runtimeEvidenceBoundaryLabel());
  setText("[data-environment-banner]", environmentBannerLabel());
  const environmentBanner = document.querySelector<HTMLElement>(
    "[data-environment-banner]",
  );
  environmentBanner?.classList.toggle(
    "is-live",
    runtimeDashboard.connectionMode === "live",
  );
  environmentBanner?.classList.toggle(
    "is-readonly",
    runtimeDashboard.connectionMode === "readonly",
  );

  document
    .querySelector<HTMLElement>(".live-state")
    ?.classList.toggle("is-inactive", !runtimeDashboard.activeRun);
  document
    .querySelector<HTMLElement>("[data-runtime-evidence-boundary]")
    ?.classList.toggle("is-live", runtimeDashboard.activeRun);

  const emergency = document.querySelector<HTMLButtonElement>(
    "[data-runtime-emergency]",
  );
  const mobile = document.querySelector<HTMLButtonElement>(
    "[data-runtime-mobile-control]",
  );
  const canControl =
    runtimeDashboard.canPause || runtimeDashboard.canResume;
  for (const button of [emergency, mobile]) {
    if (button) button.disabled = !canControl;
  }
  setText(
    "[data-runtime-emergency-label]",
    runtimeDashboard.canResume
      ? tr("恢复新开仓", "RESUME OPENINGS")
      : tr("暂停新开仓", "PAUSE OPENINGS"),
  );
  setText(
    "[data-runtime-emergency-mobile-label]",
    runtimeDashboard.canResume
      ? tr("恢复开仓", "RESUME")
      : tr("暂停开仓", "PAUSE"),
  );
  setText(
    "[data-runtime-mobile-control]",
    runtimeDashboard.canResume
      ? tr("恢复新开仓", "Resume openings")
      : tr("暂停新开仓", "Pause openings"),
  );
}

function localized(value: LocalizedText): string {
  return state.locale === "zh-CN" ? value.zh : value.en;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat(state.locale === "zh-CN" ? "zh-CN" : "en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number, digits = 0): string {
  return new Intl.NumberFormat(state.locale === "zh-CN" ? "zh-CN" : "en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

const providerPresets: Array<{
  id: ProviderId;
  name: string;
  description: LocalizedText;
  model: string;
  baseUrl: string;
  auth: "api-key" | "local";
  runtimeReady: boolean;
}> = [
  {
    id: "deepseek",
    name: "DeepSeek",
    description: { zh: "当前 TypeScript 运行时已接入，支持结构化输出与安全回退。", en: "Available in the current TypeScript Runtime with structured JSON fallback." },
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
    auth: "api-key",
    runtimeReady: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    description: { zh: "独立供应商配置，运行时适配器尚未接入。", en: "First-party provider profile. Runtime adapter is not wired yet." },
    model: "gpt-5.2",
    baseUrl: "https://api.openai.com/v1",
    auth: "api-key",
    runtimeReady: false,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: { zh: "使用独立消息接口，不能复用 OpenAI 请求格式。", en: "Uses the Messages API and requires a dedicated adapter." },
    model: "claude-sonnet-5",
    baseUrl: "https://api.anthropic.com",
    auth: "api-key",
    runtimeReady: false,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    description: { zh: "模型应通过目录接口动态发现，避免固定旧版本。", en: "Models should be discovered through the Models API instead of a stale static list." },
    model: "gemini-3.6-flash",
    baseUrl: "https://generativelanguage.googleapis.com",
    auth: "api-key",
    runtimeReady: false,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: { zh: "通过一个 OpenAI 兼容端点访问动态模型目录。", en: "A dynamic model catalog behind one OpenAI-compatible endpoint." },
    model: "provider/model-id",
    baseUrl: "https://openrouter.ai/api/v1",
    auth: "api-key",
    runtimeReady: false,
  },
  {
    id: "ollama",
    name: "Ollama",
    description: { zh: "本地模型连接，不需要把密钥发送到浏览器。", en: "Local model connection with no browser API key required." },
    model: "gemma3",
    baseUrl: "http://127.0.0.1:11434/api",
    auth: "local",
    runtimeReady: false,
  },
  {
    id: "compatible",
    name: "OpenAI Compatible",
    description: { zh: "面向 Qwen、Kimi、GLM、MiniMax 或自建网关的自定义端点。", en: "Custom endpoint for Qwen, Kimi, GLM, MiniMax, or a private gateway." },
    model: "",
    baseUrl: "",
    auth: "api-key",
    runtimeReady: false,
  },
];

function selectedProvider() {
  return providerPresets.find((provider) => provider.id === state.connections.provider) ?? providerPresets[0];
}

const candidates: Candidate[] = [
  {
    symbol: "BTCUSDT",
    rank: 1,
    score: 91.4,
    state: "selected",
    momentum: "-2.8%",
    volume: "1.84B",
    reason: {
      zh: "流动性、趋势强度和波动率均通过门槛，本轮排名最高。",
      en: "Liquidity, trend strength, and volatility passed. Highest score this cycle.",
    },
  },
  {
    symbol: "ETHUSDT",
    rank: 2,
    score: 84.7,
    state: "qualified",
    momentum: "-1.6%",
    volume: "916M",
    reason: {
      zh: "通过基础门槛，但机会评分低于本轮唯一入选标的。",
      en: "Passed base gates, but scored below the only admitted symbol.",
    },
  },
  {
    symbol: "SOLUSDT",
    rank: 3,
    score: 77.2,
    state: "qualified",
    momentum: "+1.2%",
    volume: "402M",
    reason: {
      zh: "趋势有效，但波动率距离策略理想区间较远。",
      en: "Trend is valid, but volatility sits outside the preferred band.",
    },
  },
  {
    symbol: "BNBUSDT",
    rank: 4,
    score: 70.8,
    state: "qualified",
    momentum: "-0.7%",
    volume: "188M",
    reason: {
      zh: "流动性合格，方向机会弱于前三名。",
      en: "Liquidity passed. Directional opportunity trails the top three.",
    },
  },
  {
    symbol: "XRPUSDT",
    rank: 0,
    score: 48.1,
    state: "rejected",
    momentum: "+0.2%",
    volume: "247M",
    reason: {
      zh: "趋势强度未达到策略门槛，未进入合格候选。",
      en: "Trend strength missed the strategy threshold and was rejected.",
    },
  },
];

const capabilities: Capability[] = [
  {
    id: "selector",
    name: { zh: "选币 Agent", en: "Selector Agent" },
    owner: "market_opportunity_selector_agent",
    version: "v1",
    status: "passed",
    latency: "412 ms",
    output: { zh: "扫描 42 个标的，只选择 BTCUSDT。", en: "Scanned 42 symbols. Admitted BTCUSDT only." },
    inputs: [
      { zh: "Binance Futures 公共 24 小时行情", en: "Binance Futures public 24h tickers" },
      { zh: "StrategyProfile.selector 门槛", en: "StrategyProfile.selector thresholds" },
      { zh: "候选池 42 个 USDT 永续合约", en: "42 USDT perpetual candidates" },
    ],
    evidence: [
      { zh: "机会评分 91.4，排名第 1", en: "Opportunity score 91.4, rank 1" },
      { zh: "24 小时成交额 1.84B USDT", en: "24h quote volume 1.84B USDT" },
      { zh: "topN=1，本轮没有第二个入选标的", en: "topN=1. No second symbol was admitted." },
    ],
    artifacts: 2,
  },
  {
    id: "data",
    name: { zh: "数据 Agent", en: "Data Agent" },
    owner: "historical_data_sync_agent",
    version: "v1",
    status: "passed",
    latency: "286 ms",
    output: { zh: "5 分钟、15 分钟、1 小时 K 线已对齐。", en: "5m, 15m, and 1h closed bars are aligned." },
    inputs: [
      { zh: "BTCUSDT 唯一入选标的", en: "BTCUSDT as the only admitted symbol" },
      { zh: "三个时间周期的已收盘 K 线", en: "Closed bars across three timeframes" },
      { zh: "最新公共报价", en: "Latest public quote" },
    ],
    evidence: [
      { zh: "缺失周期 0", en: "Missing timeframes 0" },
      { zh: "报价时效 4.2 秒", en: "Quote age 4.2 seconds" },
      { zh: "数据质量门禁通过", en: "Data quality gate passed" },
    ],
    artifacts: 3,
  },
  {
    id: "analysis",
    name: { zh: "分析 Agent", en: "Analysis Agent" },
    owner: "multi_period_analysis_agent",
    version: "v2.4",
    status: "passed",
    latency: "547 ms",
    output: { zh: "1 小时下行趋势仍有效，成交量确认成立。", en: "The 1h downtrend remains valid with volume confirmation." },
    inputs: [
      { zh: "多周期数据快照", en: "Multi-timeframe snapshot" },
      { zh: "人工市场观点 HT-204", en: "Human Market Thesis HT-204" },
      { zh: "当前 BTCUSDT 空仓", en: "Current BTCUSDT short position" },
    ],
    evidence: [
      { zh: "市场状态：趋势下行", en: "Regime: trending down" },
      { zh: "趋势强度 74", en: "Trend strength 74" },
      { zh: "未发现数据质量警告", en: "No data quality warnings" },
    ],
    artifacts: 5,
  },
  {
    id: "decision",
    name: { zh: "决策 Agent", en: "Decision Agent" },
    owner: "decision_core_agent",
    version: "v3.8",
    status: "active",
    latency: "86 ms",
    output: { zh: "持有空仓。尚未满足任何退出条件。", en: "HOLD SHORT. No exit condition is satisfied." },
    inputs: [
      { zh: "Bull/Bear 结构化观点", en: "Structured Bull/Bear cases" },
      { zh: "Position Monitor 结果", en: "Position Monitor result" },
      { zh: "运行中策略配置 3.8.0", en: "Running Strategy Profile 3.8.0" },
    ],
    evidence: [
      { zh: "止盈、止损均未触发", en: "Take-profit and stop-loss not triggered" },
      { zh: "趋势未反转", en: "No trend reversal" },
      { zh: "最长持仓时间未到", en: "Maximum holding time not reached" },
    ],
    artifacts: 4,
  },
  {
    id: "risk",
    name: { zh: "风险 Agent", en: "Risk Agent" },
    owner: "account_risk_agent",
    version: "v2.1",
    status: "passed",
    latency: "17 ms",
    output: { zh: "风险门禁通过，账户敞口仍在预算内。", en: "Risk Gate passed. Account exposure remains within budget." },
    inputs: [
      { zh: "Paper Account 状态", en: "Paper Account state" },
      { zh: "决策证据包", en: "Decision bundle" },
      { zh: "账户风险策略", en: "Account Risk Policy" },
    ],
    evidence: [
      { zh: "已使用风险 1.8% / 3.0%", en: "Risk used 1.8% / 3.0%" },
      { zh: "持仓数量 1 / 1", en: "Position count 1 / 1" },
      { zh: "亏损熔断未触发", en: "Loss circuit breaker inactive" },
    ],
    artifacts: 3,
  },
  {
    id: "execution",
    name: { zh: "执行 Agent", en: "Execution Agent" },
    owner: "persistent_paper_execution_agent",
    version: "v1",
    status: "idle",
    latency: "4 ms",
    output: { zh: "无新订单。当前持仓继续由 Position Monitor 管理。", en: "No new order. Position Monitor continues managing the open position." },
    inputs: [
      { zh: "风险通过的订单意图", en: "Risk-approved order intent" },
      { zh: "模拟账户执行权限", en: "Paper execution permission" },
      { zh: "每轮最多执行 1 笔", en: "Maximum 1 execution per cycle" },
    ],
    evidence: [
      { zh: "本轮订单意图 0", en: "Order intents this cycle 0" },
      { zh: "本地 Paper Account 已对账", en: "Local Paper Account reconciled" },
      { zh: "没有调用交易所写接口", en: "No exchange write API was called" },
    ],
    artifacts: 1,
  },
];

const commonActionNodes: PipelinePreviewNode[] = [
  {
    id: "decision",
    name: { zh: "决策", en: "Decision" },
    role: "decision",
    input: { zh: "结构化分析证据", en: "Structured analysis evidence" },
    output: { zh: "DecisionBundle", en: "DecisionBundle" },
    permission: { zh: "可提出决策，不可执行", en: "May propose a decision, cannot execute" },
  },
  {
    id: "portfolio",
    name: { zh: "组合", en: "Portfolio" },
    role: "portfolio",
    input: { zh: "一个或多个决策提案", en: "One or more decision proposals" },
    output: { zh: "组合筛选后的 DecisionBundle", en: "Portfolio-selected DecisionBundle" },
    permission: { zh: "唯一组合分配边界", en: "Sole portfolio allocation boundary" },
  },
  {
    id: "risk",
    name: { zh: "风险门禁", en: "Risk Gate" },
    role: "risk",
    input: { zh: "组合决策与账户状态", en: "Portfolio decision and account state" },
    output: { zh: "RiskDecision", en: "RiskDecision" },
    permission: { zh: "独立否决权", en: "Independent veto authority" },
  },
  {
    id: "execution",
    name: { zh: "模拟执行", en: "Paper Execution" },
    role: "execution",
    input: { zh: "决策与风险通过证明", en: "Decision plus Risk approval" },
    output: { zh: "ExecutionResult", en: "ExecutionResult" },
    permission: { zh: "仅本地 Paper，无交易所写入", en: "Local Paper only, no exchange writes" },
  },
];

const pipelineTemplates: PipelineTemplatePreview[] = [
  {
    id: "current",
    name: { zh: "当前 Crypto", en: "Current Crypto" },
    description: {
      zh: "现有固定 DecisionPipeline 的版本化等价描述，运行行为保持不变。",
      en: "Versioned equivalent of the fixed DecisionPipeline. Runtime behavior is unchanged.",
    },
    mode: { zh: "原生三周期", en: "Native three-window" },
    nodes: [
      {
        id: "selector",
        name: { zh: "选币", en: "Selector" },
        role: "selector",
        input: { zh: "候选池与 SelectorPolicy", en: "Candidate universe and SelectorPolicy" },
        output: { zh: "UniverseSet，topN=1", en: "UniverseSet with topN=1" },
        permission: { zh: "只选择候选，不产生订单", en: "Selects candidates, never creates orders" },
      },
      {
        id: "data-sync",
        name: { zh: "数据同步", en: "Data Sync" },
        role: "data_sync",
        window: "5m / 15m / 1h",
        input: { zh: "Binance Futures Public OHLCV", en: "Binance Futures Public OHLCV" },
        output: { zh: "MultiTimeframeSnapshot", en: "MultiTimeframeSnapshot" },
        permission: { zh: "只读公共行情", en: "Read-only public market data" },
      },
      {
        id: "data-quality",
        name: { zh: "数据质量", en: "Data Quality" },
        role: "data_quality",
        input: { zh: "多周期快照", en: "Multi-window snapshot" },
        output: { zh: "通过门禁的快照", en: "Quality-gated snapshot" },
        permission: { zh: "缺失时阻止新开仓", en: "Blocks new openings when required data is missing" },
      },
      {
        id: "analysis",
        name: { zh: "分析", en: "Analysis" },
        role: "analysis",
        window: "5m / 15m / 1h",
        input: { zh: "已对齐的 K 线快照", en: "Aligned OHLCV snapshot" },
        output: { zh: "AnalysisBundle", en: "AnalysisBundle" },
        permission: { zh: "只生成分析证据", en: "Produces analysis evidence only" },
      },
      {
        id: "bull-case",
        name: { zh: "看多观点", en: "Bull Case" },
        role: "bull_case",
        input: { zh: "AnalysisBundle", en: "AnalysisBundle" },
        output: { zh: "DirectionalCase", en: "DirectionalCase" },
        permission: { zh: "无订单权限", en: "No order permission" },
      },
      {
        id: "bear-case",
        name: { zh: "看空观点", en: "Bear Case" },
        role: "bear_case",
        input: { zh: "AnalysisBundle", en: "AnalysisBundle" },
        output: { zh: "DirectionalCase", en: "DirectionalCase" },
        permission: { zh: "无订单权限", en: "No order permission" },
      },
      ...commonActionNodes,
      {
        id: "position-monitor",
        name: { zh: "持仓监控", en: "Position Monitor" },
        role: "position_monitor",
        input: { zh: "现有持仓、快照与分析", en: "Open position, snapshot, and analysis" },
        output: { zh: "仅平仓 DecisionBundle", en: "Close-only DecisionBundle" },
        permission: { zh: "仅允许提出平仓", en: "May propose closing only" },
      },
      {
        id: "reflection",
        name: { zh: "复盘", en: "Reflection" },
        role: "reflection",
        input: { zh: "已平仓交易与执行结果", en: "Closed trades and execution results" },
        output: { zh: "ReflectionReport", en: "ReflectionReport" },
        permission: { zh: "只创建候选经验，不修改运行策略", en: "Creates candidate lessons, never mutates runtime" },
      },
    ],
  },
  {
    id: "single",
    name: { zh: "单周期日线", en: "Single Daily" },
    description: {
      zh: "数据源只有 1d 时的合法最小 Pipeline，不伪造分钟数据。",
      en: "A valid minimal pipeline for a 1d-only source. No minute data is fabricated.",
    },
    mode: { zh: "单周期", en: "Single window" },
    nodes: [
      {
        id: "daily-source",
        name: { zh: "日线数据", en: "Daily Data" },
        role: "data_sync",
        window: "1d",
        input: { zh: "原生日线 OHLCV", en: "Native daily OHLCV" },
        output: { zh: "MarketArtifact", en: "MarketArtifact" },
        permission: { zh: "只读数据", en: "Read-only data" },
      },
      {
        id: "daily-analysis",
        name: { zh: "日线分析", en: "Daily Analysis" },
        role: "analysis",
        window: "1d",
        input: { zh: "日线 MarketArtifact", en: "Daily MarketArtifact" },
        output: { zh: "AnalysisArtifact", en: "AnalysisArtifact" },
        permission: { zh: "只生成分析证据", en: "Analysis evidence only" },
      },
      ...commonActionNodes,
    ],
  },
  {
    id: "multi",
    name: { zh: "日周月组合", en: "Daily Weekly Monthly" },
    description: {
      zh: "原生 1d、1w、1M 多窗口通过 Context Reconciler 汇总。",
      en: "Native 1d, 1w, and 1M windows converge through a Context Reconciler.",
    },
    mode: { zh: "任意多周期", en: "Flexible multi-window" },
    nodes: [
      {
        id: "calendar-source",
        name: { zh: "日周月数据", en: "Calendar Data" },
        role: "data_sync",
        window: "1d / 1w / 1M",
        input: { zh: "原生多周期 OHLCV", en: "Native multi-window OHLCV" },
        output: { zh: "三个 MarketArtifact", en: "Three MarketArtifacts" },
        permission: { zh: "只读数据", en: "Read-only data" },
      },
      {
        id: "calendar-analysis",
        name: { zh: "多窗口分析", en: "Window Analysis" },
        role: "analysis",
        window: "1d / 1w / 1M",
        input: { zh: "三个原生窗口", en: "Three native windows" },
        output: { zh: "AnalysisArtifact[]", en: "AnalysisArtifact[]" },
        permission: { zh: "只生成分析证据", en: "Analysis evidence only" },
      },
      {
        id: "reconciler",
        name: { zh: "上下文汇总", en: "Context Reconciler" },
        role: "context",
        input: { zh: "多窗口分析产物", en: "Multi-window analysis artifacts" },
        output: { zh: "DecisionContext", en: "DecisionContext" },
        permission: { zh: "只压缩上下文", en: "Context compression only" },
      },
      ...commonActionNodes,
    ],
  },
  {
    id: "event",
    name: { zh: "新闻事件", en: "News Event" },
    description: {
      zh: "没有 K 线也可表达：新闻批次经过实体识别和影响分析后进入决策链。",
      en: "No bars required. News batches flow through entity linking and impact analysis.",
    },
    mode: { zh: "完全事件驱动", en: "Event-driven" },
    nodes: [
      {
        id: "news-source",
        name: { zh: "新闻批次", en: "News Batch" },
        role: "data_sync",
        window: "event_batch",
        input: { zh: "新闻事件流", en: "News event feed" },
        output: { zh: "MarketEventArtifact[]", en: "MarketEventArtifact[]" },
        permission: { zh: "只读事件", en: "Read-only events" },
      },
      {
        id: "entity-link",
        name: { zh: "实体关联", en: "Entity Link" },
        role: "processing",
        input: { zh: "新闻事件批次", en: "News event batch" },
        output: { zh: "已关联市场与标的的事件", en: "Market and symbol-linked events" },
        permission: { zh: "只处理数据", en: "Data processing only" },
      },
      {
        id: "impact-analysis",
        name: { zh: "影响分析", en: "Impact Analysis" },
        role: "analysis",
        window: "event_batch",
        input: { zh: "已关联事件", en: "Linked events" },
        output: { zh: "AnalysisArtifact", en: "AnalysisArtifact" },
        permission: { zh: "只生成分析证据", en: "Analysis evidence only" },
      },
      ...commonActionNodes,
    ],
  },
];

const position: Position = {
  symbol: "BTCUSDT",
  side: "SHORT",
  quantity: 0.148,
  notional: 9447.41,
  margin: 1889.48,
  entry: 64210.4,
  mark: 63844.7,
  stop: 64880,
  takeProfit: 62420,
  openedAt: { zh: "18 小时 24 分钟前", en: "18h 24m ago" },
  pnl: 186.42,
  pnlPercent: 2.11,
};

const activityEvents: ActivityEvent[] = [
  {
    id: "activity-selector",
    kind: "selection",
    time: { zh: "14:36:18", en: "14:36:18" },
    title: { zh: "选币 Agent 从 42 个标的中选择 BTCUSDT", en: "Selector admitted BTCUSDT from 42 symbols" },
    summary: {
      zh: "8 个标的通过基础门槛，topN=1 只允许机会评分最高的标的进入本轮链路。",
      en: "Eight passed base gates. topN=1 admitted only the highest-scoring opportunity.",
    },
    meta: "selector:v1 / rank 1 / score 91.4 / 412 ms",
    status: "success",
  },
  {
    id: "activity-decision",
    kind: "decision",
    time: { zh: "14:36:20", en: "14:36:20" },
    title: { zh: "决策 Agent 继续持有 BTCUSDT 空仓", en: "Decision Agent kept the BTCUSDT short" },
    summary: {
      zh: "现有持仓优先，止盈、止损、趋势反转和最长持仓退出条件均未触发。",
      en: "The existing position took priority. No exit condition was triggered.",
    },
    meta: "trace:7f13a9 / 18 artifacts / confidence 78",
    status: "success",
  },
  {
    id: "activity-fallback",
    kind: "exception",
    time: { zh: "14:36:19", en: "14:36:19" },
    title: { zh: "看多观点服务使用确定性回退", en: "Bull case provider used deterministic fallback" },
    summary: {
      zh: "服务超过 15 秒限制。系统生成安全回退产物，未覆盖规则结果。",
      en: "The provider exceeded 15 seconds. A safe fallback artifact was produced without overriding rules.",
    },
    meta: "deepseek_bull_case_agent@v1 / fallback / 15.0 s",
    status: "fallback",
  },
  {
    id: "activity-trade",
    kind: "trade",
    time: { zh: "昨天 20:12", en: "Yesterday 20:12" },
    title: { zh: "paper:41 建立 BTCUSDT 空仓", en: "paper:41 opened BTCUSDT SHORT" },
    summary: {
      zh: "账户风险门禁通过后，以 64,210.40 成交 0.148 BTC。",
      en: "Filled 0.148 BTC at 64,210.40 after the account Risk Gate passed.",
    },
    meta: "order:paper:41 / fee 3.80 USDT / slippage 0.02%",
    status: "review",
  },
];

function capabilityStatus(status: CapabilityStatus): string {
  if (status === "passed") return tr("已通过", "Passed");
  if (status === "active") return tr("当前决策", "Current");
  if (status === "fallback") return tr("已回退", "Fallback");
  return tr("待命", "Idle");
}

function activityKind(kind: ActivityKind): string {
  if (kind === "selection") return tr("选币", "Selection");
  if (kind === "decision") return tr("决策", "Decision");
  if (kind === "trade") return tr("交易", "Trade");
  if (kind === "configuration") return tr("配置", "Configuration");
  return tr("异常", "Exception");
}

function renderHeader(): string {
  return `
    <header class="command-bar">
      <button class="brand" type="button" data-view="trade-center" aria-label="${tr("返回模拟交易", "Return to Simulation Trading")}">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span><strong>TRADEBOT</strong><small>${tr("多 Agent 模拟交易", "MULTI-AGENT SIMULATION")}</small></span>
      </button>

      <nav class="primary-nav" aria-label="${tr("主要导航", "Primary navigation")}">
        ${[
          ["trade-center", tr("模拟交易", "Simulation")],
          ["orchestration", tr("编排工作台", "Workbench")],
          ["agent-center", tr("Agent 中心", "Agent Center")],
          ["connections", tr("连接配置", "Connections")],
        ].map(([id, label]) => `
          <button type="button" data-view="${id}" class="${state.view === id ? "is-active" : ""}" ${state.view === id ? 'aria-current="page"' : ""}>${label}</button>
        `).join("")}
      </nav>

      <div class="command-actions">
        <span class="preview-mode-chip"><i></i>${tr("仅模拟", "SIMULATION ONLY")}</span>
        <button class="language-toggle" type="button" id="toggle-language" aria-label="${state.locale === "zh-CN" ? "切换为英文" : "Switch to Chinese"}">
          ${state.locale === "zh-CN" ? "英文" : "ZH"}
        </button>
      </div>
    </header>
  `;
}

function renderAgentIdentity(): string {
  return `
    <section class="agent-identity" aria-labelledby="agent-title">
      <div class="agent-identity__main">
        <span class="live-state ${runtimeDashboard.activeRun ? "" : "is-inactive"}"><i aria-hidden="true"></i><span data-runtime-status-label>${runtimeStatusLabel()}</span></span>
        <div>
          <h1 id="agent-title">${tr("Atlas 交易 Agent", "Atlas Trading Agent")}</h1>
          <p>${tr("从市场候选池中只选择一个标的，完成可审计的分析、决策与风险控制。", "Select exactly one symbol from the market universe, then run an auditable decision and risk chain.")}</p>
        </div>
      </div>
      <dl class="agent-provenance">
        <div><dt>Run ID</dt><dd data-runtime-run-id>${runtimeDashboard.runId ?? "-"}</dd></div>
        <div><dt>${tr("控制模式", "Control mode")}</dt><dd data-runtime-control-mode>${runtimeDashboard.controlMode === "pause_new_openings_close_only" ? "ONLY CLOSE" : "NORMAL"}</dd></div>
        <div><dt>${tr("当前周期", "Current cycle")}</dt><dd data-runtime-cycle>${runtimeDashboard.activeRun ? runtimeDashboard.continuous ? `${runtimeDashboard.processedCycles ?? 0} / ∞` : `${runtimeDashboard.processedCycles ?? 0}/${runtimeDashboard.plannedCycles ?? 0}` : "-"}</dd></div>
        <div><dt>${tr("最后心跳", "Last heartbeat")}</dt><dd data-runtime-heartbeat>${runtimeHeartbeatLabel()}</dd></div>
      </dl>
    </section>
    <p class="runtime-evidence-boundary ${runtimeDashboard.activeRun ? "is-live" : ""}" data-runtime-evidence-boundary>${runtimeEvidenceBoundaryLabel()}</p>
  `;
}

function renderSimulationCenterHost(): string {
  return `<section class="simulation-center-shell" aria-label="${tr("多模拟运行中心", "Multi-simulation runtime center")}"><div id="multi-paper-runtime-center-host"></div></section>`;
}

function renderCandidateRow(candidate: Candidate): string {
  const label = candidate.state === "selected"
    ? tr("本轮选中", "Selected")
    : candidate.state === "qualified"
      ? tr("未入选", "Not admitted")
      : tr("已淘汰", "Rejected");
  return `
    <button type="button" class="candidate-row candidate-row--${candidate.state}" data-candidate="${candidate.symbol}">
      <span class="candidate-rank">${candidate.rank || "×"}</span>
      <span class="candidate-symbol"><strong>${candidate.symbol}</strong><small>${candidate.momentum} / ${candidate.volume}</small></span>
      <span class="candidate-score">${candidate.score.toFixed(1)}</span>
      <span class="candidate-state">${label}</span>
    </button>
  `;
}

function renderSelectorAperture(): string {
  return `
    <section class="selector-aperture" aria-labelledby="selector-heading">
      <header class="section-heading">
        <div>
          <h2 id="selector-heading">${tr("本轮选币", "Cycle selection")}</h2>
          <p>${tr("候选池是输入，BTCUSDT 是唯一输出。列表不会创建多个 Trading Agent。", "The universe is input. BTCUSDT is the only output. Candidate rows do not create separate Trading Agents.")}</p>
        </div>
        <button type="button" class="text-action" id="view-universe">${tr("查看完整筛选依据", "Inspect full ranking")}</button>
      </header>

      <div class="selection-stats" aria-label="${tr("筛选统计", "Selection statistics")}">
        <div><strong>42</strong><span>${tr("扫描标的", "Scanned")}</span></div>
        <span aria-hidden="true">→</span>
        <div><strong>8</strong><span>${tr("通过门槛", "Qualified")}</span></div>
        <span aria-hidden="true">→</span>
        <div class="is-final"><strong>1</strong><span>${tr("本轮入选", "Admitted")}</span></div>
      </div>

      <div class="candidate-list">
        <div class="candidate-list__head">
          <span>${tr("排名", "Rank")}</span><span>${tr("标的 / 动量 / 成交额", "Symbol / Momentum / Volume")}</span><span>${tr("评分", "Score")}</span><span>${tr("结果", "Result")}</span>
        </div>
        ${candidates.slice(0, 3).map(renderCandidateRow).join("")}
        <button type="button" class="candidate-more" id="view-more-candidates">
          <span>${tr("其余 39 个候选已折叠", "39 more candidates collapsed")}</span>
          <strong>${tr("查看完整排名", "View full ranking")}</strong>
        </button>
      </div>
      <footer class="selector-rule">
        <span>StrategyProfile.selector.topN</span>
        <strong>1</strong>
        <p>${tr("即使候选池包含很多币种，每个 Cycle 也只允许一个新标的进入后续链路。", "Even with a broad universe, each cycle admits only one new symbol to the downstream chain.")}</p>
      </footer>
    </section>
  `;
}

function renderCapabilityChain(): string {
  return `
    <section class="chain-section" aria-labelledby="chain-heading">
      <header class="section-heading">
        <div>
          <h2 id="chain-heading">${tr("Agent 实时链路", "Live Agent chain")}</h2>
          <p>${tr("点击子 Agent 查看结构化输入、输出与 Artifact 摘要。", "Select a sub-agent to inspect structured inputs, outputs, and Artifact evidence.")}</p>
        </div>
        <code>trace:7f13a9</code>
      </header>
      <div class="capability-chain">
        ${capabilities.map((capability, index) => `
          <button type="button" class="capability-node capability-node--${capability.status}" data-capability="${capability.id}">
            <span class="capability-node__step">${String(index + 1).padStart(2, "0")}</span>
            <span class="capability-node__body">
              <span class="capability-node__top">
                <strong>${localized(capability.name)}</strong>
                <em>${capabilityStatus(capability.status)}</em>
              </span>
              <span class="capability-node__output">${localized(capability.output)}</span>
              ${capability.id === "analysis" ? `
                <span class="nested-artifacts">
                  <small class="is-fallback">${tr("看多观点", "Bull case")} · ${tr("安全回退", "Fallback")}</small>
                  <small>${tr("看空观点", "Bear case")} · ${tr("已通过", "Passed")}</small>
                </span>
              ` : capability.id === "decision" ? `
                <span class="nested-artifacts">
                  <small>Position Monitor · ${tr("已通过", "Passed")}</small>
                </span>
              ` : ""}
              <span class="capability-node__meta">${capability.latency} / ${capability.artifacts} ${tr("个产物", "artifacts")}</span>
            </span>
          </button>
        `).join("")}
      </div>
      <div class="decision-result">
        <div>
          <span>${tr("当前决策", "Current decision")}</span>
          <strong>${tr("持有空仓", "HOLD SHORT")}</strong>
        </div>
        <p>${tr("BTCUSDT 已有持仓优先进入 Position Monitor。止盈、止损、趋势反转和最长持仓退出条件均未触发。", "The existing BTCUSDT position entered Position Monitor first. No take-profit, stop-loss, reversal, or max-duration exit was triggered.")}</p>
        <button type="button" class="secondary-action" id="ask-why">${tr("为什么是这个决策？", "Why this decision?")}</button>
      </div>
    </section>
  `;
}

function renderPosition(): string {
  return `
    <section class="position-module" aria-labelledby="position-heading">
      <header>
        <div>
          <span>${tr("当前持仓", "Open position")}</span>
          <h2 id="position-heading">${position.symbol}</h2>
        </div>
        <strong class="position-side">${position.side}</strong>
      </header>
      <div class="position-pnl">
        <span>${tr("未实现盈亏", "Unrealized PnL")}</span>
        <strong>+${formatUsd(position.pnl)}</strong>
        <small>+${position.pnlPercent.toFixed(2)}%</small>
      </div>
      <dl class="position-grid">
        <div><dt>${tr("数量", "Quantity")}</dt><dd>${position.quantity} BTC</dd></div>
        <div><dt>${tr("名义金额", "Notional")}</dt><dd>${formatUsd(position.notional)}</dd></div>
        <div><dt>${tr("占用保证金", "Margin")}</dt><dd>${formatUsd(position.margin)}</dd></div>
        <div><dt>${tr("持仓时长", "Holding duration")}</dt><dd>${localized(position.openedAt)}</dd></div>
        <div><dt>${tr("入场价", "Entry")}</dt><dd>${formatNumber(position.entry, 2)}</dd></div>
        <div><dt>${tr("标记价", "Mark")}</dt><dd>${formatNumber(position.mark, 2)}</dd></div>
        <div><dt>${tr("止损", "Stop")}</dt><dd>${formatNumber(position.stop, 2)}</dd></div>
        <div><dt>${tr("止盈", "Take profit")}</dt><dd>${formatNumber(position.takeProfit, 2)}</dd></div>
      </dl>
      <p class="position-monitor-note">${tr("后续 Cycle 会持续读取该持仓，并由 Position Monitor 判断止盈、止损、趋势反转或最长持仓时间。", "Future cycles keep reading this position. Position Monitor evaluates take-profit, stop-loss, reversal, and maximum holding time.")}</p>
      <button type="button" class="secondary-action full-width" id="review-position">${tr("进入因果复盘", "Open causal review")}</button>
    </section>
  `;
}

function renderOperatorAction(): string {
  return `
    <section class="operator-action">
      <header>
        <span>${tr("现在需要人工处理", "Human action now")}</span>
        <strong>${tr("1 项", "1 item")}</strong>
      </header>
      <h2>${tr("复核候选策略 3.9", "Review candidate profile 3.9")}</h2>
      <p>${tr("回测已完成。样本外最大回撤仍需确认，运行中的 3.8.0 保持只读。", "Backtest is complete. Walk-forward drawdown still needs review. Running profile 3.8.0 remains read-only.")}</p>
      <button type="button" class="primary-action full-width" data-view="lab">${tr("打开 Agent 实验室", "Open Agent Lab")}</button>
    </section>
  `;
}

function renderOverview(): string {
  return `
    ${renderStrategyOverview({
      locale: state.locale,
      preview: state.strategyPreview,
      appFilter: state.strategyAppFilter,
      detailTarget: state.strategyDetailTarget,
      detailTab: state.strategyDetailTab,
      agentCategory: state.agentCenterCategory,
      selectedAgentId: state.selectedPreviewAgentId,
      agentSearch: state.agentCenterSearch,
      connectionTab: state.connectionPreviewTab,
      experimentHandoffAppName: state.experimentHandoffAppName,
      workbenchDraft: state.workbenchDraft,
    })}
    <section class="legacy-surface-divider"><span>EXISTING PAPER / RUNTIME SURFACE</span><p>${tr("下方保留既有运行控制台；其真实状态与产品预览严格分开。", "The existing runtime console remains below; its real state is strictly separate from the product preview.")}</p></section>
    ${renderAgentIdentity()}
    ${renderSimulationCenterHost()}
    <div class="operation-layout">
      <div class="operation-main">
        ${renderSelectorAperture()}
        ${renderMobilePriority()}
        ${renderCapabilityChain()}
      </div>
      <aside class="operator-rail">
        ${renderPosition()}
        ${renderOperatorAction()}
        <section class="runtime-guard">
          <h2>${tr("运行时安全", "Runtime safety")}</h2>
          <dl>
            <div><dt>${tr("数据质量", "Data quality")}</dt><dd>${tr("通过", "Passed")}</dd></div>
            <div><dt>${tr("风险预算", "Risk budget")}</dt><dd>1.8% / 3.0%</dd></div>
            <div><dt>${tr("开仓上限", "Position limit")}</dt><dd>1 / 1</dd></div>
            <div><dt>${tr("交易所写接口", "Exchange writes")}</dt><dd>${tr("未连接", "Disconnected")}</dd></div>
          </dl>
        </section>
      </aside>
    </div>
    ${renderLifecycle(false)}
    ${renderRecentActivity()}
  `;
}

function renderMobilePriority(): string {
  return `
    <section class="mobile-priority" aria-label="${tr("风险与人工动作摘要", "Risk and human action summary")}">
      <div>
        <span>${tr("当前持仓", "Open position")}</span>
        <strong>${position.symbol} ${position.side}</strong>
        <small>+${formatUsd(position.pnl)} · ${tr("风险", "Risk")} 1.8% / 3.0%</small>
      </div>
      <div>
        <span>${tr("人工动作", "Human action")}</span>
        <strong>${tr("复核候选策略 3.9", "Review candidate 3.9")}</strong>
        <button type="button" data-view="lab">${tr("打开", "Open")}</button>
      </div>
      <button type="button" class="mobile-pause" data-open-pause data-runtime-mobile-control ${runtimeDashboard.canPause || runtimeDashboard.canResume ? "" : "disabled"}>${runtimeDashboard.canResume ? tr("恢复新开仓", "Resume openings") : tr("暂停新开仓", "Pause openings")}</button>
    </section>
  `;
}

function renderLifecycle(compact: boolean): string {
  const labels = [
    tr("草案", "Draft"),
    tr("回测", "Backtest"),
    tr("样本外验证", "Walk-Forward"),
    tr("人工审批", "Approval"),
    tr("模拟运行", "Paper"),
  ];
  return `
    <section class="lifecycle ${compact ? "lifecycle--compact" : ""}">
      <header class="section-heading">
        <div>
          <h2>${tr("策略发布门禁", "Strategy release gates")}</h2>
          <p>${tr("任何建议都先成为候选版本，无法跳过验证或直接修改运行 Agent。", "Every suggestion becomes a Candidate first. Validation cannot be skipped and the running Agent stays protected.")}</p>
        </div>
        ${compact ? "" : `<button type="button" class="text-action" data-view="lab">${tr("查看候选版本", "Inspect Candidate")}</button>`}
      </header>
      <div class="release-rail">
        ${labels.map((label, index) => {
          const status = index < 3
            ? (index < state.workspace.stage ? "complete" : index === state.workspace.stage ? "current" : "locked")
            : index === 3
              ? (state.workspace.approvalApproved ? "complete" : state.workspace.stage >= 3 ? "current" : "locked")
              : state.workspace.paperReleased
                ? "complete"
                : state.workspace.approvalApproved
                  ? "current"
                  : "locked";
          return `<div class="release-step release-step--${status}"><span>${status === "complete" ? "✓" : index + 1}</span><strong>${label}</strong></div>`;
        }).join("")}
      </div>
    </section>
  `;
}

function renderRecentActivity(): string {
  return `
    <section class="recent-activity">
      <header class="section-heading">
        <div>
          <h2>${tr("最近证据", "Recent evidence")}</h2>
          <p>${tr("从选币结果追溯到决策、风险与执行。", "Trace the selected symbol through decision, risk, and execution.")}</p>
        </div>
        <button type="button" class="text-action" data-view="activity">${tr("查看全部", "View all")}</button>
      </header>
      <div class="activity-preview">
        ${activityEvents.slice(0, 3).map(renderActivityRow).join("")}
      </div>
    </section>
  `;
}

function selectedPipelineTemplate(): PipelineTemplatePreview {
  return pipelineTemplates.find((template) => template.id === state.orchestrationTemplate) ?? pipelineTemplates[0]!;
}

function draftContextNode(): PipelinePreviewNode {
  return {
    id: "draft-context",
    name: { zh: "上下文汇总草案", en: "Context Fusion Draft" },
    role: "context",
    input: { zh: "AnalysisArtifact 与可选新闻上下文", en: "AnalysisArtifact plus optional news context" },
    output: { zh: "DecisionContext 草案", en: "DecisionContext draft" },
    permission: { zh: "仅结构化草案，未注册且未部署", en: "Structured draft only. Not registered or deployed" },
  };
}

function selectedOrchestrationNode(): PipelinePreviewNode {
  if (state.orchestrationNodeId === "draft-context") return draftContextNode();
  const template = selectedPipelineTemplate();
  return template.nodes.find((node) => node.id === state.orchestrationNodeId) ?? template.nodes[0]!;
}

function renderGraphNode(node: PipelinePreviewNode, tone = ""): string {
  const selected = state.orchestrationNodeId === node.id;
  return `
    <button type="button" class="graph-node ${tone} ${selected ? "is-selected" : ""}" data-orchestration-node="${node.id}">
      <span>${node.role}</span>
      <strong>${localized(node.name)}</strong>
      ${node.window ? `<small>${node.window}</small>` : ""}
    </button>
  `;
}

function renderCurrentGraph(): string {
  const current = selectedPipelineTemplate();
  const byId = (id: string) => current.nodes.find((node) => node.id === id)!;
  return `
    <div class="graph-band">
      <span class="graph-band__label">${tr("发现与数据", "Discovery and data")}</span>
      <div class="graph-lane">
        ${renderGraphNode(byId("selector"))}<i>→</i>
        ${renderGraphNode(byId("data-sync"))}<i>→</i>
        ${renderGraphNode(byId("data-quality"))}
      </div>
    </div>
    <div class="graph-band graph-band--reason">
      <span class="graph-band__label">${tr("分析与论证", "Analysis and cases")}</span>
      <div class="graph-lane">
        ${renderGraphNode(byId("analysis"))}<i>→</i>
        <div class="graph-fork">
          ${renderGraphNode(byId("bull-case"))}
          ${renderGraphNode(byId("bear-case"))}
        </div>
        <i>→</i>
        ${state.orchestrationDraftCreated ? `${renderGraphNode(draftContextNode(), "is-draft")}<i>→</i>` : ""}
        ${renderGraphNode(byId("decision"), "is-authority")}
      </div>
      <div class="graph-branch">
        <span>${tr("已有持仓分支", "Open-position branch")}</span>
        ${renderGraphNode(byId("position-monitor"), "is-close-only")}
        <small>${tr("仅产生平仓提案，随后汇入 Portfolio", "Close-only proposal, then merges into Portfolio")}</small>
      </div>
    </div>
    <div class="graph-band graph-band--action">
      <span class="graph-band__label">${tr("唯一动作出口", "Sole action path")}</span>
      <div class="graph-lane">
        ${renderGraphNode(byId("portfolio"), "is-authority")}<i>→</i>
        ${renderGraphNode(byId("risk"), "is-risk")}<i>→</i>
        ${renderGraphNode(byId("execution"), "is-execution")}
      </div>
      <div class="graph-branch graph-branch--post">
        <span>${tr("后处理", "Post-process")}</span>
        ${renderGraphNode(byId("reflection"))}
        <small>${tr("只创建候选经验，不回写运行策略", "Candidate lessons only, never runtime mutation")}</small>
      </div>
    </div>
  `;
}

function renderTemplateGraph(template: PipelineTemplatePreview): string {
  return `
    <div class="template-graph">
      ${template.nodes.map((node, index) => `
        ${renderGraphNode(node, ["decision", "portfolio"].includes(node.role) ? "is-authority" : node.role === "risk" ? "is-risk" : node.role === "execution" ? "is-execution" : "")}
        ${index < template.nodes.length - 1 ? "<i>→</i>" : ""}
      `).join("")}
    </div>
  `;
}

function renderValidationPreview(): string {
  if (state.orchestrationValidation === "window-error") {
    return `
      <div class="validation-preview is-error">
        <div><strong>UPSAMPLING_FORBIDDEN</strong><span>${tr("周期能力不兼容", "Window capability mismatch")}</span></div>
        <p>${tr("Agent 请求 5 minute bar_interval，但数据源只有原生 1 day。日线不能反向生成分钟数据。", "The Agent requests a 5 minute bar_interval, but the source has native 1 day data only. Daily bars cannot generate minute bars.")}</p>
      </div>
    `;
  }
  if (state.orchestrationValidation === "schema-error") {
    return `
      <div class="validation-preview is-error">
        <div><strong>SCHEMA_INCOMPATIBLE</strong><span>${tr("连线合同不兼容", "Edge contract mismatch")}</span></div>
        <p>${tr("上游输出 MarketEventArtifact，下游输入要求 MultiTimeframeSnapshot。必须更换 Agent Template 或加入已注册 Processing Agent。", "The upstream output is MarketEventArtifact while the downstream input requires MultiTimeframeSnapshot. Select a compatible template or registered Processing Agent.")}</p>
      </div>
    `;
  }
  return `
    <div class="validation-preview is-valid">
      <div><strong>PIPELINE_VALID</strong><span>${tr("合同验证通过", "Contract validation passed")}</span></div>
      <p>${tr("当前 Graph 的 Schema、Market Pack、数据能力、必需输入和 Decision → Portfolio → Risk → Execution 权限边界均通过。", "Schemas, Market Pack, source capability, required inputs, and the Decision → Portfolio → Risk → Execution boundary all pass.")}</p>
    </div>
  `;
}

function renderProductLoop(): string {
  return `
    <section class="product-loop" aria-labelledby="product-loop-title">
      <header>
        <div>
          <span>${tr("基础版本产品闭环", "Foundation product loop")}</span>
          <h2 id="product-loop-title">${tr("数据进入，语义交接，受控资金化", "Data in, semantic handoff, controlled capital")}</h2>
        </div>
        <div class="product-loop__boundary">
          <strong>${tr("当前边界", "Current boundary")}</strong>
          <span>${tr("Crypto + Paper + 部分真实 API", "Crypto + Paper + partial real APIs")}</span>
        </div>
      </header>
      <div class="product-loop__rail">
        <article class="product-loop__stage">
          <span class="product-loop__index">01</span>
          <div>
            <small>${tr("市场与数据", "Market and data")}</small>
            <h3>${tr("能力先于编排", "Capability before orchestration")}</h3>
            <p>${tr("Crypto 24x7 已登记；A 股、港股和美股等待真实 Market Pack 与 Adapter。", "Crypto 24x7 is registered. A-share, Hong Kong, and US markets still need real Market Packs and adapters.")}</p>
          </div>
          <code>DataSourceCapability</code>
        </article>
        <article class="product-loop__stage">
          <span class="product-loop__index">02</span>
          <div>
            <small>${tr("观察窗口", "Observation windows")}</small>
            <h3>${tr("结构化数据拆分", "Structured data fan-out")}</h3>
            <p>${tr("K 线按可用窗口分发给子 Agent；事件流可独立运行，不从日线伪造分钟线。", "Bars are distributed by available windows. Event streams can run independently, and daily data never fabricates minute bars.")}</p>
          </div>
          <code>5m · 15m · 1h · event</code>
        </article>
        <article class="product-loop__stage is-semantic">
          <span class="product-loop__index">03</span>
          <div>
            <small>${tr("语义 Agent 交接", "Semantic Agent handoff")}</small>
            <h3>${tr("判断，而不是裸信号", "Judgment, not bare signals")}</h3>
            <div class="semantic-samples">
              <p><b>Regime / 1h</b><span>${tr("下行结构仍然有效", "Downtrend structure remains valid")}</span></p>
              <p><b>Trigger / 5m</b><span>${tr("量能确认出现延迟", "Volume confirmation arrived late")}</span></p>
              <p><b>Reflection</b><span>${tr("候选经验：避免峰值后追单", "Lesson candidate: avoid entries after peak volume")}</span></p>
            </div>
          </div>
          <code>SemanticArtifact[]</code>
        </article>
        <article class="product-loop__stage">
          <span class="product-loop__index">04</span>
          <div>
            <small>${tr("综合决策", "Synthesis")}</small>
            <h3>Decision → Portfolio → Risk</h3>
            <p>${tr("Decision 汇总各 Agent 语义、账户状态与已批准经验；Risk 保留独立否决权。", "Decision combines Agent semantics, account state, and approved lessons. Risk keeps independent veto authority.")}</p>
          </div>
          <code>${tr("唯一动作权限链", "Sole action authority")}</code>
        </article>
        <article class="product-loop__stage">
          <span class="product-loop__index">05</span>
          <div>
            <small>${tr("资金化与反思", "Capital and reflection")}</small>
            <h3>${tr("Paper 结果回到慢循环", "Paper outcomes return to the slow loop")}</h3>
            <p>${tr("Paper Execution、持仓监控和交易结果进入 Reflection；只创建 Lesson Candidate，不回写运行策略。", "Paper execution, position monitoring, and outcomes feed Reflection. It creates Lesson Candidates and never rewrites the running strategy.")}</p>
          </div>
          <code>${tr("无交易所写入", "No exchange writes")}</code>
        </article>
      </div>
    </section>
  `;
}

function renderOrchestration(): string {
  return renderStrategyWorkbench(strategyPreviewContext());
}

function strategyPreviewContext() {
  return {
    locale: state.locale,
    preview: state.strategyPreview,
    appFilter: state.strategyAppFilter,
    detailTarget: state.strategyDetailTarget,
    detailTab: state.strategyDetailTab,
    agentCategory: state.agentCenterCategory,
    selectedAgentId: state.selectedPreviewAgentId,
    agentSearch: state.agentCenterSearch,
    connectionTab: state.connectionPreviewTab,
    experimentHandoffAppName: state.experimentHandoffAppName,
    workbenchDraft: state.workbenchDraft,
    realAgents: state.realAgents,
    agentCenterToken: state.agentCenterToken,
    selectedRealAgent: state.selectedRealAgent,
    agentVersions: state.agentVersions,
  };
}

function renderDataCenter(): string {
  return `${renderDataCenterPrelude(state.locale)}<section class="legacy-surface-divider"><span>REGISTERED DATA ASSETS · EXISTING</span><p>${tr("下方保留现有 Data Center：只展示服务端登记的资产、质量、Schema 与 Lineage。", "The existing Data Center remains below, showing only server-registered assets, quality, schema, and lineage.")}</p></section><section class="page-intro"><div><h1>${tr("数据中心", "Data Center")}</h1><p>${tr("仅展示服务端登记的资产、能力和版本化快照。没有真实来源的市场维度会明确标为不可用。", "Only server-registered assets, capabilities, and versioned snapshots are shown. Market dimensions without a real source remain explicitly unavailable.")}</p></div><div class="orchestration-version"><span>${tr("运行时边界", "Runtime boundary")}</span><strong>${tr("只读", "Read only")}</strong><small>runtimeApplied=false</small></div></section><div id="data-center-host"></div>`;
}

function renderActivityRow(event: ActivityEvent): string {
  return `
    <button type="button" class="activity-row" data-activity="${event.id}" data-kind="${event.kind}" data-search="${escapeHtml(`${localized(event.title)} ${localized(event.summary)} ${event.meta}`.toLowerCase())}">
      <span class="activity-time">${localized(event.time)}</span>
      <span class="activity-type">${activityKind(event.kind)}</span>
      <span class="activity-copy"><strong>${localized(event.title)}</strong><small>${localized(event.summary)}</small></span>
      <code>${event.meta}</code>
    </button>
  `;
}

function renderLab(): string {
  return `<section class="page-intro"><div><h1>${tr("实验场", "Experiment Arena")}</h1><p>${tr("历史策略版本在服务端锁定并重放；不会审批、部署或改变运行时。", "Historical strategy versions are server-locked and replayed; no approval, deployment, or runtime mutation.")}</p></div></section><div id="experiment-workspace-host"></div>`;
}

function renderExperiment(): string {
  return `${renderExperimentHandoff(state.locale, state.experimentHandoffAppName)}<section class="legacy-surface-divider"><span>EXPERIMENT ARENA · EXISTING M3</span><p>${tr("下方保留现有 Backtest、Walk-Forward 与 Candidate 只读实验场。", "The existing Backtest, Walk-Forward, and read-only Candidate Experiment Arena remains below.")}</p></section>${renderLab()}`;
}

function renderTradeCenter(): string {
  return renderTradeCenterPreview(state.locale, state.simulationDialogueId);
}

function renderActivity(): string {
  const filters: Array<["all" | ActivityKind, LocalizedText]> = [
    ["all", { zh: "全部", en: "All" }],
    ["selection", { zh: "选币", en: "Selection" }],
    ["decision", { zh: "决策", en: "Decision" }],
    ["trade", { zh: "交易", en: "Trade" }],
    ["exception", { zh: "异常", en: "Exception" }],
    ["configuration", { zh: "配置", en: "Configuration" }],
  ];
  return `
    <section class="page-intro">
      <div>
        <h1>${tr("审计记录", "Audit Log")}</h1>
        <p>${tr("按 Trace、订单或标的追溯 Selector、Decision、Risk、Execution 与 Review 产物。", "Trace Selector, Decision, Risk, Execution, and Review artifacts by trace, order, or symbol.")}</p>
      </div>
      <button type="button" class="secondary-action" id="activity-ask">${tr("询问副驾驶", "Ask Copilot")}</button>
    </section>
    <section class="audit-guide" aria-labelledby="audit-guide-title">
      <div class="audit-guide__intro">
        <span>${tr("如何阅读", "HOW TO READ")}</span>
        <h2 id="audit-guide-title">${tr("一笔交易为什么发生？", "Why did a trade happen?")}</h2>
        <p>${tr("从标的选择开始，沿着决策、风险检查和执行结果逐步查看。点击术语可了解它在交易链路中的作用。", "Start with symbol selection, then follow the decision, risk check, and execution result. Open a term to understand its role in the trading chain.")}</p>
      </div>
      <div class="audit-guide__terms">
        <details><summary>Trace</summary><p>${tr("贯穿一次完整决策链的追踪编号，用于把各个 Agent 的输入输出关联起来。", "The identifier linking every Agent input and output in one decision chain.")}</p></details>
        <details><summary>Decision</summary><p>${tr("决策 Agent 给出的方向、置信度和原因；它本身不能直接下单。", "Direction, confidence, and rationale from the Decision Agent; it cannot place an order directly.")}</p></details>
        <details><summary>Risk Gate</summary><p>${tr("订单进入执行前的强制风险检查，可拒绝或缩减决策。", "The mandatory risk check before execution; it can reject or reduce a decision.")}</p></details>
        <details><summary>Execution</summary><p>${tr("Paper 账户中的最终执行结果，包括成交、拒绝或未成交。", "The final Paper-account result: filled, rejected, or unfilled.")}</p></details>
      </div>
    </section>
    <div class="causal-review-mount" data-causal-review-root></div>
    <section class="activity-console activity-sample-console">
      <div class="activity-sample-label">
        <strong>SAMPLE FALLBACK</strong>
        <span>${tr("非 Runtime 事实，仅用于离线界面示例", "Not Runtime facts; offline UI examples only")}</span>
      </div>
      <div class="activity-toolbar">
        <div class="activity-filters">
          ${filters.map(([id, label]) => `<button type="button" data-activity-filter="${id}" class="${state.activityFilter === id ? "is-active" : ""}" aria-pressed="${state.activityFilter === id}">${localized(label)}</button>`).join("")}
        </div>
        <label><span>${tr("搜索审计记录", "Search audit log")}</span><input type="search" id="activity-search" placeholder="${tr("订单、标的或追踪编号", "Order, symbol, or trace")}" /></label>
      </div>
      <div class="activity-list">${activityEvents.map(renderActivityRow).join("")}</div>
      <div class="activity-empty" hidden id="activity-empty">${tr("没有符合当前条件的记录。", "No records match the current filters.")}</div>
    </section>
  `;
}

function renderConnections(): string {
  const sections: Array<[ConnectionSection, LocalizedText, LocalizedText]> = [
    ["llm", { zh: "大模型推理", en: "LLM inference" }, { zh: "供应商、模型与智能体授权", en: "Providers, models, and Agent scopes" }],
    ["exchange", { zh: "交易账户", en: "Trading account" }, { zh: "模拟账户、只读账户与实盘边界", en: "Paper, read-only, and live boundaries" }],
    ["security", { zh: "密钥与权限", en: "Secrets and permissions" }, { zh: "凭证流转、脱敏与审计", en: "Credential flow, redaction, and audit" }],
  ];
  return `
    <section class="page-intro connections-intro">
      <div>
        <h1>${tr("连接与权限", "Connections and permissions")}</h1>
        <p>${tr("配置模型推理与账户读取能力。密钥、智能体授权和交易权限彼此隔离。", "Configure model inference and account-read capabilities. Secrets, Agent authorization, and trading permissions stay isolated.")}</p>
      </div>
      <span class="connections-mode">${tr("实盘写入未启用", "Live writes disabled")}</span>
    </section>

    <section class="connection-plane" aria-label="${tr("连接状态", "Connection status")}">
      <div><span>${tr("配置来源", "Configuration source")}</span><strong>${tr("当前为浏览器模拟，会话结束即清除", "Browser mock, cleared after this session")}</strong></div>
      <div><span>${tr("运行时密钥", "Runtime secrets")}</span><strong>${tr("必须由服务端密钥库或环境变量注入", "Server vault or environment injection required")}</strong></div>
      <div class="is-locked"><span>${tr("交易所写权限", "Exchange write access")}</span><strong>${tr("锁定", "Locked")}</strong></div>
    </section>

    <div class="connections-layout">
      <nav class="connection-nav" aria-label="${tr("连接配置分类", "Connection settings sections")}">
        ${sections.map(([id, label, description]) => `
          <button type="button" data-connection-section="${id}" class="${state.connections.section === id ? "is-active" : ""}" aria-current="${state.connections.section === id ? "page" : "false"}">
            <strong>${localized(label)}</strong>
            <small>${localized(description)}</small>
          </button>
        `).join("")}
      </nav>
      <div class="connection-workspace">
        ${state.connections.section === "llm"
          ? renderLlmConnections()
          : state.connections.section === "exchange"
            ? renderExchangeConnections()
            : renderSecurityConnections()}
      </div>
    </div>
  `;
}

function renderLlmConnections(): string {
  const provider = selectedProvider();
  const saved = state.connections.llm?.provider === provider.id ? state.connections.llm : undefined;
  const scopes = saved?.authorizedScopes ?? ["bull-case", "bear-case", "reflection"];
  return `
    <section class="connection-section" aria-labelledby="llm-connections-title">
      <header class="connection-section__header">
        <div>
          <h2 id="llm-connections-title">${tr("大模型供应商目录", "LLM Provider Registry")}</h2>
          <p>${tr("旧项目的 8 个固定供应商被拆成独立协议配置。模型 ID 可编辑，并应由服务端调用模型目录接口刷新。", "The old project's eight fixed providers are now protocol-aware profiles. Model IDs stay editable and should be refreshed through server-side Models APIs.")}</p>
        </div>
        <span class="connection-health ${state.connections.llm ? "is-ready" : ""}">${state.connections.llm ? tr("草案已验证", "Draft validated") : tr("未配置", "Not configured")}</span>
      </header>

      <div class="llm-registry">
        <div class="provider-index">
          ${providerPresets.map((item) => `
            <button type="button" data-provider="${item.id}" class="${provider.id === item.id ? "is-active" : ""}" aria-pressed="${provider.id === item.id}">
              <span><strong>${item.name}</strong><small>${localized(item.description)}</small></span>
              <em>${item.runtimeReady ? tr("运行时可用", "Runtime ready") : tr("待接适配器", "Adapter needed")}</em>
            </button>
          `).join("")}
        </div>

        <form class="connection-form" id="llm-connection-form" autocomplete="off">
          <header>
            <div><span>${tr("当前供应商", "Selected provider")}</span><h3>${provider.name}</h3></div>
            <code>${provider.runtimeReady ? tr("适配器：可用", "adapter:available") : tr("适配器：仅契约", "adapter:contract-only")}</code>
          </header>

          <div class="connection-notice ${provider.runtimeReady ? "is-safe" : ""}">
            <strong>${provider.runtimeReady ? tr("当前运行时可以实际调用", "Callable by the current Runtime") : tr("当前仅完成界面与配置契约", "UI and configuration contract only")}</strong>
            <p>${provider.runtimeReady
              ? tr("DeepSeek 仅用于看多、看空与复盘智能体，失败时回退到规则智能体。", "DeepSeek is limited to Bull, Bear, and Reflection, with rule-agent fallback.")
              : tr("保存不会让该供应商进入运行周期。需要先实现并测试对应运行时适配器。", "Saving will not admit this provider into a running cycle. Its Runtime adapter must be implemented and tested first.")}</p>
          </div>

          <div class="connection-fields">
            <label>${tr("模型 ID", "Model ID")}
              <input name="model" autocomplete="off" required value="${escapeHtml(saved?.model ?? provider.model)}" placeholder="${tr("由供应商模型目录接口返回", "Returned by the provider Models API")}" />
              <small>${tr("不要依赖前端固定下拉列表，模型可能更新或下线。", "Do not rely on a static frontend list. Models can change or retire.")}</small>
            </label>
            <label>${tr("API 基础地址", "Base URL")}
              <input name="baseUrl" type="url" autocomplete="off" required value="${escapeHtml(saved?.baseUrl ?? provider.baseUrl)}" placeholder="https://api.example.com/v1" />
              <small>${tr("生产环境应在服务端设置允许列表，浏览器不能任意代理地址。", "Production must enforce a server-side allowlist. The browser cannot proxy arbitrary URLs.")}</small>
            </label>
            ${provider.auth === "api-key" ? `
              <label>${tr("API 密钥", "API key")}
                <input name="apiKey" type="password" required autocomplete="new-password" placeholder="${tr("仅用于本次模拟验证，不会保留", "Used for this mock validation only, never retained")}" />
                <small>${tr("页面不会写入浏览器本地存储、智能体产物、追踪记录或日志。", "Never written to localStorage, Artifacts, traces, or logs.")}</small>
              </label>
            ` : `
              <div class="local-auth">
                <span>${tr("认证方式", "Authentication")}</span>
                <strong>${tr("本地服务，无 API Key", "Local service, no API key")}</strong>
                <small>${tr("生产环境仍需限制运行时到 Ollama 的网络访问。", "Production must still restrict Runtime network access to Ollama.")}</small>
              </div>
            `}
          </div>

          <fieldset class="agent-scope">
            <legend>${tr("允许调用此模型的智能体", "Agents authorized to call this model")}</legend>
            <p>${tr("连接供应商不等于授权所有智能体。每个范围都必须明确记录。", "Connecting a provider does not authorize every Agent. Each scope must be recorded explicitly.")}</p>
            <label><input type="checkbox" name="scope" value="bull-case" ${scopes.includes("bull-case") ? "checked" : ""} /> <span><strong>${tr("看多观点智能体", "Bull Case Agent")}</strong><small>${tr("生成结构化看多证据，可安全回退", "Structured bullish evidence with safe fallback")}</small></span></label>
            <label><input type="checkbox" name="scope" value="bear-case" ${scopes.includes("bear-case") ? "checked" : ""} /> <span><strong>${tr("看空观点智能体", "Bear Case Agent")}</strong><small>${tr("生成结构化看空证据，可安全回退", "Structured bearish evidence with safe fallback")}</small></span></label>
            <label><input type="checkbox" name="scope" value="reflection" ${scopes.includes("reflection") ? "checked" : ""} /> <span><strong>${tr("复盘智能体", "Reflection Agent")}</strong><small>${tr("只能提出受约束建议，不能修改运行策略", "Bounded suggestions only, never runtime mutation")}</small></span></label>
          </fieldset>

          <div class="connection-actions">
            <button type="button" class="secondary-action" id="discover-models">${tr("检查模型目录", "Check model catalog")}</button>
            <button type="submit" class="primary-action">${tr("验证配置草案", "Validate configuration draft")}</button>
          </div>
          ${saved ? `<p class="saved-connection">${tr("最近验证", "Last validated")}: ${new Date(saved.validatedAt).toLocaleString(state.locale === "zh-CN" ? "zh-CN" : "en-US")} / ${escapeHtml(saved.model)} / ${saved.authorizedScopes.length} ${tr("个智能体范围", "Agent scopes")}</p>` : ""}
        </form>
      </div>
    </section>
  `;
}

function renderExchangeConnections(): string {
  const saved = state.connections.exchange;
  return `
    <section class="connection-section" aria-labelledby="exchange-connections-title">
      <header class="connection-section__header">
        <div>
          <h2 id="exchange-connections-title">${tr("账户连接平面", "Account connection plane")}</h2>
          <p>${tr("模拟账户、交易所只读账户和实盘执行是三种不同权限，不能用一个“已连接”状态混在一起。", "Paper Account, signed exchange reads, and live execution are distinct capabilities and must never share one generic connected state.")}</p>
        </div>
        <span class="connection-health ${saved ? "is-ready" : ""}">${saved ? tr("只读草案已验证", "Read-only draft validated") : tr("仅模拟账户", "Paper only")}</span>
      </header>

      <section class="paper-account-line">
        <div><span>${tr("模拟账户", "Paper Account")}</span><strong>paper:main</strong></div>
        <dl>
          <div><dt>${tr("执行方式", "Execution")}</dt><dd>${tr("本地模拟", "Local simulation")}</dd></div>
          <div><dt>${tr("数据库", "Database")}</dt><dd>data/paper.db</dd></div>
          <div><dt>${tr("交易所写入", "Exchange writes")}</dt><dd>${tr("无", "None")}</dd></div>
        </dl>
        <span class="paper-ready">${tr("可用", "Ready")}</span>
      </section>

      <div class="exchange-layout">
        <form class="connection-form exchange-form" id="exchange-connection-form" autocomplete="off">
          <header>
            <div><span>${tr("签名账户连接", "Signed account connection")}</span><h3>Binance Futures</h3></div>
            <code>${tr("能力：只读", "capability:read-only")}</code>
          </header>
          <div class="connection-notice is-safe">
            <strong>${tr("当前运行时只用于账户对账", "Current Runtime is read-only reconciliation")}</strong>
            <p>${tr("可读取余额、持仓和挂单。不会创建、修改或取消订单。", "It can read balances, positions, and open orders. It cannot create, modify, or cancel orders.")}</p>
          </div>
          <div class="connection-fields connection-fields--two">
            <label>${tr("账户名称", "Account label")}<input name="accountLabel" autocomplete="off" required value="${escapeHtml(saved?.accountLabel ?? tr("主账户只读", "Primary read-only"))}" /></label>
            <label>${tr("账户 ID", "Account ID")}<input name="accountId" autocomplete="off" required value="${escapeHtml(saved?.accountId ?? "paper:main")}" /></label>
            <label>${tr("环境", "Environment")}
              <select name="environment">
                <option value="testnet" ${saved?.environment === "live" ? "" : "selected"}>${tr("测试网", "Testnet")}</option>
                <option value="live" ${saved?.environment === "live" ? "selected" : ""}>${tr("实盘账户，只读", "Live account, read-only")}</option>
              </select>
            </label>
            <label>${tr("交易所", "Exchange")}<input value="Binance USDⓈ-M Futures" readonly /></label>
            <label>${tr("API 密钥", "API key")}<input name="apiKey" type="password" required autocomplete="new-password" placeholder="${tr("仅用于本次模拟验证", "Used for this mock validation only")}" /></label>
            <label>${tr("API 私钥", "API secret")}<input name="apiSecret" type="password" required autocomplete="new-password" placeholder="${tr("不会在浏览器中保存", "Never stored in the browser")}" /></label>
          </div>
          <fieldset class="permission-checklist">
            <legend>${tr("权限确认", "Permission confirmation")}</legend>
            <div><span>${tr("读取账户与余额", "Read account and balances")}</span><strong>${tr("需要", "Required")}</strong></div>
            <div><span>${tr("读取持仓与订单", "Read positions and orders")}</span><strong>${tr("需要", "Required")}</strong></div>
            <div><span>${tr("创建或取消订单", "Create or cancel orders")}</span><strong class="is-denied">${tr("禁止", "Denied")}</strong></div>
            <div><span>${tr("提现权限", "Withdrawal permission")}</span><strong class="is-denied">${tr("必须关闭", "Must be off")}</strong></div>
            <label><input type="checkbox" name="withdrawalDisabled" required /> ${tr("我确认该密钥没有提现权限", "I confirm this key has no withdrawal permission")}</label>
          </fieldset>
          <div class="connection-actions">
            <button type="submit" class="primary-action">${tr("验证只读连接草案", "Validate read-only draft")}</button>
          </div>
          ${saved ? `<p class="saved-connection">${tr("最近验证", "Last validated")}: ${new Date(saved.validatedAt).toLocaleString(state.locale === "zh-CN" ? "zh-CN" : "en-US")} / ${escapeHtml(saved.accountLabel)} / ${saved.environment}</p>` : ""}
        </form>

        <aside class="live-execution-lock">
          <span>${tr("实盘执行", "Live execution")}</span>
          <h3>${tr("当前不可启用", "Currently unavailable")}</h3>
          <p>${tr("TypeScript 运行时尚未实现交易所写入适配器。配置账户不能绕过这一边界。", "The TypeScript Runtime has no exchange-write adapter. Account configuration cannot bypass that boundary.")}</p>
          <ol>
            <li><strong>${tr("实现执行适配器", "Implement execution adapter")}</strong><small>${tr("订单幂等、精度、重试与撤单语义", "Idempotency, precision, retries, and cancel semantics")}</small></li>
            <li><strong>${tr("独立安全审计", "Independent safety audit")}</strong><small>${tr("密钥权限、IP 白名单与资金限制", "Key permissions, IP allowlist, and capital limits")}</small></li>
            <li><strong>${tr("人工启用门禁", "Human enablement gate")}</strong><small>${tr("再次认证、风险确认与审计事件", "Re-authentication, risk acceptance, and audit event")}</small></li>
          </ol>
          <button type="button" disabled class="locked-action">${tr("实盘写入已锁定", "Live writes locked")}</button>
        </aside>
      </div>
    </section>
  `;
}

function renderSecurityConnections(): string {
  return `
    <section class="connection-section" aria-labelledby="security-connections-title">
      <header class="connection-section__header">
        <div>
          <h2 id="security-connections-title">${tr("密钥与能力隔离", "Secret and capability isolation")}</h2>
          <p>${tr("智能体不应该拿到 API 密钥。它只获得一个受约束的能力端口，所有调用与权限变化都产生脱敏审计记录。", "Agents should never receive API keys. They receive constrained capability ports, while calls and permission changes create redacted audit records.")}</p>
        </div>
      </header>

      <div class="credential-flow" aria-label="${tr("凭证流转", "Credential flow")}">
        <div><span>${tr("录入", "Enter")}</span><strong>${tr("受保护的配置界面", "Protected configuration surface")}</strong><small>${tr("浏览器不持久化密钥", "No browser persistence")}</small></div>
        <i aria-hidden="true">→</i>
        <div><span>${tr("保存", "Store")}</span><strong>${tr("服务端密钥库", "Server-side vault")}</strong><small>${tr("加密、轮换、访问控制", "Encryption, rotation, access control")}</small></div>
        <i aria-hidden="true">→</i>
        <div><span>${tr("注入", "Inject")}</span><strong>${tr("受约束运行时端口", "Constrained Runtime port")}</strong><small>${tr("按智能体与能力授权", "Authorized per Agent and capability")}</small></div>
        <i aria-hidden="true">→</i>
        <div><span>${tr("审计", "Audit")}</span><strong>${tr("智能体产物账本", "Artifact Ledger")}</strong><small>${tr("只记录供应商、模型、状态和错误类别", "Provider, model, status, and error category only")}</small></div>
      </div>

      <div class="security-matrix">
        <section>
          <h3>${tr("永远不进入智能体产物", "Never enters an Artifact")}</h3>
          <p>${tr("API 密钥 / API 私钥 / 授权请求头 / 完整环境变量 / 完整提示词", "API key / API secret / authorization header / raw environment variables / full prompts")}</p>
        </section>
        <section>
          <h3>${tr("允许进入审计", "Allowed in audit")}</h3>
          <p>${tr("供应商 / 模型 / 基础地址主机 / 智能体范围 / 耗时 / 回退 / 错误类别 / 操作者 / 时间戳", "provider / model / base URL host / Agent scope / latency / fallback / error category / operator / timestamp")}</p>
        </section>
        <section class="is-warning">
          <h3>${tr("生产环境必需组件", "Required for production")}</h3>
          <p>${tr("密钥库、后端配置接口、角色权限、重新认证、轮换、撤销和不可变审计日志。", "Secret vault, backend configuration API, RBAC, re-authentication, rotation, revocation, and immutable audit logs.")}</p>
        </section>
      </div>
    </section>
  `;
}

function renderCopilot(): string {
  if (!state.copilotOpen) return "";
  return `
    <div class="overlay-backdrop" data-close-copilot></div>
    <aside class="copilot-drawer" role="dialog" aria-modal="true" aria-labelledby="copilot-title">
      <header>
        <div><span>${tr("受控副驾驶", "Controlled Copilot")}</span><h2 id="copilot-title">${tr("查询、解释、起草", "Query, explain, draft")}</h2></div>
        <button type="button" class="close-button" id="close-copilot" aria-label="${tr("关闭副驾驶", "Close Copilot")}">×</button>
      </header>
      <div class="copilot-context">
        <strong>Atlas Trading Agent</strong>
        <span>BTCUSDT / trace:7f13a9</span>
        <p>${tr("副驾驶可以读取 Journal、Review 和 Artifact Ledger，也可以创建草案。它不能下单或修改运行策略。", "Copilot can read Journal, Review, and Artifact Ledger and create drafts. It cannot place orders or modify the running profile.")}</p>
      </div>
      <div class="copilot-tasks">
        <button type="button" data-copilot-task="why"><strong>${tr("解释本轮决策", "Explain this decision")}</strong><span>${tr("说明为什么选择 BTCUSDT 并继续持仓", "Explain the selection and hold decision")}</span></button>
        <button type="button" data-copilot-task="history"><strong>${tr("查询交易历史", "Search trade history")}</strong><span>${tr("检索订单、复盘和 Agent 产物", "Search orders, reviews, and Agent artifacts")}</span></button>
        <button type="button" data-copilot-task="news"><strong>${tr("获取最新信息", "Get latest context")}</strong><span>${tr("整理可附加到候选版本的市场信息", "Prepare context that can be attached to a Candidate")}</span></button>
        <button type="button" data-copilot-task="loss"><strong>${tr("复盘亏损交易", "Review losses")}</strong><span>${tr("查找重复的失败模式", "Find recurring failure patterns")}</span></button>
        <button type="button" data-copilot-task="thesis"><strong>${tr("添加人工市场观点", "Add Human Market Thesis")}</strong><span>${tr("创建有范围和有效期的结构化草案", "Create a scoped, time-bounded draft")}</span></button>
        <button type="button" data-copilot-task="proposal"><strong>${tr("提出策略修改", "Propose strategy change")}</strong><span>${tr("创建候选版本，不触碰运行版本", "Create a Candidate without touching the running profile")}</span></button>
      </div>
      <div class="copilot-response" id="copilot-response" aria-live="polite">
        <span>${tr("准备就绪", "Ready")}</span>
        <p>${tr("选择一个受控任务，或输入需要查询的订单、标的或 Trace。", "Choose a controlled task or enter an order, symbol, or trace to query.")}</p>
      </div>
      <form class="copilot-composer" id="copilot-form">
        <label for="copilot-input">${tr("查询内容", "Query")}</label>
        <div><input id="copilot-input" required autocomplete="off" placeholder="${tr("例如：解释 trace:7f13a9", "Example: explain trace:7f13a9")}" /><button type="submit">${tr("查询", "Query")}</button></div>
        <small>${tr("查询结果不会触发交易或策略发布。", "Query results cannot trigger trading or strategy release.")}</small>
      </form>
    </aside>
  `;
}

function selectedCapability(): Capability {
  return capabilities.find((capability) => capability.id === state.capabilityId) ?? capabilities[0]!;
}

function selectedCandidate(): Candidate {
  return candidates.find((candidate) => candidate.symbol === state.candidateSymbol) ?? candidates[0]!;
}

function renderCapabilityPanel(): string {
  const capability = selectedCapability();
  return `
    <header class="panel-header">
      <div><span>${tr("子 Agent 详情", "Sub-agent detail")}</span><h2 id="panel-title">${localized(capability.name)}</h2></div>
      <button type="button" class="close-button" data-close-panel aria-label="${tr("关闭详情", "Close detail")}">×</button>
    </header>
    <div class="panel-status">
      <span class="state-label state-label--${capability.status}">${capabilityStatus(capability.status)}</span>
      <code>${capability.owner}@${capability.version}</code>
    </div>
    <section class="panel-callout"><span>${tr("结构化输出", "Structured output")}</span><strong>${localized(capability.output)}</strong></section>
    <section class="panel-section"><h3>${tr("输入", "Inputs")}</h3>${capability.inputs.map((item) => `<p>${localized(item)}</p>`).join("")}</section>
    <section class="panel-section"><h3>${tr("证据与产物", "Evidence and artifacts")}</h3>${capability.evidence.map((item) => `<p>${localized(item)}</p>`).join("")}</section>
    <dl class="panel-metadata">
      <div><dt>${tr("耗时", "Latency")}</dt><dd>${capability.latency}</dd></div>
      <div><dt>Artifact</dt><dd>${capability.artifacts}</dd></div>
      <div><dt>${tr("状态", "Status")}</dt><dd>${capabilityStatus(capability.status)}</dd></div>
    </dl>
  `;
}

function renderCandidatePanel(): string {
  const candidate = selectedCandidate();
  return `
    <header class="panel-header">
      <div><span>${tr("Selector 候选", "Selector candidate")}</span><h2 id="panel-title">${candidate.symbol}</h2></div>
      <button type="button" class="close-button" data-close-panel aria-label="${tr("关闭详情", "Close detail")}">×</button>
    </header>
    <div class="candidate-hero candidate-hero--${candidate.state}">
      <span>${candidate.state === "selected" ? tr("本轮唯一入选", "Only admitted symbol") : candidate.state === "qualified" ? tr("通过门槛但未入选", "Qualified, not admitted") : tr("未通过门槛", "Rejected")}</span>
      <strong>${candidate.score.toFixed(1)}</strong>
      <small>${tr("机会评分", "Opportunity score")}</small>
    </div>
    <section class="panel-callout"><span>${tr("筛选结论", "Selector conclusion")}</span><strong>${localized(candidate.reason)}</strong></section>
    <dl class="panel-metadata">
      <div><dt>${tr("排名", "Rank")}</dt><dd>${candidate.rank || tr("无", "None")}</dd></div>
      <div><dt>${tr("30 分钟动量", "30m momentum")}</dt><dd>${candidate.momentum}</dd></div>
      <div><dt>${tr("24 小时成交额", "24h volume")}</dt><dd>${candidate.volume} USDT</dd></div>
      <div><dt>topN</dt><dd>1</dd></div>
    </dl>
    <p class="protected-note">${tr("查看候选详情不会改变 Selector 结果，也不会创建订单。", "Inspecting a candidate does not change the Selector result or create an order.")}</p>
  `;
}

function renderUniversePanel(): string {
  return `
    <header class="panel-header">
      <div><span>${tr("选币审计", "Selection audit")}</span><h2 id="panel-title">${tr("42 个候选，1 个入选", "42 candidates, 1 admitted")}</h2></div>
      <button type="button" class="close-button" data-close-panel aria-label="${tr("关闭详情", "Close detail")}">×</button>
    </header>
    <section class="panel-callout"><span>SelectorPolicy</span><strong>topN=1 / minQuoteVolume24h=5M / trendStrength≥20 / volatility=0.2%-12%</strong></section>
    <div class="universe-ranking">${candidates.map(renderCandidateRow).join("")}</div>
    <p class="protected-note">${tr("这里只展示 Mock 快照中的前 5 行。接入 Runtime API 后，应从 CycleResult.universe.candidates 读取完整结果。", "This shows the top five rows from the mock snapshot. Once connected, read the full ranking from CycleResult.universe.candidates.")}</p>
  `;
}

function renderReviewPanel(): string {
  const steps = [
    [tr("选币", "Selector"), tr("BTCUSDT 排名第 1，topN=1", "BTCUSDT ranked first with topN=1"), "412 ms", "success"],
    [tr("数据", "Data"), tr("三个周期对齐，数据质量通过", "Three timeframes aligned, quality passed"), "286 ms", "success"],
    [tr("分析", "Analysis"), tr("1 小时下行趋势有效", "1h downtrend remains valid"), "547 ms", "success"],
    [tr("看多观点", "Bull case"), tr("服务超时，生成确定性安全回退产物", "Provider timed out; deterministic safe fallback produced"), "15.0 s", "fallback"],
    [tr("看空观点", "Bear case"), tr("下行论据通过结构化校验", "Bear evidence passed structured validation"), "624 ms", "success"],
    ["Position Monitor", tr("退出条件均未触发", "No exit condition was triggered"), "31 ms", "success"],
    [tr("决策", "Decision"), tr("已有空仓优先，继续持有", "Existing short took priority, hold"), "86 ms", "success"],
    [tr("风险", "Risk"), tr("账户敞口在 3% 预算内", "Exposure is within the 3% budget"), "17 ms", "success"],
    [tr("执行", "Execution"), tr("没有新的订单意图", "No new order intent"), "4 ms", "success"],
  ];
  return `
    <header class="panel-header">
      <div><span>${tr("因果复盘", "Causal review")}</span><h2 id="panel-title">BTCUSDT / trace:7f13a9</h2></div>
      <button type="button" class="close-button" data-close-panel aria-label="${tr("关闭复盘", "Close review")}">×</button>
    </header>
    <section class="review-summary">
      <div><span>${tr("当前结果", "Outcome")}</span><strong>${tr("持有空仓", "HOLD SHORT")}</strong></div>
      <p>${tr("现有持仓未达到任何退出条件，风险门禁保持通过。", "The open position met no exit condition and the Risk Gate remained passed.")}</p>
    </section>
    <section class="entry-trace">
      <span>${tr("建仓追踪", "Entry trace")}</span>
      <strong>order:paper:41 / trace:entry_8c20</strong>
      <p>${tr("昨天 20:12，风险门禁通过后以 64,210.40 建立 0.148 BTC 空仓。下方是当前 Cycle 的持仓监控链，不是原始开仓链。", "Yesterday at 20:12, 0.148 BTC SHORT was opened at 64,210.40 after Risk approval. The timeline below is the current monitor cycle, not the original entry trace.")}</p>
    </section>
    <h3 class="review-trace-title">${tr("当前持仓监控追踪", "Current position monitor trace")} · trace:7f13a9</h3>
    <ol class="review-timeline">
      ${steps.map(([name, summary, latency, status], index) => `<li class="${status === "fallback" ? "is-fallback" : ""}"><span>${index + 1}</span><div><strong>${name}</strong><p>${summary}</p><code>${latency} / ${status}</code></div></li>`).join("")}
    </ol>
    <p class="protected-note">${tr("复盘只展示安全的结构化摘要，不包含密钥、环境变量或完整 LLM Prompt。", "Review exposes safe structured summaries only. It never shows secrets, environment variables, or full LLM prompts.")}</p>
  `;
}

function renderThesisPanel(): string {
  const draft = state.workspace.thesis;
  return `
    <header class="panel-header">
      <div><span>Human Market Thesis</span><h2 id="panel-title">${tr("创建人工市场观点草案", "Create a market thesis draft")}</h2></div>
      <button type="button" class="close-button" data-close-panel aria-label="${tr("关闭表单", "Close form")}">×</button>
    </header>
    <form class="structured-form" id="thesis-form">
      <label>${tr("市场观点", "Market view")}<textarea name="marketView" required>${escapeHtml(draft?.marketView ?? tr("宏观流动性收紧可能延长 BTC 的下行趋势。", "Tighter macro liquidity may extend BTC's downtrend."))}</textarea></label>
      <div class="form-grid">
        <label>${tr("影响标的", "Affected symbols")}<input name="symbols" required value="${escapeHtml(draft?.symbols ?? "BTCUSDT")}" /></label>
        <label>${tr("有效期", "Valid until")}<input name="validUntil" type="datetime-local" required value="${escapeHtml(draft?.validUntil ?? "2026-07-28T18:00")}" /></label>
        <label>${tr("偏向", "Bias")}<select name="bias"><option value="bearish">${tr("看空", "Bearish")}</option><option value="neutral">${tr("中性", "Neutral")}</option><option value="bullish">${tr("看多", "Bullish")}</option></select></label>
        <label>${tr("置信度", "Confidence")}<input name="confidence" type="number" min="0" max="100" value="${draft?.confidence ?? 68}" /></label>
      </div>
      <label>${tr("风险约束", "Risk constraint")}<input name="riskConstraint" required value="${escapeHtml(draft?.riskConstraint ?? tr("不得提高杠杆或覆盖风险门禁", "Must not raise leverage or override the Risk Gate"))}" /></label>
      <label>${tr("说明", "Notes")}<textarea name="notes">${escapeHtml(draft?.notes ?? tr("仅作为候选策略上下文。", "Candidate context only."))}</textarea></label>
      <div class="form-protection">${tr("提交后进入 Agent 实验室，不修改运行 Agent，也不会触发订单。", "Submission goes to Agent Lab. It will not modify the running Agent or trigger an order.")}</div>
      <button type="submit" class="primary-action">${tr("保存观点草案", "Save thesis draft")}</button>
    </form>
  `;
}

function renderProposalPanel(): string {
  const proposal = state.workspace.proposal;
  return `
    <header class="panel-header">
      <div><span>${tr("候选策略", "Candidate strategy")}</span><h2 id="panel-title">${tr("创建策略修改提案", "Create strategy change proposal")}</h2></div>
      <button type="button" class="close-button" data-close-panel aria-label="${tr("关闭表单", "Close form")}">×</button>
    </header>
    <form class="structured-form" id="proposal-form">
      <div class="form-grid">
        <label>${tr("最低置信度", "Minimum confidence")}<input name="minimumConfidence" type="number" min="0" max="100" value="${proposal?.minimumConfidence ?? 68}" /></label>
        <label>${tr("最大杠杆", "Max leverage")}<input name="maxLeverage" type="number" min="1" step="0.05" value="${proposal?.maxLeverage ?? 1.25}" /></label>
        <label>${tr("最大持仓数", "Max positions")}<input name="maxPositions" type="number" min="1" value="1" readonly /></label>
        <label>${tr("每笔名义金额", "Per-trade notional")}<input name="perTradeNotional" type="number" min="1" value="${proposal?.perTradeNotional ?? 850}" /></label>
        <label>${tr("最长持仓小时", "Max holding hours")}<input name="maxHoldingHours" type="number" min="1" value="${proposal?.maxHoldingHours ?? 36}" /></label>
        <label>Selector topN<input name="topN" type="number" value="1" readonly /></label>
      </div>
      <label>${tr("修改原因", "Reason for change")}<textarea name="reason" required>${escapeHtml(proposal?.reason ?? tr("根据亏损复盘收紧入场确认，同时坚持每轮只选择一个标的。", "Tighten entry confirmation from loss reviews while keeping one admitted symbol per cycle."))}</textarea></label>
      <div class="form-protection">${tr("系统将从运行配置 3.8.0 创建候选版本。必须完成回测、样本外验证与人工审批。", "A Candidate will be created from running profile 3.8.0. Backtest, Walk-Forward, and human approval are mandatory.")}</div>
      <button type="submit" class="primary-action">${tr("创建候选提案", "Create Candidate proposal")}</button>
    </form>
  `;
}

function renderPausePanel(): string {
  const enabling = !runtimeDashboard.canResume;
  return `
    <header class="panel-header">
      <div><span>${tr("紧急风险控制", "Emergency risk control")}</span><h2 id="panel-title">${enabling ? tr("暂停所有新开仓？", "Pause all new openings?") : tr("恢复新开仓权限？", "Resume new openings?")}</h2></div>
      <button type="button" class="close-button" data-close-panel aria-label="${tr("关闭确认", "Close confirmation")}">×</button>
    </header>
    <div class="risk-confirmation">
      <strong>${enabling ? tr("立即切换为仅允许平仓", "Switch immediately to Only Close") : tr("恢复模拟开仓意图", "Restore Paper opening intents")}</strong>
      <p>${enabling
        ? tr("Selector 和分析仍会运行，但所有新开仓都会被阻止。Position Monitor 与平仓路径继续工作。", "Selector and analysis continue running, but all new openings are blocked. Position Monitor and closing paths remain active.")
        : tr("Agent 将重新获得创建模拟开仓意图的权限，所有风险门禁继续生效。", "The Agent can create Paper opening intents again. All Risk Gates remain active.")}</p>
      <button type="button" class="${enabling ? "danger-action" : "primary-action"}" id="confirm-pause">${enabling ? tr("确认暂停新开仓", "Confirm pause") : tr("确认恢复", "Confirm resume")}</button>
      <button type="button" class="secondary-action" data-close-panel>${tr("取消", "Cancel")}</button>
    </div>
  `;
}

function renderPanel(): string {
  if (!state.panel) return "";
  const content = state.panel === "capability"
    ? renderCapabilityPanel()
    : state.panel === "candidate"
      ? renderCandidatePanel()
      : state.panel === "universe"
        ? renderUniversePanel()
        : state.panel === "review"
          ? renderReviewPanel()
          : state.panel === "thesis"
            ? renderThesisPanel()
            : state.panel === "proposal"
              ? renderProposalPanel()
              : renderPausePanel();
  const wide = state.panel === "review" || state.panel === "thesis" || state.panel === "proposal" || state.panel === "universe";
  return `
    <div class="overlay-backdrop" data-close-panel></div>
    <aside class="detail-panel ${wide ? "detail-panel--wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="panel-title">
      ${content}
    </aside>
  `;
}

function renderToast(): string {
  return state.toast ? `<div class="toast" role="status">${localized(state.toast)}</div>` : "";
}

function render(): void {
  document.documentElement.lang = state.locale;
  document.title = tr("TradeBot | 多 Agent 交易策略操作台", "TradeBot | Multi-Agent Strategy Console");
  document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute(
    "content",
    tr("TradeBot 是可审计、人工参与决策的多 Agent 交易策略操作台。", "TradeBot is an auditable, human-in-the-loop Multi-Agent trading strategy console."),
  );
  document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.setAttribute("content", document.title);
  document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.setAttribute(
    "content",
    tr("从候选市场中选择一个标的，并追踪每个 Agent 决策。", "Select one symbol from the market universe and trace every Agent decision."),
  );

  const view = state.view === "overview"
    ? renderOverview()
    : state.view === "advisor"
      ? renderStrategyAdvisor(strategyPreviewContext())
      : state.view === "strategy-apps"
        ? renderMyStrategyApps(strategyPreviewContext())
        : state.view === "strategy-app-detail"
          ? renderStrategyAppDetail(strategyPreviewContext())
          : state.view === "agent-center"
            ? renderAgentCenter(strategyPreviewContext())
            : state.view === "trade-center"
              ? renderTradeCenter()
              : state.view === "orchestration"
                ? renderOrchestration()
                : state.view === "data-center"
                  ? renderDataCenter()
                  : state.view === "lab"
                    ? renderLab()
                    : state.view === "experiment"
                      ? renderExperiment()
                      : state.view === "activity"
                        ? renderActivity()
                        : renderConnectionSettingsPreview(state.locale, state.connectionPreviewTab);
  app.innerHTML = `
    <!--
    THESIS: One Trading Agent narrows a broad universe to one auditable symbol. It refuses fixed coin tabs and equal-weight dashboard cards.
    OWN-WORLD: Cold graphite planes, hard seams, system sans, mono evidence, and one chartreuse live signal.
    STORY: See the Agent running, understand the one selected symbol, inspect its chain, then act only where human judgment is required.
    FIRST VIEWPORT: A single Agent identity leads into a selection aperture and six-stage chain, with position and human action on the right.
    FORM: Selection Aperture, the sixth grounded structure. Operate mode seed a987072c.
    -->
    <div class="app-shell" id="app-shell">
      <a class="skip-link" href="#main-content">${tr("跳到主要内容", "Skip to main content")}</a>
      ${renderHeader()}
      <div class="mock-banner preview-environment-banner">${tr("模拟环境 · 页面预览不会下单或连接真实交易", "SIMULATION ENVIRONMENT · this preview cannot place live orders")}</div>
      <main class="page-frame" id="main-content" tabindex="-1" data-product-preview="${["trade-center", "orchestration", "agent-center", "connections"].includes(state.view)}">${view}</main>
    </div>
    ${renderCopilot()}
    ${renderPanel()}
    ${renderToast()}
  `;
  window.dispatchEvent(
    new CustomEvent("tradebot:runtime-evidence-remount"),
  );
  window.dispatchEvent(new CustomEvent("tradebot:multi-paper-remount"));
  bindEvents();
  syncOverlayState();
}

function showToast(zh: string, en: string): void {
  state.toast = { zh, en };
  render();
  window.setTimeout(() => {
    state.toast = null;
    render();
  }, 3200);
}

function openPanel(panel: Exclude<PanelId, null>): void {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  overlayReturnFocusSelector = active?.id
    ? `#${CSS.escape(active.id)}`
    : active?.dataset.panel
      ? `[data-panel="${CSS.escape(active.dataset.panel)}"]`
      : null;
  state.copilotOpen = false;
  state.panel = panel;
  render();
  requestAnimationFrame(() => document.querySelector<HTMLElement>(".detail-panel button, .detail-panel input, .detail-panel textarea")?.focus());
}

function openCopilot(html?: string): void {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  overlayReturnFocusSelector = active?.id ? `#${CSS.escape(active.id)}` : "#open-copilot";
  state.panel = null;
  state.copilotOpen = true;
  render();
  if (html) {
    const response = document.querySelector<HTMLDivElement>("#copilot-response");
    if (response) response.innerHTML = html;
  }
  requestAnimationFrame(() => document.querySelector<HTMLElement>(".copilot-drawer button, .copilot-drawer input")?.focus());
}

function closeOverlay(): void {
  const returnFocusSelector = overlayReturnFocusSelector;
  state.panel = null;
  state.copilotOpen = false;
  render();
  requestAnimationFrame(() => {
    if (returnFocusSelector) document.querySelector<HTMLElement>(returnFocusSelector)?.focus();
  });
}

function syncOverlayState(): void {
  const overlayOpen = state.copilotOpen || state.panel !== null;
  document.body.classList.toggle("overlay-open", overlayOpen);
  const shell = document.querySelector<HTMLElement>("#app-shell");
  if (overlayOpen) shell?.setAttribute("inert", "");
  else shell?.removeAttribute("inert");
}

function copilotTask(task: string): void {
  if (task === "thesis") {
    openPanel("thesis");
    return;
  }
  if (task === "proposal") {
    openPanel("proposal");
    return;
  }
  const response = document.querySelector<HTMLDivElement>("#copilot-response");
  if (!response) return;
  if (task === "why") {
    response.innerHTML = `<span>${tr("决策解释", "Decision explanation")}</span><h3>${tr("为什么选择并持有 BTCUSDT？", "Why select and hold BTCUSDT?")}</h3><p>${tr("Selector 在 42 个候选中将 BTCUSDT 排名第 1。由于账户已有该空仓，Position Monitor 优先检查退出条件；本轮没有条件成立，因此决策为继续持有。", "Selector ranked BTCUSDT first among 42 candidates. Because the account already holds this short, Position Monitor checked exit conditions first. None passed, so the decision remained hold.")}</p><button type="button" data-open-review>${tr("打开完整因果复盘", "Open causal review")}</button>`;
  } else if (task === "history") {
    response.innerHTML = `<span>${tr("交易历史", "Trade history")}</span><h3>${tr("找到 1 笔相关开仓与 2 次决策", "Found 1 related entry and 2 decisions")}</h3><p>paper:41 / BTCUSDT SHORT / +${formatUsd(position.pnl)}</p><button type="button" data-open-review>${tr("查看订单证据链", "Inspect order evidence")}</button>`;
  } else if (task === "news") {
    response.innerHTML = `<span>${tr("最新信息草案", "Latest context draft")}</span><h3>${tr("宏观流动性背景已整理", "Macro liquidity context prepared")}</h3><p>${tr("这是 Mock 信息摘要。附加后只会进入候选版本，不会影响当前运行 Agent。", "This is a mock context summary. Attaching it affects only the Candidate, never the running Agent.")}</p><button type="button" data-attach-context>${tr("附加到 Agent 实验室", "Attach to Agent Lab")}</button>`;
  } else {
    response.innerHTML = `<span>${tr("亏损复盘", "Loss review")}</span><h3>${tr("重复问题：成交量确认偏晚", "Recurring issue: late volume confirmation")}</h3><p>${tr("过去 3 笔亏损交易中，入场确认都发生在成交量峰值之后。建议只创建阈值调整候选，不直接修改运行配置。", "In three losing trades, entry confirmation arrived after peak volume. Create a threshold-adjustment Candidate only. Do not modify the running profile.")}</p><button type="button" data-attach-loss>${tr("附加复盘证据", "Attach review evidence")}</button>`;
  }
  bindCopilotResponseEvents();
}

function bindCopilotResponseEvents(): void {
  document.querySelector("[data-open-review]")?.addEventListener("click", () => openPanel("review"));
  document.querySelector("[data-attach-context]")?.addEventListener("click", () => {
    state.workspace.attachedEvidence.push({
      zh: "Mock 宏观背景：流动性收紧可能延长 BTC 下行趋势，有效期 48 小时。",
      en: "Mock macro context: tighter liquidity may extend BTC downside, valid for 48 hours.",
    });
    showToast("信息已附加到候选策略", "Context attached to Candidate");
  });
  document.querySelector("[data-attach-loss]")?.addEventListener("click", () => {
    if (state.workspace.attachedEvidence.length < 2) {
      state.workspace.attachedEvidence.push({
        zh: "亏损复盘建议：提高成交量确认阈值，降低过晚入场概率。",
        en: "Loss review: raise volume confirmation to reduce late entries.",
      });
    }
    showToast("复盘证据已附加", "Review evidence attached");
  });
}

function appendConfigurationActivity(title: LocalizedText, summary: LocalizedText, meta: string): void {
  const timestamp = new Date().toLocaleTimeString(state.locale === "zh-CN" ? "zh-CN" : "en-US", { hour12: false });
  activityEvents.unshift({
    id: `activity-configuration-${Date.now()}`,
    kind: "configuration",
    time: { zh: timestamp, en: timestamp },
    title,
    summary,
    meta,
    status: "review",
  });
}

function bindEvents(): void {
  const agentRequest = async (path: string, init?: RequestInit) => {
    const response = await fetch(`http://127.0.0.1:8787${path}`, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${state.agentCenterToken}`, ...(init?.headers ?? {}) } });
    const body = await response.json() as { data?: unknown; error?: { code: string } }; if (!response.ok) throw new Error(body.error?.code ?? "AGENT_API_FAILED"); return body.data;
  };
  const loadRealAgents = async () => { state.realAgents = await agentRequest(`/api/orchestration/agents?category=${state.agentCenterCategory}`) as AppState["realAgents"]; render(); };
  const key = () => `agent:${crypto.randomUUID()}`;
  const selectRealAgent = async (definitionId: string) => { const selected = await agentRequest(`/api/orchestration/agents/${encodeURIComponent(definitionId)}`) as AppState["selectedRealAgent"]; const history = await agentRequest(`/api/orchestration/agents/${encodeURIComponent(definitionId)}/versions?limit=20`) as AppState["agentVersions"]; state.selectedRealAgent = selected; state.agentVersions = history; render(); };
  document.querySelector<HTMLInputElement>("[data-agent-token]")?.addEventListener("input", (event) => { state.agentCenterToken = (event.currentTarget as HTMLInputElement).value; });
  document.querySelector<HTMLButtonElement>("[data-create-real-agent]")?.addEventListener("click", async () => {
    try { const category = state.agentCenterCategory; const name = document.querySelector<HTMLInputElement>("[data-agent-name]")?.value.trim() ?? `${category} Agent`; const prompt = document.querySelector<HTMLTextAreaElement>("[data-agent-prompt]")?.value.trim() ?? "Explain registered facts."; const input = category === "input" ? { dataRef: "data-source:binance-futures-public:v1", upstreamArtifactSchemaRefs: [], inputSchemaRef: "schema:market-observation-input:v1" } : { upstreamArtifactSchemaRefs: ["artifact-schema:structured-observation:v1"], inputSchemaRef: "schema:analysis-input:v1", ...(category === "analysis" ? { modelRef: "model-connection:deepseek:default" } : {}) }; const created = await agentRequest("/api/orchestration/agents", { method: "POST", body: JSON.stringify({ category, idempotencyKey: key(), payload: { name, templateRef: `agent-template:${category}:v1`, ...input, userInstructionPrompt: prompt, budget: { maxTokens: 1000, maxCalls: 1, timeoutMs: 5000 } } }) }) as { definition: { definitionId: string } }; await loadRealAgents(); await selectRealAgent(created.definition.definitionId); showToast("已创建真实 Agent v1", "Real Agent v1 created"); } catch (error) { showToast("创建失败", error instanceof Error ? error.message : "Creation failed"); }
  });
  document.querySelectorAll<HTMLButtonElement>("[data-real-agent]").forEach((button) => button.addEventListener("click", () => { void selectRealAgent(button.dataset.realAgent ?? "").catch((error) => showToast("读取失败", error instanceof Error ? error.message : "Read failed")); }));
  document.querySelector<HTMLButtonElement>("[data-save-agent-v2]")?.addEventListener("click", async () => {
    try { const selected = state.selectedRealAgent; if (!selected) throw new Error("AGENT_DEFINITION_NOT_SELECTED"); const prompt = document.querySelector<HTMLTextAreaElement>("[data-agent-prompt]")?.value.trim(); if (!prompt) throw new Error("USER_PROMPT_REQUIRED"); const payload = { ...selected.version.payload, userInstructionPrompt: prompt }; await agentRequest(`/api/orchestration/agents/${encodeURIComponent(selected.definition.definitionId)}/versions`, { method: "POST", body: JSON.stringify({ parentVersionId: selected.version.versionId, parentFingerprint: selected.version.fingerprint, idempotencyKey: key(), payload }) }); await loadRealAgents(); await selectRealAgent(selected.definition.definitionId); showToast("已创建不可变 v2", "Immutable v2 created"); } catch (error) { showToast("保存失败", error instanceof Error ? error.message : "Save failed"); }
  });
  const governance = async (action: "validate" | "publish" | "archive") => { const selected = state.selectedRealAgent; if (!selected) throw new Error("AGENT_DEFINITION_NOT_SELECTED"); await agentRequest(`/api/orchestration/agents/${encodeURIComponent(selected.definition.definitionId)}/${action}`, { method: "POST", body: JSON.stringify({ versionId: selected.version.versionId, fingerprint: selected.version.fingerprint }) }); await loadRealAgents(); await selectRealAgent(selected.definition.definitionId); };
  (["validate", "publish", "archive"] as const).forEach((action) => document.querySelector<HTMLButtonElement>(`[data-agent-${action}]`)?.addEventListener("click", () => void governance(action).then(() => showToast("治理状态已更新", "Lifecycle updated")).catch((error) => showToast("操作被拒绝", error instanceof Error ? error.message : "Rejected"))));
  document.querySelector<HTMLButtonElement>("[data-agent-clone]")?.addEventListener("click", () => { const selected = state.selectedRealAgent; if (!selected) return; void agentRequest(`/api/orchestration/agents/${encodeURIComponent(selected.definition.definitionId)}/clone`, { method: "POST", body: JSON.stringify({ versionId: selected.version.versionId, fingerprint: selected.version.fingerprint, idempotencyKey: key() }) }).then((created) => { const item = created as { definition: { definitionId: string } }; return loadRealAgents().then(() => selectRealAgent(item.definition.definitionId)); }).then(() => showToast("已克隆独立 Definition", "Independent Definition cloned")).catch((error) => showToast("克隆失败", error instanceof Error ? error.message : "Clone failed")); });
  document.querySelector<HTMLButtonElement>("[data-agent-diff]")?.addEventListener("click", () => { const selected = state.selectedRealAgent; const versions = state.agentVersions; if (!selected || versions.length < 2) return; void agentRequest(`/api/orchestration/agents/${encodeURIComponent(selected.definition.definitionId)}/diff?leftVersionId=${encodeURIComponent(versions.at(-1)!.versionId)}&rightVersionId=${encodeURIComponent(versions[0]!.versionId)}`).then((value) => { const target = document.querySelector<HTMLElement>("[data-agent-result]"); if (target) target.textContent = `Server Diff: ${JSON.stringify(value)}`; }).catch((error) => showToast("Diff 失败", error instanceof Error ? error.message : "Diff failed")); });
  document.querySelector<HTMLButtonElement>("[data-agent-test]")?.addEventListener("click", () => { const selected = state.selectedRealAgent; if (!selected) return; const fixture: Record<AgentCategory, string> = { input: "fixture:market-observation:v1", analysis: "fixture:analysis-assessment:v1", decision: "fixture:decision-assessment:v1", reflection: "fixture:reflection-assessment:v1" }; void agentRequest(`/api/orchestration/agents/${encodeURIComponent(selected.definition.definitionId)}/test`, { method: "POST", body: JSON.stringify({ versionId: selected.version.versionId, fingerprint: selected.version.fingerprint, fixtureRef: fixture[selected.definition.category] }) }).then((value) => { const target = document.querySelector<HTMLElement>("[data-agent-result]"); if (target) target.textContent = `Evidence: ${JSON.stringify(value)}`; }).catch((error) => showToast("测试被拒绝", error instanceof Error ? error.message : "Test rejected")); });
  document.querySelector("#toggle-language")?.addEventListener("click", () => {
    state.locale = state.locale === "zh-CN" ? "en" : "zh-CN";
    try { localStorage.setItem(localeStorageKey, state.locale); } catch { /* no-op */ }
    render();
  });

  document.querySelectorAll<HTMLElement>("[data-view]").forEach((element) => {
    element.addEventListener("click", () => {
      state.view = element.dataset.view as ViewId;
      window.history.replaceState(null, "", `#${state.view}`);
      state.panel = null;
      state.copilotOpen = false;
      render();
      if (state.view === "agent-center" && state.agentCenterToken) {
        fetch(`http://127.0.0.1:8787/api/orchestration/agents?category=${state.agentCenterCategory}`, { headers: { authorization: `Bearer ${state.agentCenterToken}` } })
          .then((response) => response.json()).then((body: { data?: AppState["realAgents"] }) => { if (body.data) { state.realAgents = body.data; render(); } }).catch(() => undefined);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-preview-scenario]").forEach((button) => {
    button.addEventListener("click", () => {
      const scenarioId = button.dataset.previewScenario ?? "hk-low-risk";
      const initialProposalByScenario: Record<string, string> = {
        "hk-low-risk": "hk-quality-trend",
        "us-earnings": "us-earnings-event",
        "crypto-trend": "crypto-trend-guard",
      };
      state.strategyPreview = selectPreviewScenario(
        state.strategyPreview,
        scenarioId,
        initialProposalByScenario[scenarioId] ?? "hk-quality-trend",
      );
      state.workbenchDraft = "";
      render();
    });
  });

  document.querySelector<HTMLButtonElement>("[data-preview-adjust]")?.addEventListener("click", () => {
    document.querySelector<HTMLButtonElement>("[data-preview-scenario]")?.focus();
  });

  document.querySelector<HTMLButtonElement>("[data-preview-recommend]")?.addEventListener("click", () => {
    const prompt = document.querySelector<HTMLTextAreaElement>("[data-workbench-prompt]")?.value.trim() ?? "";
    if (!prompt) {
      showToast("请先描述策略目标", "Describe the strategy goal first");
      document.querySelector<HTMLTextAreaElement>("[data-workbench-prompt]")?.focus();
      return;
    }
    const scenarioId = inferWorkbenchScenarioId(prompt);
    const proposalByScenario: Record<string, string> = {
      "hk-low-risk": "hk-quality-trend",
      "us-earnings": "us-earnings-event",
      "crypto-trend": "crypto-trend-guard",
    };
    state.strategyPreview = appendWorkbenchExchange(state.strategyPreview, {
      scenarioId,
      proposalId: proposalByScenario[scenarioId] ?? "hk-quality-trend",
      prompt,
    });
    state.workbenchDraft = prompt;
    render();
    window.requestAnimationFrame(() => document.querySelector(".workbench-thread")?.scrollTo({ top: 100_000, behavior: "smooth" }));
    showToast("已在对话中生成新的动态编排方案", "A new dynamic plan was generated in the conversation");
  });

  document.querySelectorAll<HTMLButtonElement>("[data-simulation-dialogue]").forEach((button) => {
    button.addEventListener("click", () => {
      state.simulationDialogueId = button.dataset.simulationDialogue ?? "hk-quality-trend";
      render();
      document.querySelector(".simulation-dialogue")?.scrollIntoView({ block: "start" });
    });
  });

  document.querySelector<HTMLButtonElement>("[data-preview-validation]")?.addEventListener("click", () => {
    showToast("预上线检查与回测将在下一阶段接入", "Preflight and backtest checks will be connected in the next stage");
  });

  document.querySelectorAll<HTMLButtonElement>("[data-preview-proposal]").forEach((button) => {
    button.addEventListener("click", () => {
      state.strategyPreview = selectPreviewProposal(state.strategyPreview, button.dataset.previewProposal ?? "hk-quality-trend");
      state.strategyDetailTarget = "proposal";
      state.strategyDetailTab = "overview";
      state.view = "strategy-app-detail";
      window.history.replaceState(null, "", "#strategy-app-detail");
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-preview-app]").forEach((button) => {
    button.addEventListener("click", () => {
      state.strategyPreview = selectPreviewApp(state.strategyPreview, button.dataset.previewApp ?? state.strategyPreview.selectedAppId);
      state.strategyDetailTarget = "app";
      state.strategyDetailTab = "overview";
      state.view = "strategy-app-detail";
      window.history.replaceState(null, "", "#strategy-app-detail");
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-strategy-status]").forEach((button) => {
    button.addEventListener("click", () => {
      state.strategyAppFilter = (button.dataset.strategyStatus ?? "all") as AppState["strategyAppFilter"];
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-strategy-detail-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.strategyDetailTab = (button.dataset.strategyDetailTab ?? "overview") as StrategyDetailTab;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-preview-experiment]").forEach((button) => {
    button.addEventListener("click", () => {
      const app = state.strategyPreview.apps.find((item) => item.id === button.dataset.previewExperiment);
      state.experimentHandoffAppName = app?.name;
      state.view = "experiment";
      window.history.replaceState(null, "", "#experiment");
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-agent-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.agentCenterCategory = (button.dataset.agentCategory ?? "input") as AgentCategory;
      const firstAgentByCategory: Record<AgentCategory, string> = {
        input: "market-input",
        analysis: "quality-analysis",
        decision: "decision-synthesis",
        reflection: "reflection-agent",
      };
      state.selectedPreviewAgentId = firstAgentByCategory[state.agentCenterCategory];
      state.agentCenterSearch = "";
      state.selectedRealAgent = undefined; state.agentVersions = [];
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-preview-agent]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPreviewAgentId = button.dataset.previewAgent ?? "market-input";
      render();
    });
  });

  document.querySelector<HTMLInputElement>("#agent-center-search")?.addEventListener("input", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    state.agentCenterSearch = input.value;
    const query = input.value.trim().toLowerCase();
    document.querySelectorAll<HTMLElement>(".preview-agent-card").forEach((card) => {
      card.hidden = Boolean(query) && !card.textContent?.toLowerCase().includes(query);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-connection-preview-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.connectionPreviewTab = (button.dataset.connectionPreviewTab ?? "data") as ConnectionPreviewTab;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-connection-section]").forEach((button) => {
    button.addEventListener("click", () => {
      state.connections.section = button.dataset.connectionSection as ConnectionSection;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-provider]").forEach((button) => {
    button.addEventListener("click", () => {
      state.connections.provider = button.dataset.provider as ProviderId;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-orchestration-template]").forEach((button) => {
    button.addEventListener("click", () => {
      state.orchestrationTemplate = button.dataset.orchestrationTemplate as PipelineTemplateId;
      const template = selectedPipelineTemplate();
      state.orchestrationNodeId = template.id === "current" ? "data-sync" : template.nodes[0]!.id;
      state.orchestrationValidation = "passed";
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-orchestration-node]").forEach((button) => {
    button.addEventListener("click", () => {
      state.orchestrationNodeId = button.dataset.orchestrationNode ?? "data-sync";
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-validation-preview]").forEach((button) => {
    button.addEventListener("click", () => {
      state.orchestrationValidation = button.dataset.validationPreview as ValidationPreview;
      render();
    });
  });

  const createOrchestrationDraft = () => {
    state.orchestrationDraftCreated = true;
    state.orchestrationTemplate = "current";
    state.orchestrationNodeId = "draft-context";
    state.orchestrationValidation = "passed";
    showToast("结构化 Draft 已创建，Runtime 未修改", "Structured Draft created. Runtime unchanged");
  };
  document.querySelector("#create-orchestration-draft")?.addEventListener("click", createOrchestrationDraft);
  document.querySelector("#create-direct-edit-draft")?.addEventListener("click", createOrchestrationDraft);
  document.querySelector<HTMLFormElement>("#orchestration-copilot-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    createOrchestrationDraft();
  });

  document.querySelector("#discover-models")?.addEventListener("click", () => {
    showToast(
      "模型目录必须由后端代理读取，当前不从浏览器直接请求",
      "Model discovery requires a backend proxy and is not called directly from the browser",
    );
  });

  document.querySelector<HTMLFormElement>("#llm-connection-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const provider = selectedProvider();
    const scopes = formData.getAll("scope").map(String);
    state.connections.llm = {
      provider: provider.id,
      model: String(formData.get("model") ?? "").trim(),
      baseUrl: String(formData.get("baseUrl") ?? "").trim(),
      authorizedScopes: scopes,
      validatedAt: new Date().toISOString(),
    };
    appendConfigurationActivity(
      { zh: `${provider.name} 配置草案已验证`, en: `${provider.name} configuration draft validated` },
      {
        zh: `记录模型与 ${scopes.length} 个智能体授权范围。API 密钥未写入浏览器状态或审计。`,
        en: `Recorded the model and ${scopes.length} Agent scopes. The API key was not written to browser state or audit.`,
      },
      `provider:${provider.id} / model:${state.connections.llm.model || "unset"} / secret:redacted`,
    );
    showToast(
      provider.runtimeReady ? "配置草案已验证，密钥未保留" : "配置契约已保存，仍需运行时适配器",
      provider.runtimeReady ? "Draft validated. Secret was not retained" : "Configuration contract saved. Runtime adapter still required",
    );
  });

  document.querySelector<HTMLFormElement>("#exchange-connection-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    state.connections.exchange = {
      exchange: "binance-futures",
      environment: formData.get("environment") === "live" ? "live" : "testnet",
      accountLabel: String(formData.get("accountLabel") ?? "").trim(),
      accountId: String(formData.get("accountId") ?? "").trim(),
      validatedAt: new Date().toISOString(),
    };
    appendConfigurationActivity(
      { zh: "Binance Futures 只读连接草案已验证", en: "Binance Futures read-only draft validated" },
      {
        zh: "记录账户标签、环境与只读能力。API 密钥和私钥未进入浏览器状态或审计。",
        en: "Recorded account label, environment, and read-only capability. API key and secret were not written to browser state or audit.",
      },
      `exchange:binance-futures / environment:${state.connections.exchange.environment} / permission:read-only / secret:redacted`,
    );
    showToast("只读账户草案已验证，密钥未保留", "Read-only account draft validated. Secrets were not retained");
  });

  document.querySelector("#open-copilot")?.addEventListener("click", () => openCopilot());
  document.querySelector("#close-copilot")?.addEventListener("click", closeOverlay);
  document.querySelector("[data-close-copilot]")?.addEventListener("click", closeOverlay);
  document.querySelectorAll("[data-close-panel]").forEach((element) => element.addEventListener("click", closeOverlay));

  document.querySelectorAll<HTMLButtonElement>("[data-capability]").forEach((button) => {
    button.addEventListener("click", () => {
      state.capabilityId = button.dataset.capability as CapabilityId;
      openPanel("capability");
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-candidate]").forEach((button) => {
    button.addEventListener("click", () => {
      state.candidateSymbol = button.dataset.candidate ?? "BTCUSDT";
      openPanel("candidate");
    });
  });

  document.querySelector("#view-universe")?.addEventListener("click", () => openPanel("universe"));
  document.querySelector("#view-more-candidates")?.addEventListener("click", () => openPanel("universe"));
  document.querySelector("#review-position")?.addEventListener("click", () => openPanel("review"));
  document.querySelector("#ask-why")?.addEventListener("click", () => {
    openCopilot();
    copilotTask("why");
  });
  document.querySelector("#pause-openings")?.addEventListener("click", () => openPanel("pause"));
  document.querySelector("[data-open-pause]")?.addEventListener("click", () => openPanel("pause"));
  document.querySelector("#confirm-pause")?.addEventListener("click", () => {
    const action = runtimeDashboard.canResume
      ? "resume-normal"
      : "close-only";
    window.dispatchEvent(
      new CustomEvent("tradebot:runtime-action-request", {
        detail: { action },
      }),
    );
    state.panel = null;
    showToast(
      action === "close-only" ? "暂停请求已提交" : "恢复请求已提交",
      action === "close-only" ? "Pause request submitted" : "Resume request submitted",
    );
  });

  document.querySelector("#lab-open-copilot")?.addEventListener("click", () => openCopilot(`<span>${tr("候选材料", "Candidate evidence")}</span><p>${tr("可以从交易历史、亏损复盘和最新市场信息中准备证据，但不会自动修改参数。", "Evidence can be prepared from trade history, loss reviews, and current context, but parameters will not be changed automatically.")}</p>`));
  document.querySelector("#activity-ask")?.addEventListener("click", () => openCopilot(`<span>${tr("审计查询", "Audit query")}</span><p>${tr("输入订单、标的或 Trace 编号，我会查询 Mock Journal、Review 与 Artifact Ledger。", "Enter an order, symbol, or trace. I will query the mock Journal, Review, and Artifact Ledger.")}</p>`));
  document.querySelector("#edit-proposal")?.addEventListener("click", () => openPanel("proposal"));
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((element) => element.addEventListener("click", () => openPanel(element.dataset.panel as Exclude<PanelId, null>)));

  document.querySelectorAll<HTMLButtonElement>("[data-copilot-task]").forEach((button) => {
    button.addEventListener("click", () => copilotTask(button.dataset.copilotTask ?? ""));
  });

  document.querySelector<HTMLFormElement>("#copilot-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#copilot-input");
    const response = document.querySelector<HTMLDivElement>("#copilot-response");
    if (!input || !response) return;
    response.innerHTML = `<span>${tr("只读查询结果", "Read-only query result")}</span><h3>${escapeHtml(input.value)}</h3><p>${tr("已在 Mock Journal、Trade Review 和 Artifact Ledger 中找到 3 条相关记录。查询不会触发订单或策略变更。", "Found three related records in the mock Journal, Trade Review, and Artifact Ledger. The query cannot trigger an order or strategy change.")}</p>`;
    input.value = "";
  });

  document.querySelector<HTMLFormElement>("#thesis-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    state.workspace.thesis = {
      marketView: String(formData.get("marketView") ?? ""),
      symbols: String(formData.get("symbols") ?? ""),
      validUntil: String(formData.get("validUntil") ?? ""),
      confidence: Number(formData.get("confidence") ?? 0),
      bias: String(formData.get("bias") ?? ""),
      riskConstraint: String(formData.get("riskConstraint") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      createdAt: new Date().toISOString(),
    };
    state.panel = null;
    state.view = "lab";
    showToast("人工市场观点草案已保存", "Human Market Thesis draft saved");
  });

  document.querySelector<HTMLFormElement>("#proposal-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    state.workspace.proposal = {
      minimumConfidence: Number(formData.get("minimumConfidence") ?? 68),
      maxLeverage: Number(formData.get("maxLeverage") ?? 1.25),
      maxPositions: 1,
      perTradeNotional: Number(formData.get("perTradeNotional") ?? 850),
      maxHoldingHours: Number(formData.get("maxHoldingHours") ?? 36),
      reason: String(formData.get("reason") ?? ""),
      createdAt: new Date().toISOString(),
    };
    state.workspace.stage = 0;
    state.workspace.approvalRequested = false;
    state.workspace.approvalApproved = false;
    state.workspace.paperReleased = false;
    state.panel = null;
    state.view = "lab";
    showToast("候选策略提案已创建，必须先回测", "Candidate created. Backtest is required");
  });

  document.querySelector("#run-backtest")?.addEventListener("click", () => {
    state.workspace.backtestRunning = true;
    render();
    window.setTimeout(() => {
      state.workspace.backtestRunning = false;
      state.workspace.stage = 2;
      showToast("Mock 回测已完成", "Mock backtest completed");
    }, 700);
  });
  document.querySelector("#run-walk-forward")?.addEventListener("click", () => {
    state.workspace.stage = 3;
    state.workspace.approvalRequested = false;
    state.workspace.approvalApproved = false;
    state.workspace.paperReleased = false;
    showToast("Mock 样本外验证已完成", "Mock Walk-Forward completed");
  });
  document.querySelector("#request-approval")?.addEventListener("click", () => {
    state.workspace.approvalRequested = true;
    showToast("候选策略正在等待人工审批", "Candidate is awaiting human approval");
  });
  document.querySelector("#approve-candidate")?.addEventListener("click", () => {
    state.workspace.approvalApproved = true;
    showToast("人工审批证据已记录，尚未发布", "Human approval recorded. Not released yet");
  });
  document.querySelector("#deploy-paper")?.addEventListener("click", () => {
    state.workspace.paperReleased = true;
    showToast("候选策略已发布到模拟运行", "Candidate released to Paper");
  });

  document.querySelectorAll<HTMLButtonElement>("[data-activity-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activityFilter = button.dataset.activityFilter as AppState["activityFilter"];
      render();
      applyActivityFilter("");
    });
  });
  document.querySelector<HTMLInputElement>("#activity-search")?.addEventListener("input", (event) => {
    applyActivityFilter((event.currentTarget as HTMLInputElement).value);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-activity]").forEach((button) => button.addEventListener("click", () => openPanel(button.dataset.kind === "selection" ? "universe" : "review")));
}

window.addEventListener("tradebot:data-center-send", ((event: Event) => {
  const asset = (event as CustomEvent<unknown>).detail;
  state.view = "orchestration";
  window.history.replaceState(null, "", "#orchestration");
  render();
  window.setTimeout(() => window.dispatchEvent(new CustomEvent("tradebot:orchestration-data-intent", { detail: asset })), 0);
}) as EventListener);

function applyActivityFilter(query: string): void {
  const normalized = query.trim().toLowerCase();
  let visible = 0;
  document.querySelectorAll<HTMLElement>(".activity-list .activity-row").forEach((row) => {
    const matchesKind = state.activityFilter === "all" || row.dataset.kind === state.activityFilter;
    const matchesQuery = !normalized || (row.dataset.search ?? "").includes(normalized);
    row.hidden = !(matchesKind && matchesQuery);
    if (!row.hidden) visible += 1;
  });
  const empty = document.querySelector<HTMLElement>("#activity-empty");
  if (empty) empty.hidden = visible > 0;
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && (state.copilotOpen || state.panel)) {
    closeOverlay();
  }
});

window.addEventListener("hashchange", () => {
  const nextView = initialView();
  if (nextView === state.view) return;
  state.view = nextView;
  state.panel = null;
  state.copilotOpen = false;
  render();
});

// Delegated once so a Prototype action remains bound across every page-memory
// render without introducing storage, a Runtime call, or a persistent worker.
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>("[data-preview-create]");
  if (!button) return;
  const proposal = proposalById(button.dataset.previewCreate ?? "hk-quality-trend");
  state.strategyPreview = createPrototypeStrategyApp(state.strategyPreview, proposal);
  state.strategyDetailTarget = "app";
  state.strategyDetailTab = "overview";
  state.view = "orchestration";
  window.history.replaceState(null, "", "#orchestration");
  showToast("多 Agent 策略方案已生成，可放入模拟槽位", "Multi-Agent strategy generated and ready for a simulation slot");
});

render();
