import {
  ArrowRight,
  BookOpenCheck,
  Bot,
  Boxes,
  CheckCircle2,
  GitBranch,
  ScanSearch,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import type { AgentWorkflowSummary, AgentWorkflowVersion } from "../../api/strategyWorkspace";

type WorkflowItem = {
  workflow: AgentWorkflowSummary;
  version: AgentWorkflowVersion;
};

type BlueprintId = "research" | "screening" | "strategy";

type Blueprint = {
  id: BlueprintId;
  name: string;
  type: string;
  description: string;
  input: string;
  output: string;
  destination: string;
  destinationLabel: string;
  stages: Array<{ label: string; kind: "input" | "tool" | "rating" | "llm" | "rule" | "output" }>;
  boundary: string;
};

const BLUEPRINTS: Blueprint[] = [
  {
    id: "research",
    name: "单股票分析工作流",
    type: "默认研究工作流",
    description: "消费已经标准化的单股数据，先完成确定性计算与评级，再由独立 LLM 形成研究报告。具体股票、市场和数据提供方由策略中心或单股研究入口绑定。",
    input: "ResearchDataBundle",
    output: "ResearchReport",
    destination: "/stock-research",
    destinationLabel: "单股研究",
    stages: [
      { label: "标准研究输入", kind: "input" },
      { label: "确定性分析", kind: "tool" },
      { label: "多维评级", kind: "rating" },
      { label: "研究综合 LLM", kind: "llm" },
      { label: "报告校验", kind: "rule" },
      { label: "研究报告", kind: "output" },
    ],
    boundary: "只定义数据如何被分析；不绑定股票、真实数据源、运行时间，也不进入订单链路。",
  },
  {
    id: "screening",
    name: "选股工作流",
    type: "默认候选发现工作流",
    description: "消费策略中心准备的股票池和特征数据，用确定性规则压缩范围，再让 LLM 解释有限候选。市场范围和数据来源不在这里重复配置。",
    input: "UniverseSnapshot + FeatureSet",
    output: "CandidateList",
    destination: "/screening",
    destinationLabel: "选股扫描",
    stages: [
      { label: "标准股票池", kind: "input" },
      { label: "资格硬过滤", kind: "rule" },
      { label: "因子计算", kind: "tool" },
      { label: "评级与排名", kind: "rating" },
      { label: "候选比较 LLM", kind: "llm" },
      { label: "候选列表", kind: "output" },
    ],
    boundary: "只定义如何从给定股票池产生候选；完整 Daily Stock 扫描还需要策略中心绑定市场、数据和运行计划。",
  },
  {
    id: "strategy",
    name: "交易决策工作流",
    type: "默认混合工作流",
    description: "把候选、研究结论、规则和 LLM 判断组合成标准化决策提案。它可以替换为纯规则或纯 LLM 版本，但不负责配置资金、调度或数据提供方。",
    input: "CandidateList + ResearchReport + StrategyContext",
    output: "DecisionProposal",
    destination: "/strategies",
    destinationLabel: "策略中心",
    stages: [
      { label: "标准策略输入", kind: "input" },
      { label: "指标与规则", kind: "tool" },
      { label: "选股与评级", kind: "rating" },
      { label: "决策 LLM", kind: "llm" },
      { label: "提案规则校验", kind: "rule" },
      { label: "决策提案", kind: "output" },
    ],
    boundary: "终点是 DecisionProposal；策略中心负责把它与市场、数据、标的和风险边界组装成完整策略。",
  },
];

const stageClass: Record<Blueprint["stages"][number]["kind"], string> = {
  input: "border-border bg-surface text-secondary-text",
  tool: "border-primary/25 bg-primary/5 text-foreground",
  rating: "border-primary/25 bg-primary/10 text-foreground",
  llm: "border-primary/35 bg-primary/10 text-primary",
  rule: "border-warning/25 bg-warning/5 text-foreground",
  output: "border-success/30 bg-success/5 text-success",
};

const formatVersion = (version: AgentWorkflowVersion) => version.status === "PUBLISHED"
  ? `正式版本 V${version.versionNumber ?? "—"}`
  : `草稿 revision ${version.revision}`;

export function WorkflowLibraryPanel({
  workflows,
  onOpenComposer,
}: {
  workflows: WorkflowItem[];
  onOpenComposer: (item?: WorkflowItem) => void;
}) {
  const [selectedId, setSelectedId] = useState<BlueprintId>("research");
  const selected = BLUEPRINTS.find((blueprint) => blueprint.id === selectedId) ?? BLUEPRINTS[0];

  return (
    <section id="capability-center-panel-workflows" aria-labelledby="capability-center-tab-workflows" role="tabpanel" className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="workspace-surface overflow-hidden p-0">
          <div className="flex flex-col gap-4 border-b border-border/70 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2"><span className="rounded-md border border-warning/25 bg-warning/5 px-2 py-1 text-[11px] font-medium text-warning">默认结构蓝图</span><span className="text-xs text-muted-text">能力级流程 · 待写入工作流数据库</span></div>
              <h2 className="mt-3 text-xl font-semibold tracking-[-0.02em] text-foreground">工作流只负责串起能力</h2>
              <p className="mt-2 max-w-[70ch] text-sm leading-6 text-secondary-text">这里定义数据如何经过工具、规则和 LLM；具体市场、股票、数据源和运行周期留给策略中心组装。</p>
            </div>
            <button type="button" className="btn-primary shrink-0" onClick={() => onOpenComposer()}>进入工作流编辑器</button>
          </div>

          <div className="grid border-b border-border/70 lg:grid-cols-[250px_minmax(0,1fr)]">
            <div className="border-b border-border/70 p-3 lg:border-b-0 lg:border-r">
              {BLUEPRINTS.map((blueprint) => {
                const active = blueprint.id === selected.id;
                const Icon = blueprint.id === "research" ? BookOpenCheck : blueprint.id === "screening" ? ScanSearch : ShieldCheck;
                return (
                  <button key={blueprint.id} type="button" aria-pressed={active} onClick={() => setSelectedId(blueprint.id)} className={`mb-1 flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${active ? "border-primary/25 bg-primary/10" : "border-transparent hover:bg-hover/60"}`}>
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-text"}`} aria-hidden="true" />
                    <span><span className="block text-sm font-medium text-foreground">{blueprint.name}</span><span className="mt-1 block text-[11px] text-muted-text">{blueprint.type}</span></span>
                  </button>
                );
              })}
            </div>

            <div className="min-w-0 px-5 py-5 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div><p className="text-xs font-medium text-primary">{selected.type}</p><h3 className="mt-1 text-lg font-semibold text-foreground">{selected.name}</h3></div>
                <Link to={selected.destination} className="text-xs font-medium text-primary hover:text-foreground">用于{selected.destinationLabel} <ArrowRight className="ml-1 inline h-3.5 w-3.5" aria-hidden="true" /></Link>
              </div>
              <p className="mt-3 max-w-[68ch] text-sm leading-6 text-secondary-text">{selected.description}</p>

              <div className="mt-5 overflow-x-auto pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" tabIndex={0} aria-label="工作流节点，横向滚动查看">
                <div className="flex min-w-max items-center">
                  {selected.stages.map((stage, index) => (
                    <div key={`${selected.id}-${stage.label}`} className="flex items-center">
                      <div className={`flex min-h-16 w-[132px] flex-col justify-center rounded-lg border px-3 py-2 ${stageClass[stage.kind]}`}>
                        <span className="text-[10px] text-muted-text">{stage.kind === "llm" ? "LLM" : stage.kind === "tool" ? "工具" : stage.kind === "rating" ? "评级" : stage.kind === "rule" ? "规则" : stage.kind === "input" ? "输入" : "输出"}</span>
                        <span className="mt-1 text-xs font-medium">{stage.label}</span>
                      </div>
                      {index < selected.stages.length - 1 ? <ArrowRight className="mx-2 h-4 w-4 shrink-0 text-muted-text" aria-hidden="true" /> : null}
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-1 text-[11px] text-muted-text sm:hidden">横向滑动查看全部工作流节点</p>

              <div className="mt-4 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
                <div className="bg-surface px-4 py-3"><p className="text-[11px] text-muted-text">输入契约</p><code className="mt-1 block break-all text-xs text-foreground">{selected.input}</code></div>
                <div className="bg-surface px-4 py-3"><p className="text-[11px] text-muted-text">输出契约</p><code className="mt-1 block break-all text-xs text-foreground">{selected.output}</code></div>
                <div className="bg-surface px-4 py-3"><p className="text-[11px] text-muted-text">产品边界</p><p className="mt-1 text-xs leading-5 text-secondary-text">{selected.destinationLabel}</p></div>
              </div>
              <p className="mt-4 flex gap-2 text-xs leading-5 text-secondary-text"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />{selected.boundary}</p>
            </div>
          </div>
        </div>

        <aside className="workspace-surface self-start p-5 xl:sticky xl:top-6">
          <div className="flex items-center gap-2"><Boxes className="h-4 w-4 text-warning" aria-hidden="true" /><h2 className="font-semibold text-foreground">目标黑盒契约</h2></div>
          <p className="mt-2 text-sm leading-6 text-secondary-text">这是新能力模型的目标调用边界；当前真实 API 尚未持久化以下工作流级 Schema 与适用范围字段。</p>
          <dl className="mt-4 divide-y divide-border/70 border-y border-border/70 text-sm">
            <div className="grid grid-cols-[100px_1fr] py-3"><dt className="text-muted-text">身份</dt><dd className="text-foreground">workflowVersionId</dd></div>
            <div className="grid grid-cols-[100px_1fr] py-3"><dt className="text-muted-text">输入</dt><dd className="text-foreground">Input Schema</dd></div>
            <div className="grid grid-cols-[100px_1fr] py-3"><dt className="text-muted-text">输出</dt><dd className="text-foreground">Output Schema</dd></div>
            <div className="grid grid-cols-[100px_1fr] py-3"><dt className="text-muted-text">适用范围</dt><dd className="text-foreground">市场 · 周期 · 数据要求</dd></div>
            <div className="grid grid-cols-[100px_1fr] py-3"><dt className="text-muted-text">治理</dt><dd className="text-foreground">版本 · 校验 · 运行状态</dd></div>
          </dl>
          <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 px-3 py-3 text-xs leading-5 text-secondary-text"><Bot className="mr-2 inline h-3.5 w-3.5 text-primary" aria-hidden="true" />内部是否调用 LLM，不改变外部页面的调用方式。</div>
        </aside>
      </div>

      <div className="workspace-surface overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="flex items-center gap-2"><Workflow className="h-4 w-4 text-primary" aria-hidden="true" /><h2 className="font-semibold text-foreground">我的工作流</h2></div><p className="mt-1 text-xs text-muted-text">以下内容来自现有真实工作流 API；点击后在本页进入编排编辑器。</p></div>
          <span className="text-xs tabular-nums text-muted-text">{workflows.length} 个已载入版本</span>
        </div>
        {workflows.length ? (
          <div className="divide-y divide-border/60">
            {workflows.map((item) => (
              <button key={item.version.id} type="button" onClick={() => onOpenComposer(item)} className="grid w-full gap-3 px-5 py-4 text-left transition-colors hover:bg-hover/55 md:grid-cols-[minmax(220px,1.3fr)_minmax(180px,1fr)_auto] md:items-center">
                <span className="min-w-0"><span className="block truncate font-medium text-foreground">{item.workflow.name}</span><span className="mt-1 block truncate text-xs text-secondary-text">{item.workflow.description || "尚未填写工作流说明"}</span></span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-secondary-text"><span className={item.version.status === "PUBLISHED" ? "text-success" : "text-warning"}>{formatVersion(item.version)}</span>{item.version.outputContract ? <><span>·</span><code className="text-primary">{item.version.outputContract}</code></> : null}<span>·</span><span>{item.version.agentCount} 个兼容节点</span><span>·</span><span>{item.version.connectionCount} 条连接</span></span>
                <span className="inline-flex items-center text-xs font-medium text-primary">打开编排 <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></span>
              </button>
            ))}
          </div>
        ) : (
          <div className="px-5 py-10 text-center"><GitBranch className="mx-auto h-5 w-5 text-muted-text" aria-hidden="true" /><p className="mt-3 font-medium text-foreground">还没有持久化工作流</p><p className="mt-1 text-sm text-secondary-text">进入工作流编辑器创建空白草稿。</p><button type="button" onClick={() => onOpenComposer()} className="btn-secondary mt-4">进入工作流编辑器</button></div>
        )}
      </div>
    </section>
  );
}
