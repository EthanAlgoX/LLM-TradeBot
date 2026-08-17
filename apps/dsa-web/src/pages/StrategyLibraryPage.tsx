import {
  ArrowRight,
  BookOpen,
  CandlestickChart,
  Code2,
  Database,
  FileArchive,
  FileText,
  FlaskConical,
  Layers3,
  LoaderCircle,
  PlayCircle,
  RefreshCw,
  ScanSearch,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  strategyWorkspaceApi,
  type StrategyDataRequirement,
  type StrategyPurpose,
  type StrategySummary,
} from "../api/strategyWorkspace";
import { AppPage, Card, PageHeader } from "../components/common";
import { StrategyLifecycleNav } from "../components/strategy/StrategyLifecycleNav";
import { purposeDefinition } from "../utils/strategyPurpose";

type Filter = "all" | StrategyPurpose;

const purposeIcon = {
  research_report: FileText,
  candidate_screening: ScanSearch,
  trading_decision: CandlestickChart,
} satisfies Record<StrategyPurpose, typeof FileText>;

const purposeOrder: Record<StrategyPurpose, number> = {
  research_report: 0,
  candidate_screening: 1,
  trading_decision: 2,
};

const purposePresentation: Record<StrategyPurpose, { label: string }> = {
  research_report: {
    label: "单股研究",
  },
  candidate_screening: {
    label: "选股",
  },
  trading_decision: {
    label: "交易策略",
  },
};

function StrategyPurposeMarker({ purpose }: { purpose: StrategyPurpose }) {
  const Icon = purposeIcon[purpose];
  const presentation = purposePresentation[purpose];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/70 bg-base px-2 py-1 text-[11px] font-medium text-secondary-text"
      aria-label={`${presentation.label}类型`}
    >
      <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
      {presentation.label}
    </span>
  );
}

function strategyTarget(item: StrategySummary) {
  return `/strategies/${item.id}`;
}

function productTarget(item: StrategySummary) {
  if (!item.currentPublishedVersionId) return strategyTarget(item);
  const query = `strategyId=${item.id}&versionId=${item.currentPublishedVersionId}`;
  if (item.currentStrategyPurpose === "research_report") return `/stock-research?${query}`;
  if (item.currentStrategyPurpose === "candidate_screening") return `/screening?${query}`;
  return `/backtests?${query}`;
}

function purposeLabel(purpose?: StrategyPurpose | null) {
  return purposeDefinition(purpose || "trading_decision");
}

const dependencyKindLabel = {
  kline: "行情 / K 线",
  news: "新闻",
  fundamentals: "基本面",
  other: "其他数据",
} as const;

const dependencyRequirementLabel: Record<string, string> = {
  historical_ohlcv: "历史日线",
  market_snapshot: "市场快照",
  daily_ohlcv: "历史日线增强",
  candidate_market_data: "候选市场数据",
  fundamentals: "基本面",
  news: "新闻",
  sentiment: "情绪与社交信号",
};

function dataRequirementLabel(requirement: StrategyDataRequirement) {
  return dependencyRequirementLabel[requirement.id] || dependencyKindLabel[requirement.kind];
}

export default function StrategyLibraryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<StrategySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [configuringKernelId, setConfiguringKernelId] = useState<number | null>(null);
  const [configurationName, setConfigurationName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await strategyWorkspaceApi.listStrategies());
    } catch {
      setError("无法加载策略。请检查服务连接后重试。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.title = "策略中心 - LLM TradeBot";
    void load();
  }, []);

  const kernels = useMemo(
    () => items.filter((item) => item.productRole === "kernel"),
    [items],
  );
  const visibleItems = useMemo(
    () =>
      [...items]
        .filter((item) => item.productRole !== "kernel")
        .filter((item) => filter === "all" || item.currentStrategyPurpose === filter)
        .sort(
          (left, right) =>
            purposeOrder[left.currentStrategyPurpose || "trading_decision"] -
            purposeOrder[right.currentStrategyPurpose || "trading_decision"],
        ),
    [filter, items],
  );

  const beginConfiguration = (item: StrategySummary) => {
    setConfiguringKernelId(item.id);
    setConfigurationName(`${item.name} · 运行配置`);
    setError("");
  };

  const createConfiguration = async (item: StrategySummary) => {
    const kernelVersionId = item.kernelVersionId || item.currentPublishedVersionId || item.activeDraftVersionId;
    if (!kernelVersionId || !configurationName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const result = await strategyWorkspaceApi.createConfiguredStrategy(
        kernelVersionId,
        configurationName.trim(),
        `基于“${item.name}”策略内核创建的独立运行配置。`,
      );
      navigate(`/strategies/${result.strategy.id}/editor?versionId=${result.draft.id}`);
    } catch {
      setError("无法创建运行配置。请确认名称未被占用，然后重试。");
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppPage className="space-y-7">
      <PageHeader
        eyebrow="Strategy products"
        title="策略中心"
        description="先从固定的策略内核创建运行配置，再检查、回测和发布完整策略。内核负责计算逻辑；市场、数据源、周期和风险边界由配置独立决定。"
        actions={
          <Link to="/strategy-development" className="btn-primary inline-flex items-center gap-2">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            策略生成指南
          </Link>
        }
      />

      <StrategyLifecycleNav current="strategy" />

      <section className="grid overflow-hidden rounded-xl border border-border/70 bg-surface lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]" aria-labelledby="strategy-model-heading">
        <div className="px-5 py-6 sm:px-7 sm:py-7">
          <p className="text-xs font-medium text-primary">新的使用方式</p>
          <h2 id="strategy-model-heading" className="mt-2 max-w-2xl text-xl font-semibold tracking-[-0.02em] text-foreground sm:text-2xl">
            策略内核与运行配置分开管理。
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-secondary-text">
            现有 3 个实现和新上传的代码包都只作为策略内核。选择内核后，再配置市场、股票范围、数据源、周期、运行频率和风险边界，才形成可检查与发布的完整策略。
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to="/strategy-development" className="btn-secondary inline-flex items-center gap-2">
              查看输入输出协议 <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link to="/strategies/import" className="btn-primary inline-flex items-center gap-2">
              <FileArchive className="h-4 w-4" aria-hidden="true" />
              上传策略包
            </Link>
          </div>
          <p id="strategy-upload-boundary" className="mt-3 text-xs leading-5 text-muted-text">
            策略包会经过入口、Schema、数据依赖和安全规则检查，并由受限 Python 子进程调用；完整策略仍需另行配置和发布。
          </p>
        </div>
        <div className="border-t border-border/70 bg-subtle/45 px-5 py-6 lg:border-l lg:border-t-0 lg:px-6">
          <p className="text-sm font-semibold text-foreground">完整策略的组成</p>
          <ol className="mt-4 space-y-4">
            {[
              ["策略内核", "固定规则、工具、LLM 逻辑与输入输出契约。"],
              ["运行配置", "市场、标的、数据、周期、频率、参数与风险边界。"],
              ["正式版本", "冻结内核引用和配置，交给验证或运行中心。"],
            ].map(([title, detail], index) => (
              <li key={title} className="grid grid-cols-[24px_1fr] gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
                <span>
                  <span className="block text-sm font-medium text-foreground">{title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-secondary-text">{detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {error ? (
        <Card variant="bordered" padding="lg">
          <p role="alert" className="text-warning">{error}</p>
          <button type="button" className="btn-secondary mt-3 inline-flex items-center gap-2" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" /> 重试
          </button>
        </Card>
      ) : null}

      <section aria-labelledby="strategy-kernels-heading">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="strategy-kernels-heading" className="text-lg font-semibold text-foreground">策略内核</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-secondary-text">内核提供统一的 Python 函数入口，并静态声明说明、数据依赖和输出契约；创建运行配置后才进入产品回测与持续运行。</p>
          </div>
          <span className="text-xs text-muted-text">{kernels.length} 个可用内核</span>
        </div>
        {loading ? (
          <Card variant="bordered" padding="lg" className="mt-4">正在读取策略内核…</Card>
        ) : kernels.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border px-5 py-7 text-sm text-secondary-text">还没有策略内核。可以按生成指南创建并上传一个策略包。</div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-border/70 bg-surface">
            {kernels.map((item, index) => {
              const purpose = item.currentStrategyPurpose || "trading_decision";
              const meta = purposeLabel(purpose);
              const expanded = configuringKernelId === item.id;
              const requirements = item.kernelDataRequirements || [];
              return (
                <article key={item.id} className={index ? "border-t border-border/70" : ""}>
                  <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-foreground">{item.name}</h3>
                        <StrategyPurposeMarker purpose={purpose} />
                        <span className={`rounded-md border px-2 py-0.5 text-[11px] ${item.kernelExecutionStatus === "ready" ? "border-success/30 bg-success/5 text-success" : "border-warning/30 bg-warning/5 text-warning"}`}>{item.kernelExecutionStatus === "ready" ? "函数可调用" : "执行器不可用"}</span>
                      </div>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-text">{item.currentObjective || item.description || "尚未填写策略说明。"}</p>
                      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-text">
                        <span className="inline-flex min-w-0 items-center gap-1.5"><Code2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><code className="break-all">{item.kernelEntrypoint || "尚未声明函数入口"}</code></span>
                        <span className="inline-flex items-center gap-1.5"><Database className="h-3.5 w-3.5" aria-hidden="true" />{requirements.length} 项数据依赖</span>
                      </div>
                      {requirements.length ? <ul className="mt-3 flex flex-wrap gap-2" aria-label={`${item.name} 数据依赖`}>{requirements.map((requirement) => {
                        const label = dataRequirementLabel(requirement);
                        const requirementState = requirement.required ? "必需" : "可选";
                        return <li key={requirement.id} aria-label={`${label}，${requirementState}，来源 ${requirement.sourceIds.join("、")}`} title={requirement.usage} className="rounded-md border border-border/70 bg-base px-2 py-1 text-[11px] text-secondary-text"><span className="font-medium text-foreground">{label}</span> · {requirementState} · {requirement.sourceIds.join(" / ")}</li>;
                      })}</ul> : <p className="mt-3 text-xs text-warning">尚未声明可机器校验的数据依赖。</p>}
                    </div>
                    <dl className="grid gap-2 text-xs">
                      <div className="flex items-center justify-between gap-3"><dt className="text-muted-text">交付结果</dt><dd className="font-medium text-foreground">{meta.label}</dd></div>
                      <div className="flex items-center justify-between gap-3"><dt className="text-muted-text">输出契约</dt><dd><code className="text-primary">{item.currentOutputContract || meta.output}</code></dd></div>
                      <div className="flex items-center justify-between gap-3"><dt className="text-muted-text">配置数量</dt><dd className="text-secondary-text">可创建多套</dd></div>
                    </dl>
                    <button type="button" className="btn-primary inline-flex items-center justify-center gap-2" onClick={() => beginConfiguration(item)}>
                      <Settings2 className="h-4 w-4" aria-hidden="true" /> 创建运行配置
                    </button>
                  </div>
                  {expanded ? (
                    <form className="border-t border-border/70 bg-subtle/45 px-5 py-4" onSubmit={(event) => { event.preventDefault(); void createConfiguration(item); }}>
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                        <label className="grid gap-1.5 text-xs font-medium text-secondary-text">
                          完整策略名称
                          <input autoFocus aria-label="完整策略名称" className="h-10 rounded-control border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" value={configurationName} maxLength={120} onChange={(event) => setConfigurationName(event.target.value)} />
                        </label>
                        <button type="submit" className="btn-primary inline-flex items-center justify-center gap-2" disabled={!configurationName.trim() || creating}>
                          {creating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                          {creating ? "正在创建…" : "进入策略配置"}
                        </button>
                        <button type="button" className="btn-secondary" onClick={() => setConfiguringKernelId(null)} disabled={creating}>取消</button>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted-text">创建后进入独立配置草稿；不会修改这个策略内核，也不会立即发布或运行。</p>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="strategies-heading">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2"><Layers3 className="h-5 w-5 text-primary" aria-hidden="true" /><h2 id="strategies-heading" className="text-lg font-semibold text-foreground">完整策略</h2></div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-secondary-text">这里才是可检查、回测和发布的策略。每条记录都冻结一个内核引用和一套独立运行配置。</p>
          </div>
          <div className="inline-flex w-fit rounded-lg border border-border bg-base p-1" role="group" aria-label="筛选策略类型">
            {([
              ["all", "全部"],
              ["research_report", "单股研究"],
              ["candidate_screening", "选股扫描"],
              ["trading_decision", "交易决策"],
            ] as Array<[Filter, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${filter === value ? "bg-surface text-foreground shadow-sm" : "text-secondary-text hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <Card variant="bordered" padding="lg" className="mt-4">正在读取策略…</Card>
        ) : visibleItems.length === 0 ? (
          <div className="mt-4 grid gap-5 rounded-xl border border-dashed border-border px-5 py-8 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="font-medium text-foreground">{filter === "all" ? "还没有完整策略" : "这个类型下还没有完整策略"}</p>
              <p className="mt-1 text-sm leading-6 text-secondary-text">请先在上方选择一个策略内核，再创建并保存运行配置。</p>
            </div>
            <ShieldCheck className="h-8 w-8 text-muted-text" aria-hidden="true" />
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-border/70 bg-surface">
            {visibleItems.map((item, index) => {
              const purpose = item.currentStrategyPurpose || "trading_decision";
              const meta = purposeLabel(purpose);
              const published = Boolean(item.currentPublishedVersionId);
              const backtestReady = purpose === "trading_decision" && item.backtestReadiness?.ready === true;
              return (
                <article key={item.id} className={index ? "border-t border-border/70" : ""}>
                  <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-foreground">{item.name}</h3>
                        <StrategyPurposeMarker purpose={purpose} />
                        <span className={`rounded-md px-2 py-0.5 text-[11px] ${published ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                          {published ? `已发布 V${item.currentPublishedVersionNumber ?? "—"}` : "草稿"}
                        </span>
                        {published && item.activeDraftVersionId ? <span className="rounded-md bg-warning/10 px-2 py-0.5 text-[11px] text-warning">有未发布修改</span> : null}
                        {published && purpose === "trading_decision" ? (
                          <span className={`rounded-md px-2 py-0.5 text-[11px] ${backtestReady ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                            {backtestReady ? "回测就绪" : "需准备历史股票池"}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-3 max-w-3xl">
                        <p className="text-xs font-medium text-muted-text">策略说明</p>
                        <p className="mt-1 text-sm leading-6 text-secondary-text">{item.currentObjective || item.description || "尚未填写策略说明。"}</p>
                      </div>
                    </div>
                    <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-1">
                      <div className="flex items-center justify-between gap-3"><dt className="text-muted-text">使用入口</dt><dd className="font-medium text-foreground">{meta.destination}</dd></div>
                      <div className="flex items-center justify-between gap-3"><dt className="text-muted-text">输出契约</dt><dd><code className="text-primary">{item.currentOutputContract || meta.output}</code></dd></div>
                      <div className="flex items-center justify-between gap-3"><dt className="text-muted-text">当前状态</dt><dd className={published ? "font-medium text-success" : "font-medium text-warning"}>{published ? `正式 V${item.currentPublishedVersionNumber ?? "—"}` : "草稿"}</dd></div>
                      {purpose === "trading_decision" ? <div className="flex items-start justify-between gap-3"><dt className="shrink-0 text-muted-text">回测准备</dt><dd className={`text-right font-medium ${backtestReady ? "text-success" : "text-warning"}`}>{item.backtestReadiness?.message || "正在确认股票池"}</dd></div> : null}
                    </dl>
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <Link to={item.activeDraftVersionId ? `/strategies/${item.id}/editor?versionId=${item.activeDraftVersionId}` : item.currentPublishedVersionId ? `/strategies/${item.id}/editor?versionId=${item.currentPublishedVersionId}` : strategyTarget(item)} className="btn-secondary inline-flex items-center gap-2">
                        <Settings2 className="h-4 w-4" /> {item.activeDraftVersionId ? "继续策略配置" : "查看策略配置"}
                      </Link>
                      {published ? (
                        <Link to={productTarget(item)} className={`${purpose !== "trading_decision" || backtestReady ? "btn-primary" : "btn-secondary"} inline-flex items-center gap-2`}>
                          {purpose === "trading_decision" ? <FlaskConical className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                          {purpose === "trading_decision" ? backtestReady ? "开始回测" : "查看回测准备" : `打开${meta.destination}`}
                        </Link>
                      ) : null}
                      <Link to={strategyTarget(item)} className="btn-secondary">版本与记录</Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

    </AppPage>
  );
}
