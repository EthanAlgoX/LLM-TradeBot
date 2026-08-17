import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, BookOpenText, ScanSearch, Workflow } from "lucide-react";

import {
  strategyWorkspaceApi,
  type StrategySummary,
  type StrategyVersion,
} from "../../api/strategyWorkspace";

export type SelectedProductStrategy = {
  summary: StrategySummary;
  version: StrategyVersion;
};

const productMeta = {
  research_report: {
    label: "单股研究策略",
    contract: "ResearchReport",
    icon: BookOpenText,
    empty: "策略中心还没有正式发布的单股研究策略。",
  },
  candidate_screening: {
    label: "选股策略",
    contract: "CandidateList",
    icon: ScanSearch,
    empty: "策略中心还没有正式发布的选股策略。",
  },
} as const;

type SupportedPurpose = keyof typeof productMeta;

function marketLabel(version: StrategyVersion) {
  const market = String(version.screeningPolicy?.market || "cn").toLowerCase();
  return ({ cn: "A 股", hk: "港股", us: "美股" } as Record<string, string>)[market] || market.toUpperCase();
}

function dataLabel(version: StrategyVersion) {
  const snapshot = version.dataPermissionSnapshot || {};
  const labels = [
    ["kline", "K 线"],
    ["news", "新闻"],
    ["fundamentals", "基本面"],
    ["other", "其他"],
  ].filter(([key]) => {
    const value = snapshot[key];
    return typeof value === "object" && value !== null && (value as { enabled?: boolean }).enabled !== false;
  }).map(([, label]) => label);
  return labels.length ? labels.join(" + ") : "系统默认输入";
}

export function StrategyProductSelector({
  purpose,
  disabled = false,
  onChange,
}: {
  purpose: SupportedPurpose;
  disabled?: boolean;
  onChange: (selection: SelectedProductStrategy | null) => void;
}) {
  const initialParams = useMemo(() => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search), []);
  const [strategies, setStrategies] = useState<StrategySummary[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState(() => initialParams.get("versionId") || "");
  const [selection, setSelection] = useState<SelectedProductStrategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const meta = productMeta[purpose];
  const Icon = meta.icon;

  useEffect(() => {
    let active = true;
    strategyWorkspaceApi.listStrategies()
      .then((items) => {
        if (!active) return;
        setStrategies(items);
        setError("");
      })
      .catch(() => {
        if (active) setError("暂时无法读取策略中心，请稍后重试。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [purpose]);

  const options = useMemo(() => strategies
    .filter((item) =>
      item.currentPublishedVersionId
      && item.productRole !== "kernel"
      && item.currentStrategyPurpose === purpose
      && item.kernelExecutionStatus === "ready"
    )
    .map((item) => ({
      summary: item,
      versionId: item.currentPublishedVersionId as number,
      versionNumber: item.currentPublishedVersionNumber,
    })), [purpose, strategies]);

  const displayOptions = useMemo(() => {
    if (!selection || options.some((item) => item.versionId === selection.version.id)) {
      return options;
    }
    return [
      ...options,
      {
        summary: selection.summary,
        versionId: selection.version.id,
        versionNumber: selection.version.versionNumber,
      },
    ];
  }, [options, selection]);

  useEffect(() => {
    if (!selectedVersionId || loading) return;
    const versionId = Number(selectedVersionId);
    const currentParams = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    const linkedStrategyId = Number(currentParams.get("strategyId"));
    const option = options.find((item) => item.versionId === versionId);
    const summary = option?.summary || strategies.find((item) => item.id === linkedStrategyId);
    if (!Number.isInteger(versionId) || !summary || !Number.isInteger(linkedStrategyId)) {
      queueMicrotask(() => {
        setSelection(null);
        onChange(null);
        setError("链接中的策略或版本无效，请从策略中心重新打开。");
      });
      return;
    }
    let active = true;
    strategyWorkspaceApi.getVersion(versionId)
      .then((version) => {
        if (!active) return;
        if (
          version.strategyId !== linkedStrategyId
          || version.strategyId !== summary.id
          || version.status !== "PUBLISHED"
          || version.strategyPurpose !== purpose
          || version.outputContract !== meta.contract
          || version.strategyPackage?.executionStatus !== "ready"
        ) {
          throw new Error("incompatible strategy version");
        }
        const next = { summary, version };
        setSelection(next);
        setError("");
        onChange(next);
      })
      .catch(() => {
        if (!active) return;
        setSelection(null);
        onChange(null);
        setError("无法读取这个正式策略版本，请回到策略中心检查版本状态。");
      });
    return () => { active = false; };
  }, [loading, meta.contract, onChange, options, purpose, selectedVersionId, strategies]);

  const choose = (value: string) => {
    setSelectedVersionId(value);
    setSelection(null);
    onChange(null);
    const nextParams = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    if (!value) {
      nextParams.delete("strategyId");
      nextParams.delete("versionId");
    } else {
      const option = options.find((item) => String(item.versionId) === value);
      if (option) nextParams.set("strategyId", String(option.summary.id));
      nextParams.set("versionId", value);
    }
    if (typeof window !== "undefined") {
      const query = nextParams.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  };

  return (
    <section className="workspace-surface overflow-hidden p-0" aria-label={`选择${meta.label}`}>
      <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] lg:items-end">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-primary">
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span className="text-xs font-semibold">来自策略中心</span>
          </div>
          <h2 className="mt-2 text-lg font-semibold text-foreground">先选择一个正式{meta.label}</h2>
          <p className="mt-1 text-sm leading-6 text-secondary-text">
            页面只负责提供运行输入并展示结果；正式 StrategyVersion 声明不可变的市场、数据源、参数和策略内核边界。
          </p>
        </div>
        <label className="grid gap-2 text-xs font-medium text-secondary-text">
          {meta.label}
          <select
            aria-label={meta.label}
            className="h-11 w-full rounded-control border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
            value={selectedVersionId}
            disabled={disabled || loading || displayOptions.length === 0}
            onChange={(event) => choose(event.target.value)}
          >
            <option value="">{loading ? "正在读取正式版本…" : `请选择${meta.label}`}</option>
            {displayOptions.map(({ summary, versionId, versionNumber }) => (
              <option key={versionId} value={versionId}>
                {summary.name} · V{versionNumber ?? "—"}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div className="border-t border-danger/25 bg-danger/5 px-5 py-3 text-sm text-danger">{error}</div>
      ) : displayOptions.length === 0 && !loading ? (
        <div className="flex flex-col gap-3 border-t border-border bg-subtle/50 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-secondary-text">{meta.empty}</span>
          <a href="/strategies" className="inline-flex items-center gap-2 font-medium text-primary hover:underline">
            前往策略中心配置 <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      ) : selection ? (
        <div className="grid gap-px border-t border-border bg-border md:grid-cols-4">
          <StrategyFact label="正式版本" value={`V${selection.version.versionNumber ?? "—"} · 已发布`} />
          <StrategyFact label="输出契约" value={meta.contract} mono />
          <StrategyFact label="市场与输入" value={`${marketLabel(selection.version)} · ${dataLabel(selection.version)}`} />
          <StrategyFact
            label="策略内核快照"
            value={selection.version.agentWorkflowVersionId ? `版本 #${selection.version.agentWorkflowVersionId}` : "历史内嵌快照"}
            icon={<Workflow className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
          />
        </div>
      ) : null}
    </section>
  );
}

function StrategyFact({ label, value, mono = false, icon }: { label: string; value: string; mono?: boolean; icon?: ReactNode }) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="text-xs text-muted-text">{label}</p>
      <p className={`mt-1 flex items-center gap-2 text-sm font-medium text-foreground ${mono ? "font-mono" : ""}`}>
        {icon}{value}
      </p>
    </div>
  );
}

export function StrategyReportHeader({
  selection,
  title,
  description,
  status,
}: {
  selection: SelectedProductStrategy;
  title: string;
  description: string;
  status: string;
}) {
  return (
    <header className="border-b border-border pb-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium text-primary">{selection.summary.name} · V{selection.version.versionNumber ?? "—"}</p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-foreground">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-secondary-text">{description}</p>
        </div>
        <span className="w-fit rounded-md border border-border bg-subtle px-2.5 py-1.5 text-xs font-medium text-secondary-text">{status}</span>
      </div>
    </header>
  );
}
