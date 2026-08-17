import type React from 'react';
import { useEffect, useState } from 'react';
import { ArrowRight, CircleAlert, Database, LoaderCircle, Plus, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { strategyWorkspaceApi, type StrategyDataSource } from '../api/strategyWorkspace';
import { toApiErrorMessage } from '../api/error';
import { AppPage, Card, PageHeader } from '../components/common';
import { dataSourceMarketSummary, STRATEGY_MARKETS } from '../utils/strategyMarkets';

const kindLabel:Record<StrategyDataSource['kind'],string>={kline:'K 线与行情',news:'新闻与资讯',fundamentals:'基本面',other:'其他研究数据'};

const DataSourcesPage: React.FC = () => {
  const [sources,setSources]=useState<StrategyDataSource[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [name,setName]=useState('');
  const [connectionKey,setConnectionKey]=useState('');
  const [description,setDescription]=useState('');
  const [kind,setKind]=useState<StrategyDataSource['kind']>('kline');
  const [markets,setMarkets]=useState<string[]>(['cn']);

  const load=async()=>{setLoading(true);setError('');try{setSources(await strategyWorkspaceApi.listDataSources());}catch(error){setError(toApiErrorMessage(error,'无法读取数据源目录。'));}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);
  const create=async(event:React.FormEvent)=>{event.preventDefault();if(!name.trim()||!connectionKey.trim()||markets.length===0)return;setSaving(true);setError('');try{const created=await strategyWorkspaceApi.createDataSource({name:name.trim(),connectionKey:connectionKey.trim(),description:description.trim()||undefined,kind,markets});setSources(current=>[...current,created]);setName('');setConnectionKey('');setDescription('');setKind('kline');setMarkets(['cn']);}catch(error){setError(toApiErrorMessage(error,'无法登记数据源。'));}finally{setSaving(false);}};
  const archive=async(source:StrategyDataSource)=>{if(!source.id||!window.confirm(`从目录移除“${source.name}”？已发布策略中的冻结引用不会被改写。`))return;try{await strategyWorkspaceApi.archiveDataSource(source.id);setSources(current=>current.filter(item=>item.sourceId!==source.sourceId));}catch(error){setError(toApiErrorMessage(error,'无法移除数据源。'));}};
  const defaults=sources.filter(item=>['system_market_data','system_news','system_fundamentals'].includes(item.sourceId));
  const providers=sources.filter(item=>item.selectionMode==='provider'&&item.builtIn);
  const customSources=sources.filter(item=>!item.builtIn);
  const configuredProviders=providers.filter(item=>item.selectable).length;
  const unconfiguredProviders=providers.filter(item=>!item.selectable).length;
  const readyDefaults=defaults.filter(item=>item.selectable).length;

  return <AppPage className="space-y-6">
    <PageHeader eyebrow="Platform data dependencies" title="数据中心" description="查看平台当前可用的数据连接、适用市场和配置状态。策略包接入后，平台会按数据需求自动核对依赖；密钥仍由设置管理。" actions={<Link to="/strategies" className="btn-primary inline-flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" />查看策略需求</Link>} />
    {error?<div role="alert" className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger"><CircleAlert className="h-4 w-4 shrink-0" />{error}</div>:null}
    <section aria-label="数据连接摘要" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 lg:grid-cols-4">
      {[
        ['系统默认', loading?'—':`${readyDefaults}/${defaults.length}`, '当前可用 / 全部'],
        ['已配置提供方', loading?'—':configuredProviders, '可固定数据口径'],
        ['待配置提供方', loading?'—':unconfiguredProviders, '连接尚不可用'],
        ['自定义来源', loading?'—':customSources.length, '已登记到目录'],
      ].map(([label,value,hint])=><div key={label} className="bg-card px-4 py-4"><p className="text-xs text-secondary-text">{label}</p><p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">{value}</p><p className="mt-1 text-xs text-muted-text">{hint}</p></div>)}
    </section>
    <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <Card variant="gradient" padding="lg">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold text-foreground">系统默认来源</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-secondary-text">K 线、新闻和基本面已作为新策略默认输入。系统会沿用设置中的提供方优先级和失败降级，不要求每个策略重复配置。</p></div><span className="shrink-0 rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">开箱即用</span></div>
        {loading?<p className="mt-6 flex items-center gap-2 text-sm text-secondary-text"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取数据源目录…</p>:<div className="mt-5 divide-y divide-border/70">{defaults.map(source=><div key={source.sourceId} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium text-foreground">{source.name}</h3>{source.required?<span className="text-xs text-cyan">策略必备</span>:<span className="text-xs text-muted-text">默认启用，可关闭</span>}<span className="rounded-full bg-hover px-2 py-0.5 text-[11px] text-secondary-text">{dataSourceMarketSummary(source)}</span></div><p className="mt-1 text-sm leading-6 text-secondary-text">{source.description}</p><p className="mt-1 text-xs text-muted-text">连接：{source.connectionKey}</p></div></div>)}</div>}
      </Card>
      <Card variant="bordered" padding="lg">
        <h2 className="text-lg font-semibold text-foreground">登记数据源</h2><p className="mt-2 text-sm leading-6 text-secondary-text">标注数据类型和适用市场后，策略中心会自动筛选兼容来源。这里仅保存无密钥的连接标识；对应适配器必须已在系统中配置。</p>
        <form className="mt-5 space-y-4" onSubmit={event=>void create(event)}>
          <label className="block text-sm text-secondary-text">数据源名称<input aria-label="数据源名称" required maxLength={120} value={name} onChange={event=>setName(event.target.value)} placeholder="例如 港股日线数据库" className="mt-1 w-full rounded-lg border border-border bg-base p-2.5 text-foreground" /></label>
          <label className="block text-sm text-secondary-text">数据类型<select aria-label="数据类型" value={kind} onChange={event=>setKind(event.target.value as StrategyDataSource['kind'])} className="mt-1 w-full rounded-lg border border-border bg-base p-2.5 text-foreground"><option value="kline">K 线与行情</option><option value="news">新闻与资讯</option><option value="fundamentals">基本面</option><option value="other">其他研究数据</option></select></label>
          <fieldset><legend className="text-sm text-secondary-text">适用市场</legend><p className="mt-1 text-xs leading-5 text-muted-text">至少选择一个。一个跨市场来源可以多选；策略中心只展示与策略市场匹配的来源。</p><div className="mt-2 grid grid-cols-3 gap-2">{STRATEGY_MARKETS.map(market=><label key={market.value} className={`flex min-h-10 items-center justify-center gap-2 rounded-lg border px-2 text-sm ${markets.includes(market.value)?'border-cyan/50 bg-cyan/10 text-foreground':'border-border bg-base text-secondary-text'}`}><input type="checkbox" aria-label={`适用市场 ${market.label}`} checked={markets.includes(market.value)} onChange={event=>setMarkets(current=>event.target.checked?[...current,market.value]:current.filter(item=>item!==market.value))} />{market.label}</label>)}</div>{markets.length===0?<p role="alert" className="mt-2 text-xs text-warning">请至少选择一个适用市场。</p>:null}</fieldset>
          <label className="block text-sm text-secondary-text">连接标识<input aria-label="连接标识" required maxLength={160} value={connectionKey} onChange={event=>setConnectionKey(event.target.value)} placeholder="例如 hk_daily_v1" className="mt-1 w-full rounded-lg border border-border bg-base p-2.5 font-mono text-sm text-foreground" /><span className="mt-1 block text-xs text-muted-text">仅填写已配置适配器的连接标识，不要填写 URL、Token 或密钥。</span></label>
          <label className="block text-sm text-secondary-text">用途说明（可选）<textarea aria-label="用途说明" maxLength={1000} value={description} onChange={event=>setDescription(event.target.value)} placeholder="说明它提供的数据范围和口径" className="mt-1 min-h-20 w-full rounded-lg border border-border bg-base p-2.5 text-foreground" /></label>
          <button type="submit" className="btn-primary inline-flex w-full items-center justify-center gap-2" disabled={saving||!name.trim()||!connectionKey.trim()||markets.length===0}>{saving?<LoaderCircle className="h-4 w-4 animate-spin" />:<Plus className="h-4 w-4" />}{saving?'正在登记…':'登记到数据源目录'}</button>
        </form>
      </Card>
    </section>
    <section><div className="mb-3"><h2 className="text-xl font-semibold text-foreground">可指定的提供方</h2><p className="mt-1 text-sm text-secondary-text">策略默认使用自动路由；当策略包声明固定提供方或需要复现实验口径时，平台会在版本接入检查中核对以下连接。市场标签决定可匹配的策略市场。</p></div>{loading?<Card variant="bordered" padding="lg"><p className="text-sm text-secondary-text">正在核对提供方配置…</p></Card>:<div className="grid gap-4 lg:grid-cols-3">{(['kline','news','fundamentals'] as const).map(kind=><Card key={kind} variant="bordered" padding="lg"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-foreground">{kindLabel[kind]}</h3><span className="text-xs text-muted-text">{providers.filter(item=>item.kind===kind&&item.selectable).length} 个可选</span></div><div className="mt-3 divide-y divide-border/70">{providers.filter(item=>item.kind===kind).map(source=><div key={source.sourceId} className="py-3 first:pt-0 last:pb-0"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-foreground">{source.name}</p><span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${source.selectable?'bg-success/10 text-success':'bg-warning/10 text-warning'}`}>{source.selectable?'已配置':'未配置'}</span></div><p className="mt-1 text-xs leading-5 text-secondary-text">{source.description}</p><p className="mt-1 text-[11px] text-muted-text">适用市场：{dataSourceMarketSummary(source)}</p></div>)}</div></Card>)}</div>}</section>
    <section><div className="mb-3"><h2 className="text-xl font-semibold text-foreground">自定义数据源目录</h2><p className="mt-1 text-sm text-secondary-text">自定义来源保留数据类型和市场标签；上传检查会按策略包的数据需求自动匹配可用连接。</p></div>{loading?<Card variant="bordered" padding="lg"><p className="text-sm text-secondary-text">正在读取目录…</p></Card>:customSources.length?<div className="divide-y divide-border/70 rounded-2xl border border-border/70 bg-card px-5">{customSources.map(source=><div key={source.sourceId} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Database className="h-4 w-4 text-cyan" /><h3 className="font-medium text-foreground">{source.name}</h3><span className="rounded-full bg-hover px-2 py-0.5 text-xs text-secondary-text">{kindLabel[source.kind]}</span><span className="rounded-full bg-hover px-2 py-0.5 text-xs text-secondary-text">{dataSourceMarketSummary(source)}</span></div><p className="mt-1 text-sm text-secondary-text">{source.description||'自定义登记数据源'}</p><p className="mt-1 text-xs text-muted-text">连接：{source.connectionKey} · 已登记，运行时核对适配器</p></div><button type="button" onClick={()=>void archive(source)} className="inline-flex shrink-0 items-center gap-1 text-sm text-danger"><Trash2 className="h-4 w-4" />移出目录</button></div>)}</div>:<Card variant="bordered" padding="lg"><p className="font-medium text-foreground">还没有自定义数据源</p><p className="mt-1 text-sm text-secondary-text">可以先直接使用系统默认来源；需要专用行情、新闻或私有研究数据时再登记。</p></Card>}</section>
    <Card variant="bordered" padding="lg" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-foreground">策略接入后自动核对数据依赖</p><p className="mt-1 text-sm text-secondary-text">平台会根据策略市场、数据类型和固定提供方要求检查连接；缺少依赖时会明确指出，不会静默替换数据口径。</p></div><Link to="/strategies" className="inline-flex items-center gap-1 text-sm font-medium text-cyan">前往策略中心 <ArrowRight className="h-4 w-4" /></Link></Card>
  </AppPage>;
};

export default DataSourcesPage;
