import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  CircleAlert,
  Database,
  FlaskConical,
  PlayCircle,
} from "lucide-react";
import { Link } from "react-router-dom";

import {
  strategyWorkspaceApi,
  type AutomaticStrategyRunBatch,
  type ContinuousStrategyRunControl,
  type StrategyDataSource,
  type StrategySummary,
  type StrategyValidationVersionStatus,
} from "../api/strategyWorkspace";
import { AppPage, Card, PageHeader } from "../components/common";
import { purposeDefinition } from "../utils/strategyPurpose";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const runStatusLabel: Record<AutomaticStrategyRunBatch["status"], string> = {
  queued: "等待执行",
  running: "运行中",
  completed: "已完成",
  completed_with_failures: "部分失败",
  failed: "失败",
  cancelled: "已取消",
};

const activeBatchStatuses = new Set<AutomaticStrategyRunBatch["status"]>([
  "queued",
  "running",
]);

function strategyTarget(item: StrategySummary) {
  return `/strategies/${item.id}`;
}

export default function StrategyOverviewPage() {
  const [items, setItems] = useState<StrategySummary[]>([]);
  const [automaticRuns, setAutomaticRuns] = useState<AutomaticStrategyRunBatch[]>([]);
  const [continuousRuns, setContinuousRuns] = useState<ContinuousStrategyRunControl[]>([]);
  const [dataSources, setDataSources] = useState<StrategyDataSource[]>([]);
  const [validationStatuses, setValidationStatuses] = useState<Record<number, StrategyValidationVersionStatus>>({});
  const [validationUnavailable, setValidationUnavailable] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      const results = await Promise.allSettled([
        strategyWorkspaceApi.listStrategies(),
        strategyWorkspaceApi.listAutomaticRuns(),
        strategyWorkspaceApi.listContinuousRuns(),
        strategyWorkspaceApi.listDataSources(),
      ]);
      if (!active) return;

      const strategies = results[0].status === "fulfilled" ? results[0].value.filter((item) => item.productRole !== "kernel") : [];
      setItems(strategies);
      setAutomaticRuns(results[1].status === "fulfilled" ? results[1].value : []);
      setContinuousRuns(results[2].status === "fulfilled" ? results[2].value : []);
      setDataSources(results[3].status === "fulfilled" ? results[3].value : []);
      if (results.some((result) => result.status === "rejected")) {
        setError("部分运营摘要暂时无法读取；页面只展示已成功返回的真实记录。");
      }

      const tradingVersions = strategies.flatMap((item) =>
        item.currentPublishedVersionId && item.currentStrategyPurpose === "trading_decision"
          ? [item.currentPublishedVersionId]
          : [],
      );
      const statusResults = await Promise.allSettled(
        tradingVersions.map((versionId) => strategyWorkspaceApi.getValidationStatus(versionId)),
      );
      if (!active) return;
      const nextStatuses: Record<number, StrategyValidationVersionStatus> = {};
      let unavailable = 0;
      statusResults.forEach((result, index) => {
        if (result.status === "fulfilled") nextStatuses[tradingVersions[index]] = result.value;
        else unavailable += 1;
      });
      setValidationStatuses(nextStatuses);
      setValidationUnavailable(unavailable);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const summary = useMemo(() => {
    const published = items.filter((item) => Boolean(item.currentPublishedVersionId));
    const tradingVersions = published.flatMap((item) =>
      item.currentPublishedVersionId && item.currentStrategyPurpose === "trading_decision"
        ? [item.currentPublishedVersionId]
        : [],
    );
    const pendingValidation = tradingVersions.filter((versionId) => {
      const status = validationStatuses[versionId]?.status;
      return status && status !== "completed" && status !== "validated";
    }).length;
    return {
      published: published.length,
      pendingValidation,
      activeRuns:
        automaticRuns.filter((item) => activeBatchStatuses.has(item.status)).length +
        continuousRuns.filter((item) => item.status === "running").length,
      failedRuns: automaticRuns.filter(
        (item) => item.status === "failed" || item.status === "completed_with_failures",
      ).length,
      readySources: dataSources.filter((item) => item.selectable).length,
      unavailableSources: dataSources.filter((item) => !item.selectable).length,
    };
  }, [automaticRuns, continuousRuns, dataSources, items, validationStatuses]);

  const latestStrategies = useMemo(
    () => [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4),
    [items],
  );
  const latestRuns = useMemo(
    () => [...automaticRuns].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4),
    [automaticRuns],
  );
  const hasAttention =
    summary.pendingValidation > 0 ||
    summary.failedRuns > 0 ||
    summary.unavailableSources > 0 ||
    validationUnavailable > 0;

  return (
    <AppPage className="space-y-7" data-testid="home-page">
      <PageHeader
        eyebrow="Strategy operations"
        title="策略首页"
        description="查看策略、验证、运行和数据依赖的当前状态。这里只汇总真实保存的记录，不展示推测收益或虚构 KPI。"
        actions={<Link className="btn-primary" to="/strategies">管理策略</Link>}
      />

      {error ? (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      ) : null}

      <section aria-labelledby="strategy-summary-heading">
        <h2 id="strategy-summary-heading" className="sr-only">策略运营摘要</h2>
        <Card variant="bordered" padding="none">
          <dl className="grid grid-cols-2 xl:grid-cols-4">
            {[
              { label: "策略总数", value: items.length, detail: `${summary.published} 个已有正式版本` },
              { label: "待历史验证", value: summary.pendingValidation, detail: "仅统计交易决策正式版本" },
              { label: "活跃运行", value: summary.activeRuns, detail: "活动批次与持续运行计划" },
              { label: "可用数据源", value: summary.readySources, detail: "当前可由策略调用的连接" },
            ].map((metric, index) => (
              <div key={metric.label} className={`px-4 py-5 sm:px-5 ${index === 1 ? "border-l border-border/70" : ""} ${index === 2 ? "border-t border-border/70 xl:border-l xl:border-t-0" : ""} ${index === 3 ? "border-l border-t border-border/70 xl:border-t-0" : ""}`}>
                <dt className="text-xs font-medium text-secondary-text">{metric.label}</dt>
                <dd className="mt-2 font-mono text-[1.8rem] font-semibold tabular-nums tracking-[-0.04em] text-foreground">{loading ? "—" : metric.value}</dd>
                <p className="mt-1 text-xs leading-5 text-muted-text">{metric.detail}</p>
              </div>
            ))}
          </dl>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
        <Card variant="bordered" padding="lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">最近运行</h2>
              <p className="mt-1 text-sm text-secondary-text">来自运行中心的真实研究批次。</p>
            </div>
            <Link to="/runs" className="inline-flex items-center gap-1 text-sm font-medium text-cyan">全部运行 <ArrowRight className="h-4 w-4" /></Link>
          </div>
          {loading ? <p className="mt-5 text-sm text-secondary-text">正在读取运行记录…</p> : latestRuns.length ? (
            <ol className="mt-4 divide-y divide-border/60">
              {latestRuns.map((run) => (
                <li key={run.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{run.strategyName} · V{run.versionNumber ?? "—"}</p>
                    <p className="mt-1 text-xs text-muted-text">批次 #{run.id} · {dateFormatter.format(new Date(run.createdAt))}</p>
                  </div>
                  <span className={`shrink-0 text-xs font-medium ${run.status === "failed" || run.status === "completed_with_failures" ? "text-warning" : run.status === "running" || run.status === "queued" ? "text-cyan" : "text-secondary-text"}`}>{runStatusLabel[run.status]}</span>
                </li>
              ))}
            </ol>
          ) : <p className="mt-5 text-sm leading-6 text-secondary-text">尚无运行批次。策略正式发布后，可在运行中心启动研究运行。</p>}
        </Card>

        <Card variant="gradient" padding="lg">
          <Activity className="h-5 w-5 text-cyan" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-semibold text-foreground">需要关注</h2>
          {loading ? <p className="mt-3 text-sm text-secondary-text">正在核对当前状态…</p> : hasAttention ? (
            <ul className="mt-3 space-y-3 text-sm leading-6 text-secondary-text">
              {summary.pendingValidation ? <li><Link to="/backtests" className="font-medium text-warning hover:underline">{summary.pendingValidation} 个交易策略版本仍待历史验证</Link></li> : null}
              {summary.failedRuns ? <li><Link to="/runs" className="font-medium text-warning hover:underline">{summary.failedRuns} 个运行批次失败或部分失败</Link></li> : null}
              {summary.unavailableSources ? <li><Link to="/data" className="font-medium text-warning hover:underline">{summary.unavailableSources} 个数据连接尚未配置</Link></li> : null}
              {validationUnavailable ? <li>{validationUnavailable} 个版本的验证状态暂时无法读取</li> : null}
            </ul>
          ) : <p className="mt-3 text-sm leading-6 text-secondary-text">当前没有需要立即处理的阻断项。</p>}
        </Card>
      </section>

      <section aria-labelledby="recent-strategies-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="recent-strategies-heading" className="text-lg font-semibold text-foreground">最近更新策略</h2>
            <p className="mt-1 text-sm text-secondary-text">策略首页只提供快捷入口；完整版本与说明仍在策略中心管理。</p>
          </div>
          <Link to="/strategies" className="hidden items-center gap-1 text-sm font-medium text-cyan sm:inline-flex">全部策略 <ArrowRight className="h-4 w-4" /></Link>
        </div>
        {loading ? <Card variant="bordered" padding="lg" className="mt-4"><p className="text-sm text-secondary-text">正在读取策略…</p></Card> : latestStrategies.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {latestStrategies.map((item) => {
              const purpose = purposeDefinition(item.currentStrategyPurpose ?? undefined);
              return (
                <Link key={item.id} to={strategyTarget(item)} className="group rounded-xl border border-border/70 bg-card p-4 transition-colors hover:bg-hover/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{item.name}</p>
                      <p className="mt-1 text-xs text-secondary-text">{purpose.shortLabel} · 输出 {item.currentOutputContract ?? purpose.output}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${item.currentPublishedVersionId ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{item.currentPublishedVersionId ? `正式 V${item.currentPublishedVersionNumber ?? "—"}` : "尚未发布"}</span>
                  </div>
                  <p className="mt-3 text-xs text-muted-text">更新于 {dateFormatter.format(new Date(item.updatedAt))}</p>
                </Link>
              );
            })}
          </div>
        ) : (
          <Card variant="bordered" padding="lg" className="mt-4">
            <BookOpen className="h-5 w-5 text-cyan" aria-hidden="true" />
            <p className="mt-3 font-medium text-foreground">还没有策略记录</p>
            <p className="mt-1 text-sm leading-6 text-secondary-text">前往策略中心查看默认策略，或按生成指南上传完整策略包。</p>
          </Card>
        )}
      </section>

      <section aria-labelledby="lifecycle-heading" className="border-t border-border/60 pt-7">
        <div>
          <h2 id="lifecycle-heading" className="text-lg font-semibold text-foreground">策略运行链</h2>
          <p className="mt-1 text-sm leading-6 text-secondary-text">策略是带输入输出契约的完整黑盒；网站负责接入版本、验证证据和持续运行。</p>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <Link to="/strategies" className="rounded-xl border border-border/70 p-5 transition-colors hover:bg-hover/50"><BookOpen className="h-5 w-5 text-cyan" aria-hidden="true" /><p className="mt-3 font-medium text-foreground">1 · 策略中心</p><p className="mt-1 text-sm leading-6 text-secondary-text">查看完整策略、输入输出契约、说明与不可变版本。</p></Link>
          <Link to="/backtests" className="rounded-xl border border-border/70 p-5 transition-colors hover:bg-hover/50"><FlaskConical className="h-5 w-5 text-cyan" aria-hidden="true" /><p className="mt-3 font-medium text-foreground">2 · 验证中心</p><p className="mt-1 text-sm leading-6 text-secondary-text">绑定策略版本和数据快照，保存实验结果；验证不等于真实交易。</p></Link>
          <Link to="/runs" className="rounded-xl border border-border/70 p-5 transition-colors hover:bg-hover/50"><PlayCircle className="h-5 w-5 text-cyan" aria-hidden="true" /><p className="mt-3 font-medium text-foreground">3 · 运行中心</p><p className="mt-1 text-sm leading-6 text-secondary-text">运行正式策略并观察研究状态；当前不会自动下单。</p></Link>
        </div>
        <Link to="/data" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-secondary-text hover:text-foreground"><Database className="h-4 w-4" />数据中心持续提供并核对策略依赖 <ArrowRight className="h-4 w-4" /></Link>
      </section>
    </AppPage>
  );
}
