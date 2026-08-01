import "./data-center.css";
import { createDataCenterHostLifecycle } from "./data-center-host-lifecycle.js";
import {
  resolveOrchestrationSessionConfiguration,
  type OrchestrationViteEnvironment,
} from "./orchestration-session.js";

type Asset = {
  assetId: string;
  name: string;
  sourceName: string;
  sourceKind: "binance_public" | "csv_historical";
  capabilityId: string;
  health: "healthy" | "historical" | "unavailable";
  updatedAt?: string;
  dataset?: {
    datasetId: string;
    version: string;
    fingerprint: string;
    asOfStart: string;
    asOfEnd: string;
  };
  schemaPreview: string[];
  quality: { completeness: number; label: string };
  lineage: string[];
};

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

let assets: Asset[] = [];
let error = "";
let activeRequest: AbortController | undefined;

const zh = (): boolean => document.documentElement.lang === "zh-CN";
const t = (zhText: string, enText: string): string =>
  zh() ? zhText : enText;
const esc = (value: string): string =>
  value.replace(/[&<>"']/gu, (char) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]!,
  );

function host(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#data-center-host");
}

function render(root: HTMLElement): void {
  root.innerHTML = error
    ? `<p class="dc-error">${esc(error)}</p>`
    : `
  <section class="dc-radar"><div><span>MARKET RADAR</span><h2>${t("当前已证实的市场维度", "Verified market dimensions")}</h2><p>${t("当前注册表没有可审计的实时 Regime、Mover、Volume、Funding/OI 快照；全部保持 unavailable。", "No auditable live Regime, Mover, Volume, or Funding/OI snapshot is registered; all remain unavailable.")}</p></div><dl><div><dt>Regime</dt><dd>UNAVAILABLE</dd></div><div><dt>Mover</dt><dd>UNAVAILABLE</dd></div><div><dt>Volume</dt><dd>UNAVAILABLE</dd></div><div><dt>Funding / OI</dt><dd>UNAVAILABLE</dd></div></dl></section>
  <section class="dc-assets"><header><div><span>DATA ASSETS</span><h2>${t("服务端登记的数据资产", "Server-registered data assets")}</h2></div><code>runtimeApplied=false</code></header>${assets.map((asset) => `<article class="dc-asset"><header><div><span class="dc-status dc-status--${asset.health}">${asset.health}</span><h3>${esc(asset.name)}</h3><p>${esc(asset.sourceName)} · ${asset.sourceKind === "csv_historical" ? t("历史快照", "historical snapshot") : t("公共能力，未登记实时快照", "public capability; no registered live snapshot")}</p></div><button type="button" data-dc-send="${esc(asset.assetId)}" ${asset.dataset ? "" : "disabled"}>${t("送入编排", "Send to orchestration")}</button></header><div class="dc-grid"><div><small>${t("能力", "Capability")}</small><code>${esc(asset.capabilityId)}</code></div><div><small>Dataset snapshot</small><strong>${asset.dataset ? `${esc(asset.dataset.version)} · ${esc(asset.dataset.fingerprint.slice(0, 20))}…` : t("未登记 / unavailable", "not registered / unavailable")}</strong></div><div><small>${t("健康 / 质量", "Health / quality")}</small><strong>${Math.round(asset.quality.completeness * 100)}% · ${esc(asset.quality.label)}</strong></div><div><small>Schema</small><code>${asset.schemaPreview.join(", ")}</code></div></div>${asset.dataset ? `<details><summary>Lineage</summary><code>${asset.lineage.map(esc).join(" → ")}</code><p>${t("送入编排只创建受控 Draft 意图；不会 Apply、启动 Paper Run 或写入交易所。", "Sending creates a controlled Draft intent only; it cannot apply, start a Paper Run, or write to an exchange.")}</p></details>` : ""}</article>`).join("")}</section>`;
}

async function load(root: HTMLElement): Promise<void> {
  activeRequest?.abort();
  const request = new AbortController();
  activeRequest = request;

  try {
    if (!session.token) {
      throw new Error(
        t(
          "只读：未连接本地 Operator",
          "Readonly: local Operator is not connected",
        ),
      );
    }
    const response = await fetch(
      `${session.apiBase}/api/orchestration/data-center/assets`,
      {
        headers: { authorization: `Bearer ${session.token}` },
        signal: request.signal,
      },
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    assets = (
      (await response.json()) as { data: { assets: Asset[] } }
    ).data.assets;
    error = "";
  } catch (cause) {
    if (request.signal.aborted) {
      return;
    }
    error =
      cause instanceof Error ? cause.message : "DATA_CENTER_UNAVAILABLE";
  } finally {
    if (activeRequest === request) {
      activeRequest = undefined;
    }
  }

  if (lifecycle.current() === root) {
    render(root);
  }
}

document.addEventListener(
  "click",
  (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-dc-send]",
    );
    if (!button) return;
    const asset = assets.find(
      (item) => item.assetId === button.dataset.dcSend,
    );
    if (!asset?.dataset) return;
    window.dispatchEvent(
      new CustomEvent("tradebot:data-center-send", { detail: asset }),
    );
  },
  true,
);

const lifecycle = createDataCenterHostLifecycle<HTMLElement>(
  (root) => {
    render(root);
    void load(root);
  },
  () => {
    activeRequest?.abort();
    activeRequest = undefined;
  },
);

const app = document.querySelector("#app") ?? document.body;
new MutationObserver(() => lifecycle.sync(host())).observe(app, {
  childList: true,
  subtree: true,
});
lifecycle.sync(host());
