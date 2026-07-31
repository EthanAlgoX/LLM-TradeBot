import "./operational-outbox-monitor.css";

type Attempt = {
  attemptId: string;
  eventId: string;
  templateId: string;
  status: "queued" | "delivering" | "delivered" | "retry_wait" | "dead_letter";
  attemptCount: number;
  nextAttemptAt: string | null;
  errorCode: string | null;
};

type DeadLetter = {
  deadLetterId: string;
  eventId: string;
  templateId: string;
  reasonCode: string;
  incidentStatus: "open" | "acknowledged" | "replayed";
};

type OutboxPayload = {
  state: {
    ownerId: string | null;
    fencingToken: number;
    leaseExpiresAt: string | null;
    registeredTemplateIds: string[];
    externalDeliveryConfigured: false;
    networkRequestCount: 0;
  };
  attempts: Attempt[];
  deadLetters: DeadLetter[];
  externalChannels: {
    slack: "not_configured";
    email: "not_configured";
    webhook: "not_configured";
  };
  worker: null | {
    enabled: boolean;
    running: boolean;
    tickInProgress: boolean;
    totalTicks: number;
    totalProcessed: number;
    lastErrorCode: string | null;
  };
  retention: null | {
    policy: {
      policyId: string;
      lifecycleStatus: "enabled" | "disabled";
      retentionDays: number;
      cleanupAllowed: boolean;
    };
    manifests: Array<{
      manifestId: string;
      manifestFingerprint: string;
      eventCount: number;
      attemptCount: number;
      createdAt: string;
    }>;
    executions: Array<{
      executionId: string;
      manifestId: string;
      deletedEventCount: number;
      deletedAttemptCount: number;
      executedAt: string;
    }>;
  };
};

type RetentionPreviewResult = {
  preview: {
    protectedReasonCounts: Record<string, number>;
    eligibleEventCount: number;
    eligibleAttemptCount: number;
  };
  manifest: {
    manifestId: string;
    manifestFingerprint: string;
    eventCount: number;
    attemptCount: number;
  };
};

const copy = {
  zh: {
    title: "Operational Outbox",
    summary: "受控事件投递",
    api: "本地 API",
    token: "Operator Bearer token",
    refresh: "读取状态",
    dispatch: "投递已注册模板",
    configured: "已注册模板",
    owner: "Dispatcher owner",
    attempts: "最近投递",
    deadLetters: "Dead letter",
    empty: "暂无记录",
    external: "Slack、邮件、Webhook 均未配置",
    zeroNetwork: "外部网络请求：0",
    locked: "输入本地 API 与 operator token 后读取。",
    replay: "重放",
    loading: "读取中",
    failed: "无法读取受控 API",
    worker: "Scheduled Worker",
    retention: "Retention policy",
    dryRun: "生成保留预览",
    execute: "确认执行清理",
    manifest: "Audit manifest",
    protected: "受保护原因",
    disabled: "后端策略未启用",
    tombstone: "最近清理 tombstone",
  },
  en: {
    title: "Operational Outbox",
    summary: "Controlled event delivery",
    api: "Local API",
    token: "Operator Bearer token",
    refresh: "Load status",
    dispatch: "Dispatch registered templates",
    configured: "Registered templates",
    owner: "Dispatcher owner",
    attempts: "Recent attempts",
    deadLetters: "Dead letters",
    empty: "No records",
    external: "Slack, email and webhook are not configured",
    zeroNetwork: "External network requests: 0",
    locked: "Enter the local API and operator token to load status.",
    replay: "Replay",
    loading: "Loading",
    failed: "Controlled API is unavailable",
    worker: "Scheduled worker",
    retention: "Retention policy",
    dryRun: "Create retention preview",
    execute: "Execute confirmed cleanup",
    manifest: "Audit manifest",
    protected: "Protected reasons",
    disabled: "Backend policy is disabled",
    tombstone: "Latest cleanup tombstone",
  },
} as const;

const locale = (): keyof typeof copy =>
  document.documentElement.lang.toLowerCase().startsWith("zh") ? "zh" : "en";

const createElement = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
};

const root = document.querySelector<HTMLElement>("#operational-outbox-monitor");

if (root) {
  const details = createElement("details", "outbox-drawer");
  const summary = createElement("summary", "outbox-summary");
  const title = createElement("span", "outbox-summary__title");
  const titleStrong = createElement("strong", undefined, copy[locale()].title);
  const titleSmall = createElement("small", undefined, copy[locale()].summary);
  title.append(titleStrong, titleSmall);
  const health = createElement("span", "outbox-health", "LOCAL · 0 NETWORK");
  summary.append(title, health);

  const body = createElement("div", "outbox-body");
  const credentials = createElement("div", "outbox-credentials");
  const apiLabel = createElement("label");
  apiLabel.append(createElement("span", undefined, copy[locale()].api));
  const apiInput = createElement("input");
  apiInput.type = "url";
  apiInput.value = "http://127.0.0.1:8787";
  apiInput.autocomplete = "off";
  apiInput.spellcheck = false;
  apiLabel.append(apiInput);
  const tokenLabel = createElement("label");
  tokenLabel.append(createElement("span", undefined, copy[locale()].token));
  const tokenInput = createElement("input");
  tokenInput.type = "password";
  tokenInput.autocomplete = "off";
  tokenInput.spellcheck = false;
  tokenLabel.append(tokenInput);
  credentials.append(apiLabel, tokenLabel);

  const actions = createElement("div", "outbox-actions");
  const refreshButton = createElement(
    "button",
    "outbox-button outbox-button--primary",
    copy[locale()].refresh,
  );
  const dispatchButton = createElement(
    "button",
    "outbox-button",
    copy[locale()].dispatch,
  );
  dispatchButton.disabled = true;
  const retentionPreviewButton = createElement(
    "button",
    "outbox-button",
    copy[locale()].dryRun,
  );
  const retentionExecuteButton = createElement(
    "button",
    "outbox-button outbox-button--danger",
    copy[locale()].execute,
  );
  retentionExecuteButton.disabled = true;
  actions.append(
    refreshButton,
    dispatchButton,
    retentionPreviewButton,
    retentionExecuteButton,
  );

  const status = createElement("p", "outbox-status", copy[locale()].locked);
  const metrics = createElement("div", "outbox-metrics");
  const attemptsSection = createElement("section", "outbox-section");
  const deadLettersSection = createElement("section", "outbox-section");
  const retentionSection = createElement(
    "section",
    "outbox-section outbox-retention",
  );
  body.append(
    credentials,
    actions,
    status,
    metrics,
    attemptsSection,
    deadLettersSection,
    retentionSection,
  );
  details.append(summary, body);
  root.append(details);

  const request = async (
    path: string,
    init?: RequestInit,
  ): Promise<Response> => {
    const origin = apiInput.value.trim().replace(/\/$/, "");
    return fetch(`${origin}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${tokenInput.value.trim()}`,
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  };

  let latestRetentionResult: RetentionPreviewResult | null = null;
  let latestPayload: OutboxPayload | null = null;

  const renderRetention = (payload: OutboxPayload): void => {
    const text = copy[locale()];
    retentionSection.replaceChildren(
      createElement("h3", undefined, text.retention),
    );
    if (!payload.retention) {
      retentionSection.append(
        createElement("p", "outbox-empty", text.empty),
      );
      retentionPreviewButton.disabled = true;
      retentionExecuteButton.disabled = true;
      return;
    }
    retentionPreviewButton.disabled = false;
    retentionExecuteButton.disabled =
      !payload.retention.policy.cleanupAllowed || !latestRetentionResult;
    const policy = createElement("div", "outbox-retention__policy");
    policy.append(
      createElement(
        "strong",
        undefined,
        payload.retention.policy.lifecycleStatus.toUpperCase(),
      ),
      createElement(
        "span",
        undefined,
        `${payload.retention.policy.retentionDays}d · ${payload.retention.policy.policyId}`,
      ),
    );
    retentionSection.append(policy);
    if (!payload.retention.policy.cleanupAllowed) {
      retentionSection.append(
        createElement("p", "outbox-empty", text.disabled),
      );
    }
    const manifest =
      latestRetentionResult?.manifest ?? payload.retention.manifests[0];
    if (manifest) {
      const manifestBlock = createElement("div", "outbox-manifest");
      manifestBlock.append(
        createElement("span", undefined, text.manifest),
        createElement(
          "strong",
          undefined,
          manifest.manifestFingerprint,
        ),
        createElement(
          "small",
          undefined,
          `${manifest.eventCount} events · ${manifest.attemptCount} attempts`,
        ),
      );
      retentionSection.append(manifestBlock);
    }
    if (latestRetentionResult) {
      const reasons = Object.entries(
        latestRetentionResult.preview.protectedReasonCounts,
      )
        .filter(([, count]) => count > 0)
        .map(([reason, count]) => `${reason} ${count}`)
        .join(" · ");
      retentionSection.append(
        createElement(
          "p",
          "outbox-empty",
          `${text.protected}: ${reasons || "0"}`,
        ),
      );
    }
    const execution = payload.retention.executions[0];
    if (execution) {
      retentionSection.append(
        createElement(
          "p",
          "outbox-empty",
          `${text.tombstone}: ${execution.deletedEventCount} events · ${execution.executionId}`,
        ),
      );
    }
  };

  const render = (payload: OutboxPayload): void => {
    latestPayload = payload;
    const text = copy[locale()];
    health.textContent = `${payload.state.registeredTemplateIds.length} TEMPLATES · 0 NETWORK`;
    status.textContent = `${text.external}. ${text.zeroNetwork}.`;
    status.dataset.state = "ready";
    dispatchButton.disabled = payload.state.registeredTemplateIds.length === 0;
    metrics.replaceChildren();
    const ownerMetric = createElement("div", "outbox-metric");
    ownerMetric.append(
      createElement("span", undefined, text.owner),
      createElement("strong", undefined, payload.state.ownerId ?? "UNCLAIMED"),
    );
    const templateMetric = createElement("div", "outbox-metric");
    templateMetric.append(
      createElement("span", undefined, text.configured),
      createElement(
        "strong",
        undefined,
        String(payload.state.registeredTemplateIds.length),
      ),
    );
    metrics.append(ownerMetric, templateMetric);
    const workerMetric = createElement("div", "outbox-metric");
    workerMetric.append(
      createElement("span", undefined, text.worker),
      createElement(
        "strong",
        undefined,
        payload.worker
          ? `${payload.worker.enabled ? "ENABLED" : "DISABLED"} · ${
              payload.worker.running ? "RUNNING" : "STOPPED"
            }`
          : "UNAVAILABLE",
      ),
    );
    const retentionMetric = createElement("div", "outbox-metric");
    retentionMetric.append(
      createElement("span", undefined, text.retention),
      createElement(
        "strong",
        undefined,
        payload.retention
          ? payload.retention.policy.lifecycleStatus.toUpperCase()
          : "UNAVAILABLE",
      ),
    );
    metrics.append(workerMetric, retentionMetric);

    attemptsSection.replaceChildren(
      createElement("h3", undefined, text.attempts),
    );
    if (payload.attempts.length === 0) {
      attemptsSection.append(createElement("p", "outbox-empty", text.empty));
    } else {
      const list = createElement("ol", "outbox-list");
      for (const attempt of payload.attempts.slice(0, 6)) {
        const item = createElement("li");
        const main = createElement("div");
        main.append(
          createElement("strong", undefined, attempt.status.toUpperCase()),
          createElement(
            "span",
            undefined,
            `${attempt.templateId} · #${attempt.attemptCount}`,
          ),
        );
        item.append(main);
        if (attempt.errorCode || attempt.nextAttemptAt) {
          item.append(
            createElement(
              "small",
              undefined,
              attempt.errorCode ?? attempt.nextAttemptAt ?? "",
            ),
          );
        }
        list.append(item);
      }
      attemptsSection.append(list);
    }

    deadLettersSection.replaceChildren(
      createElement("h3", undefined, text.deadLetters),
    );
    const openDeadLetters = payload.deadLetters.filter(
      (deadLetter) => deadLetter.incidentStatus === "open",
    );
    if (openDeadLetters.length === 0) {
      deadLettersSection.append(
        createElement("p", "outbox-empty", text.empty),
      );
    } else {
      const list = createElement("ol", "outbox-list outbox-list--dead");
      for (const deadLetter of openDeadLetters.slice(0, 6)) {
        const item = createElement("li");
        const main = createElement("div");
        main.append(
          createElement("strong", undefined, deadLetter.reasonCode),
          createElement("span", undefined, deadLetter.templateId),
        );
        const replay = createElement(
          "button",
          "outbox-replay",
          text.replay,
        );
        replay.addEventListener("click", async () => {
          replay.disabled = true;
          try {
            const response = await request(
              `/api/orchestration/operational-outbox/dead-letters/${encodeURIComponent(
                deadLetter.deadLetterId,
              )}/replay`,
              {
                method: "POST",
                body: JSON.stringify({
                  confirmation: "REPLAY_REGISTERED_DELIVERY",
                  idempotencyKey: `web-replay:${crypto.randomUUID()}`,
                  reason: "Operator confirmed replay from TradeBot Web",
                }),
              },
            );
            if (!response.ok) {
              throw new Error(String(response.status));
            }
            await load();
          } catch {
            status.textContent = text.failed;
            status.dataset.state = "error";
          } finally {
            replay.disabled = false;
          }
        });
        item.append(main, replay);
        list.append(item);
      }
      deadLettersSection.append(list);
    }
    renderRetention(payload);
  };

  const syncLocale = (): void => {
    const text = copy[locale()];
    titleStrong.textContent = text.title;
    titleSmall.textContent = text.summary;
    const apiLabelText = apiLabel.querySelector("span");
    const tokenLabelText = tokenLabel.querySelector("span");
    if (apiLabelText) apiLabelText.textContent = text.api;
    if (tokenLabelText) tokenLabelText.textContent = text.token;
    refreshButton.textContent = text.refresh;
    dispatchButton.textContent = text.dispatch;
    retentionPreviewButton.textContent = text.dryRun;
    retentionExecuteButton.textContent = text.execute;
    if (latestPayload) {
      render(latestPayload);
    } else {
      status.textContent = text.locked;
    }
  };

  const load = async (): Promise<void> => {
    const text = copy[locale()];
    status.textContent = text.loading;
    status.dataset.state = "loading";
    try {
      const response = await request(
        "/api/orchestration/operational-outbox",
      );
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      render((await response.json()) as OutboxPayload);
    } catch {
      status.textContent = text.failed;
      status.dataset.state = "error";
      dispatchButton.disabled = true;
    }
  };

  refreshButton.addEventListener("click", () => void load());
  const localeObserver = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.type === "attributes" &&
          record.attributeName === "lang",
      )
    ) {
      syncLocale();
    }
  });
  localeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });
  dispatchButton.addEventListener("click", async () => {
    dispatchButton.disabled = true;
    try {
      const response = await request(
        "/api/orchestration/operational-outbox/dispatch",
        {
          method: "POST",
          body: JSON.stringify({
            confirmation: "DISPATCH_REGISTERED_OUTBOX",
            idempotencyKey: `web-dispatch:${crypto.randomUUID()}`,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      await load();
    } catch {
      status.textContent = copy[locale()].failed;
      status.dataset.state = "error";
    } finally {
      dispatchButton.disabled = false;
    }
  });
  retentionPreviewButton.addEventListener("click", async () => {
    retentionPreviewButton.disabled = true;
    try {
      const response = await request(
        "/api/orchestration/operational-outbox/retention/previews",
        {
          method: "POST",
          body: JSON.stringify({
            confirmation: "CREATE_RETENTION_DRY_RUN",
            idempotencyKey: `web-retention-preview:${crypto.randomUUID()}`,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      latestRetentionResult =
        (await response.json()) as RetentionPreviewResult;
      await load();
    } catch {
      status.textContent = copy[locale()].failed;
      status.dataset.state = "error";
    } finally {
      retentionPreviewButton.disabled = false;
    }
  });
  retentionExecuteButton.addEventListener("click", async () => {
    if (!latestRetentionResult) {
      return;
    }
    retentionExecuteButton.disabled = true;
    try {
      const manifest = latestRetentionResult.manifest;
      const response = await request(
        `/api/orchestration/operational-outbox/retention/manifests/${encodeURIComponent(
          manifest.manifestId,
        )}/execute`,
        {
          method: "POST",
          body: JSON.stringify({
            confirmation: "EXECUTE_CONFIRMED_RETENTION",
            manifestId: manifest.manifestId,
            manifestFingerprint: manifest.manifestFingerprint,
            idempotencyKey: `web-retention-execution:${crypto.randomUUID()}`,
            reason: "Operator confirmed sealed audit retention from TradeBot Web",
          }),
        },
      );
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      latestRetentionResult = null;
      await load();
    } catch {
      status.textContent = copy[locale()].failed;
      status.dataset.state = "error";
    }
  });
}
