import "./runtime-control.css";
import "./release-guide.css";
import {
  deriveRuntimeControlState,
  type RuntimeControlUiState,
} from "./runtime-control-state.js";
import {
  createRuntimeDashboardSnapshot,
  createRuntimeOperationKeys,
  partitionRuntimeRun,
  rotateRuntimeOperationKey,
  type RuntimeOperationKey,
} from "./runtime-operation-session.js";
import {
  deriveReleaseGuideState,
  type ReleaseGateId,
} from "./release-guide-state.js";
import {
  deriveRecoveredPromotionState,
  parseReleaseSessionRefs,
  RELEASE_SESSION_STORAGE_KEY,
  releaseReferenceChainMatches,
  serializeReleaseSessionRefs,
} from "./release-session-state.js";

type Locale = "zh" | "en";
type ConnectionMode = "connecting" | "live" | "readonly" | "offline";

interface CatalogResponse {
  pipelineGraphs: unknown[];
  marketPacks: unknown[];
  dataSources: unknown[];
  capabilities: unknown[];
  agentTemplates: unknown[];
  runtimeMutationAllowed: false;
}

interface DraftResponse {
  draftId: string;
  promotionStage: string;
  runtimeApplied: false;
}

interface CompileResponse {
  steps: unknown[];
  runtimeApplied: false;
}

interface SessionResponse {
  actor: {
    actorId: string;
    displayName: string;
    roles: string[];
  };
}

interface EvidenceJobResponse {
  jobId: string;
  kind: "backtest" | "walk_forward";
  status: "queued" | "running" | "succeeded" | "failed";
  failureCode?: string;
  evidence?: {
    evidenceId: string;
    artifactSha256?: string;
    lineage?: {
      runnerId: string;
      dataSourceRef: string;
      dataFingerprint: string;
      manifestSha256: string;
    };
  };
}

interface ApprovedPaperPlanResponse {
  planId: string;
  draftId: string;
  lifecycleStatus: "approved_ready";
  fingerprint: string;
  runtimeApplied: false;
}

interface PaperActivationResponse {
  activationId: string;
  status: "activated_not_applied";
  runtimeApplied: false;
}

interface PaperControlResponse {
  controlId: string;
  mode: "normal" | "pause_new_openings_close_only";
  controlPlaneRecorded: true;
  runtimeApplied: false;
}

interface PaperRuntimeRunResponse {
  runId: string;
  planId: string;
  status:
    | "queued"
    | "running"
    | "stop_requested"
    | "drained"
    | "orphaned"
    | "completed"
    | "failed"
    | "safety_blocked";
  plannedCycles: number;
  processedCycles: number;
  continuous?: boolean;
  cadence?: PaperRuntimeCadence;
  lastControlMode: "normal" | "pause_new_openings_close_only";
  lastControlApplied: boolean;
  failureCode?: string;
  paperRuntimeApplied: boolean;
  exchangeWriteAllowed: false;
}

type PaperRuntimeCadence =
  | "1m"
  | "5m"
  | "10m"
  | "15m"
  | "30m"
  | "1h"
  | "3h"
  | "5h";

const paperRuntimeCadences: readonly PaperRuntimeCadence[] = [
  "1m",
  "5m",
  "10m",
  "15m",
  "30m",
  "1h",
  "3h",
  "5h",
];

let selectedPaperRuntimeCadence: PaperRuntimeCadence = "1m";

function cadenceLabel(cadence: PaperRuntimeCadence): string {
  const labels: Record<PaperRuntimeCadence, [string, string]> = {
    "1m": ["1 分钟", "1 minute"],
    "5m": ["5 分钟", "5 minutes"],
    "10m": ["10 分钟", "10 minutes"],
    "15m": ["15 分钟", "15 minutes"],
    "30m": ["30 分钟", "30 minutes"],
    "1h": ["1 小时", "1 hour"],
    "3h": ["3 小时", "3 hours"],
    "5h": ["5 小时", "5 hours"],
  };
  return labels[cadence][locale() === "zh" ? 0 : 1];
}

interface ApiEnvelope<T> {
  data: T;
}

interface PaperRuntimePreflightResponse {
  reportId: string;
  fingerprint: string;
  status: "passed" | "failed";
  createdAt: string;
  expiresAt: string;
  checks: Array<{
    checkId: string;
    status: "passed" | "failed";
    code: string;
  }>;
  paperAccountMutationAllowed: false;
  exchangeWriteAllowed: false;
}

interface PaperRuntimeLeaseResponse {
  ownerId: string;
  fencingToken: number;
  status: "active" | "released" | "lost" | "orphaned";
  heartbeatAt: string;
  expiresAt: string;
}

interface PaperRuntimeStopResponse {
  stopId: string;
  status: "requested" | "drained";
  requestedAt: string;
  currentCycleMayComplete: true;
  futureCyclesAllowed: false;
  exchangeWriteAllowed: false;
}

interface PaperRuntimeLaunchContextResponse {
  schemaVersion: "1.0.0";
  generatedAt: string;
  launchState:
    | "release_required"
    | "preflight_required"
    | "ready"
    | "running"
    | "only_close"
    | "draining"
    | "blocked";
  preset: {
    presetId: string;
    humanVersion: string;
    availability: "available" | "unavailable";
    fixture: true;
    graphId: string;
    observationWindows: string[];
  };
  plan?: ApprovedPaperPlanResponse;
  activation?: PaperActivationResponse;
  control?: PaperControlResponse;
  preflight?: PaperRuntimePreflightResponse;
  run?: PaperRuntimeRunResponse;
  blockerCode?: string;
  paperOnly: true;
  runtimeApplied: false;
  exchangeWriteAllowed: false;
  clientRuntimeParametersAccepted: false;
}

interface PaperRuntimeOperationalEventResponse {
  eventId: string;
  sequence: number;
  eventType: string;
  severity: "info" | "warning" | "critical";
  occurredAt: string;
  outboxStatus: "pending";
  deliveryConfigured: false;
  exchangeWriteAllowed: false;
}

interface PaperRuntimeIncidentResponse {
  incidentId: string;
  incidentType: string;
  severity: "warning" | "critical";
  status: "open" | "acknowledged" | "cleared";
  acknowledgedByDisplayName?: string;
  exchangeWriteAllowed: false;
}

interface PaperRuntimeOrphanClearanceResponse {
  clearanceId: string;
  runStatusAfter: "orphaned";
  runtimeResumed: false;
  executionTriggered: false;
  paperAccountMutated: false;
  exchangeWriteAllowed: false;
}

interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

interface TradeBotViteEnvironment {
  readonly DEV?: boolean;
  readonly VITE_TRADEBOT_ORCHESTRATION_API?: string;
  readonly VITE_TRADEBOT_ORCHESTRATION_TOKEN?: string;
  readonly VITE_TRADEBOT_MARKET_DATA_LABEL?: string;
  readonly VITE_TRADEBOT_EVIDENCE_DATA_LABEL?: string;
}

const viteApiBase = import.meta.env.VITE_TRADEBOT_ORCHESTRATION_API;
const viteMarketDataLabel = import.meta.env.VITE_TRADEBOT_MARKET_DATA_LABEL;
const viteEvidenceDataLabel = import.meta.env.VITE_TRADEBOT_EVIDENCE_DATA_LABEL;
const developmentOperatorToken = import.meta.env.DEV
  ? import.meta.env.VITE_TRADEBOT_ORCHESTRATION_TOKEN
  : undefined;
const configuredApiBase =
  (
    globalThis as typeof globalThis & {
      __TRADEBOT_ORCHESTRATION_API__?: string;
    }
  ).__TRADEBOT_ORCHESTRATION_API__ ??
  viteApiBase ??
  "http://127.0.0.1:8787";
const configuredToken =
  (
    globalThis as typeof globalThis & {
      __TRADEBOT_ORCHESTRATION_TOKEN__?: string;
    }
  ).__TRADEBOT_ORCHESTRATION_TOKEN__ ??
  developmentOperatorToken;
const configuredMarketDataLabel =
  viteMarketDataLabel ??
  "SERVER CONFIGURED";
const configuredEvidenceDataLabel =
  viteEvidenceDataLabel ??
  (configuredMarketDataLabel === "LOCAL BACKEND FIXTURE" ||
  configuredMarketDataLabel === "BINANCE FUTURES PUBLIC READ ONLY"
    ? "CSV SYNTHETIC FIXTURE"
    : "SERVER REGISTERED EVIDENCE");

const state: {
  mode: ConnectionMode;
  catalog?: CatalogResponse;
  draft?: DraftResponse;
  validationValid?: boolean;
  compiledSteps?: number;
  token?: string;
  actorDisplayName?: string;
  backtestStatus?: string;
  walkForwardStatus?: string;
  approvalId?: string;
  artifactSha256?: string;
  artifactLineage?: string;
  paperPlan?: ApprovedPaperPlanResponse;
  paperActivation?: PaperActivationResponse;
  paperControl?: PaperControlResponse;
  paperRun?: PaperRuntimeRunResponse;
  paperLastRun?: PaperRuntimeRunResponse;
  paperPreflight?: PaperRuntimePreflightResponse;
  paperLease?: PaperRuntimeLeaseResponse;
  paperStop?: PaperRuntimeStopResponse;
  paperEvents: PaperRuntimeOperationalEventResponse[];
  paperIncidents: PaperRuntimeIncidentResponse[];
  paperClearance?: PaperRuntimeOrphanClearanceResponse;
  paperLaunchPresetAvailable: boolean;
  restoreCode?:
    | "RELEASE_SESSION_RESTORED"
    | "RELEASE_SESSION_REFERENCE_STALE"
    | "RELEASE_SESSION_REFERENCE_INVALID";
  jobKeys: {
    backtest: string;
    walkForward: string;
  };
  paperKeys: {
    plan: string;
    activation: string;
    control: string;
    run: string;
    preflight: string;
    stop: string;
    acknowledgement: string;
    clearance: string;
  };
  errorCode?: string;
  busy: boolean;
} = {
  mode: "connecting",
  paperLaunchPresetAvailable: false,
  token: configuredToken,
  jobKeys: {
    backtest: crypto.randomUUID(),
    walkForward: crypto.randomUUID(),
  },
  paperKeys: createRuntimeOperationKeys(),
  paperEvents: [],
  paperIncidents: [],
  busy: false,
};

function locale(): Locale {
  return document.documentElement.lang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

const copy = {
  zh: {
    title: "运行时连接",
    live: "LOCAL API",
    offline: "OFFLINE MOCK",
    readonly: "AUTH REQUIRED",
    connecting: "CONNECTING",
    liveBody: "Catalog 与 Graph 来自本机受控 API；Draft 不会自动应用到 Runtime。",
    offlineBody: "API 不可用。画布仍可浏览，但保存、验证和编译已禁用。",
    readonlyBody: "Catalog 已连接。输入启动时生成的临时 token 后才能执行受控操作。",
    tokenPlaceholder: "临时 operator token",
    authenticate: "验证身份",
    retry: "重试连接",
    save: "保存当前 Graph 草案",
    validate: "合同验证",
    compile: "编译执行计划",
    graphReady: "当前固定 Crypto Graph 已从 Registry 载入",
    noGraph: "Catalog 未提供可保存的 Graph Manifest",
    draft: "草案",
    valid: "验证通过",
    invalid: "验证失败",
    compiled: "计划节点",
    backtest: "运行 Backtest Job",
    walkForward: "运行 Walk-Forward Job",
    approve: "人工批准",
    createPaperPlan: "生成 Approved Paper Plan",
    activatePaperPlan: "显式激活计划",
    closeOnly: "暂停新开仓 / 仅允许平仓",
    resumeNormal: "恢复普通 Paper 周期",
    startPaperRun: "启动有界 Paper Run",
    runPreflight: "运行 Paper Preflight",
    stopPaperRun: "当前周期后停止",
    preflightStatus: "Preflight",
    leaseStatus: "租约 / Fencing",
    stopStatus: "停止 / Drain",
    acknowledgeIncident: "确认 Runtime Incident",
    clearOrphan: "清除 Orphan 人工处置状态",
    eventTimeline: "运行事件",
    externalDeliveryOff: "外部通知未配置",
    runtimeNotApplied: "未接管 Runtime",
    actor: "操作者",
    restore: {
      RELEASE_SESSION_RESTORED:
        "已从服务端恢复发布会话；Preflight 必须重新执行",
      RELEASE_SESSION_REFERENCE_STALE:
        "保存的发布引用已失效并清除",
      RELEASE_SESSION_REFERENCE_INVALID:
        "浏览器发布引用合同无效并清除",
    },
  },
  en: {
    title: "Runtime connection",
    live: "LOCAL API",
    offline: "OFFLINE MOCK",
    readonly: "AUTH REQUIRED",
    connecting: "CONNECTING",
    liveBody:
      "Catalog and Graph come from the controlled local API. Drafts never auto-apply to Runtime.",
    offlineBody:
      "API unavailable. The canvas remains browsable; save, validation, and compile are disabled.",
    readonlyBody:
      "Catalog connected. Enter the ephemeral startup token to enable controlled operations.",
    tokenPlaceholder: "Ephemeral operator token",
    authenticate: "Authenticate",
    retry: "Retry connection",
    save: "Save current Graph draft",
    validate: "Contract validation",
    compile: "Compile execution plan",
    graphReady: "Current fixed Crypto Graph loaded from Registry",
    noGraph: "Catalog did not provide a savable Graph Manifest",
    draft: "Draft",
    valid: "Validation passed",
    invalid: "Validation failed",
    compiled: "Plan nodes",
    backtest: "Run Backtest job",
    walkForward: "Run Walk-Forward job",
    approve: "Human approval",
    createPaperPlan: "Create Approved Paper Plan",
    activatePaperPlan: "Explicitly activate plan",
    closeOnly: "Pause new openings / close only",
    resumeNormal: "Resume normal Paper cycles",
    startPaperRun: "Start bounded Paper Run",
    runPreflight: "Run Paper preflight",
    stopPaperRun: "Stop after current cycle",
    preflightStatus: "Preflight",
    leaseStatus: "Lease / fencing",
    stopStatus: "Stop / drain",
    acknowledgeIncident: "Acknowledge runtime incident",
    clearOrphan: "Clear orphan operator hold",
    eventTimeline: "Runtime events",
    externalDeliveryOff: "External delivery not configured",
    runtimeNotApplied: "Runtime not applied",
    actor: "Operator",
    restore: {
      RELEASE_SESSION_RESTORED:
        "Release session restored from the server; Preflight must run again",
      RELEASE_SESSION_REFERENCE_STALE:
        "Stale release references were cleared",
      RELEASE_SESSION_REFERENCE_INVALID:
        "Invalid browser release references were cleared",
    },
  },
} as const;

function orchestrationRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    "[data-orchestration-root], .orchestration-workspace, .orchestration-shell, .orchestration-view, .orchestration-grid, .orchestration-layout",
  );
}

const runtimeControlCopy = {
  zh: {
    eyebrow: "Paper Runtime 控制",
    title: "交易运行实例",
    connection: "API",
    plan: "策略计划",
    run: "运行实例",
    cycle: "周期",
    heartbeat: "心跳",
    marketData: "运行行情",
    exchange: "交易所写入",
    exchangeOff: "关闭",
    preflight: "运行预检",
    start: "开始运行",
    pause: "暂停新开仓",
    resume: "恢复新开仓",
    stop: "安全结束",
    retry: "重新连接 Runtime",
    authenticate: "前往系统编排认证",
    releaseRequired: "需要先完成策略发布与计划激活",
    prepareFixture: "准备本地 Paper 计划",
    prepareFixtureNote:
      "使用服务器固定 Current Crypto Graph 执行 CSV 回测、Walk-Forward，并记录本次明确批准；不会启动交易。",
    states: {
      connecting: "连接中",
      offline: "离线",
      auth_required: "等待认证",
      stopped: "已停止",
      preflight: "等待预检",
      ready: "可以启动",
      running: "运行中",
      only_close: "仅允许平仓",
      draining: "安全结束中",
      blocked: "安全阻断",
    },
    descriptions: {
      connecting: "正在连接本机受控 Runtime API。",
      offline: "Runtime API 不可用。所有运行操作均已禁用，不会在浏览器内伪造交易。",
      auth_required: "Catalog 已连接。输入服务端启动时生成的临时 Operator Token 后才能操作。",
      stopped: "当前没有运行实例。只有已批准并显式激活的 Paper Plan 可以启动。",
      preflight: "计划已激活。必须先完成只读安全预检，才能启动交易周期。",
      ready: "预检已通过。点击开始后由后端创建有界 Paper Trading Run。",
      running: "后端正在执行有界 Paper 周期；Risk 与 Position Monitor 保持生效。",
      only_close: "新开仓已暂停；行情、Risk、Position Monitor 和平仓链路继续运行。",
      draining: "已拒绝后续周期，当前周期完成后由后端安全排空。",
      blocked: "Runtime 已失败关闭。检查稳定错误代码和 Incident 后再处理。",
    },
    banner: {
      connecting: "正在连接本机 Runtime API",
      offline: "OFFLINE MOCK：Runtime API 不可用，交易控制已禁用",
      readonly: "本机 API 已连接：需要 Operator Token 才能执行受控操作",
      live: "本机 Runtime 已连接：PAPER ONLY · NO EXCHANGE WRITE",
    },
  },
  en: {
    eyebrow: "Paper Runtime control",
    title: "Trading run",
    connection: "API",
    plan: "Strategy plan",
    run: "Run",
    cycle: "Cycle",
    heartbeat: "Heartbeat",
    marketData: "Run market data",
    exchange: "Exchange writes",
    exchangeOff: "OFF",
    preflight: "Run preflight",
    start: "Start run",
    pause: "Pause openings",
    resume: "Resume openings",
    stop: "Safe stop",
    retry: "Reconnect Runtime",
    authenticate: "Authenticate in Orchestration",
    releaseRequired: "Complete strategy release and plan activation first",
    prepareFixture: "Prepare local Paper plan",
    prepareFixtureNote:
      "Run CSV Backtest and Walk-Forward for the server-owned Current Crypto Graph, then record this explicit approval. Trading will not start.",
    states: {
      connecting: "CONNECTING",
      offline: "OFFLINE",
      auth_required: "AUTH REQUIRED",
      stopped: "STOPPED",
      preflight: "PREFLIGHT REQUIRED",
      ready: "READY",
      running: "RUNNING",
      only_close: "ONLY CLOSE",
      draining: "DRAINING",
      blocked: "SAFETY BLOCKED",
    },
    descriptions: {
      connecting: "Connecting to the controlled local Runtime API.",
      offline: "Runtime API is unavailable. Every run action is disabled and no browser-side trading is simulated.",
      auth_required: "Catalog is connected. Enter the ephemeral server-issued Operator Token before operating.",
      stopped: "No run is active. Only an approved and explicitly activated Paper Plan can start.",
      preflight: "The plan is active. A read-only safety preflight must pass before trading cycles start.",
      ready: "Preflight passed. Start creates a bounded Paper Trading Run on the backend.",
      running: "Bounded Paper cycles are running on the backend with Risk and Position Monitor active.",
      only_close: "New openings are paused. Data, Risk, Position Monitor, and exits remain active.",
      draining: "Future cycles are rejected. The backend will drain safely after the current cycle.",
      blocked: "Runtime failed closed. Inspect the stable error code and incident before recovery.",
    },
    banner: {
      connecting: "Connecting to the local Runtime API",
      offline: "OFFLINE MOCK: Runtime API unavailable, trading controls disabled",
      readonly: "Local API connected: Operator Token required for controlled actions",
      live: "LOCAL RUNTIME CONNECTED: PAPER ONLY · NO EXCHANGE WRITE",
    },
  },
} as const;

const releaseGuideCopy = {
  zh: {
    kicker: "受控发布路径",
    title: "从策略草案到 Paper 运行",
    current: "当前",
    passed: "完成",
    pending: "等待",
    blocked: "阻断",
    next: "下一安全动作",
    humanRequired: "需要明确的人工批准，不会由系统自动执行。",
    busy: "后端正在处理当前动作",
    complete: "发布与启动链路已经建立。Runtime 控制保持独立。",
    running: "Paper Run 已由后端创建。运行控制、Risk 与 Position Monitor 保持生效。",
    connection: {
      connecting: "正在连接受控 Runtime API。",
      offline: "Runtime API 离线，发布动作已禁用。",
      readonly: "请先在上方使用服务端临时 Token 完成身份认证。",
    },
    facts: {
      evidence: "发布证据",
      marketData: "Paper 行情",
      exchange: "交易所写入",
      exchangeOff: "永久关闭",
    },
    steps: {
      draft: ["Draft", "保存服务端注册 Graph 的不可变草案"],
      validation: ["合同验证", "校验 Schema、数据能力与权限边界"],
      backtest: ["Backtest", "生成绑定数据指纹的后端证据"],
      walk_forward: ["Walk-Forward", "使用隔离窗口验证泛化能力"],
      approval: ["人工批准", "由具备权限的操作者显式确认"],
      activation: ["计划激活", "生成并激活不可变 Paper Plan"],
      preflight: ["Preflight", "只读检查 Binding、DB、Profile 与行情"],
      start: ["开始", "由后端创建有界 Paper Run"],
    },
    actions: {
      save: "保存 Graph 草案",
      validate: "执行合同验证",
      backtest: "运行 Backtest",
      "walk-forward": "运行 Walk-Forward",
      approve: "执行人工批准",
      "paper-plan": "生成 Paper Plan",
      "activate-paper": "显式激活计划",
      "paper-preflight": "运行只读 Preflight",
      "start-paper-run": "开始持续 Paper 模拟",
      retry: "重新连接 Runtime",
    },
  },
  en: {
    kicker: "Controlled release path",
    title: "From strategy draft to Paper run",
    current: "CURRENT",
    passed: "COMPLETE",
    pending: "PENDING",
    blocked: "BLOCKED",
    next: "Next safe action",
    humanRequired: "Explicit human approval is required and is never automated.",
    busy: "The backend is processing the current action",
    complete: "The release and start path is established. Runtime controls remain independent.",
    running: "The backend created a Paper Run. Runtime control, Risk, and Position Monitor remain active.",
    connection: {
      connecting: "Connecting to the controlled Runtime API.",
      offline: "Runtime API is offline. Release actions are disabled.",
      readonly: "Authenticate above with the ephemeral server-issued token.",
    },
    facts: {
      evidence: "Release evidence",
      marketData: "Paper market data",
      exchange: "Exchange writes",
      exchangeOff: "PERMANENTLY OFF",
    },
    steps: {
      draft: ["Draft", "Save an immutable draft of a server-registered Graph"],
      validation: ["Contract validation", "Check schemas, data capabilities, and authority"],
      backtest: ["Backtest", "Create backend evidence bound to a data fingerprint"],
      walk_forward: ["Walk-Forward", "Validate generalization in isolated windows"],
      approval: ["Human approval", "Require an explicit action from an authorized operator"],
      activation: ["Plan activation", "Create and activate an immutable Paper Plan"],
      preflight: ["Preflight", "Read-only checks for Binding, DB, Profile, and bars"],
      start: ["Start", "Create a bounded Paper Run on the backend"],
    },
    actions: {
      save: "Save Graph draft",
      validate: "Run contract validation",
      backtest: "Run Backtest",
      "walk-forward": "Run Walk-Forward",
      approve: "Record human approval",
      "paper-plan": "Create Paper Plan",
      "activate-paper": "Explicitly activate plan",
      "paper-preflight": "Run read-only Preflight",
      "start-paper-run": "Start continuous Paper simulation",
      retry: "Reconnect Runtime",
    },
  },
} as const;

function escapeControlValue(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function renderReleaseGuide(
  root: HTMLElement,
  bridge: HTMLElement,
): void {
  const release = deriveReleaseGuideState({
    mode: state.mode,
    busy: state.busy,
    hasDraft: Boolean(state.draft),
    promotionStage: state.draft?.promotionStage,
    validationValid: state.validationValid,
    backtestStatus: state.backtestStatus,
    walkForwardStatus: state.walkForwardStatus,
    hasApproval: Boolean(state.approvalId),
    hasPaperPlan: Boolean(state.paperPlan),
    hasActivation: Boolean(state.paperActivation),
    preflightStatus: state.paperPreflight?.status,
    runStatus: state.paperRun?.status,
    errorCode: state.errorCode,
  });
  const text = releaseGuideCopy[locale()];
  const statusLabel = {
    complete: text.passed,
    current: text.current,
    pending: text.pending,
    blocked: text.blocked,
  } as const;
  const stepMarkup = release.steps
    .map((step, index) => {
      const copy = text.steps[step.id];
      return `
        <li data-release-status="${step.status}" ${
          step.id === release.nextStepId ? 'aria-current="step"' : ""
        }>
          <div>
            <span>${String(index + 1).padStart(2, "0")}</span>
            <small>${statusLabel[step.status]}</small>
          </div>
          <strong>${copy[0]}</strong>
          <p>${copy[1]}</p>
        </li>
      `;
    })
    .join("");
  const currentStep = release.nextStepId
    ? text.steps[release.nextStepId]
    : undefined;
  const connectionMessage =
    state.mode === "connecting"
      ? text.connection.connecting
      : state.mode === "offline"
        ? text.connection.offline
        : state.mode === "readonly"
          ? text.connection.readonly
          : undefined;
  const summary =
    connectionMessage ??
    (state.paperRun
      ? text.running
      : currentStep
        ? `${text.next}: ${currentStep[0]}`
        : text.complete);
  const actionLabel = release.nextAction
    ? text.actions[release.nextAction]
    : undefined;

  let guide = root.querySelector<HTMLElement>("[data-release-guide]");
  if (!guide) {
    guide = document.createElement("section");
    guide.dataset.releaseGuide = "true";
    bridge.insertAdjacentElement("afterend", guide);
  }
  guide.className = `release-guide is-${release.phase}`;
  guide.setAttribute("aria-label", text.title);
  guide.innerHTML = `
    <header class="release-guide__header">
      <div>
        <span>${text.kicker}</span>
        <h3>${text.title}</h3>
      </div>
      <p aria-live="polite">${summary}</p>
      <dl>
        <div>
          <dt>${text.facts.evidence}</dt>
          <dd>${escapeControlValue(configuredEvidenceDataLabel)}</dd>
        </div>
        <div>
          <dt>${text.facts.marketData}</dt>
          <dd>${escapeControlValue(configuredMarketDataLabel)}</dd>
        </div>
        <div>
          <dt>${text.facts.exchange}</dt>
          <dd>${text.facts.exchangeOff}</dd>
        </div>
      </dl>
    </header>
    <ol class="release-guide__steps">${stepMarkup}</ol>
    <footer class="release-guide__footer">
      <div>
        ${
          release.reasonCode
            ? `<code>CODE: ${escapeControlValue(release.reasonCode)}</code>`
            : ""
        }
        ${
          release.requiresHumanAction
            ? `<p>${text.humanRequired}</p>`
            : state.busy
              ? `<p>${text.busy}</p>`
              : ""
        }
      </div>
      ${
        release.nextAction && actionLabel
          ? `<button type="button" data-runtime-action="${release.nextAction}" ${
              state.busy ? "disabled" : ""
            } class="${release.requiresHumanAction ? "is-human" : ""}">
              ${actionLabel}
            </button>`
          : ""
      }
    </footer>
  `;
}

function runtimeStateLabel(
  uiState: RuntimeControlUiState,
  text: (typeof runtimeControlCopy)[Locale],
): string {
  return text.states[uiState];
}

function runtimeStateDescription(
  uiState: RuntimeControlUiState,
  text: (typeof runtimeControlCopy)[Locale],
): string {
  return text.descriptions[uiState];
}

let lastRuntimeDashboardSnapshotKey: string | undefined;

function renderRuntimeControl(): void {
  const shell = document.querySelector<HTMLElement>("#app-shell");
  const main = document.querySelector<HTMLElement>("#main-content");
  if (!shell || !main) return;

  const controlMode =
    state.paperControl?.mode ?? state.paperRun?.lastControlMode;
  const ui = deriveRuntimeControlState({
    mode: state.mode,
    busy: state.busy,
    hasActivatedPlan: Boolean(state.paperActivation),
    preflightStatus: state.paperPreflight?.status,
    runStatus: state.paperRun?.status,
    controlMode,
    stopStatus: state.paperStop?.status,
    errorCode: state.errorCode,
  });
  const text = runtimeControlCopy[locale()];
  const heartbeat = state.paperLease?.heartbeatAt
    ? new Date(state.paperLease.heartbeatAt).toLocaleTimeString(
        locale() === "zh" ? "zh-CN" : "en-US",
        { hour12: false },
      )
    : "-";
  const cycle = state.paperRun
    ? state.paperRun.continuous
      ? locale() === "zh"
        ? `${state.paperRun.processedCycles} 轮 · 持续运行`
        : `${state.paperRun.processedCycles} rounds · continuous`
      : `${state.paperRun.processedCycles}/${state.paperRun.plannedCycles}`
    : "-";
  const connectionLabel =
    state.mode === "live"
      ? "LOCAL API"
      : state.mode === "readonly"
        ? "AUTH REQUIRED"
        : state.mode === "connecting"
          ? "CONNECTING"
          : "OFFLINE";

  const html = `
    <div class="runtime-control__identity">
      <span>${text.eyebrow}</span>
      <strong><i aria-hidden="true"></i>${runtimeStateLabel(ui.state, text)}</strong>
      <p>${runtimeStateDescription(ui.state, text)}</p>
      ${state.errorCode ? `<code>CODE: ${escapeControlValue(state.errorCode)}</code>` : ""}
    </div>
    <dl class="runtime-control__facts">
      <div><dt>${text.connection}</dt><dd>${connectionLabel}</dd></div>
      <div><dt>${text.plan}</dt><dd>${escapeControlValue(state.paperPlan?.planId ?? "-")}</dd></div>
      <div><dt>${text.run}</dt><dd>${escapeControlValue(state.paperRun?.runId ?? "-")}</dd></div>
      <div><dt>${text.cycle}</dt><dd>${cycle}</dd></div>
      <div><dt>${text.heartbeat}</dt><dd>${escapeControlValue(heartbeat)}</dd></div>
      <div><dt>${text.marketData}</dt><dd>${escapeControlValue(configuredMarketDataLabel)}</dd></div>
      <div><dt>${text.exchange}</dt><dd class="is-locked">${text.exchangeOff}</dd></div>
    </dl>
    <div class="runtime-control__actions" aria-busy="${state.busy}">
      <label class="runtime-control__cadence">
        <span>${locale() === "zh" ? "运行频率" : "Run cadence"}</span>
        <select data-runtime-cadence ${ui.canStop || state.busy ? "disabled" : ""}>
          ${paperRuntimeCadences.map((cadence) => `
            <option value="${cadence}" ${cadence === selectedPaperRuntimeCadence ? "selected" : ""}>${cadenceLabel(cadence)}${locale() === "zh" ? "一轮" : " per round"}</option>
          `).join("")}
        </select>
      </label>
      ${state.mode === "offline" ? `<button type="button" data-runtime-action="retry">${text.retry}</button>` : ""}
      ${state.mode === "readonly" ? `<a href="#orchestration">${text.authenticate}</a>` : ""}
      ${
        state.mode === "live" &&
        !state.paperActivation &&
        state.paperLaunchPresetAvailable
          ? `<button type="button" class="is-start" data-runtime-action="prepare-current-crypto-fixture" ${state.busy ? "disabled" : ""}>
              ${text.prepareFixture}
            </button>`
          : ""
      }
      <button type="button" data-runtime-action="paper-preflight" ${ui.canPreflight ? "" : "disabled"}>
        ${text.preflight}
      </button>
      <button type="button" class="is-start" data-runtime-action="start-paper-run" ${ui.canStart ? "" : "disabled"}>
        ${text.start}
      </button>
      ${
        ui.state === "only_close"
          ? `<button type="button" class="is-pause" data-runtime-action="resume-normal" ${ui.canResume ? "" : "disabled"}>${text.resume}</button>`
          : `<button type="button" class="is-pause" data-runtime-action="close-only" ${ui.canPause ? "" : "disabled"}>${text.pause}</button>`
      }
      <button type="button" class="is-stop" data-runtime-action="stop-paper-run" ${ui.canStop ? "" : "disabled"}>
        ${text.stop}
      </button>
      ${
        state.mode === "live" && !state.paperActivation
          ? `<small>${
              state.paperLaunchPresetAvailable
                ? text.prepareFixtureNote
                : text.releaseRequired
            }</small>`
          : ""
      }
    </div>
  `;

  let control = shell.querySelector<HTMLElement>("[data-runtime-control]");
  if (!control) {
    control = document.createElement("section");
    control.dataset.runtimeControl = "true";
    main.insertAdjacentElement("beforebegin", control);
  }
  const renderKey = JSON.stringify({
    html,
    state: ui.state,
    busy: state.busy,
  });
  control.className = `runtime-control is-${ui.state}`;
  control.setAttribute("aria-label", text.title);
  if (control.dataset.renderKey !== renderKey) {
    control.dataset.renderKey = renderKey;
    control.innerHTML = html;
  }

  const banner = shell.querySelector<HTMLElement>(".mock-banner");
  const bannerText = text.banner[state.mode];
  if (banner && banner.textContent !== bannerText) {
    banner.textContent = bannerText;
  }
  const dashboardSnapshot = createRuntimeDashboardSnapshot({
    connectionMode: state.mode,
    uiState: ui.state,
    canPause: ui.canPause,
    canResume: ui.canResume,
    canStop: ui.canStop,
    controlMode: controlMode ?? "normal",
    run: state.paperRun,
    heartbeatAt: state.paperLease?.heartbeatAt,
    events: state.paperEvents.map((event) => ({
      eventType: event.eventType,
      occurredAt: event.occurredAt,
    })),
  });
  const dashboardSnapshotKey = JSON.stringify(dashboardSnapshot);
  if (dashboardSnapshotKey !== lastRuntimeDashboardSnapshotKey) {
    lastRuntimeDashboardSnapshotKey = dashboardSnapshotKey;
    window.dispatchEvent(
      new CustomEvent("tradebot:runtime-context", {
        detail: dashboardSnapshot,
      }),
    );
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch(`${configuredApiBase}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(state.token
          ? { authorization: `Bearer ${state.token}` }
          : {}),
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const body = (await response.json()) as ApiEnvelope<T> & ApiErrorEnvelope;
    if (!response.ok || !("data" in body)) {
      throw new Error(body.error?.code ?? `HTTP_${response.status}`);
    }
    return body.data;
  } finally {
    window.clearTimeout(timeout);
  }
}

function releaseStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function persistReleaseSession(): void {
  if (state.mode !== "live") return;
  const storage = releaseStorage();
  if (!storage) return;
  if (!state.draft && !state.paperPlan && !state.paperRun) {
    storage.removeItem(RELEASE_SESSION_STORAGE_KEY);
    return;
  }
  storage.setItem(
    RELEASE_SESSION_STORAGE_KEY,
    serializeReleaseSessionRefs({
      schemaVersion: "1.0.0",
      ...(state.draft ? { draftId: state.draft.draftId } : {}),
      ...(state.paperPlan
        ? { paperPlanId: state.paperPlan.planId }
        : {}),
      ...(state.paperRun ? { paperRunId: state.paperRun.runId } : {}),
    }),
  );
}

function applyRecoveredDraft(draft: DraftResponse): void {
  state.draft = draft;
  const promotion = deriveRecoveredPromotionState(
    draft.promotionStage,
  );
  state.validationValid = promotion.validationValid;
  state.backtestStatus = promotion.backtestStatus;
  state.walkForwardStatus = promotion.walkForwardStatus;
}

function rotatePaperKey(operation: RuntimeOperationKey): void {
  state.paperKeys = rotateRuntimeOperationKey(
    state.paperKeys,
    operation,
  );
}

function acceptPaperRun(run: PaperRuntimeRunResponse | undefined): void {
  const partition = partitionRuntimeRun(run);
  state.paperRun = partition.activeRun;
  if (partition.terminalRun) {
    state.paperLastRun = partition.terminalRun;
    state.paperLease = undefined;
    state.paperStop = undefined;
  }
}

async function applyPaperLaunchContext(
  context: PaperRuntimeLaunchContextResponse,
): Promise<boolean> {
  if (
    context.paperOnly !== true ||
    context.runtimeApplied !== false ||
    context.exchangeWriteAllowed !== false ||
    context.clientRuntimeParametersAccepted !== false
  ) {
    throw new Error("PAPER_LAUNCH_CONTEXT_INVARIANT_FAILED");
  }
  state.paperLaunchPresetAvailable =
    context.preset.availability === "available";
  state.paperPlan = context.plan;
  state.paperActivation = context.activation;
  state.paperControl = context.control;
  acceptPaperRun(context.run);
  if (!context.run) {
    state.paperLease = undefined;
    state.paperStop = undefined;
  }
  state.paperPreflight =
    context.preflight &&
    Date.parse(context.preflight.expiresAt) > Date.now()
      ? context.preflight
      : undefined;
  state.errorCode = context.blockerCode;
  if (context.plan) {
    applyRecoveredDraft(
      await apiRequest<DraftResponse>(
        `/api/orchestration/drafts/${encodeURIComponent(
          context.plan.draftId,
        )}`,
      ),
    );
  }
  if (state.paperRun) {
    await refreshPaperSupervisor(state.paperRun.runId);
    void pollPaperRun(state.paperRun.runId);
  }
  persistReleaseSession();
  return Boolean(context.plan);
}

async function restorePaperLaunchContext(): Promise<boolean> {
  return applyPaperLaunchContext(
    await apiRequest<PaperRuntimeLaunchContextResponse>(
      "/api/orchestration/paper-runtime/launch-context",
    ),
  );
}

function codeFromError(error: unknown): string {
  return error instanceof Error ? error.message : "API_REQUEST_FAILED";
}

async function restoreReleaseSession(): Promise<void> {
  const storage = releaseStorage();
  const raw = storage?.getItem(RELEASE_SESSION_STORAGE_KEY);
  if (!storage || raw == null) return;
  const parsed = parseReleaseSessionRefs(raw);
  if (!parsed.ok) {
    storage.removeItem(RELEASE_SESSION_STORAGE_KEY);
    state.restoreCode = parsed.code;
    return;
  }

  let stale = false;
  try {
    if (parsed.refs.draftId) {
      applyRecoveredDraft(
        await apiRequest<DraftResponse>(
          `/api/orchestration/drafts/${encodeURIComponent(
            parsed.refs.draftId,
          )}`,
        ),
      );
    }
  } catch {
    stale = true;
    state.draft = undefined;
    state.paperPlan = undefined;
    state.paperActivation = undefined;
    state.paperRun = undefined;
  }

  if (!stale && parsed.refs.paperPlanId) {
    try {
      const plan = await apiRequest<ApprovedPaperPlanResponse>(
        `/api/orchestration/paper-plans/${encodeURIComponent(
          parsed.refs.paperPlanId,
        )}`,
      );
      if (plan.runtimeApplied !== false) {
        throw new Error("RUNTIME_MUTATION_INVARIANT_FAILED");
      }
      if (
        !releaseReferenceChainMatches({
          draftId: state.draft?.draftId,
          planId: plan.planId,
          planDraftId: plan.draftId,
        })
      ) {
        throw new Error("RELEASE_SESSION_REFERENCE_MISMATCH");
      }
      state.paperPlan = plan;
      try {
        const activation =
          await apiRequest<PaperActivationResponse>(
            `/api/orchestration/paper-plans/${encodeURIComponent(
              plan.planId,
            )}/activation`,
          );
        if (activation.runtimeApplied !== false) {
          throw new Error("RUNTIME_MUTATION_INVARIANT_FAILED");
        }
        state.paperActivation = activation;
        try {
          state.paperControl = await apiRequest<PaperControlResponse>(
            `/api/orchestration/paper-plans/${encodeURIComponent(
              plan.planId,
            )}/control`,
          );
        } catch {
          state.paperControl = undefined;
        }
      } catch (error) {
        if (codeFromError(error) !== "PAPER_PLAN_NOT_ACTIVATED") {
          throw error;
        }
        state.paperActivation = undefined;
      }
    } catch {
      stale = true;
      state.paperPlan = undefined;
      state.paperActivation = undefined;
      state.paperControl = undefined;
      state.paperRun = undefined;
    }
  }

  if (!stale && parsed.refs.paperRunId) {
    try {
      const run = await apiRequest<PaperRuntimeRunResponse>(
        `/api/orchestration/paper-runs/${encodeURIComponent(
          parsed.refs.paperRunId,
        )}`,
      );
      if (run.exchangeWriteAllowed !== false) {
        throw new Error("EXCHANGE_WRITE_INVARIANT_FAILED");
      }
      if (
        !releaseReferenceChainMatches({
          draftId: state.draft?.draftId,
          planId: state.paperPlan?.planId,
          planDraftId: state.paperPlan?.draftId,
          runPlanId: run.planId,
        })
      ) {
        throw new Error("RELEASE_SESSION_REFERENCE_MISMATCH");
      }
      acceptPaperRun(run);
      await refreshPaperSupervisor(run.runId);
      if (
        run.status === "queued" ||
        run.status === "running" ||
        run.status === "stop_requested"
      ) {
        void pollPaperRun(run.runId);
      }
    } catch {
      stale = true;
      state.paperRun = undefined;
      state.paperLease = undefined;
      state.paperEvents = [];
      state.paperIncidents = [];
    }
  }

  state.paperPreflight = undefined;
  state.restoreCode = stale
    ? "RELEASE_SESSION_REFERENCE_STALE"
    : "RELEASE_SESSION_RESTORED";
  persistReleaseSession();
}

function renderBridge(): void {
  renderRuntimeControl();
  const root = orchestrationRoot();
  if (!root) {
    return;
  }
  let bridge = root.querySelector<HTMLElement>("[data-orchestration-api-bridge]");
  if (!bridge) {
    bridge = document.createElement("section");
    bridge.dataset.orchestrationApiBridge = "true";
    root.prepend(bridge);
  }

  const text = copy[locale()];
  const modeLabel =
    state.mode === "live"
      ? text.live
      : state.mode === "readonly"
        ? text.readonly
      : state.mode === "offline"
        ? text.offline
        : text.connecting;
  const graphAvailable = Boolean(state.catalog?.pipelineGraphs[0]);
  const actionsDisabled =
    state.mode !== "live" || state.busy || !graphAvailable;
  const promotionStage = state.draft?.promotionStage;
  const statusParts = [
    graphAvailable && state.mode === "live" ? text.graphReady : text.noGraph,
    state.draft ? `${text.draft}: ${state.draft.draftId}` : undefined,
    state.validationValid === true ? text.valid : undefined,
    state.validationValid === false ? text.invalid : undefined,
    state.compiledSteps !== undefined
      ? `${text.compiled}: ${state.compiledSteps}`
      : undefined,
    state.actorDisplayName
      ? `${text.actor}: ${state.actorDisplayName}`
      : undefined,
    state.backtestStatus
      ? `Backtest: ${state.backtestStatus}`
      : undefined,
    state.walkForwardStatus
      ? `Walk-Forward: ${state.walkForwardStatus}`
      : undefined,
    state.approvalId ? `Approval: ${state.approvalId}` : undefined,
    state.paperPlan
      ? `Paper Plan: ${state.paperPlan.lifecycleStatus} · ${text.runtimeNotApplied}`
      : undefined,
    state.paperActivation
      ? `Activation: ${state.paperActivation.status} · ${text.runtimeNotApplied}`
      : undefined,
    state.paperControl
      ? `${state.paperControl.mode} · ${text.runtimeNotApplied}`
      : undefined,
    state.paperRun
      ? `Paper Run: ${state.paperRun.status} · ${state.paperRun.continuous ? `${state.paperRun.processedCycles} cycles · continuous` : `${state.paperRun.processedCycles}/${state.paperRun.plannedCycles}`} · control ${
          state.paperRun.lastControlApplied ? "applied" : "pending"
        } · exchange write false`
      : undefined,
    state.artifactSha256
      ? `Artifact: ${state.artifactSha256.slice(0, 22)}…`
      : undefined,
    state.artifactLineage,
    state.restoreCode ? text.restore[state.restoreCode] : undefined,
    state.errorCode ? `CODE: ${state.errorCode}` : undefined,
  ].filter(Boolean);

  bridge.className = `orchestration-runtime-bridge is-${state.mode}`;
  bridge.innerHTML = `
    <div class="orchestration-runtime-copy">
      <div class="orchestration-runtime-heading">
        <span>${text.title}</span>
        <strong>${modeLabel}</strong>
      </div>
      <p>${
        state.mode === "live"
          ? text.liveBody
          : state.mode === "readonly"
            ? text.readonlyBody
            : text.offlineBody
      }</p>
      <small>${statusParts.join(" · ")}</small>
    </div>
    <div class="orchestration-runtime-actions">
      ${
        state.mode === "readonly"
          ? `<label class="orchestration-token-field">
              <span>${text.tokenPlaceholder}</span>
              <input type="password" autocomplete="off" data-runtime-token />
            </label>
            <button type="button" data-runtime-action="authenticate" ${
              state.busy ? "disabled" : ""
            }>${text.authenticate}</button>`
          : ""
      }
      <button type="button" data-runtime-action="retry" ${state.busy ? "disabled" : ""}>
        ${text.retry}
      </button>
      <button type="button" data-runtime-action="save" ${actionsDisabled ? "disabled" : ""}>
        ${text.save}
      </button>
      <button type="button" data-runtime-action="validate" ${
        actionsDisabled ||
        !state.draft ||
        promotionStage !== "draft"
          ? "disabled"
          : ""
      }>
        ${text.validate}
      </button>
      <button type="button" data-runtime-action="backtest" ${
        actionsDisabled || promotionStage !== "contract_validated"
          ? "disabled"
          : ""
      }>
        ${text.backtest}
      </button>
      <button type="button" data-runtime-action="walk-forward" ${
        actionsDisabled || promotionStage !== "backtested"
          ? "disabled"
          : ""
      }>
        ${text.walkForward}
      </button>
      <button type="button" data-runtime-action="approve" ${
        actionsDisabled || promotionStage !== "walk_forward_validated"
          ? "disabled"
          : ""
      }>
        ${text.approve}
      </button>
      <button type="button" data-runtime-action="paper-plan" ${
        actionsDisabled ||
        promotionStage !== "human_approved" ||
        Boolean(state.paperPlan)
          ? "disabled"
          : ""
      }>
        ${text.createPaperPlan}
      </button>
      <button type="button" data-runtime-action="activate-paper" ${
        actionsDisabled || !state.paperPlan || Boolean(state.paperActivation)
          ? "disabled"
          : ""
      }>
        ${text.activatePaperPlan}
      </button>
      <button type="button" data-runtime-action="close-only" ${
        actionsDisabled ||
        !state.paperActivation ||
        state.paperControl?.mode === "pause_new_openings_close_only"
          ? "disabled"
          : ""
      }>
        ${text.closeOnly}
      </button>
      <button type="button" data-runtime-action="resume-normal" ${
        actionsDisabled ||
        !state.paperActivation ||
        state.paperControl?.mode !== "pause_new_openings_close_only"
          ? "disabled"
          : ""
      }>
        ${text.resumeNormal}
      </button>
      <button type="button" data-runtime-action="start-paper-run" ${
        actionsDisabled ||
        !state.paperActivation ||
        state.paperPreflight?.status !== "passed" ||
        state.paperRun?.status === "queued" ||
        state.paperRun?.status === "running" ||
        state.paperRun?.status === "stop_requested"
          ? "disabled"
          : ""
      }>
        ${text.startPaperRun}
      </button>
      <button type="button" data-runtime-action="paper-preflight" ${
        actionsDisabled || !state.paperActivation ? "disabled" : ""
      }>
        ${text.runPreflight}
      </button>
      <button type="button" data-runtime-action="stop-paper-run" ${
        actionsDisabled ||
        !state.paperRun ||
        !["queued", "running", "stop_requested"].includes(
          state.paperRun.status,
        ) ||
        state.paperStop?.status === "requested"
          ? "disabled"
          : ""
      }>
        ${text.stopPaperRun}
      </button>
      <button type="button" data-runtime-action="ack-runtime-incident" ${
        actionsDisabled ||
        !state.paperIncidents.some((incident) => incident.status === "open")
          ? "disabled"
          : ""
      }>
        ${text.acknowledgeIncident}
      </button>
      <button type="button" data-runtime-action="clear-orphan" ${
        actionsDisabled ||
        state.paperRun?.status !== "orphaned" ||
        state.paperIncidents.every((incident) => incident.status === "cleared") ||
        state.paperClearance
          ? "disabled"
          : ""
      }>
        ${text.clearOrphan}
      </button>
      <button type="button" data-runtime-action="compile" ${
        actionsDisabled || !state.draft ? "disabled" : ""
      }>
        ${text.compile}
      </button>
    </div>
    <div class="runtime-bridge-status" aria-live="polite">
      <span>${text.preflightStatus}: ${
        state.paperPreflight
          ? `${state.paperPreflight.status} (${state.paperPreflight.checks.filter((item) => item.status === "passed").length}/${state.paperPreflight.checks.length})`
          : "-"
      }</span>
      <span>${text.leaseStatus}: ${
        state.paperLease
          ? `${state.paperLease.status} · #${state.paperLease.fencingToken} · ${state.paperLease.heartbeatAt}`
          : "-"
      }</span>
      <span>${text.stopStatus}: ${state.paperStop?.status ?? "-"}</span>
    </div>
    <section class="runtime-supervisor" aria-live="polite">
      <header>
        <strong>${text.eventTimeline}</strong>
        <span>OUTBOX PENDING · ${text.externalDeliveryOff}</span>
      </header>
      <ol>
        ${state.paperEvents
          .slice(-8)
          .map(
            (event) => `
              <li data-severity="${event.severity}">
                <span>#${event.sequence}</span>
                <strong>${event.eventType}</strong>
                <time>${event.occurredAt}</time>
              </li>
            `,
          )
          .join("") || "<li>-</li>"}
      </ol>
      <div class="runtime-supervisor-incidents">
        ${state.paperIncidents
          .map(
            (incident) => `
              <span data-severity="${incident.severity}">
                ${incident.incidentType} · ${incident.status}${
                  incident.acknowledgedByDisplayName
                    ? ` · ${incident.acknowledgedByDisplayName}`
                    : ""
                }
              </span>
            `,
          )
          .join("") || "<span>-</span>"}
      </div>
    </section>
  `;
  renderReleaseGuide(root, bridge);
}

async function connect(): Promise<void> {
  state.mode = "connecting";
  state.busy = true;
  state.errorCode = undefined;
  state.restoreCode = undefined;
  renderBridge();
  try {
    const catalog = await apiRequest<CatalogResponse>("/api/orchestration/catalog");
    if (catalog.runtimeMutationAllowed !== false) {
      throw new Error("RUNTIME_MUTATION_INVARIANT_FAILED");
    }
    state.catalog = catalog;
    if (state.token) {
      const session = await apiRequest<SessionResponse>(
        "/api/orchestration/session",
      );
      state.actorDisplayName = session.actor.displayName;
      state.mode = "live";
      const restoredFromServer =
        await restorePaperLaunchContext();
      if (!restoredFromServer) {
        await restoreReleaseSession();
      }
      window.dispatchEvent(
        new CustomEvent("tradebot:orchestration-session", {
          detail: { token: state.token },
        }),
      );
    } else {
      state.mode = "readonly";
    }
  } catch (error) {
    state.mode = state.catalog ? "readonly" : "offline";
    if (state.catalog) {
      state.token = undefined;
      state.actorDisplayName = undefined;
    }
    state.errorCode = error instanceof Error ? error.message : "API_UNAVAILABLE";
  } finally {
    state.busy = false;
    renderBridge();
  }
}

async function runAction(action: string): Promise<void> {
  if (action === "authenticate") {
    const tokenInput = document.querySelector<HTMLInputElement>(
      "[data-runtime-token]",
    );
    const token = tokenInput?.value.trim();
    if (token) {
      state.token = token;
      await connect();
    }
    return;
  }
  if (action === "retry") {
    await connect();
    return;
  }
  if (state.mode !== "live") {
    return;
  }
  state.busy = true;
  state.errorCode = undefined;
  state.restoreCode = undefined;
  renderBridge();
  try {
    if (action === "prepare-current-crypto-fixture") {
      await applyPaperLaunchContext(
        await apiRequest<PaperRuntimeLaunchContextResponse>(
          "/api/orchestration/paper-runtime/presets/current-crypto-fixture/prepare",
          {
            method: "POST",
            body: JSON.stringify({
              schemaVersion: "1.0.0",
              idempotencyKey: crypto.randomUUID(),
              confirmation:
                "prepare_current_crypto_fixture_paper_plan",
            }),
          },
        ),
      );
    } else if (action === "save") {
      const graph = state.catalog?.pipelineGraphs[0];
      if (!graph) {
        throw new Error("PIPELINE_GRAPH_UNAVAILABLE");
      }
      const draft = await apiRequest<DraftResponse>("/api/orchestration/drafts", {
        method: "POST",
        body: JSON.stringify(graph),
      });
      if (draft.runtimeApplied !== false) {
        throw new Error("RUNTIME_MUTATION_INVARIANT_FAILED");
      }
      state.draft = draft;
      state.validationValid = undefined;
      state.compiledSteps = undefined;
    } else if (action === "validate" && state.draft) {
      const result = await apiRequest<{
        validation: { valid: boolean };
        draft: DraftResponse;
      }>(
        `/api/orchestration/drafts/${encodeURIComponent(state.draft.draftId)}/validate`,
        { method: "POST" },
      );
      state.validationValid = result.validation.valid;
      state.draft = result.draft;
    } else if (
      (action === "backtest" || action === "walk-forward") &&
      state.draft
    ) {
      const job = await apiRequest<EvidenceJobResponse>(
        `/api/orchestration/drafts/${encodeURIComponent(
          state.draft.draftId,
        )}/jobs/${action}`,
        {
          method: "POST",
          body: JSON.stringify({
            schemaVersion: "1.0.0",
            idempotencyKey:
              action === "backtest"
                ? state.jobKeys.backtest
                : state.jobKeys.walkForward,
            parameters: {},
          }),
        },
      );
      if (action === "backtest") {
        state.backtestStatus = job.failureCode ?? job.status;
        if (job.status === "failed") {
          state.jobKeys.backtest = crypto.randomUUID();
        }
      } else {
        state.walkForwardStatus = job.failureCode ?? job.status;
        if (job.status === "failed") {
          state.jobKeys.walkForward = crypto.randomUUID();
        }
      }
      state.artifactSha256 = job.evidence?.artifactSha256;
      state.artifactLineage = job.evidence?.lineage
        ? `${job.evidence.lineage.runnerId} · ${job.evidence.lineage.dataSourceRef} · ${job.evidence.lineage.dataFingerprint.slice(0, 18)}…`
        : undefined;
      state.draft = await apiRequest<DraftResponse>(
        `/api/orchestration/drafts/${encodeURIComponent(
          state.draft.draftId,
        )}`,
      );
    } else if (action === "approve" && state.draft) {
      const approved = await apiRequest<{
        audit: { approvalId: string };
        draft: DraftResponse;
      }>(
        `/api/orchestration/drafts/${encodeURIComponent(
          state.draft.draftId,
        )}/approval`,
        {
          method: "POST",
          body: JSON.stringify({
            schemaVersion: "1.0.0",
            decision: "approve",
          }),
        },
      );
      state.approvalId = approved.audit.approvalId;
      state.draft = approved.draft;
    } else if (action === "paper-plan" && state.draft) {
      const plan = await apiRequest<ApprovedPaperPlanResponse>(
        `/api/orchestration/drafts/${encodeURIComponent(
          state.draft.draftId,
        )}/paper-plan`,
        {
          method: "POST",
          body: JSON.stringify({
            schemaVersion: "1.0.0",
            idempotencyKey: state.paperKeys.plan,
          }),
        },
      );
      if (plan.runtimeApplied !== false) {
        throw new Error("RUNTIME_MUTATION_INVARIANT_FAILED");
      }
      state.paperPlan = plan;
      rotatePaperKey("plan");
    } else if (action === "activate-paper" && state.paperPlan) {
      const activation = await apiRequest<PaperActivationResponse>(
        `/api/orchestration/paper-plans/${encodeURIComponent(
          state.paperPlan.planId,
        )}/activation`,
        {
          method: "POST",
          body: JSON.stringify({
            schemaVersion: "1.0.0",
            idempotencyKey: state.paperKeys.activation,
            confirmation: "activate_paper_plan",
          }),
        },
      );
      if (activation.runtimeApplied !== false) {
        throw new Error("RUNTIME_MUTATION_INVARIANT_FAILED");
      }
      state.paperActivation = activation;
      rotatePaperKey("activation");
    } else if (
      action === "close-only" &&
      state.paperPlan &&
      state.paperActivation
    ) {
      const control = await apiRequest<PaperControlResponse>(
        `/api/orchestration/paper-plans/${encodeURIComponent(
          state.paperPlan.planId,
        )}/control/close-only`,
        {
          method: "POST",
          body: JSON.stringify({
            schemaVersion: "1.0.0",
            idempotencyKey: state.paperKeys.control,
            mode: "pause_new_openings_close_only",
            confirmation: "pause_new_openings_close_only",
          }),
        },
      );
      if (control.runtimeApplied !== false) {
        throw new Error("RUNTIME_MUTATION_INVARIANT_FAILED");
      }
      state.paperControl = control;
      rotatePaperKey("control");
    } else if (
      action === "resume-normal" &&
      state.paperPlan &&
      state.paperActivation
    ) {
      const control = await apiRequest<PaperControlResponse>(
        `/api/orchestration/paper-plans/${encodeURIComponent(
          state.paperPlan.planId,
        )}/control/normal`,
        {
          method: "POST",
          body: JSON.stringify({
            schemaVersion: "1.0.0",
            idempotencyKey: state.paperKeys.control,
            mode: "normal",
            confirmation: "resume_normal_paper_cycles",
          }),
        },
      );
      state.paperControl = control;
      rotatePaperKey("control");
    } else if (
      action === "paper-preflight" &&
      state.paperPlan &&
      state.paperActivation
    ) {
      const preflight = await apiRequest<PaperRuntimePreflightResponse>(
        `/api/orchestration/paper-plans/${encodeURIComponent(
          state.paperPlan.planId,
        )}/preflight`,
        {
          method: "POST",
          body: JSON.stringify({
            schemaVersion: "1.0.0",
            idempotencyKey: state.paperKeys.preflight,
            confirmation: "run_paper_runtime_preflight",
          }),
        },
      );
      if (
        preflight.exchangeWriteAllowed !== false ||
        preflight.paperAccountMutationAllowed !== false
      ) {
        throw new Error("PREFLIGHT_MUTATION_INVARIANT_FAILED");
      }
      state.paperPreflight = preflight;
      rotatePaperKey("preflight");
    } else if (
      action === "start-paper-run" &&
      state.paperPlan &&
      state.paperActivation &&
      state.paperControl?.mode !== "pause_new_openings_close_only"
    ) {
      const run = await apiRequest<PaperRuntimeRunResponse>(
        `/api/orchestration/paper-plans/${encodeURIComponent(
          state.paperPlan.planId,
        )}/runs`,
        {
          method: "POST",
          body: JSON.stringify({
            schemaVersion: "1.0.0",
            idempotencyKey: state.paperKeys.run,
            confirmation: "start_bounded_paper_run",
            locale: document.documentElement.lang.toLowerCase().startsWith("zh")
              ? "zh-CN"
              : "en",
            cadence: selectedPaperRuntimeCadence,
          }),
        },
      );
      if (run.exchangeWriteAllowed !== false) {
        throw new Error("EXCHANGE_WRITE_INVARIANT_FAILED");
      }
      acceptPaperRun(run);
      state.paperLastRun = undefined;
      state.paperStop = undefined;
      rotatePaperKey("run");
      void pollPaperRun(run.runId);
    } else if (
      action === "stop-paper-run" &&
      state.paperRun &&
      ["queued", "running", "stop_requested"].includes(state.paperRun.status)
    ) {
      const stop = await apiRequest<PaperRuntimeStopResponse>(
        `/api/orchestration/paper-runs/${encodeURIComponent(
          state.paperRun.runId,
        )}/stop`,
        {
          method: "POST",
          body: JSON.stringify({
            schemaVersion: "1.0.0",
            idempotencyKey: state.paperKeys.stop,
            confirmation: "stop_after_current_paper_cycle",
            reason: "operator_requested_from_orchestration_workspace",
          }),
        },
      );
      if (
        stop.exchangeWriteAllowed !== false ||
        stop.futureCyclesAllowed !== false
      ) {
        throw new Error("STOP_CONTROL_INVARIANT_FAILED");
      }
      state.paperStop = stop;
      rotatePaperKey("stop");
    } else if (action === "ack-runtime-incident") {
      const incident = state.paperIncidents.find(
        (item) => item.status === "open",
      );
      if (incident && state.paperRun) {
        await apiRequest(
          `/api/orchestration/paper-incidents/${encodeURIComponent(
            incident.incidentId,
          )}/acknowledgement`,
          {
            method: "POST",
            body: JSON.stringify({
              schemaVersion: "1.0.0",
              idempotencyKey: state.paperKeys.acknowledgement,
              confirmation: "acknowledge_paper_runtime_incident",
              note: "acknowledged_from_orchestration_workspace",
            }),
          },
        );
        rotatePaperKey("acknowledgement");
        await refreshPaperSupervisor(state.paperRun.runId);
      }
    } else if (
      action === "clear-orphan" &&
      state.paperRun?.status === "orphaned"
    ) {
      const clearance =
        await apiRequest<PaperRuntimeOrphanClearanceResponse>(
          `/api/orchestration/paper-runs/${encodeURIComponent(
            state.paperRun.runId,
          )}/orphan-clearance`,
          {
            method: "POST",
            body: JSON.stringify({
              schemaVersion: "1.0.0",
              idempotencyKey: state.paperKeys.clearance,
              confirmation: "clear_terminal_orphan_incident",
              reason: "operator_reviewed_terminal_orphan",
            }),
          },
        );
      if (
        clearance.runtimeResumed !== false ||
        clearance.executionTriggered !== false ||
        clearance.paperAccountMutated !== false ||
        clearance.exchangeWriteAllowed !== false ||
        clearance.runStatusAfter !== "orphaned"
      ) {
        throw new Error("ORPHAN_CLEARANCE_INVARIANT_FAILED");
      }
      state.paperClearance = clearance;
      rotatePaperKey("clearance");
      await refreshPaperSupervisor(state.paperRun.runId);
    } else if (action === "compile" && state.draft) {
      const plan = await apiRequest<CompileResponse>(
        `/api/orchestration/drafts/${encodeURIComponent(state.draft.draftId)}/compile`,
        { method: "POST" },
      );
      if (plan.runtimeApplied !== false) {
        throw new Error("RUNTIME_MUTATION_INVARIANT_FAILED");
      }
      state.compiledSteps = plan.steps.length;
    }
  } catch (error) {
    state.errorCode = error instanceof Error ? error.message : "API_REQUEST_FAILED";
  } finally {
    state.busy = false;
    persistReleaseSession();
    renderBridge();
  }
}

async function pollPaperRun(runId: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    try {
      const run = await apiRequest<PaperRuntimeRunResponse>(
        `/api/orchestration/paper-runs/${encodeURIComponent(runId)}`,
      );
      acceptPaperRun(run);
      try {
        state.paperLease = await apiRequest<PaperRuntimeLeaseResponse>(
          `/api/orchestration/paper-runs/${encodeURIComponent(runId)}/lease`,
        );
      } catch {
        state.paperLease = undefined;
      }
      await refreshPaperSupervisor(runId);
      persistReleaseSession();
      renderBridge();
      if (
        run.status === "completed" ||
        run.status === "failed" ||
        run.status === "safety_blocked" ||
        run.status === "drained" ||
        run.status === "orphaned"
      ) {
        acceptPaperRun(run);
        persistReleaseSession();
        renderBridge();
        return;
      }
    } catch {
      return;
    }
  }
}

async function refreshPaperSupervisor(runId: string): Promise<void> {
  try {
    const page = await apiRequest<{
      events: PaperRuntimeOperationalEventResponse[];
    }>(
      `/api/orchestration/paper-runs/${encodeURIComponent(
        runId,
      )}/events?limit=50`,
    );
    state.paperEvents = page.events;
    state.paperIncidents = await apiRequest<
      PaperRuntimeIncidentResponse[]
    >(
      `/api/orchestration/paper-runs/${encodeURIComponent(
        runId,
      )}/incidents`,
    );
  } catch {
    state.paperEvents = [];
    state.paperIncidents = [];
  }
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const button = target.closest<HTMLButtonElement>("[data-runtime-action]");
  if (!button) {
    return;
  }
  void runAction(button.dataset.runtimeAction ?? "");
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (!target.matches("[data-runtime-cadence]")) return;
  if (paperRuntimeCadences.includes(target.value as PaperRuntimeCadence)) {
    selectedPaperRuntimeCadence = target.value as PaperRuntimeCadence;
  }
});

window.addEventListener("tradebot:runtime-action-request", (event) => {
  const action = (event as CustomEvent<{ action?: unknown }>).detail?.action;
  if (action === "close-only" || action === "resume-normal") {
    void runAction(action);
  }
});

const observer = new MutationObserver((records) => {
  const languageChanged = records.some(
    (record) =>
      record.type === "attributes" &&
      record.target === document.documentElement &&
      record.attributeName === "lang",
  );
  if (
    languageChanged ||
    !document.querySelector("[data-orchestration-api-bridge]") ||
    !document.querySelector("[data-runtime-control]")
  ) {
    renderBridge();
  }
});
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["lang"],
});

void connect();
