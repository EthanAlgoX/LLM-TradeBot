import type React from 'react';
import { ArrowRight, CircleDot, ExternalLink, Newspaper, RadioTower, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppPage, Card, PageHeader } from '../components/common';

const newsItems = [
  ['市场观察', '实时新闻流将在完成数据源连接后展示', '等待数据源配置'],
  ['策略上下文', '当前策略未接入新闻输入，运行不会假定已读取资讯', '尚未接入'],
  ['信息透明度', '每条被 Agent 使用的内容都将保留来源、时间与处理结果', '规划中'],
];

const LiveNewsPage: React.FC = () => (
  <AppPage className="space-y-6">
    <PageHeader eyebrow="Data & evidence · live news" title="让策略看得见它读过的新闻" description="新闻是输入数据，不是装饰性信息流。接入后，这里会展示来源、时间、关联策略与 Agent 是否实际使用，方便回放每个判断。" actions={<Link to="/data" className="btn-primary inline-flex items-center gap-2"><RadioTower className="h-4 w-4" />配置新闻数据源</Link>} />
    <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
      <Card variant="gradient" padding="lg"><div className="flex items-start gap-3"><Newspaper className="h-6 w-6 shrink-0 text-cyan" /><div><p className="label-uppercase">Current stream</p><h2 className="mt-1 text-xl font-semibold text-foreground">当前没有可展示的实时新闻</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-secondary-text">本页不会展示模拟资讯。请先在数据源中完成连接；只有实际可用且被策略允许的来源，才会进入这里与策略运行记录。</p></div></div><Link to="/data-sources" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-cyan">前往数据源配置 <ArrowRight className="h-4 w-4" /></Link></Card>
      <Card variant="bordered" padding="lg" className="flex flex-col"><ShieldAlert className="h-6 w-6 text-warning" /><h2 className="mt-4 text-lg font-semibold text-foreground">输入可追溯</h2><p className="mt-2 text-sm leading-6 text-secondary-text">策略运行后，每条新闻都会标明是否纳入输入和产生了什么影响；未接入来源不会被计入。</p></Card>
    </section>
    <section><div className="mb-3"><p className="label-uppercase">Data contract</p><h2 className="mt-1 text-xl font-semibold text-foreground">实时信息流的展示规则</h2></div><div className="divide-y divide-border rounded-2xl border border-border bg-card/50">{newsItems.map(([label, text, status]) => <div key={label} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-muted-text" /><div><p className="text-sm font-semibold text-foreground">{label}</p><p className="mt-1 text-sm text-secondary-text">{text}</p></div></div><span className="text-xs text-muted-text">{status}</span></div>)}</div></section>
    <p className="flex items-center gap-2 text-xs text-muted-text"><ExternalLink className="h-3.5 w-3.5" />来源链接、抓取时间与策略引用记录将在数据接通后显示。</p>
  </AppPage>
);

export default LiveNewsPage;
