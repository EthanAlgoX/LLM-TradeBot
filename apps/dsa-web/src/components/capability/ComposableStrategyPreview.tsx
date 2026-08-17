import {
  ArrowRight,
  Box,
  Database,
  FileOutput,
  ListFilter,
  LockKeyhole,
} from "lucide-react";

import type {
  AgentWorkflowVersion,
  StrategyVersion,
} from "../../api/strategyWorkspace";
import { purposeDefinition } from "../../utils/strategyPurpose";

const marketName = (value?: string) =>
  ({ cn: "A 股", hk: "港股", us: "美股" })[
    value as "cn" | "hk" | "us"
  ] ?? value?.toUpperCase() ?? "未选择市场";

function sourceSummary(snapshot: Record<string, unknown>) {
  const labels: Record<string, string> = {
    kline: "K 线",
    news: "新闻",
    fundamentals: "基本面",
    other: "扩展数据",
  };
  const enabled = Object.keys(labels).filter((key) => {
    const value = snapshot[key];
    return typeof value === "object" && value !== null && (value as { enabled?: boolean }).enabled !== false;
  });
  return enabled.length ? enabled.map((key) => labels[key]).join(" · ") : "系统默认输入";
}

function implementationSummary(version: StrategyVersion) {
  const deterministic = version.agents.filter((agent) => agent.executionMode === "DETERMINISTIC").length;
  const hybrid = version.agents.filter((agent) => agent.executionMode === "HYBRID").length;
  const llm = version.agents.length - deterministic - hybrid;
  return [
    deterministic ? `${deterministic} 个确定性步骤` : "",
    hybrid ? `${hybrid} 个混合步骤` : "",
    llm ? `${llm} 个 LLM 步骤` : "",
  ].filter(Boolean).join(" · ") || "内部实现已冻结";
}

export function ComposableStrategyPreview({
  version,
}: {
  version: StrategyVersion;
  workflows?: AgentWorkflowVersion[];
}) {
  const purpose = version.strategyPurpose || "trading_decision";
  const purposeMeta = purposeDefinition(purpose);
  const market = marketName(version.screeningPolicy?.market);
  const fixedSymbols = Array.isArray(version.marketScope?.symbols)
    ? version.marketScope.symbols.map(String).filter(Boolean)
    : [];
  const runtimeSymbol = version.marketScope?.universeMode === "runtime_symbol";
  const scopeLabel = fixedSymbols.length
    ? fixedSymbols.join("、")
    : runtimeSymbol
      ? `${market} · 运行时单股`
      : `${market} · 动态候选`;

  return (
    <section className="workspace-surface overflow-hidden p-0" aria-labelledby="strategy-contract-title">
      <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="strategy-contract-title" className="text-lg font-semibold text-foreground">完整策略组成</h2>
            <span className="rounded-md border border-primary/25 bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary">
              {version.status === "PUBLISHED" ? "正式版本 · 配置已冻结" : "配置草稿 · 可调整"}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-secondary-text">
            当前版本引用一个固定策略内核，并单独保存市场、输入数据、周期、参数和风险边界。修改配置不会改写内核实现。
          </p>
        </div>
        <code className="w-fit rounded-lg border border-border bg-base px-3 py-2 text-xs text-primary">{purposeMeta.output}</code>
      </div>

      <div className="grid gap-px bg-border/70 md:grid-cols-[1fr_44px_1.1fr_44px_1fr] md:items-stretch">
        <div className="bg-surface px-5 py-5">
          <div className="flex items-center gap-2 text-primary"><Database className="h-4 w-4" /><span className="text-xs font-medium">输入</span></div>
          <h3 className="mt-3 font-semibold text-foreground">{scopeLabel}</h3>
          <p className="mt-1 text-xs leading-5 text-secondary-text">{sourceSummary(version.dataPermissionSnapshot || {})}</p>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-text"><ListFilter className="h-3.5 w-3.5" />独立运行配置</div>
        </div>
        <div className="hidden items-center justify-center bg-subtle/55 md:flex"><ArrowRight className="h-4 w-4 text-muted-text" /></div>
        <div className="bg-subtle/35 px-5 py-5">
          <div className="flex items-center gap-2 text-primary"><Box className="h-4 w-4" /><span className="text-xs font-medium">策略内核</span></div>
          <h3 className="mt-3 font-semibold text-foreground">{purposeMeta.shortLabel}内核</h3>
          <p className="mt-1 text-xs leading-5 text-secondary-text">{implementationSummary(version)}</p>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-text"><LockKeyhole className="h-3.5 w-3.5" />内核引用 #{version.kernelVersionId ?? version.agentWorkflowVersionId ?? version.id} · 只读</div>
        </div>
        <div className="hidden items-center justify-center bg-subtle/55 md:flex"><ArrowRight className="h-4 w-4 text-muted-text" /></div>
        <div className="bg-surface px-5 py-5">
          <div className="flex items-center gap-2 text-primary"><FileOutput className="h-4 w-4" /><span className="text-xs font-medium">输出</span></div>
          <h3 className="mt-3 font-semibold text-foreground">{purposeMeta.output}</h3>
          <p className="mt-1 text-xs leading-5 text-secondary-text">进入{purposeMeta.destination}，并保留版本、日志、证据和降级原因。</p>
          <div className="mt-3 text-xs text-muted-text">不会越过声明的输出边界</div>
        </div>
      </div>
    </section>
  );
}
