import type React from 'react';
import { Activity, ArrowRight, FlaskConical, ShieldCheck, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';

type StrategyHealthPanelProps = {
  className?: string;
  compact?: boolean;
  showLink?: boolean;
  strategyName?: string;
  candidateSource?: string;
  agentCount?: number;
};

/**
 * Strategy-first status surface shared by research and simulation workspaces.
 * Values are intentionally labelled as a seed until simulation persistence lands.
 */
export const StrategyHealthPanel: React.FC<StrategyHealthPanelProps> = ({ className, compact = false, showLink = true, strategyName = '趋势突破组合 v1.0', candidateSource = '趋势质量与放量突破', agentCount = 6 }) => {
  if (compact) {
    return (
      <section className={cn('rounded-2xl border border-cyan/25 bg-cyan/5 px-4 py-3', className)} aria-label="当前策略状态">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground"><FlaskConical className="h-4 w-4 text-cyan" />{strategyName}</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-warning"><span className="h-2 w-2 rounded-full bg-warning" />等待有效性样本</span>
          <span className="text-xs text-secondary-text">策略研究入口 · 尚无可跟随的实盘结论</span>
          {showLink ? <Link to="/simulation" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-cyan hover:text-cyan/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/40">查看策略工作台 <ArrowRight className="h-3.5 w-3.5" /></Link> : null}
        </div>
      </section>
    );
  }

  return (
    <section className={cn('overflow-hidden rounded-2xl border border-cyan/25 bg-card/70 shadow-soft-card', className)} aria-label="策略有效性概览">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-5 py-4">
        <div>
          <p className="label-uppercase">Strategy cockpit</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">预置策略有效性</h2>
          <p className="mt-1 text-sm text-secondary-text">首页负责把研究入口收拢到一处：先查看当前策略的证据状态，再进入研究、回测与模拟工作台。未完成验证的策略不会被标记为可跟随。</p>
        </div>
        {showLink ? <Link to="/simulation" className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm">进入策略工作台 <ArrowRight className="h-4 w-4" /></Link> : null}
      </div>
      <div className="grid divide-y divide-border/70 md:grid-cols-[1.25fr_repeat(3,minmax(0,0.75fr))] md:divide-x md:divide-y-0">
        <div className="p-5">
          <div className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-cyan" /><p className="text-sm font-semibold text-foreground">{strategyName}</p></div>
          <p className="mt-2 text-sm leading-6 text-secondary-text">候选池由{candidateSource}生成，再交给技术、情报、风控与决策 Agent 联合判断。这是研究编排，不代表已产生交易信号。</p>
          <div className="mt-3 flex flex-wrap gap-2"><span className="rounded-full border border-cyan/25 bg-cyan/10 px-2 py-1 text-xs text-cyan">specialist 编排</span><span className="rounded-full border border-border/70 bg-hover/60 px-2 py-1 text-xs text-secondary-text">预置模板</span></div>
        </div>
        <div className="p-5"><p className="text-xs text-secondary-text">验证状态</p><p className="mt-2 inline-flex items-center gap-2 text-base font-semibold text-warning"><span className="h-2 w-2 rounded-full bg-warning" />尚待验证</p><p className="mt-2 text-xs leading-5 text-muted-text">尚未达到“可跟随”门槛</p></div>
        <div className="p-5"><p className="text-xs text-secondary-text">计划编排</p><p className="mt-2 inline-flex items-center gap-2 text-base font-semibold text-foreground"><Activity className="h-4 w-4 text-cyan" />{agentCount} 个 Agent</p><p className="mt-2 text-xs leading-5 text-muted-text">输入 → 分析 → 选股 → 风控 → 决策 → 反思</p></div>
        <div className="p-5"><p className="text-xs text-secondary-text">模拟跟踪</p><p className="mt-2 inline-flex items-center gap-2 text-base font-semibold text-foreground"><TrendingUp className="h-4 w-4 text-success" />待启用</p><p className="mt-2 inline-flex gap-1.5 text-xs leading-5 text-muted-text"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 text-success" />不连接真实账户</p></div>
      </div>
    </section>
  );
};
