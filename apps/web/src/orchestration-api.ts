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
  lastControlMode: "normal" | "pause_new_openings_close_only";
  lastControlApplied: boolean;
  failureCode?: string;
  paperRuntimeApplied: boolean;
  exchangeWriteAllowed: false;
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

const configuredApiBase =
  (
    globalThis as typeof globalThis & {
      __TRADEBOT_ORCHESTRATION_API__?: string;
    }
  ).__TRADEBOT_ORCHESTRATION_API__ ?? "http://127.0.0.1:8787";
const configuredToken =
  (
    globalThis as typeof globalThis & {
      __TRADEBOT_ORCHESTRATION_TOKEN__?: string;
    }
  ).__TRADEBOT_ORCHESTRATION_TOKEN__;

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
  paperPreflight?: PaperRuntimePreflightResponse;
  paperLease?: PaperRuntimeLeaseResponse;
  paperStop?: PaperRuntimeStopResponse;
  paperEvents: PaperRuntimeOperationalEventResponse[];
  paperIncidents: PaperRuntimeIncidentResponse[];
  paperClearance?: PaperRuntimeOrphanClearanceResponse;
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
  token: configuredToken,
  jobKeys: {
    backtest: crypto.randomUUID(),
    walkForward: crypto.randomUUID(),
  },
  paperKeys: {
    plan: crypto.randomUUID(),
    activation: crypto.randomUUID(),
    control: crypto.randomUUID(),
    run: crypto.randomUUID(),
    preflight: crypto.randomUUID(),
    stop: crypto.randomUUID(),
    acknowledgement: crypto.randomUUID(),
    clearance: crypto.randomUUID(),
  },
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
  },
} as const;

function orchestrationRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    "[data-orchestration-root], .orchestration-workspace, .orchestration-shell, .orchestration-view, .orchestration-grid",
  );
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

function renderBridge(): void {
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
      ? `Paper Run: ${state.paperRun.status} · ${state.paperRun.processedCycles}/${state.paperRun.plannedCycles} · control ${
          state.paperRun.lastControlApplied ? "applied" : "pending"
        } · exchange write false`
      : undefined,
    state.artifactSha256
      ? `Artifact: ${state.artifactSha256.slice(0, 22)}…`
      : undefined,
    state.artifactLineage,
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
}

async function connect(): Promise<void> {
  state.mode = "connecting";
  state.busy = true;
  state.errorCode = undefined;
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
  renderBridge();
  try {
    if (action === "save") {
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
            idempotencyKey: crypto.randomUUID(),
            mode: "normal",
            confirmation: "resume_normal_paper_cycles",
          }),
        },
      );
      state.paperControl = control;
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
    } else if (
      action === "start-paper-run" &&
      state.paperPlan &&
      state.paperActivation
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
          }),
        },
      );
      if (run.exchangeWriteAllowed !== false) {
        throw new Error("EXCHANGE_WRITE_INVARIANT_FAILED");
      }
      state.paperRun = run;
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
      state.paperRun = run;
      try {
        state.paperLease = await apiRequest<PaperRuntimeLeaseResponse>(
          `/api/orchestration/paper-runs/${encodeURIComponent(runId)}/lease`,
        );
      } catch {
        state.paperLease = undefined;
      }
      await refreshPaperSupervisor(runId);
      renderBridge();
      if (
        run.status === "completed" ||
        run.status === "failed" ||
        run.status === "safety_blocked" ||
        run.status === "drained" ||
        run.status === "orphaned"
      ) {
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

const observer = new MutationObserver((records) => {
  const languageChanged = records.some(
    (record) =>
      record.type === "attributes" &&
      record.target === document.documentElement &&
      record.attributeName === "lang",
  );
  if (
    languageChanged ||
    !document.querySelector("[data-orchestration-api-bridge]")
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
