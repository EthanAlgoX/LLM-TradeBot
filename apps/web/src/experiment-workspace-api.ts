import {
  ExperimentCatalogSchema,
  ExperimentListResponseSchema,
  ExperimentSchema,
  type Experiment,
  type ExperimentCatalog,
  type ExperimentConstraintResult,
  type ExperimentListResponse,
  type ExperimentParticipant,
} from "../../../packages/contracts/src/index.js";
import { createDataCenterHostLifecycle } from "./data-center-host-lifecycle.js";
import {
  acceptsExperimentResponse,
  boundedSeries,
  buildExperimentCreateRequest,
  createExperimentFormState,
  experimentActionEnabled,
  mergeExperimentList,
  type ExperimentAction,
  type ExperimentFormState,
} from "./experiment-workspace-state.js";
import {
  resolveOrchestrationSessionConfiguration,
  type OrchestrationViteEnvironment,
} from "./orchestration-session.js";
import "./experiment-workspace.css";

const environment: OrchestrationViteEnvironment = {
  DEV: import.meta.env.DEV,
  VITE_TRADEBOT_ORCHESTRATION_API:
    import.meta.env.VITE_TRADEBOT_ORCHESTRATION_API,
  VITE_TRADEBOT_ORCHESTRATION_TOKEN: import.meta.env.DEV
    ? import.meta.env.VITE_TRADEBOT_ORCHESTRATION_TOKEN
    : undefined,
};
const runtimeGlobals = globalThis as typeof globalThis & {
  __TRADEBOT_ORCHESTRATION_API__?: string;
  __TRADEBOT_ORCHESTRATION_TOKEN__?: string;
};
const session = resolveOrchestrationSessionConfiguration({
  globalApiBase: runtimeGlobals.__TRADEBOT_ORCHESTRATION_API__,
  globalToken: runtimeGlobals.__TRADEBOT_ORCHESTRATION_TOKEN__,
  viteEnvironment: environment,
});

let catalog: ExperimentCatalog | undefined;
let experiments: Experiment[] = [];
let nextCursor: string | undefined;
let selectedExperimentId: string | undefined;
let selectedParticipantIds = new Set<string>();
let form: ExperimentFormState | undefined;
let busyAction: "create" | ExperimentAction | "load" | undefined;
let error = "";
let activeRequest: AbortController | undefined;
let epoch = 0;

const zh = (): boolean => document.documentElement.lang === "zh-CN";
const t = (zhText: string, enText: string): string =>
  zh() ? zhText : enText;
const esc = (value: string): string =>
  value.replace(/[&<>"']/gu, (character) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]!,
  );
const short = (value: string): string =>
  value.length > 24 ? `${value.slice(0, 21)}…` : value;
const idempotencyKey = (): string => `web-experiment-${crypto.randomUUID()}`;

function host(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#experiment-workspace-host");
}

function selectedExperiment(): Experiment | undefined {
  return experiments.find(
    (experiment) => experiment.experimentId === selectedExperimentId,
  );
}

async function api(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; signal: AbortSignal },
): Promise<unknown> {
  const response = await fetch(`${session.apiBase}${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${session.token}`,
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const body = (await response.json()) as { code?: string };
  if (!response.ok) throw new Error(body.code ?? `HTTP_${response.status}`);
  return body;
}

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
}

function participantSelector(currentCatalog: ExperimentCatalog): string {
  return currentCatalog.participants
    .map((participant) => {
      const eligible = participant.eligibility === "eligible";
      return `
        <label class="experiment-participant${eligible ? "" : " is-disabled"}">
          <input type="checkbox" data-participant value="${esc(participant.versionId)}"
            ${selectedParticipantIds.has(participant.versionId) ? "checked" : ""}
            ${!eligible || busyAction ? "disabled" : ""}>
          <span>
            <strong>${esc(participant.label)}</strong>
            <code>${esc(short(participant.versionId))} · ${esc(short(participant.fingerprint))}</code>
            <small>${esc(participant.eligibility)}${participant.issueCodes.length ? ` · ${esc(participant.issueCodes.join(", "))}` : ""}</small>
          </span>
        </label>`;
    })
    .join("");
}

function experimentList(): string {
  return `
    <aside class="experiment-list" aria-label="${t("实验列表", "Experiment list")}">
      <header><span>EXPERIMENTS</span><strong>${experiments.length}</strong></header>
      ${
        experiments.length === 0
          ? `<p>${t("尚未创建实验。", "No experiments yet.")}</p>`
          : experiments
              .map(
                (experiment) => `
                  <button type="button" data-experiment-select="${esc(experiment.experimentId)}"
                    class="${experiment.experimentId === selectedExperimentId ? "is-active" : ""}">
                    <strong>${esc(short(experiment.experimentId))}</strong>
                    <span>${esc(experiment.lifecycleStatus)} · ${esc(experiment.comparability.status)}</span>
                  </button>`,
              )
              .join("")
      }
      ${nextCursor ? `<button type="button" class="text-action" data-experiment-more ${busyAction ? "disabled" : ""}>${t("加载更多", "Load more")}</button>` : ""}
    </aside>`;
}

function constraintLabel(result: ExperimentConstraintResult): string {
  const actual = result.actual === undefined ? "unavailable" : String(result.actual);
  return `${result.key}: ${result.status} (${actual} / ${String(result.expected)})`;
}

function equityChart(participant: ExperimentParticipant): string {
  const points = participant.backtestEvidence?.scorecard?.equityPoints ?? [];
  if (points.length === 0) return "";
  const sampledPoints = boundedSeries(points);
  const values = sampledPoints.map((point) => point.equity);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = Math.max(maximum - minimum, 1);
  const polyline = sampledPoints
    .map((point, index) => {
      const x =
        sampledPoints.length === 1
          ? 50
          : (index / (sampledPoints.length - 1)) * 100;
      const y = 36 - ((point.equity - minimum) / span) * 32;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return `
    <figure class="experiment-equity">
      <svg viewBox="0 0 100 40" role="img" aria-label="${t("历史净值曲线", "Historical equity curve")}">
        <polyline points="${polyline}" fill="none" vector-effect="non-scaling-stroke"></polyline>
      </svg>
      <figcaption>${esc(points[0]!.asOf.slice(0, 10))} ${points[0]!.equity.toFixed(2)} → ${esc(points.at(-1)!.asOf.slice(0, 10))} ${points.at(-1)!.equity.toFixed(2)} · ${points.length} ${t("个观测点", "observations")}</figcaption>
    </figure>`;
}

function participantResult(participant: ExperimentParticipant): string {
  const scorecard = participant.backtestEvidence?.scorecard;
  const walkForward = participant.walkForwardEvidence?.walkForward;
  return `
    <article class="experiment-participant-result">
      <header>
        <div><strong>${esc(participant.label)}</strong><code>${esc(short(participant.participantId))}</code></div>
        <span>${participant.issueCodes.length ? esc(participant.issueCodes.join(", ")) : "OK"}</span>
      </header>
      ${
        scorecard
          ? `<dl class="experiment-metrics">
              <div><dt>Total return</dt><dd>${scorecard.totalReturnPct.toFixed(2)}%</dd></div>
              <div><dt>Max drawdown</dt><dd>${scorecard.maxDrawdownPct.toFixed(2)}%</dd></div>
              <div><dt>Trades / fills</dt><dd>${scorecard.tradeCount} / ${scorecard.fillCount}</dd></div>
              <div><dt>Risk rejects / cycles</dt><dd>${scorecard.riskRejectionCount} / ${scorecard.cycleCount}</dd></div>
            </dl>${equityChart(participant)}`
          : `<p>${t("等待已验证 Backtest Evidence。", "Awaiting verified Backtest Evidence.")}</p>`
      }
      <p>Walk-Forward: ${
        walkForward
          ? `${walkForward.foldCount} folds · ${walkForward.positiveValidation ? "positive" : "not positive"} · promotion ${walkForward.promotionEligible ? "eligible" : "blocked"}`
          : "unavailable"
      }</p>
      <p>Sharpe / Sortino / Profit Factor: unavailable</p>
      <p>${t("约束", "Constraints")}: ${
        participant.constraintResults.length
          ? participant.constraintResults.map(constraintLabel).map(esc).join(" · ")
          : t("未配置", "not configured")
      }</p>
      <details>
        <summary>Evidence lineage</summary>
        <code>Plan ${esc(short(participant.historicalPlanRef.fingerprint))}</code>
        <code>Backtest ${esc(short(participant.backtestEvidence?.manifestFingerprint ?? "unavailable"))}</code>
        <code>Walk-Forward ${esc(short(participant.walkForwardEvidence?.manifestFingerprint ?? "unavailable"))}</code>
      </details>
    </article>`;
}

function result(experiment: Experiment): string {
  const openClass = experiment.comparability.status === "OPEN_CLASS";
  return `
    <section class="experiment-result">
      <header>
        <div><span>FAIRNESS LOCK</span><h2>${esc(experiment.experimentId)}</h2></div>
        <strong class="experiment-status">${esc(experiment.comparability.status)}</strong>
      </header>
      <p>${
        openClass
          ? t(
              "开放类比较只描述差异，不形成因果赢家或 Candidate。",
              "Open-class comparison is descriptive only; it cannot produce a causal winner or Candidate.",
            )
          : t(
              "服务端根据锁定快照判断可比性。",
              "Comparability is derived from the server-locked snapshot.",
            )
      }</p>
      <dl class="experiment-lock">
        <div><dt>Dataset</dt><dd>${esc(experiment.lock.dataset.datasetRef.id)} · ${esc(short(experiment.lock.dataset.datasetRef.fingerprint))}</dd></div>
        <div><dt>Range</dt><dd>${esc(experiment.lock.dataset.startAt)} → ${esc(experiment.lock.dataset.endAt)}</dd></div>
        <div><dt>Calendar</dt><dd>${esc(experiment.lock.dataset.timezone)} · ${esc(experiment.lock.dataset.tradingCalendarRef)}</dd></div>
        <div><dt>Objective</dt><dd>${esc(experiment.lock.objective.kind)}</dd></div>
        <div><dt>${t("变化项", "Changed")}</dt><dd>${esc(experiment.comparability.changedDimensions.join(", ") || "none")}</dd></div>
        <div><dt>${t("锁定项", "Locked")}</dt><dd>${esc(experiment.comparability.lockedDimensions.join(", "))}</dd></div>
      </dl>
      <div class="experiment-actions">
        ${(["backtest", "walk-forward", "replay", "candidate"] as ExperimentAction[])
          .map((action) => {
            const labels: Record<ExperimentAction, [string, string]> = {
              backtest: ["运行 Backtest", "Run Backtest"],
              "walk-forward": ["运行 Walk-Forward", "Run Walk-Forward"],
              replay: ["验证重放", "Verify replay"],
              candidate: ["形成验证候选", "Create validation candidate"],
            };
            return `<button type="button" ${action === "candidate" ? 'class="primary-action"' : 'class="secondary-action"'} data-experiment-action="${action}" ${busyAction || !experimentActionEnabled(experiment, action) ? "disabled" : ""}>${busyAction === action ? t("处理中…", "Working…") : t(...labels[action])}</button>`;
          })
          .join("")}
      </div>
      <p class="experiment-safety">
        ${
          experiment.candidate
            ? `${t("验证候选", "Validation candidate")}: ${esc(experiment.candidate.participantId)} · candidate_for_validation · runtimeApplied=false`
            : t(
                "没有 Approval、Deploy、Paper Run 或 Runtime Apply 动作。",
                "No Approval, Deploy, Paper Run, or Runtime Apply action exists.",
              )
        }
      </p>
      ${experiment.replay ? `<p class="experiment-replay">Replay ${esc(experiment.replay.status)} · definition ${esc(short(experiment.replay.definitionFingerprint))} · evidence ${esc(short(experiment.replay.evidenceFingerprint))} · result ${esc(short(experiment.replay.resultFingerprint))}</p>` : ""}
      <section class="experiment-score">
        <h3>${t("真实 Scorecard、净值与 Evidence", "Real Scorecard, equity & Evidence")}</h3>
        ${experiment.participants.map(participantResult).join("")}
      </section>
      <section class="experiment-diff">
        <h3>${t("服务端配置差异", "Server configuration diff")}</h3>
        ${
          experiment.configurationDiff.length
            ? experiment.configurationDiff
                .map(
                  (entry) => `<div><strong>${esc(entry.field)}</strong>${entry.values
                    .map(
                      (value) =>
                        `<code>${esc(short(value.participantId))}: ${esc(String(value.value))}</code>`,
                    )
                    .join("")}</div>`,
                )
                .join("")
            : `<p>${t("安全投影中没有额外差异。", "No additional differences in the safe projection.")}</p>`
        }
      </section>
    </section>`;
}

function render(root: HTMLElement): void {
  if (lifecycle.current() !== root) return;
  const currentCatalog = catalog;
  const currentForm = form;
  const experiment = selectedExperiment();
  root.innerHTML = `
    <section class="experiment-shell" aria-live="polite">
      <header class="experiment-heading">
        <div>
          <span>EXPERIMENT ARENA · V1</span>
          <h1>${t("可重放策略实验场", "Replayable strategy experiments")}</h1>
          <p>${t("历史版本、数据和 Evidence 均由服务端锁定。", "Historical versions, data, and Evidence are server-locked.")}</p>
        </div>
        <code>runtimeApplied=false · Paper Only · exchangeWriteAllowed=false</code>
      </header>
      ${error ? `<p class="experiment-error" role="alert">${esc(error)} <button type="button" data-experiment-refresh>${t("重试", "Retry")}</button></p>` : ""}
      ${!session.token ? `<p class="experiment-error">${t("只读：未连接本地 Operator", "Readonly: local Operator is not connected")}</p>` : ""}
      ${
        currentCatalog && currentForm
          ? `<div class="experiment-workspace">
              ${experimentList()}
              <main>
                <section class="experiment-create">
                  <header><div><span>NEW EXPERIMENT</span><h2>${t("锁定比较条件", "Lock comparison conditions")}</h2></div><small>${t("选择 2–5 个历史 Strategy Version", "Select 2–5 historical Strategy Versions")}</small></header>
                  <div class="experiment-participants">${participantSelector(currentCatalog) || `<p>${t("暂无历史策略版本。", "No historical strategy versions.")}</p>`}</div>
                  <div class="experiment-form">
                    <label>Dataset<select id="experiment-dataset">${currentCatalog.datasets.map((dataset) => option(dataset.id, `${dataset.id} · ${dataset.version}`, dataset.id === currentForm.datasetId)).join("")}</select></label>
                    <label>Walk-Forward<select id="experiment-plan">${currentCatalog.walkForwardPlans.map((plan) => option(plan.id, `${plan.id} · ${plan.version}`, plan.id === currentForm.walkForwardPlanId)).join("")}</select></label>
                    <label>${t("比较类型", "Comparison mode")}<select id="experiment-mode">${currentCatalog.supportedComparisonModes.map((mode) => option(mode, mode, mode === currentForm.comparisonMode)).join("")}</select></label>
                    <label>Max drawdown ≤<input id="experiment-max-drawdown" type="number" min="0" max="100" step="0.1" value="${currentForm.maxDrawdownPctLte ?? ""}"></label>
                    <label>Minimum trades<input id="experiment-min-trades" type="number" min="0" step="1" value="${currentForm.minimumTradeCount ?? ""}"></label>
                    <label class="experiment-check"><input id="experiment-wf-positive" type="checkbox" ${currentForm.walkForwardPositive ? "checked" : ""}>Walk-Forward positive</label>
                    <label class="experiment-check"><input id="experiment-runtime-zero" type="checkbox" ${currentForm.runtimeFailureCountEqZero ? "checked" : ""}>Runtime failures = 0</label>
                    <button type="button" class="primary-action" data-experiment-create ${busyAction || selectedParticipantIds.size < 2 || selectedParticipantIds.size > 5 || !currentForm.datasetId || !currentForm.walkForwardPlanId ? "disabled" : ""}>${busyAction === "create" ? t("创建中…", "Creating…") : t("锁定并创建", "Lock and create")}</button>
                  </div>
                </section>
                ${experiment ? result(experiment) : `<section class="experiment-empty"><h2>${t("选择或创建实验", "Select or create an experiment")}</h2><p>${t("Evidence 操作只会运行隔离的历史模拟。", "Evidence actions run isolated historical simulations only.")}</p></section>`}
              </main>
            </div>`
          : `<p class="experiment-loading">${busyAction === "load" ? t("正在加载服务端实验目录…", "Loading the server experiment catalog…") : t("实验目录不可用。", "Experiment catalog unavailable.")}</p>`
      }
    </section>`;
}

async function load(root: HTMLElement, append = false): Promise<void> {
  activeRequest?.abort();
  const request = new AbortController();
  activeRequest = request;
  const stamp = ++epoch;
  busyAction = "load";
  if (!append) render(root);
  try {
    if (!session.token) throw new Error("OPERATOR_IDENTITY_REQUIRED");
    const listPath = append && nextCursor
      ? `/api/orchestration/experiments?limit=20&cursor=${encodeURIComponent(nextCursor)}`
      : "/api/orchestration/experiments?limit=20";
    const [catalogBody, listBody] = await Promise.all([
      append
        ? Promise.resolve(catalog)
        : api("/api/orchestration/experiments/catalog", {
            signal: request.signal,
          }),
      api(listPath, { signal: request.signal }),
    ]);
    if (request.signal.aborted || lifecycle.current() !== root || stamp !== epoch) {
      return;
    }
    if (!append) {
      catalog = ExperimentCatalogSchema.parse(catalogBody);
      form = createExperimentFormState(catalog, idempotencyKey(), form);
    }
    const list = ExperimentListResponseSchema.parse(listBody);
    experiments = append
      ? mergeExperimentList(experiments, list.data)
      : list.data;
    nextCursor = list.nextCursor;
    if (
      !selectedExperimentId ||
      !experiments.some(
        (experiment) => experiment.experimentId === selectedExperimentId,
      )
    ) {
      selectedExperimentId = experiments[0]?.experimentId;
    }
    error = "";
  } catch (cause) {
    if (request.signal.aborted || lifecycle.current() !== root || stamp !== epoch) {
      return;
    }
    error = cause instanceof Error ? cause.message : "EXPERIMENT_UNAVAILABLE";
  } finally {
    if (activeRequest === request) activeRequest = undefined;
    if (lifecycle.current() === root && stamp === epoch) {
      busyAction = undefined;
      render(root);
    }
  }
}

function captureForm(root: HTMLElement): void {
  if (!form) return;
  const optionalNumber = (selector: string): number | undefined => {
    const value = root.querySelector<HTMLInputElement>(selector)?.value ?? "";
    return value.trim() === "" ? undefined : Number(value);
  };
  form = {
    ...form,
    datasetId:
      root.querySelector<HTMLSelectElement>("#experiment-dataset")?.value ??
      form.datasetId,
    walkForwardPlanId:
      root.querySelector<HTMLSelectElement>("#experiment-plan")?.value ??
      form.walkForwardPlanId,
    comparisonMode:
      (root.querySelector<HTMLSelectElement>("#experiment-mode")?.value as
        | ExperimentFormState["comparisonMode"]
        | undefined) ?? form.comparisonMode,
    maxDrawdownPctLte: optionalNumber("#experiment-max-drawdown"),
    minimumTradeCount: optionalNumber("#experiment-min-trades"),
    walkForwardPositive: root.querySelector<HTMLInputElement>(
      "#experiment-wf-positive",
    )?.checked
      ? true
      : undefined,
    runtimeFailureCountEqZero: root.querySelector<HTMLInputElement>(
      "#experiment-runtime-zero",
    )?.checked
      ? true
      : undefined,
  };
}

async function createExperiment(root: HTMLElement): Promise<void> {
  if (!catalog || !form) return;
  captureForm(root);
  const requestBody = buildExperimentCreateRequest(
    catalog,
    form,
    [...selectedParticipantIds],
  );
  const controller = new AbortController();
  activeRequest?.abort();
  activeRequest = controller;
  const stamp = ++epoch;
  busyAction = "create";
  error = "";
  render(root);
  try {
    const created = ExperimentSchema.parse(
      await api("/api/orchestration/experiments", {
        method: "POST",
        body: requestBody,
        signal: controller.signal,
      }),
    );
    if (controller.signal.aborted || lifecycle.current() !== root || stamp !== epoch) {
      return;
    }
    experiments = mergeExperimentList(experiments, [created]);
    selectedExperimentId = created.experimentId;
    form = { ...form, idempotencyKey: idempotencyKey() };
  } catch (cause) {
    if (!controller.signal.aborted && lifecycle.current() === root && stamp === epoch) {
      error = cause instanceof Error ? cause.message : "EXPERIMENT_CREATE_FAILED";
    }
  } finally {
    if (activeRequest === controller) activeRequest = undefined;
    if (lifecycle.current() === root && stamp === epoch) {
      busyAction = undefined;
      render(root);
    }
  }
}

async function runAction(root: HTMLElement, action: ExperimentAction): Promise<void> {
  const current = selectedExperiment();
  if (!current || !experimentActionEnabled(current, action)) return;
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  const requestedExperimentId = current.experimentId;
  const stamp = ++epoch;
  busyAction = action;
  error = "";
  render(root);
  try {
    const updated = ExperimentSchema.parse(
      await api(
        `/api/orchestration/experiments/${encodeURIComponent(requestedExperimentId)}/${action}`,
        { method: "POST", body: {}, signal: controller.signal },
      ),
    );
    if (
      controller.signal.aborted ||
      lifecycle.current() !== root ||
      !acceptsExperimentResponse({
        currentEpoch: epoch,
        responseEpoch: stamp,
        selectedExperimentId,
        requestedExperimentId,
      })
    ) {
      return;
    }
    experiments = mergeExperimentList(experiments, [updated]);
  } catch (cause) {
    if (
      !controller.signal.aborted &&
      lifecycle.current() === root &&
      acceptsExperimentResponse({
        currentEpoch: epoch,
        responseEpoch: stamp,
        selectedExperimentId,
        requestedExperimentId,
      })
    ) {
      error = cause instanceof Error ? cause.message : "EXPERIMENT_ACTION_FAILED";
    }
  } finally {
    if (activeRequest === controller) activeRequest = undefined;
    if (lifecycle.current() === root && stamp === epoch) {
      busyAction = undefined;
      render(root);
    }
  }
}

document.addEventListener(
  "change",
  (event) => {
    const root = lifecycle.current();
    if (!root) return;
    const participant = (event.target as HTMLElement).closest<HTMLInputElement>(
      "[data-participant]",
    );
    if (participant && root.contains(participant)) {
      if (participant.checked) selectedParticipantIds.add(participant.value);
      else selectedParticipantIds.delete(participant.value);
      render(root);
      return;
    }
    if (root.contains(event.target as Node)) captureForm(root);
  },
  true,
);

document.addEventListener(
  "click",
  (event) => {
    const root = lifecycle.current();
    if (!root) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-experiment-create],[data-experiment-action],[data-experiment-select],[data-experiment-refresh],[data-experiment-more]",
    );
    if (!target || !root.contains(target) || busyAction) return;
    if (target.dataset.experimentRefresh !== undefined) {
      void load(root);
      return;
    }
    if (target.dataset.experimentMore !== undefined) {
      void load(root, true);
      return;
    }
    if (target.dataset.experimentSelect) {
      activeRequest?.abort();
      epoch += 1;
      selectedExperimentId = target.dataset.experimentSelect;
      error = "";
      render(root);
      return;
    }
    if (target.dataset.experimentCreate !== undefined) {
      void createExperiment(root);
      return;
    }
    const action = target.dataset.experimentAction as
      | ExperimentAction
      | undefined;
    if (action) void runAction(root, action);
  },
  true,
);

const lifecycle = createDataCenterHostLifecycle<HTMLElement>(
  (root) => {
    catalog = undefined;
    experiments = [];
    nextCursor = undefined;
    selectedExperimentId = undefined;
    selectedParticipantIds = new Set();
    form = undefined;
    error = "";
    render(root);
    void load(root);
  },
  () => {
    epoch += 1;
    activeRequest?.abort();
    activeRequest = undefined;
    busyAction = undefined;
  },
);

const app = document.querySelector("#app") ?? document.body;
new MutationObserver(() => lifecycle.sync(host())).observe(app, {
  childList: true,
  subtree: true,
});
lifecycle.sync(host());
