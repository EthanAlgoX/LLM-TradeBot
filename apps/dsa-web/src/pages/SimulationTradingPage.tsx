import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronRight,
  Database,
  LineChart,
  Newspaper,
  Play,
  Radio,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Twitter,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { historyApi } from '../api/history';
import { screeningApi } from '../api/screening';
import { simulationApi } from '../api/simulation';
import { AppPage, Button, Card, PageHeader, StatCard } from '../components/common';
import { StrategyHealthPanel } from '../components/strategy';
import { cn } from '../utils/cn';

type AgentId = 'input' | 'analysis' | 'screening' | 'risk' | 'decision' | 'reflection';

type Agent = {
  id: AgentId;
  name: string;
  shortName: string;
  description: string;
  prompt: string;
  status: 'active' | 'waiting' | 'ready';
  icon: React.ComponentType<{ className?: string }>;
};

type StrategyPreset = {
  id: string;
  name: string;
  description: string;
  candidates: string;
  specialists: string[];
  mode: 'quick' | 'standard' | 'full' | 'specialist';
  source: string;
  risk: string;
};

const STRATEGY_PRESETS: StrategyPreset[] = [
  { id: 'trend-breakout', name: '趋势突破组合', description: '趋势质量选股后，以放量突破与多头趋势确认入场。', candidates: '趋势质量 + 放量突破', specialists: ['多头趋势', '放量突破', '龙头策略'], mode: 'specialist', source: 'volume_breakout · bull_trend · dragon_head', risk: '突破后乖离率与量能异常过滤' },
  { id: 'pullback-quality', name: '回踩质量组合', description: '在优质趋势中寻找缩量回踩与风险受控的低吸机会。', candidates: '低波质量 + 缩量回踩', specialists: ['缩量回踩', '成长质量', '均线金叉'], mode: 'full', source: 'low_volatility_quality · shrink_pullback', risk: '趋势失效与回踩跌破过滤' },
  { id: 'theme-catalyst', name: '题材催化组合', description: '追踪热点题材、事件催化与龙头强度，同时控制情绪过热。', candidates: '资金热度 + 均衡多因子', specialists: ['热点题材', '事件驱动', '情绪周期'], mode: 'specialist', source: 'capital_heat · hot_theme · event_driven', risk: '情绪过热与催化兑现过滤' },
  { id: 'value-quality', name: '质量价值组合', description: '从估值与质量因子中筛选兼具安全边际和稳定性的标的。', candidates: '质量价值 + 双低', specialists: ['成长质量', '均线金叉'], mode: 'standard', source: 'quality_value · dual_low · growth_quality', risk: '估值陷阱与基本面恶化过滤' },
  { id: 'oversold-reversal', name: '超跌修复组合', description: '识别超跌后的反转证据，避免把下跌趋势误判为低吸机会。', candidates: '超跌反转 + 低波质量', specialists: ['底部放量', '箱体震荡'], mode: 'full', source: 'oversold_reversal · bottom_volume · box_oscillation', risk: '反转确认不足时不建仓' },
  { id: 'income-defensive', name: '红利防御组合', description: '以高流动性、稳定收益与较低波动构建防御型观察池。', candidates: '蓝筹红利 + 低波质量', specialists: ['成长质量', '均线金叉'], mode: 'standard', source: 'blue_chip_income · low_volatility_quality', risk: '防御资产的利率与行业集中度过滤' },
];

const AGENTS: Agent[] = [
  {
    id: 'input',
    name: '输入 Agent',
    shortName: 'IN',
    description: '汇集行情、资讯与市场情绪，形成可追溯的研究上下文。',
    prompt: '你负责过滤噪声、标记时效，并为每条信息保留来源和可信度。',
    status: 'active',
    icon: Database,
  },
  {
    id: 'analysis',
    name: '分析 Agent',
    shortName: 'AN',
    description: '从基本面、技术面与情绪面提取可验证的投资假设。',
    prompt: '先列出证据与反证，再给出市场状态及不确定性判断。',
    status: 'waiting',
    icon: BrainCircuit,
  },
  {
    id: 'screening',
    name: '选股 Agent',
    shortName: 'SC',
    description: '按照研究假设筛出候选池，并说明进入与排除原因。',
    prompt: '只保留与当前市场状态一致、风险收益比可解释的标的。',
    status: 'waiting',
    icon: Target,
  },
  {
    id: 'risk',
    name: '风控 Agent',
    shortName: 'RI',
    description: '检查新闻、估值、集中度与市场阶段，必要时否决或降级信号。',
    prompt: '只有风险可解释且仓位边界明确时，才允许将候选移交给决策 Agent。',
    status: 'waiting',
    icon: ShieldCheck,
  },
  {
    id: 'decision',
    name: '决策 Agent',
    shortName: 'DE',
    description: '将候选标的转化为模拟仓位、入场条件和风险边界。',
    prompt: '没有明确的止损、仓位与失效条件时，不得生成交易指令。',
    status: 'ready',
    icon: TrendingUp,
  },
  {
    id: 'reflection',
    name: '反思 Agent',
    shortName: 'RE',
    description: '回顾信号与结果偏差，把有效经验写回下一轮流程。',
    prompt: '区分运气、执行偏差和假设失效，输出可操作的修正项。',
    status: 'ready',
    icon: Sparkles,
  },
];

const DATA_SOURCES = [
  { name: '实时 K 线', meta: '行情 · 1 min', icon: LineChart, tone: 'text-cyan', enabled: true },
  { name: '财经新闻', meta: '资讯 · 15 min', icon: Newspaper, tone: 'text-purple', enabled: true },
  { name: 'Reddit 情绪', meta: '社交 · 30 min', icon: UsersRound, tone: 'text-warning', enabled: true },
  { name: 'Twitter / X', meta: '社交 · 未接入', icon: Twitter, tone: 'text-secondary-text', enabled: false, available: false },
];

const statusStyle = {
  active: { label: '采集中', className: 'border-cyan/30 bg-cyan/10 text-cyan' },
  waiting: { label: '等待上游', className: 'border-border/80 bg-hover/50 text-secondary-text' },
  ready: { label: '已就绪', className: 'border-success/30 bg-success/10 text-success' },
};

type LinkStatus = 'loading' | 'connected' | 'empty' | 'unavailable';

type SimulationLink = {
  status: LinkStatus;
  detail: string;
};

const linkStatusStyle: Record<LinkStatus, { label: string; className: string }> = {
  loading: { label: '读取中', className: 'border-border/70 bg-hover/60 text-secondary-text' },
  connected: { label: '可作为输入', className: 'border-success/25 bg-success/10 text-success' },
  empty: { label: '暂无内容', className: 'border-border/70 bg-hover/60 text-secondary-text' },
  unavailable: { label: '暂不可用', className: 'border-warning/25 bg-warning/10 text-warning' },
};

const initialLink: SimulationLink = { status: 'loading', detail: '正在读取已有工作区数据…' };

const SimulationTradingPage: React.FC = () => {
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>('input');
  const [selectedStrategyId, setSelectedStrategyId] = useState(STRATEGY_PRESETS[0].id);
  const [strategyPresets, setStrategyPresets] = useState<StrategyPreset[]>(STRATEGY_PRESETS);
  const [isRunning, setIsRunning] = useState(false);
  const [isSavingRun, setIsSavingRun] = useState(false);
  const [isSavingStrategy, setIsSavingStrategy] = useState(false);
  const [editingStrategyId, setEditingStrategyId] = useState<number | null>(null);
  const [isEditingStrategy, setIsEditingStrategy] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftSkills, setDraftSkills] = useState<string[]>([]);
  const [draftMode, setDraftMode] = useState<StrategyPreset['mode']>('specialist');
  const [draftRisk, setDraftRisk] = useState('');
  const [draftMaxPosition, setDraftMaxPosition] = useState('');
  const [draftPrompts, setDraftPrompts] = useState<Record<string, string>>({});
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [targetStockCode, setTargetStockCode] = useState('');
  const [paperAccountName, setPaperAccountName] = useState('');
  const [paperAccountCash, setPaperAccountCash] = useState('1000000');
  const [paperAccount, setPaperAccount] = useState<{ id: number; name: string; cash_balance: number; currency: string } | null>(null);
  const [paperAccounts, setPaperAccounts] = useState<Array<{ id: number; name: string; cash_balance: number; currency: string }>>([]);
  const [paperOrders, setPaperOrders] = useState<Array<{ id: number; status: string; stock_code: string; reject_reason?: string | null }>>([]);
  const [selectedPaperRunId, setSelectedPaperRunId] = useState('');
  const [preparingPaperExecution, setPreparingPaperExecution] = useState(false);
  const [creatingPaperAccount, setCreatingPaperAccount] = useState(false);
  const [recentRuns, setRecentRuns] = useState<Array<{ id: number; status: string; strategy_version_id: number; created_at: string }>>([]);
  const [enabledSources, setEnabledSources] = useState(() => new Set(DATA_SOURCES.filter((source) => source.enabled).map((source) => source.name)));
  const [linkedInputs, setLinkedInputs] = useState<Record<'screening' | 'watchlist' | 'analysis', SimulationLink>>({
    screening: initialLink,
    watchlist: initialLink,
    analysis: initialLink,
  });
  const selectedAgent = useMemo(
    () => AGENTS.find((agent) => agent.id === selectedAgentId) ?? AGENTS[0],
    [selectedAgentId],
  );
  const selectedStrategy = useMemo(
    () => strategyPresets.find((strategy) => strategy.id === selectedStrategyId) ?? strategyPresets[0],
    [selectedStrategyId, strategyPresets],
  );

  useEffect(() => {
    void simulationApi.listTemplates().then((templates) => {
      const inherited = templates.map((template) => ({
        id: template.id, name: template.name, description: template.description,
        candidates: template.screening_strategy_id, specialists: template.skill_ids,
        mode: template.orchestrator_mode, source: template.source_files.join(' · '),
        risk: String(template.risk_rules.summary || '模板默认风控'),
      }));
      if (inherited.length) setStrategyPresets(inherited);
    }).catch(() => undefined);
  }, []);

  const toggleSource = (sourceName: string) => {
    setEnabledSources((previous) => {
      const next = new Set(previous);
      if (next.has(sourceName)) next.delete(sourceName);
      else next.add(sourceName);
      return next;
    });
  };

  const loadLinkedInputs = useCallback(async (): Promise<Record<'screening' | 'watchlist' | 'analysis', SimulationLink>> => {
    const [screening, watchlist, analysis] = await Promise.allSettled([
      screeningApi.getHistory({ limit: 1 }),
      historyApi.getStockBarList({ limit: 100 }),
      historyApi.getList({ limit: 3 }),
    ]);

    return {
      screening: screening.status === 'fulfilled'
        ? screening.value.runs[0]
          ? { status: 'connected', detail: `最近一次选股：${screening.value.runs[0].candidateCount} 个候选 · ${screening.value.runs[0].strategy || '默认策略'}` }
          : { status: 'empty', detail: '尚无已完成选股结果；可稍后在“选股”运行策略。' }
        : { status: 'unavailable', detail: '选股当前不可读取；模拟交易仍可使用其他输入。' },
      watchlist: watchlist.status === 'fulfilled'
        ? watchlist.value.total > 0
          ? { status: 'connected', detail: `${watchlist.value.total} 只自选股可加入模拟候选池。` }
          : { status: 'empty', detail: '尚未发现自选股；不会自动创建或修改自选股。' }
        : { status: 'unavailable', detail: '自选股列表当前不可读取。' },
      analysis: analysis.status === 'fulfilled'
        ? analysis.value.total > 0
          ? { status: 'connected', detail: `${analysis.value.total} 份单股分析可作为研究上下文。` }
          : { status: 'empty', detail: '尚无可复用的单股分析报告。' }
        : { status: 'unavailable', detail: '分析历史当前不可读取。' },
    };
  }, []);

  const refreshLinkedInputs = useCallback(() => {
    setLinkedInputs({
      screening: initialLink,
      watchlist: initialLink,
      analysis: initialLink,
    });
    void loadLinkedInputs().then(setLinkedInputs);
  }, [loadLinkedInputs]);

  const loadRecentRuns = useCallback(() => {
    void simulationApi.listRuns().then(setRecentRuns).catch(() => setRecentRuns([]));
  }, []);

  const executeRecordedRun = useCallback((runId: number) => {
    void simulationApi.executeRun(runId).then((run) => {
      setRunNotice(run.status === 'failed' ? `运行 #${run.id} 未执行：${run.error_message}` : `运行 #${run.id} 已开始执行。`);
      loadRecentRuns();
    }).catch(() => setRunNotice('执行运行失败，请刷新后重试。'));
  }, [loadRecentRuns]);

  const createPaperAccount = useCallback(() => {
    setCreatingPaperAccount(true);
    void simulationApi.createAccount({ name: paperAccountName.trim(), initial_cash: Number(paperAccountCash), currency: 'CNY' }).then((account) => {
      setPaperAccount(account); setPaperAccounts((previous) => [account, ...previous]); setRunNotice(`已创建纸面账户“${account.name}”，不会关联真实资产。`);
    }).catch(() => setRunNotice('创建纸面账户失败，请检查名称和初始资金。')).finally(() => setCreatingPaperAccount(false));
  }, [paperAccountCash, paperAccountName]);

  useEffect(() => { void simulationApi.listAccounts().then((items) => { setPaperAccounts(items); if (items[0]) setPaperAccount(items[0]); }).catch(() => undefined); }, []);
  useEffect(() => { if (paperAccount) void simulationApi.listAccountOrders(paperAccount.id).then(setPaperOrders).catch(() => setPaperOrders([])); }, [paperAccount]);
  const preparePaperExecution = useCallback(() => {
    if (!paperAccount || !selectedPaperRunId) return;
    setPreparingPaperExecution(true);
    void simulationApi.preparePaperExecution(paperAccount.id, Number(selectedPaperRunId)).then((result) => {
      setRunNotice(result.status === 'rejected' ? `纸面执行已拒绝：${result.reason}` : `纸面订单 #${result.order_id} 已准备。`);
      return simulationApi.listAccountOrders(paperAccount.id);
    }).then(setPaperOrders).catch(() => setRunNotice('准备纸面执行失败；仅已完成运行可执行。')).finally(() => setPreparingPaperExecution(false));
  }, [paperAccount, selectedPaperRunId]);

  const savePreviewRun = useCallback(async () => {
    setIsSavingRun(true);
    setRunNotice(null);
    const config = {
      preset_id: selectedStrategy.id,
      candidate_source: selectedStrategy.candidates,
      specialists: selectedStrategy.specialists,
      orchestrator_mode: selectedStrategy.mode,
      inherited_assets: selectedStrategy.source,
      default_risk_boundary: selectedStrategy.risk,
      agents: AGENTS.map(({ id, name, prompt }) => ({ id, name, prompt })),
    };
    try {
      const strategies = await simulationApi.listStrategies();
      const existing = strategies.find((strategy) => strategy.name === selectedStrategy.name);
      const version = existing
        ? await simulationApi.createVersion(existing.id, { label: `预览 ${new Date().toLocaleString('zh-CN')}`, config })
        : (await simulationApi.createStrategy({ name: selectedStrategy.name, description: selectedStrategy.description, config, version_label: '预置策略 v1' })).latest_version;
      if (!version) throw new Error('策略版本创建失败，请重试。');
      const run = await simulationApi.createRun({
        strategy_version_id: version.id,
        execution_mode: 'preview',
        input_snapshot: { stock_code: targetStockCode.trim(), enabled_sources: Array.from(enabledSources), linked_inputs: linkedInputs },
      });
      setIsRunning(false);
      setRunNotice(`已记录预览运行 #${run.id}（策略 v${version.version}），等待后续 Agent 执行接入。`);
      loadRecentRuns();
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存预览运行失败，请检查服务后重试。';
      setRunNotice(message);
    } finally {
      setIsSavingRun(false);
    }
  }, [enabledSources, linkedInputs, loadRecentRuns, selectedStrategy, targetStockCode]);

  const startEditingStrategy = useCallback(async () => {
    const baseConfig = {
      template_id: selectedStrategy.id, screening_strategy_id: selectedStrategy.candidates,
      skill_ids: selectedStrategy.specialists, orchestrator_mode: selectedStrategy.mode,
      risk_rules: { summary: selectedStrategy.risk }, position_rules: { max_position_pct: 20 },
      agent_prompts: Object.fromEntries(AGENTS.map((agent) => [agent.id, agent.prompt])),
      recommended_sources: Array.from(enabledSources), inherited_assets: selectedStrategy.source,
    };
    try {
      const created = await simulationApi.createStrategy({ name: `${selectedStrategy.name} · 我的策略`, description: selectedStrategy.description, config: baseConfig, version_label: '从官方模板复制 v1' });
      setEditingStrategyId(created.id); setDraftName(created.name); setDraftDescription(selectedStrategy.description);
      setDraftSkills(selectedStrategy.specialists); setDraftMode(selectedStrategy.mode); setDraftRisk(selectedStrategy.risk); setDraftMaxPosition('20');
      setDraftPrompts(Object.fromEntries(AGENTS.map((agent) => [agent.id, agent.prompt]))); setIsEditingStrategy(true);
      setRunNotice('已从官方模板复制个人策略 v1；现在可编辑并保存下一版本。');
    } catch (error) { setRunNotice(error instanceof Error ? error.message : '复制模板失败，请重试。'); }
  }, [enabledSources, selectedStrategy]);

  const saveStrategyVersion = useCallback(async () => {
    if (!editingStrategyId) return;
    setIsSavingStrategy(true);
    try {
      await simulationApi.updateStrategy(editingStrategyId, { name: draftName, description: draftDescription });
      const version = await simulationApi.createVersion(editingStrategyId, { label: `编辑保存 ${new Date().toLocaleString('zh-CN')}`, config: {
        template_id: selectedStrategy.id, screening_strategy_id: selectedStrategy.candidates, skill_ids: draftSkills,
        orchestrator_mode: draftMode, risk_rules: { summary: draftRisk }, position_rules: { max_position_pct: Number(draftMaxPosition) || 0 },
        agent_prompts: draftPrompts, recommended_sources: Array.from(enabledSources), inherited_assets: selectedStrategy.source,
      }});
      setRunNotice(`个人策略已保存为 v${version.version}；旧版本保持不变。`); setIsEditingStrategy(false);
    } catch (error) { setRunNotice(error instanceof Error ? error.message : '保存策略版本失败，请重试。'); } finally { setIsSavingStrategy(false); }
  }, [draftDescription, draftMaxPosition, draftMode, draftName, draftPrompts, draftRisk, draftSkills, editingStrategyId, enabledSources, selectedStrategy]);

  useEffect(() => {
    let active = true;
    void loadLinkedInputs().then((next) => {
      if (active) {
        setLinkedInputs(next);
      }
    });
    return () => {
      active = false;
    };
  }, [loadLinkedInputs]);

  useEffect(() => { loadRecentRuns(); }, [loadRecentRuns]);

  return (
    <AppPage className="max-w-[1680px]">
      {/* THESIS: A live decision chain makes the simulated trade legible before configuration. OWN-WORLD: Existing DSA cool-neutral panels, cyan action signal, semantic state colors, compact data typography. STORY: Inspect what each agent receives, decides, and hands forward; then start a safe simulated run. FIRST VIEWPORT: Status header above a single left-to-right agent rail, with source controls and the selected prompt below. FORM: Candidate 5, a decision-chain workbench with the active handoff as its central organising line; seed cb7e8313. */}
      <div className="space-y-5 pb-6">
        <PageHeader
          eyebrow="Simulation Lab · Isolated workspace"
          title="模拟交易"
          description="将选股、自选股和单股分析作为只读研究输入，由多 Agent 生成独立的模拟订单、持仓、收益与复盘；不会写入真实持仓、告警或回测。"
          actions={(
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-xl border border-warning/25 bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
                <ShieldCheck className="h-4 w-4" />
                <span className="sm:hidden">模拟</span><span className="hidden sm:inline">未连接真实交易</span>
              </span>
              <Button variant="secondary" size="md" disabled title="预览阶段暂不提供系统配置"><Settings2 className="h-4 w-4" />配置系统</Button>
              <Button variant="primary" size="md" onClick={() => void savePreviewRun()} disabled={isSavingRun}>
                {isSavingRun ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {isSavingRun ? '正在记录预览' : '记录模拟预览'}
              </Button>
            </div>
          )}
        />

        <StrategyHealthPanel showLink={false} strategyName={selectedStrategy.name} candidateSource={selectedStrategy.candidates} agentCount={AGENTS.length} />

        <Card padding="none" className="overflow-hidden" aria-label="最近模拟运行">
          <div className="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-4"><div><p className="text-sm font-semibold text-foreground">最近模拟运行</p><p className="mt-1 text-xs text-secondary-text">版本与输入已保存；等待后续 Agent 执行。</p></div><Button variant="outline" size="sm" onClick={loadRecentRuns}><RefreshCw className="h-4 w-4" />刷新</Button></div>
          <div className="divide-y divide-border/70" role="status" aria-live="polite">{recentRuns.length === 0 ? <p className="px-5 py-4 text-sm text-secondary-text">还没有运行记录。选择策略后点击“记录模拟预览”。</p> : recentRuns.map((run) => <div key={run.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-3"><div><p className="text-sm font-medium text-foreground">运行 #{run.id} · 策略版本 #{run.strategy_version_id}</p><p className="mt-1 text-xs text-secondary-text">{new Date(run.created_at).toLocaleString('zh-CN')}</p></div><div className="flex items-center gap-2"><span className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', run.status === 'failed' ? 'border-danger/25 bg-danger/10 text-danger' : 'border-warning/25 bg-warning/10 text-warning')}>{run.status === 'queued' ? '等待执行' : run.status === 'failed' ? '执行未完成' : run.status}</span>{(run.status === 'queued' || run.status === 'failed') ? <Button variant="outline" size="sm" onClick={() => executeRecordedRun(run.id)}>执行</Button> : null}</div></div>)}</div>
        </Card>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="模拟账户概览">
          <StatCard label="模拟净值" value="¥ 1,024,680" hint="初始资金 ¥ 1,000,000 · 演示" icon={<TrendingUp className="h-5 w-5" />} tone="primary" />
          <StatCard label="当日盈亏" value="+ ¥ 3,820" hint="+0.37% · 演示" icon={<Activity className="h-5 w-5" />} tone="success" />
          <StatCard label="当前仓位" value="62%" hint="4 个持仓 · 演示" icon={<Target className="h-5 w-5" />} />
          <StatCard label="本轮输入" value={`${enabledSources.size} 源`} hint="行情与资讯配置 · 演示" icon={<Radio className="h-5 w-5" />} tone="warning" />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]" aria-label="纸面账户工作台预览">
          <Card padding="none" className="overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-5 py-4"><div><p className="label-uppercase">Paper account workspace</p><h2 className="mt-1 text-lg font-semibold text-foreground">纸面账户与权益回放</h2><p className="mt-1 text-sm text-secondary-text">账户、订单、成交、持仓与权益将在已完成的 Agent 运行后逐步接通。</p></div><span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">预览 · 待接入</span></div>
            <div className="grid divide-y divide-border/70 md:grid-cols-3 md:divide-x md:divide-y-0"><div className="p-5"><p className="text-xs text-secondary-text">可用现金</p><p className="mt-2 text-xl font-semibold text-foreground">{paperAccount ? `¥ ${paperAccount.cash_balance.toLocaleString('zh-CN')}` : '—'}</p><p className="mt-2 text-sm text-secondary-text">{paperAccount ? paperAccount.name : '创建模拟账户后显示'}</p></div><div className="p-5"><p className="text-xs text-secondary-text">模拟持仓</p><p className="mt-2 text-xl font-semibold text-foreground">—</p><p className="mt-2 text-sm text-secondary-text">仅来自已成交纸面订单</p></div><div className="p-5"><p className="text-xs text-secondary-text">权益曲线</p><p className="mt-2 text-xl font-semibold text-foreground">{paperAccount ? `¥ ${paperAccount.cash_balance.toLocaleString('zh-CN')}` : '—'}</p><p className="mt-2 text-sm text-secondary-text">初始权益，尚未产生订单</p></div></div>
            <div className="border-t border-border/70 bg-hover/25 px-5 py-4"><div className="flex flex-wrap gap-2">{paperAccounts.map((account) => <button key={account.id} onClick={() => setPaperAccount(account)} className={cn('rounded-full border px-3 py-1.5 text-xs', paperAccount && 'id' in paperAccount && paperAccount.id === account.id ? 'border-cyan/30 bg-cyan/10 text-cyan' : 'border-border text-secondary-text')}>{account.name}</button>)}</div><p className="mt-4 text-sm font-medium text-foreground">创建首个纸面账户</p><div className="mt-3 grid gap-3 sm:grid-cols-[1fr_160px_auto]"><input value={paperAccountName} onChange={(event) => setPaperAccountName(event.target.value)} placeholder="账户名称，例如：趋势突破实验" className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground" /><input type="number" min="1" value={paperAccountCash} onChange={(event) => setPaperAccountCash(event.target.value)} className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground" /><Button variant="primary" onClick={createPaperAccount} disabled={creatingPaperAccount || !paperAccountName.trim()}>{creatingPaperAccount ? '正在创建…' : '创建账户'}</Button></div></div>
          </Card>
          <Card padding="none" className="overflow-hidden"><div className="border-b border-border/70 px-5 py-4"><p className="text-sm font-semibold text-foreground">订单与拒绝记录</p><p className="mt-1 text-xs text-secondary-text">按运行回放，不会创建真实订单</p><div className="mt-3 flex flex-wrap gap-2"><select value={selectedPaperRunId} onChange={(event) => setSelectedPaperRunId(event.target.value)} disabled={!paperAccount} className="min-w-48 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"><option value="">选择已完成运行</option>{recentRuns.filter((run) => run.status === 'completed').map((run) => <option key={run.id} value={run.id}>运行 #{run.id} · 策略版本 #{run.strategy_version_id}</option>)}</select><Button variant="outline" size="sm" onClick={preparePaperExecution} disabled={!paperAccount || !selectedPaperRunId || preparingPaperExecution}>{preparingPaperExecution ? '准备中…' : '准备纸面执行'}</Button></div></div>{paperOrders.length ? <div className="divide-y divide-border/70">{paperOrders.map((order) => <div key={order.id} className="px-5 py-4"><p className="text-sm font-medium text-foreground">{order.stock_code} · {order.status}</p><p className="mt-1 text-xs text-secondary-text">{order.reject_reason || '等待纸面成交接入'}</p></div>)}</div> : <div className="px-5 py-8 text-center"><WalletCards className="mx-auto h-6 w-6 text-muted-text" /><p className="mt-3 text-sm font-medium text-foreground">暂无可执行的纸面订单</p><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-secondary-text">先完成带有结构化决策和行情证据的模拟运行；资金不足、行情缺失或风控越界会在这里说明拒绝原因。</p></div>}</Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]" aria-label="策略配置">
          <Card padding="none" className="overflow-hidden">
            <div className="border-b border-border/70 px-5 py-4">
              <p className="label-uppercase">Prebuilt strategy library</p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">选择要模拟的策略</h2>
              <p className="mt-1 text-sm text-secondary-text">官方模板直接继承原项目的选股策略、分析 Skill 与 Agent 编排；复制后可再定制。</p>
            </div>
            <div className="grid divide-y divide-border/70 md:grid-cols-2 md:divide-x lg:grid-cols-3">
              {strategyPresets.map((strategy) => {
                const selected = strategy.id === selectedStrategyId;
                return <button key={strategy.id} type="button" onClick={() => setSelectedStrategyId(strategy.id)} aria-pressed={selected} className={cn('p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan/15', selected ? 'bg-cyan/8' : 'hover:bg-hover/60')}>
                  <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-foreground">{strategy.name}</p>{selected ? <Check className="h-4 w-4 text-cyan" /> : null}</div>
                  <p className="mt-2 min-h-12 text-sm leading-6 text-secondary-text">{strategy.description}</p>
                  <p className="mt-3 text-xs text-muted-text">候选池：{strategy.candidates}</p>
                  <p className="mt-1 text-xs text-muted-text">来源：{strategy.source}</p>
                </button>;
              })}
            </div>
          </Card>
          <Card padding="md" className="border border-purple/20 bg-purple/5">
            <p className="label-uppercase">Execution plan</p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{selectedStrategy.name}</h2>
            <dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-secondary-text">编排模式</dt><dd className="font-medium text-foreground">{selectedStrategy.mode}</dd></div><div><dt className="text-secondary-text">策略专家</dt><dd className="mt-1 font-medium leading-6 text-foreground">{selectedStrategy.specialists.join(' · ')}</dd></div><div><dt className="text-secondary-text">来源资产</dt><dd className="mt-1 break-words text-secondary-text">{selectedStrategy.source}</dd></div><div><dt className="text-secondary-text">默认风控</dt><dd className="mt-1 text-secondary-text">{selectedStrategy.risk}</dd></div><div><dt className="text-secondary-text">模板状态</dt><dd className="mt-1 text-secondary-text">官方模板，可复制后创建个人版本。</dd></div></dl>
            <label className="mt-4 block text-sm font-medium text-foreground">本轮股票标的（P4 执行必填）<input value={targetStockCode} onChange={(event) => setTargetStockCode(event.target.value)} placeholder="例如 600519" className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground" /></label><Button className="mt-5 w-full" variant="secondary" onClick={() => void startEditingStrategy()} disabled={isEditingStrategy || isSavingStrategy}>复制并编辑模板</Button>
          </Card>
        </section>

        {isEditingStrategy ? <Card padding="none" className="overflow-hidden border border-cyan/25">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-5 py-4"><div><p className="label-uppercase">Personal strategy draft</p><h2 className="mt-1 text-lg font-semibold text-foreground">编辑个人策略版本</h2><p className="mt-1 text-sm text-secondary-text">基于官方模板复制；本次保存只创建新版本，不会覆盖 v1。</p></div><span className="rounded-full border border-cyan/25 bg-cyan/10 px-2.5 py-1 text-xs font-medium text-cyan">策略 #{editingStrategyId}</span></div>
          <div className="grid gap-4 p-5 lg:grid-cols-2"><label className="text-sm font-medium text-foreground">策略名称<input value={draftName} onChange={(event) => setDraftName(event.target.value)} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-4 focus:ring-cyan/15" /></label><label className="text-sm font-medium text-foreground">编排模式<select value={draftMode} onChange={(event) => setDraftMode(event.target.value as StrategyPreset['mode'])} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"><option value="quick">quick</option><option value="standard">standard</option><option value="full">full</option><option value="specialist">specialist</option></select></label><label className="text-sm font-medium text-foreground lg:col-span-2">策略说明<textarea value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} className="mt-2 min-h-20 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-4 focus:ring-cyan/15" /></label><label className="text-sm font-medium text-foreground">分析 Skill（逗号分隔）<input value={draftSkills.join(', ')} onChange={(event) => setDraftSkills(event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground" /></label><label className="text-sm font-medium text-foreground">单标的最大仓位 %<input type="number" min="0" max="100" value={draftMaxPosition} onChange={(event) => setDraftMaxPosition(event.target.value)} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground" /></label><label className="text-sm font-medium text-foreground lg:col-span-2">风险规则<textarea value={draftRisk} onChange={(event) => setDraftRisk(event.target.value)} className="mt-2 min-h-16 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground" /></label></div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 px-5 py-4"><Button variant="outline" onClick={() => setIsEditingStrategy(false)} disabled={isSavingStrategy}>取消编辑</Button><Button variant="primary" onClick={() => void saveStrategyVersion()} disabled={isSavingStrategy}>{isSavingStrategy ? '正在保存…' : '保存为新版本'}</Button></div>
        </Card> : null}

        {runNotice ? <div role="status" aria-live="polite" className="rounded-xl border border-cyan/25 bg-cyan/8 px-4 py-3 text-sm text-secondary-text">{runNotice}</div> : null}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(330px,0.8fr)]" aria-label="模拟交易关联边界">
          <Card padding="none" className="overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-5 py-4">
              <div>
                <p className="label-uppercase">Read-only inputs</p>
                <h2 className="mt-1 text-lg font-semibold text-foreground">从现有工作区读取研究上下文</h2>
              </div>
              <Button variant="outline" size="sm" onClick={() => void refreshLinkedInputs()}><RefreshCw className="h-4 w-4" />刷新关联数据</Button>
            </div>
            <div className="divide-y divide-border/70" role="status" aria-live="polite">
              {([
                ['screening', '选股结果', '选股 Agent 的候选池来源'],
                ['watchlist', '自选股', '用于扩充观察范围，不改变原列表'],
                ['analysis', '单股分析', '分析 Agent 可引用既有报告中的证据与风险'],
              ] as const).map(([key, title, description]) => {
                const link = linkedInputs[key];
                const state = linkStatusStyle[link.status];
                return (
                  <div key={key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{title}</p>
                      <p className="mt-1 text-sm text-secondary-text">{description}</p>
                      <p className="mt-2 text-xs text-muted-text">{link.detail}</p>
                    </div>
                    <span className={cn('shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium', state.className)}>{state.label}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card padding="md" className="border border-warning/25 bg-warning/5">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <div>
                <p className="text-sm font-semibold text-foreground">隔离执行边界</p>
                <p className="mt-1 text-sm leading-6 text-secondary-text">当前所有订单、仓位、收益和反思均为本地预览，尚未保存。它不会读取或写入真实持仓，也不会触发真实告警、下单或回测任务。</p>
              </div>
            </div>
          </Card>
        </section>

        <section className="overflow-hidden rounded-2xl border border-border/70 bg-card/70 shadow-soft-card" aria-label="Agent 决策流程">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
            <div>
              <p className="label-uppercase">Decision chain</p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">{selectedStrategy.name}：盘前研究与候选建仓</h2>
            </div>
            <div className="inline-flex items-center gap-2 text-sm text-secondary-text" role="status" aria-live="polite">
              <span className={cn('h-2 w-2 rounded-full', isRunning ? 'bg-cyan shadow-[0_0_0_4px_hsl(var(--primary)/0.14)]' : 'bg-success')} />
              {isSavingRun ? '正在保存策略版本与预览运行…' : runNotice ? '预览已记录，尚未执行 Agent 或创建订单' : '模拟流程已就绪'}
            </div>
          </div>
          <div className="relative p-4 lg:p-5">
            <div className="absolute left-10 right-10 top-[4.35rem] hidden h-px bg-border lg:block" aria-hidden="true" />
            <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {AGENTS.map((agent, index) => {
                const Icon = agent.icon;
                const state = statusStyle[agent.status];
                const selected = agent.id === selectedAgentId;
                return (
                  <React.Fragment key={agent.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedAgentId(agent.id)}
                      className={cn(
                        'group relative rounded-xl border p-4 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan/15',
                        selected ? 'border-cyan/45 bg-cyan/8 shadow-soft-card' : 'border-border/70 bg-background/45 hover:border-cyan/25 hover:bg-hover/60',
                      )}
                      aria-pressed={selected}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className={cn('flex h-9 w-9 items-center justify-center rounded-xl border', selected ? 'border-cyan/35 bg-cyan/12 text-cyan' : 'border-border/70 bg-card text-secondary-text')}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <span className={cn('rounded-full border px-2 py-1 text-[11px] font-medium', state.className)}>{state.label}</span>
                      </div>
                      <p className="mt-4 text-sm font-semibold text-foreground">{agent.name}</p>
                      <p className="mt-1 min-h-10 text-xs leading-5 text-secondary-text">{agent.description}</p>
                      {index < AGENTS.length - 1 ? <ArrowRight className="absolute -right-[1.35rem] top-7 z-10 hidden h-4 w-4 bg-card text-muted-text lg:block" /> : null}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
          <section className="space-y-5">
            <Card padding="none" className="overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan/25 bg-cyan/10 text-cyan"><selectedAgent.icon className="h-5 w-5" /></div>
                  <div>
                    <p className="label-uppercase">Agent configuration</p>
                    <h2 className="mt-1 text-lg font-semibold text-foreground">{selectedAgent.name}</h2>
                  </div>
                </div>
                <Button variant="outline" size="sm" disabled title="预览阶段仅展示提示词摘要">编辑 system prompt<ChevronRight className="h-4 w-4" /></Button>
              </div>
              <div className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_minmax(190px,0.52fr)]">
                <div>
                  <p className="text-sm font-medium text-foreground">System prompt</p>
                  {isEditingStrategy ? <textarea value={draftPrompts[selectedAgent.id] ?? selectedAgent.prompt} onChange={(event) => setDraftPrompts((previous) => ({ ...previous, [selectedAgent.id]: event.target.value }))} className="mt-2 min-h-28 w-full rounded-xl border border-border bg-background/50 p-4 text-sm leading-6 text-foreground focus:outline-none focus:ring-4 focus:ring-cyan/15" aria-label={`${selectedAgent.name} system prompt`} /> : <div className="mt-2 rounded-xl border border-border/70 bg-background/50 p-4 text-sm leading-6 text-secondary-text">{selectedAgent.prompt}</div>}
                  <p className="mt-3 text-xs text-muted-text">{isEditingStrategy ? '当前 Agent 的 prompt 会随本次保存冻结到新版本。' : '复制模板后，可按 Agent 分别编辑 prompt。'}</p>
                </div>
                <div className="rounded-xl border border-border/70 bg-hover/35 p-4">
                  <p className="text-sm font-medium text-foreground">本轮交接</p>
                  <dl className="mt-3 space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-3"><dt className="text-secondary-text">输入</dt><dd className="font-medium text-foreground">{selectedAgent.id === 'input' ? `${enabledSources.size} 个数据源` : '上游 Agent 输出'}</dd></div>
                    <div className="flex items-center justify-between gap-3"><dt className="text-secondary-text">输出</dt><dd className="font-medium text-foreground">结构化研究包</dd></div>
                    <div className="flex items-center justify-between gap-3"><dt className="text-secondary-text">状态</dt><dd className="inline-flex items-center gap-1.5 font-medium text-success"><Check className="h-3.5 w-3.5" />可配置</dd></div>
                  </dl>
                </div>
              </div>
            </Card>

            <Card title="模拟账本与复盘" subtitle="Local preview · not persisted" padding="none" className="overflow-hidden">
              <div className="grid divide-y divide-border/70 md:grid-cols-3 md:divide-x md:divide-y-0">
                <div className="p-5"><p className="text-xs text-secondary-text">模拟订单</p><p className="mt-2 text-xl font-semibold text-foreground">2 笔</p><p className="mt-2 text-sm text-secondary-text">本地预览示例 · 未保存</p></div>
                <div className="p-5"><p className="text-xs text-secondary-text">模拟持仓</p><p className="mt-2 text-xl font-semibold text-success">3 只</p><p className="mt-2 text-sm text-secondary-text">预览总仓位 62% · 未写入真实持仓</p></div>
                <div className="p-5"><p className="text-xs text-secondary-text">反思结论</p><p className="mt-2 text-xl font-semibold text-foreground">1 项</p><p className="mt-2 text-sm text-secondary-text">降低社交情绪权重 · 本地示例</p></div>
              </div>
            </Card>
          </section>

          <aside className="space-y-5">
            <Card padding="none" className="overflow-hidden">
              <div className="border-b border-border/70 px-5 py-4">
                <p className="label-uppercase">Input Agent</p>
                <h2 className="mt-1 text-lg font-semibold text-foreground">数据源配置</h2>
                <p className="mt-1 text-sm text-secondary-text">选择输入 Agent 本轮读取的信息通道。</p>
              </div>
              <div className="p-3">
                {DATA_SOURCES.map((source) => {
                  const Icon = source.icon;
                  const enabled = enabledSources.has(source.name);
                  const available = source.available !== false;
                  return (
                    <label key={source.name} className={cn('flex items-center gap-3 rounded-xl px-3 py-3 transition-colors', available ? 'cursor-pointer hover:bg-hover/70' : 'cursor-not-allowed opacity-55')}>
                      <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-background/55', source.tone)}><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-foreground">{source.name}</span><span className="mt-0.5 block text-xs text-secondary-text">{source.meta}</span></span>
                      <input type="checkbox" checked={enabled} onChange={() => toggleSource(source.name)} disabled={!available} className="h-4 w-4 rounded border-border accent-cyan disabled:cursor-not-allowed" aria-label={available ? `启用 ${source.name}` : `${source.name} 尚未接入`} />
                    </label>
                  );
                })}
              </div>
              <div className="border-t border-border/70 px-5 py-3"><button type="button" disabled aria-label="数据源接入将在完整版本提供" className="cursor-not-allowed text-sm font-medium text-secondary-text">+ 添加数据源（完整版本）</button></div>
            </Card>

            <Card padding="md" className="border border-purple/20 bg-purple/5">
              <div className="flex gap-3">
                <WalletCards className="mt-0.5 h-5 w-5 shrink-0 text-purple" />
                <div>
                  <h2 className="text-sm font-semibold text-foreground">后续接入顺序</h2>
                  <p className="mt-1 text-sm leading-6 text-secondary-text">先实现模拟账户、订单和持仓账本，再接 Agent 编排与 Prompt 版本；回测仅在用户主动导出模拟策略后才接入。</p>
                </div>
              </div>
            </Card>
          </aside>
        </div>
      </div>
    </AppPage>
  );
};

export default SimulationTradingPage;
