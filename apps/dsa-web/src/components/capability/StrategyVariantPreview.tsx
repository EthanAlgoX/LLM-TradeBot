import { isAxiosError } from "axios";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  GitCompareArrows,
  LoaderCircle,
} from "lucide-react";

import {
  strategyWorkspaceApi,
  type StrategyValidationComparison,
  type StrategyValidationComparisonMetric,
  type StrategyValidationExperiment,
} from "../../api/strategyWorkspace";

const percentFormatter = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  maximumFractionDigits: 2,
});
const signedPercentFormatter = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});
const numberFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});
const signedNumberFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});
const integerFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 0,
});
const signedIntegerFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});
function apiErrorMessage(cause: unknown) {
  if (!isAxiosError(cause)) return "暂时无法完成版本对比，请稍后重试。";
  const detail = cause.response?.data?.detail as { message?: string } | undefined;
  return detail?.message || "暂时无法完成版本对比，请稍后重试。";
}

function versionLabel(experiment: StrategyValidationExperiment) {
  return experiment.versionStatus === "DRAFT"
    ? "发布候选草稿"
    : `正式版本 V${experiment.versionNumber ?? "—"}`;
}

function experimentLabel(experiment: StrategyValidationExperiment) {
  return `${versionLabel(experiment)} · 实验 #${experiment.id} · ${experiment.config.startDate} 至 ${experiment.config.endDate}`;
}

function formatMetric(metric: StrategyValidationComparisonMetric, value: number | null | undefined, signed = false) {
  if (value == null) return "—";
  if (metric.format === "percent") return (signed ? signedPercentFormatter : percentFormatter).format(value);
  if (metric.format === "integer") return (signed ? signedIntegerFormatter : integerFormatter).format(value);
  return (signed ? signedNumberFormatter : numberFormatter).format(value);
}

function sideLabel(side: StrategyValidationComparison["baseline"]) {
  return side.versionStatus === "DRAFT" ? "发布候选草稿" : `正式版本 V${side.versionNumber ?? "—"}`;
}

interface StrategyVariantPreviewProps {
  strategyId: number;
  currentVersionId: number;
  refreshToken?: string;
}

export function StrategyVariantPreview({
  strategyId,
  currentVersionId,
  refreshToken = "",
}: StrategyVariantPreviewProps) {
  const [candidates, setCandidates] = useState<StrategyValidationExperiment[]>([]);
  const [baselineId, setBaselineId] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [comparison, setComparison] = useState<StrategyValidationComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setComparison(null);
    strategyWorkspaceApi.listValidationComparisonCandidates(strategyId)
      .then((items) => {
        if (!active) return;
        setCandidates(items);
        const current = items.find((item) => item.strategyVersionId === currentVersionId) ?? items[0] ?? null;
        const target = items.find((item) => current && item.strategyVersionId !== current.strategyVersionId) ?? null;
        setBaselineId(current?.id ?? null);
        setTargetId(target?.id ?? null);
      })
      .catch((cause) => {
        if (!active) return;
        setCandidates([]);
        setBaselineId(null);
        setTargetId(null);
        setError(apiErrorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [strategyId, currentVersionId, refreshToken]);

  const baseline = useMemo(
    () => candidates.find((item) => item.id === baselineId) ?? null,
    [baselineId, candidates],
  );
  const targetOptions = useMemo(
    () => candidates.filter((item) => !baseline || item.strategyVersionId !== baseline.strategyVersionId),
    [baseline, candidates],
  );
  const versionCount = useMemo(
    () => new Set(candidates.map((item) => item.strategyVersionId)).size,
    [candidates],
  );

  const selectBaseline = (nextId: number) => {
    const next = candidates.find((item) => item.id === nextId) ?? null;
    const nextTarget = candidates.find((item) => next && item.strategyVersionId !== next.strategyVersionId) ?? null;
    setBaselineId(next?.id ?? null);
    setTargetId(nextTarget?.id ?? null);
    setComparison(null);
    setError("");
  };

  const compare = async () => {
    if (!baselineId || !targetId) return;
    setComparing(true);
    setError("");
    try {
      setComparison(await strategyWorkspaceApi.compareValidationExperiments(baselineId, targetId));
    } catch (cause) {
      setComparison(null);
      setError(apiErrorMessage(cause));
    } finally {
      setComparing(false);
    }
  };

  return (
    <section className="workspace-surface overflow-hidden p-0" aria-labelledby="variant-preview-title">
      <div className="border-b border-border/70 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <GitCompareArrows className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 id="variant-preview-title" className="text-lg font-semibold text-foreground">策略版本对比</h2>
          {!loading ? (
            <span className="rounded-full border border-border/70 bg-base/60 px-2.5 py-1 text-xs font-medium text-secondary-text">
              {versionCount} 个可比较版本
            </span>
          ) : null}
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-text">
          选择同一策略的两条正式历史回放。后端会先校验区间、资金、成本、成交和调仓口径，再读取真实结果计算差异。
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 px-5 py-6 text-sm text-secondary-text">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />正在读取可比较的历史回放…
        </div>
      ) : null}

      {!loading && candidates.length === 0 ? (
        <div className="px-5 py-6">
          <p className="font-medium text-foreground">还没有可用于版本对比的正式回放。</p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-text">
            当前只接受已完成、区间覆盖完整且冻结快照校验通过的正式回放；指定股票诊断和旧版未校验记录不会进入候选列表。
          </p>
        </div>
      ) : null}

      {!loading && candidates.length > 0 ? (
        <div className="px-5 py-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] lg:items-end">
            <label className="min-w-0 text-sm font-medium text-foreground">
              基准版本回放
              <select
                aria-label="基准版本回放"
                className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-2.5 text-sm text-foreground"
                value={baselineId ?? ""}
                onChange={(event) => selectBaseline(Number(event.target.value))}
              >
                {candidates.map((item) => <option key={item.id} value={item.id}>{experimentLabel(item)}</option>)}
              </select>
            </label>
            <ArrowRight className="hidden h-5 w-5 text-muted-text lg:block" aria-hidden="true" />
            <label className="min-w-0 text-sm font-medium text-foreground">
              对比版本回放
              <select
                aria-label="对比版本回放"
                className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-2.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                value={targetId ?? ""}
                disabled={targetOptions.length === 0}
                onChange={(event) => {
                  setTargetId(Number(event.target.value));
                  setComparison(null);
                  setError("");
                }}
              >
                {targetOptions.length === 0 ? <option value="">没有其他已回放版本</option> : null}
                {targetOptions.map((item) => <option key={item.id} value={item.id}>{experimentLabel(item)}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="btn-primary inline-flex items-center justify-center gap-2"
              disabled={!baselineId || !targetId || comparing}
              onClick={() => void compare()}
            >
              {comparing ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <GitCompareArrows className="h-4 w-4" aria-hidden="true" />}
              {comparing ? "正在核对口径…" : "比较两个版本"}
            </button>
          </div>
          {targetOptions.length === 0 ? (
            <p className="mt-3 text-sm leading-6 text-secondary-text">
              需要同一策略的另一个版本也完成一次正式历史回放，才可以进行版本对比。
            </p>
          ) : null}
          {error ? (
            <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm leading-6 text-warning">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {comparison ? (
        <div className="border-t border-border/70">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-base/35 px-5 py-3 text-xs text-secondary-text">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />比较口径已通过后端校验
            </span>
            <span>{comparison.comparisonBasis.startDate} — {comparison.comparisonBasis.endDate}</span>
            <span>{comparison.comparisonBasis.market.toUpperCase()} · {comparison.comparisonBasis.engineVersion}</span>
            <span>{comparison.comparisonBasis.snapshotMode === "exact_snapshot" ? "完全相同的冻结行情快照" : "对齐区间的独立冻结快照"}</span>
          </div>
          {comparison.comparisonBasis.snapshotMode !== "exact_snapshot" ? (
            <p className="border-t border-border/60 px-5 py-3 text-xs leading-5 text-warning">
              两个版本的股票池或冻结行情并不完全相同；这里比较的是相同实验假设下的完整版本表现，不能用于逐标的归因。
            </p>
          ) : null}
          <p className="border-t border-border/60 px-5 py-2 text-xs text-muted-text sm:hidden">
            左右滑动表格可查看目标版本与差值。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-y border-border/60 bg-base/45 text-xs text-secondary-text">
                <tr>
                  <th className="px-5 py-3 font-medium">比较维度</th>
                  <th className="px-4 py-3 text-right font-medium">
                    {sideLabel(comparison.baseline)}<span className="ml-1 text-muted-text">#{comparison.baseline.experimentId}</span>
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {sideLabel(comparison.target)}<span className="ml-1 text-muted-text">#{comparison.target.experimentId}</span>
                  </th>
                  <th className="px-5 py-3 text-right font-medium">目标 − 基准</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {comparison.metrics.map((metric) => (
                  <tr key={metric.key}>
                    <th scope="row" className="px-5 py-3 font-medium text-foreground">{metric.label}</th>
                    <td className="px-4 py-3 text-right tabular-nums text-secondary-text">{formatMetric(metric, metric.baselineValue)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">{formatMetric(metric, metric.targetValue)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-secondary-text">{formatMetric(metric, metric.delta, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border/60 px-5 py-3 text-xs text-secondary-text">
            <span>基准 {comparison.baseline.symbolCount} 个标的</span>
            <span>目标 {comparison.target.symbolCount} 个标的</span>
            <span>{comparison.comparisonBasis.sameUniverse ? "股票池一致" : "股票池不同"}</span>
            <span>差值只陈述结果变化，不自动宣称哪个版本有效。</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
