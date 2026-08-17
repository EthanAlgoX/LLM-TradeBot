import { isAxiosError } from 'axios';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, CalendarRange, CheckCircle2, CircleAlert, FlaskConical,
  History, LoaderCircle, Play, RotateCcw, Settings2, TrendingUp,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppPage, Card, InlineAlert, PageHeader } from '../components/common';
import { StrategyVariantPreview } from '../components/capability';
import { StrategyLifecycleNav } from '../components/strategy/StrategyLifecycleNav';
import {
  strategyWorkspaceApi,
  type RunnableStrategyVersion,
  type StrategySummary,
  type StrategyValidationConfig,
  type StrategyValidationExperiment,
  type StrategyValidationVersionStatus,
  type StrategyVersion,
} from '../api/strategyWorkspace';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
});
const numberFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const percentFormatter = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 2, signDisplay: 'exceptZero' });

const toInputDate = (value: Date) => value.toISOString().slice(0, 10);
const defaultDates = () => {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
  return { startDate: toInputDate(start), endDate: toInputDate(end) };
};

const statusCopy: Record<StrategyValidationVersionStatus['status'], string> = {
  not_started: '未开始', queued: '等待运行', running: '回放中', completed: '历史回放已完成（观察性）', validated: '已通过验证', failed: '回放失败',
};
const experimentStatusCopy: Record<StrategyValidationExperiment['status'], string> = {
  queued: '等待运行', running: '运行中', completed: '已完成', failed: '失败',
};

const isTrustedExperiment = (experiment: StrategyValidationExperiment) => (
  experiment.status === 'completed'
  && experiment.integrityStatus === 'verified'
  && experiment.result?.dataQuality?.complete === true
);

const experimentPurpose = (experiment: StrategyValidationExperiment) => (
  experiment.config.experimentPurpose
  || (experiment.config.universeMode === 'override' ? 'diagnostic' : 'validation')
);

const experimentStatusLabel = (experiment: StrategyValidationExperiment) => {
  if (experiment.status !== 'completed') return experimentStatusCopy[experiment.status];
  if (isTrustedExperiment(experiment)) return experimentPurpose(experiment) === 'diagnostic' ? '诊断完成' : '正式回放完成';
  return experiment.integrityStatus === 'failed' ? '快照校验失败' : '旧版未校验';
};

function formatExperimentTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function ExperimentHistory({
  experiments,
  selectedExperimentId,
  onSelect,
}: {
  experiments: StrategyValidationExperiment[];
  selectedExperimentId: number | null;
  onSelect: (experimentId: number) => void;
}) {
  return (
    <Card variant="gradient" padding="lg">
      <History className="h-5 w-5 text-cyan" aria-hidden="true" />
      <h2 className="mt-3 text-lg font-semibold text-foreground">实验记录</h2>
      <p className="mt-1 text-sm leading-6 text-secondary-text">每次正式回放和股票诊断都会绑定策略版本并保存运行时间；只有正式回放会更新版本验证状态。</p>
      {experiments.length ? (
        <ol className="mt-4 space-y-2">
          {experiments.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                className={`w-full rounded-xl border px-3 py-3 text-left ${selectedExperimentId === item.id ? 'border-cyan bg-cyan/5' : 'border-border/60 bg-base/45'}`}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">实验 #{item.id} · {experimentPurpose(item) === 'diagnostic' ? '股票诊断' : '正式回放'}</span>
                  <span className={`text-xs font-medium ${isTrustedExperiment(item) ? 'text-success' : item.status === 'failed' || item.status === 'completed' ? 'text-warning' : 'text-cyan'}`}>{experimentStatusLabel(item)}</span>
                </span>
                <span className="mt-1 block text-xs font-medium text-secondary-text">{item.strategyName || `策略 #${item.strategyId ?? '—'}`} · V{item.versionNumber ?? '—'}</span>
                <span className="mt-2 block text-xs text-secondary-text">{item.config.startDate} — {item.config.endDate} · {item.barCount} 根日线</span>
                <span className="mt-1 block text-[11px] tabular-nums text-muted-text">提交 {formatExperimentTime(item.createdAt)} · 开始 {formatExperimentTime(item.startedAt)} · 完成 {formatExperimentTime(item.completedAt)}</span>
                {item.errorMessage ? <span className="mt-1 block text-xs text-warning">{item.errorMessage}</span> : null}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-5">
          <p className="font-medium text-foreground">此版本尚未产生策略级历史验证记录。</p>
          <p className="mt-2 text-sm leading-6 text-secondary-text">配置区间和成本后运行第一条实验；页面不会提前展示收益、回撤或胜率。</p>
        </div>
      )}
      {experiments.length ? (
        <button type="button" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-cyan" onClick={() => onSelect(experiments[0].id)}>
          <RotateCcw className="h-4 w-4" />查看最新实验
        </button>
      ) : null}
    </Card>
  );
}

function apiErrorMessage(cause: unknown, fallback: string) {
  if (!isAxiosError(cause)) return fallback;
  const detail = cause.response?.data?.detail as { message?: string } | undefined;
  return detail?.message || fallback;
}

function VersionContext({ strategy, version, validationStatus }: {
  strategy: StrategySummary;
  version: StrategyVersion;
  validationStatus: StrategyValidationVersionStatus | null;
}) {
  const isDraft = version.status === 'DRAFT';
  const versionLabel = isDraft ? '发布候选草稿' : `已发布版本 V${version.versionNumber ?? '—'}`;
  const completedId = validationStatus?.latestCompletedExperimentId;
  return (
    <Card variant="bordered" padding="lg">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-cyan">{isDraft ? '发布前验证' : '已发布策略的重新研究'}</p>
          <h2 className="mt-2 break-words text-xl font-semibold text-foreground">{strategy.name} · {versionLabel}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-text">{strategy.description || '该策略尚未填写说明。'}</p>
        </div>
        <dl className="grid shrink-0 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-1">
          <div className="rounded-xl bg-base/70 px-3 py-2 text-secondary-text"><dt className="inline">{isDraft ? '创建时间' : '发布时间'}：</dt><dd className="inline font-medium text-foreground">{dateFormatter.format(new Date(isDraft ? version.createdAt : version.publishedAt ?? version.createdAt))}</dd></div>
          <div className={`rounded-xl px-3 py-2 ${validationStatus?.status === 'validated' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}><dt className="inline">验证状态：</dt><dd className="inline font-medium">{validationStatus ? statusCopy[validationStatus.status] : '正在读取'}</dd></div>
        </dl>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
        <Link to={isDraft ? `/strategies/${strategy.id}/editor?versionId=${version.id}${completedId ? `&validationExperimentId=${completedId}` : ''}` : `/strategies/${strategy.id}`} className="btn-secondary inline-flex items-center gap-2"><ArrowLeft className="h-4 w-4" />{isDraft ? '返回正式发布' : '返回策略中心'}</Link>
        {isDraft ? <p className="text-sm text-secondary-text">历史回测是正式发布前的可选研究步骤；完成后可以返回策略中心发布。</p> : <Link to={`/runs?strategyId=${strategy.id}&versionId=${version.id}`} className="btn-secondary inline-flex items-center gap-2">在运行中心打开 <ArrowRight className="h-4 w-4" /></Link>}
      </div>
    </Card>
  );
}

function EquityChart({ experiment }: { experiment: StrategyValidationExperiment }) {
  const curve = experiment.result?.equityCurve ?? [];
  if (curve.length < 2) return null;
  const values = curve.map((point) => point.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = curve.map((point, index) => {
    const x = (index / (curve.length - 1)) * 600;
    const y = 166 - ((point.equity - min) / range) * 142;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return <div className="mt-5 overflow-hidden rounded-xl border border-border/60 bg-base/45 p-4">
    <div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="font-medium text-foreground">资金与持仓曲线</h3><p className="mt-1 text-xs text-secondary-text">按每个回放日收盘价计算；成交发生在信号后的下一交易日开盘。</p></div><p className="text-sm text-secondary-text">{curve[0].date} — {curve.at(-1)?.date}</p></div>
    <svg className="mt-4 h-48 w-full overflow-visible text-cyan" viewBox="0 0 600 180" preserveAspectRatio="none" role="img" aria-label={`资金曲线，从 ${numberFormatter.format(values[0])} 变化到 ${numberFormatter.format(values.at(-1) ?? 0)}`}>
      <line x1="0" y1="24" x2="600" y2="24" className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <line x1="0" y1="95" x2="600" y2="95" className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <line x1="0" y1="166" x2="600" y2="166" className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="mt-2 flex justify-between text-xs text-secondary-text"><span>最低 {numberFormatter.format(min)}</span><span>最高 {numberFormatter.format(max)}</span></div>
  </div>;
}

function ResultPanel({ experiment }: { experiment: StrategyValidationExperiment }) {
  const result = experiment.result;
  if (!result) return null;
  if (!isTrustedExperiment(experiment)) return <section aria-labelledby="validation-result-heading">
    <Card variant="bordered" padding="lg">
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <h2 id="validation-result-heading" className="text-lg font-semibold text-foreground">实验 #{experiment.id} 是旧版未校验记录</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-text">这条记录缺少完整区间证据或冻结快照校验，不能作为策略成绩、发布依据或“已验证有效”的证明。为避免误导，页面不展示它过去计算的收益、夏普、回撤、胜率、成交和持仓。</p>
          <dl className="mt-4 grid gap-2 text-sm text-secondary-text sm:grid-cols-2">
            <div><dt className="inline">当时请求：</dt><dd className="inline">{experiment.config.startDate} 至 {experiment.config.endDate}</dd></div>
            <div><dt className="inline">实际冻结：</dt><dd className="inline">{result.marketSnapshot.firstDate} 至 {result.marketSnapshot.lastDate} · {experiment.barCount} 根日线</dd></div>
            <div><dt className="inline">旧引擎：</dt><dd className="inline">{experiment.engineVersion}</dd></div>
            <div><dt className="inline">完整性：</dt><dd className="inline">{experiment.integrityStatus === 'failed' ? '哈希校验失败' : '未保存可验证哈希'}</dd></div>
          </dl>
          <p className="mt-4 text-sm font-medium text-warning">请在上方重新运行新版历史回放；股票池默认由策略版本决定，也可以选择仅调试指定股票。</p>
        </div>
      </div>
    </Card>
  </section>;
  const diagnostic = experimentPurpose(experiment) === 'diagnostic';
  const metrics = result.metrics;
  const metricItems = [
    ['累计收益', percentFormatter.format(metrics.cumulativeReturn)],
    ['最大回撤', percentFormatter.format(metrics.maxDrawdown)],
    ['年化收益', metrics.annualizedReturn == null ? '—' : percentFormatter.format(metrics.annualizedReturn)],
    ['夏普比率', metrics.sharpeRatio == null ? '—' : numberFormatter.format(metrics.sharpeRatio)],
    ['胜率', metrics.winRate == null ? '暂无平仓' : percentFormatter.format(metrics.winRate)],
    ['交易次数', numberFormatter.format(metrics.tradeCount)],
  ];
  return <section aria-labelledby="validation-result-heading" className="space-y-5">
    {diagnostic ? <div role="note" className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm leading-6 text-warning"><strong>这是指定股票诊断，不是正式策略验证。</strong> 临时股票池改变了 StrategyVersion 的原始范围，因此本结果不会更新验证状态，也不能作为正式发布依据。</div> : null}
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="validation-result-heading" className="text-lg font-semibold text-foreground">实验 #{experiment.id} · {diagnostic ? '股票诊断结果' : '正式回放结果'}</h2><p className="mt-1 text-sm text-secondary-text">结果来自冻结的 {experiment.barCount} 根本地日线；这是观察性价格规则回放，不是完整 Agent 策略验证。</p></div><p className="text-xs text-secondary-text">引擎 {experiment.engineVersion} · 快照{experiment.integrityStatus === 'verified' ? '已校验' : experiment.integrityStatus === 'failed' ? '校验失败' : '旧版未校验'}</p></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{metricItems.map(([label, value]) => <div key={label} className="rounded-xl border border-border/60 bg-card px-4 py-3"><p className="text-xs text-secondary-text">{label}</p><p className="mt-1 text-lg font-semibold text-foreground">{value}</p></div>)}</div>
    <Card variant="bordered" padding="lg">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-secondary-text">期末权益</p><p className="mt-1 text-2xl font-semibold text-foreground">{numberFormatter.format(metrics.finalEquity)}</p></div><div className="text-right text-sm text-secondary-text"><p>换手 {metrics.turnover == null ? '—' : numberFormatter.format(metrics.turnover)}</p><p className="mt-1">平仓 {metrics.closedTradeCount} 次</p></div></div>
      <EquityChart experiment={experiment} />
    </Card>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
      <Card variant="bordered" padding="lg"><h3 className="font-semibold text-foreground">最近成交记录</h3><p className="mt-1 text-sm text-secondary-text">以下是本实验生成的确定性回放成交，不是券商订单或真实交易。</p>{result.trades.length ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="text-xs text-secondary-text"><tr><th className="pb-2 font-medium">标的 / 方向</th><th className="pb-2 font-medium">信号 → 成交</th><th className="pb-2 text-right font-medium">数量</th><th className="pb-2 text-right font-medium">成交价</th><th className="pb-2 text-right font-medium">费用</th></tr></thead><tbody className="divide-y divide-border/60">{result.trades.slice(-20).reverse().map((trade, index) => <tr key={`${trade.code}-${trade.executionDate}-${trade.side}-${index}`}><td className="py-2.5 font-medium text-foreground">{trade.code} · {trade.side === 'buy' ? '买入' : '卖出'}</td><td className="py-2.5 text-secondary-text">{trade.signalDate} → {trade.executionDate}</td><td className="py-2.5 text-right text-secondary-text">{numberFormatter.format(trade.quantity)}</td><td className="py-2.5 text-right text-secondary-text">{numberFormatter.format(trade.fillPrice)}</td><td className="py-2.5 text-right text-secondary-text">{numberFormatter.format((trade.totalFees ?? trade.commission) + trade.slippageCost)}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-secondary-text">该区间没有产生符合条件的成交。</p>}</Card>
      <Card variant="gradient" padding="lg"><CircleAlert className="h-5 w-5 text-warning" aria-hidden="true"/><h3 className="mt-3 font-semibold text-foreground">结果边界</h3><ul className="mt-3 space-y-2 text-sm leading-6 text-secondary-text">{result.limitations.map((item) => <li key={item}>• {item}</li>)}</ul><dl className="mt-5 space-y-2 border-t border-border/60 pt-4 text-xs text-secondary-text"><div><dt className="inline">快照：</dt><dd className="inline break-all">{result.marketSnapshot.sha256}</dd></div><div><dt className="inline">请求区间：</dt><dd className="inline">{result.dataQuality?.requestedStartDate ?? experiment.config.startDate} 至 {result.dataQuality?.requestedEndDate ?? experiment.config.endDate}</dd></div><div><dt className="inline">实际回放：</dt><dd className="inline">{result.dataQuality?.actualReplayStartDate ?? '—'} 至 {result.dataQuality?.actualReplayEndDate ?? '—'} · {result.dataQuality?.complete ? '覆盖校验通过' : '覆盖信息缺失'}</dd></div><div><dt className="inline">范围：</dt><dd className="inline">{result.marketSnapshot.symbolCount} 个标的 · {result.marketSnapshot.firstDate} 至 {result.marketSnapshot.lastDate}</dd></div><div><dt className="inline">来源：</dt><dd className="inline">{result.marketSnapshot.sources.join('、') || '未标注'}</dd></div><div><dt className="inline">策略覆盖：</dt><dd className="inline">{result.strategyCoverage?.level === 'full' ? '完整' : '部分，仅 OHLCV 可复现规则'}</dd></div></dl></Card>
    </div>
  </section>;
}

export default function StrategyValidationPage() {
  useEffect(() => {
    document.title = '验证中心 - LLM TradeBot';
  }, []);
  const [params] = useSearchParams();
  const strategyId = Number(params.get('strategyId'));
  const versionId = Number(params.get('versionId'));
  const hasContext = Number.isInteger(strategyId) && strategyId > 0 && Number.isInteger(versionId) && versionId > 0;
  const initialDates = useMemo(defaultDates, []);
  const [strategy, setStrategy] = useState<StrategySummary | null>(null);
  const [version, setVersion] = useState<StrategyVersion | null>(null);
  const [validationStatus, setValidationStatus] = useState<StrategyValidationVersionStatus | null>(null);
  const [experiments, setExperiments] = useState<StrategyValidationExperiment[]>([]);
  const [selectedExperimentId, setSelectedExperimentId] = useState<number | null>(null);
  const [loading, setLoading] = useState(hasContext);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [publishedVersions, setPublishedVersions] = useState<RunnableStrategyVersion[]>([]);
  const [publishedLoading, setPublishedLoading] = useState(!hasContext);
  const [publishedError, setPublishedError] = useState('');
  const [form, setForm] = useState({ ...initialDates, initialCapital: '1000000', commissionPercent: '0.03', minimumCommission: '5', slippagePercent: '0.10', rebalanceFrequency: 'weekly', market: 'cn', maxPositions: '3', maxUniverseSize: '50', symbols: '' });
  const [showDiagnostic, setShowDiagnostic] = useState(false);

  useEffect(() => {
    if (!hasContext) return;
    let active = true;
    setLoading(true); setError('');
    void (async () => {
      try {
        const [nextStrategy, nextVersion] = await Promise.all([
          strategyWorkspaceApi.getStrategy(strategyId), strategyWorkspaceApi.getVersion(versionId),
        ]);
        if (nextVersion.strategyId !== strategyId) throw new Error('invalid-version-context');
        if (!active) return;
        setStrategy(nextStrategy); setVersion(nextVersion);
        if ((nextVersion.strategyPurpose || 'trading_decision') !== 'trading_decision') {
          setError(`这个策略版本输出 ${nextVersion.outputContract || '研究结果'}，不属于交易决策策略，因此不能进入历史交易回测。请从对应研究工具使用它。`);
          return;
        }
        setForm((current) => ({ ...current, market: nextVersion.screeningPolicy?.market || current.market }));

        const [experimentsResult, statusResult] = await Promise.allSettled([
          strategyWorkspaceApi.listValidationExperiments(versionId),
          strategyWorkspaceApi.getValidationStatus(versionId),
        ]);
        if (!active) return;
        const nextExperiments = experimentsResult.status === 'fulfilled' ? experimentsResult.value : [];
        const nextStatus = statusResult.status === 'fulfilled' ? statusResult.value : null;
        setExperiments(nextExperiments);
        setValidationStatus(nextStatus);
        setSelectedExperimentId(nextStatus?.latestCompletedExperimentId ?? nextExperiments[0]?.id ?? null);
        if (experimentsResult.status === 'rejected' || statusResult.status === 'rejected') {
          setError('策略版本已读取，但验证记录接口暂时不可用。请刷新重试；如果问题持续，请确认当前页面已连接最新后端。');
        }
      } catch (cause) {
        if (!active) return;
        setStrategy(null); setVersion(null);
        setError(apiErrorMessage(cause, '无法读取这个策略版本。请从策略中心重新选择版本。'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [hasContext, strategyId, versionId]);

  useEffect(() => {
    if (hasContext) return;
    void strategyWorkspaceApi.listRunnableVersions().then(setPublishedVersions)
      .catch(() => setPublishedError('已发布策略列表暂时无法加载。你仍可从策略中心选择版本。'))
      .finally(() => setPublishedLoading(false));
  }, [hasContext]);

  const selectedExperiment = experiments.find((item) => item.id === selectedExperimentId) ?? experiments.find((item) => item.status === 'completed') ?? null;
  const strategySymbols = (() => {
    const scope = version?.marketScope ?? {};
    for (const key of ['symbols', 'codes', 'stockCodes', 'universe']) {
      const value = scope[key];
      if (Array.isArray(value) && value.length) return value.map(String).filter(Boolean);
    }
    return [];
  })();
  const strategyUniverseSummary = strategySymbols.length
    ? `使用 StrategyVersion 中冻结的固定股票池：${strategySymbols.join('、')}`
    : `由策略内选股阶段 ${version?.screeningPolicy?.strategy || '（未命名）'} 从 ${{ cn: 'A 股', hk: '港股', us: '美股' }[(version?.screeningPolicy?.market || form.market) as 'cn' | 'hk' | 'us'] || (version?.screeningPolicy?.market || form.market).toUpperCase()}市场产生候选，最多 ${version?.screeningPolicy?.maxCandidates ?? form.maxPositions} 只。`;
  const strategyUniverseMode = String(version?.marketScope?.universeMode || '').toLowerCase();
  const dynamicUniverseReplayUnavailable = Boolean(
    version
    && !strategySymbols.length
    && strategyUniverseMode !== 'fixed',
  );
  const runValidation = async (purpose: 'validation' | 'diagnostic') => {
    if (!version || running) return;
    if (!form.startDate || !form.endDate || form.startDate >= form.endDate) { setError('请选择有效的回测区间，结束日期必须晚于开始日期。'); return; }
    const symbols = form.symbols.split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean);
    if (purpose === 'diagnostic' && !symbols.length) { setError('请为诊断实验填写至少一个临时股票代码。'); return; }
    const config: StrategyValidationConfig = {
      startDate: form.startDate, endDate: form.endDate,
      initialCapital: Number(form.initialCapital), commissionRate: Number(form.commissionPercent) / 100,
      minimumCommission: Number(form.minimumCommission),
      slippageRate: Number(form.slippagePercent) / 100, executionRule: 'next_open',
      rebalanceFrequency: form.rebalanceFrequency as StrategyValidationConfig['rebalanceFrequency'],
      market: form.market as StrategyValidationConfig['market'], universeMode: purpose === 'validation' ? 'strategy' : 'override', experimentPurpose: purpose, maxPositions: Number(form.maxPositions),
      maxUniverseSize: Number(form.maxUniverseSize), symbols: purpose === 'diagnostic' ? symbols : [],
    };
    if (![config.initialCapital, config.commissionRate, config.minimumCommission, config.slippageRate, config.maxPositions, config.maxUniverseSize].every(Number.isFinite)) { setError('请检查资金、费率和数量配置是否为有效数字。'); return; }
    setRunning(true); setError('');
    try {
      const created = await strategyWorkspaceApi.createValidationExperiment(version.id, config);
      setExperiments((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setSelectedExperimentId(created.id);
      const completed = await strategyWorkspaceApi.executeValidationExperiment(created.id);
      setExperiments((current) => [completed, ...current.filter((item) => item.id !== completed.id)]);
      setSelectedExperimentId(completed.id);
      setValidationStatus(await strategyWorkspaceApi.getValidationStatus(version.id));
    } catch (cause) {
      setError(apiErrorMessage(cause, '历史验证执行失败。配置已保留，请检查本地行情数据后重试。'));
      try { setExperiments(await strategyWorkspaceApi.listValidationExperiments(version.id)); } catch { /* keep the last visible state */ }
    } finally { setRunning(false); }
  };

  if (!hasContext) return <AppPage className="space-y-6">
    <PageHeader eyebrow="Strategy validation laboratory" title="验证中心" description="统一管理策略版本的验证证据。当前已接入交易决策策略的 OHLCV 历史回放；研究报告与选股结果的验证引擎尚未接入。" />
    <StrategyLifecycleNav current="backtests" />
    <Card variant="bordered" padding="lg" className="max-w-3xl"><FlaskConical className="h-6 w-6 text-cyan" aria-hidden="true"/><h2 className="mt-4 text-xl font-semibold text-foreground">选择一个可验证的策略版本</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-secondary-text">策略中心负责接入并冻结完整版本；验证中心绑定版本、冻结行情并保存实验结果。当前列表只展示可执行历史交易回放的策略，不提供第二套策略编辑器。</p><Link className="btn-primary mt-5 inline-flex items-center gap-2" to="/strategies">前往策略中心 <ArrowRight className="h-4 w-4"/></Link></Card>
    <section aria-labelledby="published-strategies-heading" className="max-w-5xl"><div className="mb-3"><h2 id="published-strategies-heading" className="text-lg font-semibold text-foreground">重新研究已发布策略</h2><p className="mt-1 text-sm leading-6 text-secondary-text">列表来自真实已发布策略版本 API；进入后可创建新的历史验证实验。</p></div>{publishedLoading ? <Card variant="bordered" padding="lg">正在读取已发布策略版本…</Card> : null}{publishedError ? <Card variant="bordered" padding="lg"><p role="alert" className="text-warning">{publishedError}</p></Card> : null}{!publishedLoading && !publishedError && publishedVersions.length === 0 ? <Card variant="bordered" padding="lg"><p className="font-medium text-foreground">目前没有可重新研究的已发布策略。</p><p className="mt-1 text-sm leading-6 text-secondary-text">请先在策略中心选择草稿完成发布前验证。</p></Card> : null}{!publishedLoading && publishedVersions.length > 0 ? <ul aria-label="已发布策略版本" className="divide-y divide-border/60 rounded-2xl border border-border/70 bg-card">{publishedVersions.map((item) => <li key={item.versionId} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="break-words font-medium text-foreground">{item.strategyName} · 正式版本 V{item.versionNumber ?? '—'}</p><p className="mt-1 text-sm text-secondary-text">{item.strategyDescription || '未填写策略说明。'}{item.publishedAt ? ` · 发布于 ${dateFormatter.format(new Date(item.publishedAt))}` : ''}</p></div><Link className="btn-secondary inline-flex shrink-0 items-center gap-2" to={`/backtests?strategyId=${item.strategyId}&versionId=${item.versionId}`}>重新研究 <ArrowRight className="h-4 w-4"/></Link></li>)}</ul> : null}</section>
  </AppPage>;

  return <AppPage className="space-y-6">
    <PageHeader eyebrow="Strategy version validation" title="验证中心" description="把交易决策策略版本放进冻结的历史市场环境中回放；完成验证不代表策略一定有效，更不代表已经真实交易。" />
    <StrategyLifecycleNav current="backtests" />
    {loading ? <Card variant="bordered" padding="lg"><span className="inline-flex items-center gap-2 text-secondary-text"><LoaderCircle className="h-4 w-4 animate-spin"/>正在读取策略版本与实验记录…</span></Card> : null}
    {error ? <Card variant="bordered" padding="lg"><p role="alert" className="text-warning">{error}</p><div className="mt-4 flex flex-wrap gap-3">{strategy ? <button className="btn-secondary" type="button" onClick={() => window.location.reload()}>刷新重试</button> : null}<Link className="btn-secondary inline-flex" to="/strategies">返回策略中心</Link></div></Card> : null}
    {strategy && version ? <>
      <VersionContext strategy={strategy} version={version} validationStatus={validationStatus}/>
      <StrategyVariantPreview
        strategyId={strategy.id}
        currentVersionId={version.id}
        refreshToken={experiments.map((item) => `${item.id}:${item.status}`).join(',')}
      />
      <section aria-label="验证流程" className="flex flex-wrap items-center gap-2 px-1 text-sm text-secondary-text">{['定义策略', '配置实验', '运行历史验证', '查看结果', '正式发布 / 重新研究'].map((step, index) => <span key={step} className="inline-flex items-center gap-2"><span className={index === 2 ? 'font-medium text-cyan' : 'font-medium text-foreground'}>{step}</span>{index < 4 ? <ArrowRight className="h-4 w-4 text-muted-text" aria-hidden="true"/> : null}</span>)}</section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Card variant="bordered" padding="lg"><div className="flex items-start gap-3"><Settings2 className="mt-0.5 h-5 w-5 text-cyan" aria-hidden="true"/><div><h2 className="text-lg font-semibold text-foreground">验证配置</h2><p className="mt-1 text-sm leading-6 text-secondary-text">创建后会冻结当前 StrategyVersion 和所消费的本地日线。信号只使用当日及此前数据，统一在下一交易日开盘成交。</p></div></div>
          <div className="mt-5 rounded-xl border border-cyan/30 bg-cyan/5 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-foreground">正式策略股票池</p><p className="mt-1 text-sm leading-6 text-secondary-text">{strategyUniverseSummary}</p></div><span className="rounded-full border border-cyan/30 px-2.5 py-1 text-xs font-medium text-cyan">来自 StrategyVersion · 不可覆盖</span></div>{strategySymbols.length ? <p className="mt-3 text-xs leading-5 text-secondary-text">创建实验后，输入数据只保留这些股票的 K 线；后续筛选和分析不得越出该范围。</p> : null}</div>
          {dynamicUniverseReplayUnavailable ? (
            <InlineAlert
              className="mt-4"
              variant="warning"
              title="当前版本暂不能运行正式回放"
              message={<>该版本通过 <code>{version.screeningPolicy?.strategy || '动态选股'}</code> 产生候选，但验证后端尚未保存所选区间的历史时点股票池与成分变更。系统不会用今天的股票名单代替历史数据。你可以先做指定股票诊断，或者基于此版本创建固定股票池配置。</>}
              action={<div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={() => setShowDiagnostic(true)}>改做指定股票诊断</button><Link className="btn-secondary" to={`/strategies/${strategy.id}/editor?versionId=${version.id}`}>前往策略中心配置固定股票池</Link></div>}
            />
          ) : null}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-foreground">开始日期<input aria-label="开始日期" type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-2.5"/></label>
            <label className="text-sm font-medium text-foreground">结束日期<input aria-label="结束日期" type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-2.5"/></label>
            <label className="text-sm font-medium text-foreground">初始资金<input aria-label="初始资金" type="number" min="10000" value={form.initialCapital} onChange={(event) => setForm({ ...form, initialCapital: event.target.value })} className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-2.5"/></label>
            <div className="text-sm font-medium text-foreground">策略市场<div aria-label="策略市场" className="mt-2 rounded-xl border border-border bg-base/60 px-3 py-2.5 text-secondary-text">{{ cn: 'A 股', hk: '港股', us: '美股' }[(version.screeningPolicy?.market || form.market) as 'cn' | 'hk' | 'us'] || version.screeningPolicy?.market || form.market}</div></div>
            <label className="text-sm font-medium text-foreground">佣金率（%）<input aria-label="手续费" type="number" min="0" max="5" step="0.01" value={form.commissionPercent} onChange={(event) => setForm({ ...form, commissionPercent: event.target.value })} className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-2.5"/></label>
            <label className="text-sm font-medium text-foreground">单笔最低佣金<input aria-label="单笔最低佣金" type="number" min="0" step="0.01" value={form.minimumCommission} onChange={(event) => setForm({ ...form, minimumCommission: event.target.value })} className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-2.5"/></label>
            <label className="text-sm font-medium text-foreground">滑点（%）<input aria-label="滑点" type="number" min="0" max="5" step="0.01" value={form.slippagePercent} onChange={(event) => setForm({ ...form, slippagePercent: event.target.value })} className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-2.5"/></label>
            <label className="text-sm font-medium text-foreground">调仓频率<select aria-label="调仓频率" value={form.rebalanceFrequency} onChange={(event) => setForm({ ...form, rebalanceFrequency: event.target.value })} className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-2.5"><option value="daily">每日</option><option value="weekly">每 5 个回放日</option><option value="monthly">每 20 个回放日</option></select></label>
            <label className="text-sm font-medium text-foreground">成交规则<select aria-label="成交规则" disabled value="next_open" className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-2.5 disabled:opacity-70"><option value="next_open">下一交易日开盘</option></select></label>
            <label className="text-sm font-medium text-foreground">最大持仓数<input aria-label="最大持仓数" type="number" min="1" max="10" value={form.maxPositions} onChange={(event) => setForm({ ...form, maxPositions: event.target.value })} className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-2.5"/></label>
            <label className="text-sm font-medium text-foreground sm:col-span-2">最大候选池<input aria-label="最大候选池" type="number" min="1" max="100" value={form.maxUniverseSize} onChange={(event) => setForm({ ...form, maxUniverseSize: event.target.value })} className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-2.5"/></label>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3"><button type="button" className="btn-primary inline-flex items-center gap-2" disabled={running || dynamicUniverseReplayUnavailable} onClick={() => void runValidation('validation')}>{running ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Play className="h-4 w-4"/>}{running ? '正在补齐、冻结行情并回放…' : dynamicUniverseReplayUnavailable ? '正式回放暂不可用' : '运行正式策略回放'}</button><p className="text-xs leading-5 text-secondary-text">{dynamicUniverseReplayUnavailable ? '等待历史时点股票池接入后开放；不会创建不完整的正式记录。' : '正式回放忠实使用版本股票池；完成后才可成为该版本的发布关联记录。'}</p></div>
        </Card>
        <ExperimentHistory experiments={experiments} selectedExperimentId={selectedExperiment?.id ?? null} onSelect={setSelectedExperimentId} />
      </section>
      <Card variant="bordered" padding="lg"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="max-w-3xl"><div className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-warning" aria-hidden="true"/><h2 className="text-lg font-semibold text-foreground">指定股票诊断</h2></div><p className="mt-2 text-sm leading-6 text-secondary-text">临时限定股票可以回答“这个策略在某几只股票上表现如何”，但它改变了策略原始股票池，因此不能更新验证状态，也不能作为发布依据。</p></div><button type="button" className="btn-secondary shrink-0" aria-expanded={showDiagnostic} onClick={() => setShowDiagnostic((value) => !value)}>{showDiagnostic ? '收起诊断配置' : '创建诊断实验'}</button></div>{showDiagnostic ? <div className="mt-5 border-t border-border/60 pt-5"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-foreground">临时股票代码<input aria-label="诊断股票代码" value={form.symbols} onChange={(event) => setForm({ ...form, symbols: event.target.value })} placeholder="例如 600519, 000001" className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-2.5"/><span className="mt-1 block text-xs leading-5 text-secondary-text">只影响本次诊断实验，不会写回 StrategyVersion。</span></label><label className="text-sm font-medium text-foreground">诊断市场<select aria-label="诊断市场" value={form.market} onChange={(event) => setForm({ ...form, market: event.target.value, minimumCommission: event.target.value === 'cn' ? '5' : '0' })} className="mt-2 w-full rounded-xl border border-border bg-base px-3 py-2.5"><option value="cn">A 股</option><option value="hk">港股</option><option value="us">美股</option></select></label></div><div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={running} onClick={() => void runValidation('diagnostic')}>{running ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <FlaskConical className="h-4 w-4"/>}{running ? '正在运行诊断…' : '运行股票诊断'}</button><p className="text-xs font-medium text-warning">诊断结果不具备发布资格。</p></div></div> : null}</Card>
      {selectedExperiment?.status === 'completed' && selectedExperiment.result ? <ResultPanel experiment={selectedExperiment}/> : null}
      {selectedExperiment?.status === 'failed' ? <Card variant="bordered" padding="lg"><CircleAlert className="h-5 w-5 text-warning"/><p className="mt-3 font-medium text-foreground">这次实验没有生成结果</p><p className="mt-1 text-sm leading-6 text-secondary-text">{selectedExperiment.errorMessage || '验证执行失败。请检查策略股票池、回放区间和历史行情后创建新实验。'}</p></Card> : null}
      <Card variant="bordered" padding="lg"><div className="flex items-start gap-3"><CalendarRange className="mt-0.5 h-5 w-5 text-purple" aria-hidden="true"/><div><h2 className="text-lg font-semibold text-foreground">回放方法与边界</h2><p className="mt-1 text-sm leading-6 text-secondary-text">后端会解析策略股票池、校验行情覆盖、冻结输入、执行仓位上限和历史费用规则，再计算收益、回撤、胜率、换手、资金曲线与逐笔回放成交。当前结果仍是观察性 OHLCV 回放，不代表完整多 Agent 策略已经验证通过。</p></div></div><div className="mt-5 grid gap-x-8 gap-y-3 text-sm text-secondary-text sm:grid-cols-2 lg:grid-cols-3">{['策略股票池来源与区间覆盖校验', '冻结快照哈希完整性校验', '仓位上限与历史费用规则', '累计收益、回撤与波动', '资金曲线与逐笔回放成交', 'Agent、新闻与 LLM 尚未历史重放'].map((item) => <p key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-text" aria-hidden="true"/>{item}</p>)}</div></Card>
      {(validationStatus?.status === 'completed' || validationStatus?.status === 'validated') && version.status === 'DRAFT' ? <Card variant="gradient" padding="lg"><TrendingUp className="h-5 w-5 text-success"/><p className="mt-3 font-medium text-foreground">当前策略定义已完成观察性历史回放</p><p className="mt-1 text-sm leading-6 text-secondary-text">你现在可以返回策略中心填写变更说明并正式发布；这不等于完整 Agent 策略已验证有效。如果继续修改策略定义，这条回放会自动变为过期。</p><Link className="btn-primary mt-4 inline-flex items-center gap-2" to={`/strategies/${strategy.id}/editor?versionId=${version.id}&validationExperimentId=${validationStatus.latestCompletedExperimentId}`}>返回正式发布 <ArrowRight className="h-4 w-4"/></Link></Card> : null}
    </> : null}
  </AppPage>;
}
