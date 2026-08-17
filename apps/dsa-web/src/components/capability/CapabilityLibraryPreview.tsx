import {
  ArrowRight,
  Bot,
  Braces,
  Calculator,
  Database,
  FileOutput,
  Filter,
  Gauge,
  GitMerge,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  strategyWorkspaceApi,
  type Agent,
  type AgentTemplate,
  type AgentTemplateDetail,
} from "../../api/strategyWorkspace";

type CapabilityKind = "all" | "input" | "tool" | "rating" | "rule" | "llm" | "output";
type AtomicCapabilityKind = Exclude<CapabilityKind, "all">;

type CatalogCapability = {
  id: string;
  name: string;
  kind: Exclude<AtomicCapabilityKind, "llm">;
  kindLabel: string;
  description: string;
  input: string;
  output: string;
  markets: string[];
  source: string;
  state: "已有服务逻辑" | "待能力化" | "设计蓝图";
  deterministic: true;
  failurePolicy: string;
  evidence: string[];
};

type LlmCapability = {
  id: string;
  name: string;
  kind: "llm";
  kindLabel: string;
  description: string;
  input: string;
  output: string;
  markets: string[];
  source: string;
  state: "数据库版本";
  deterministic: false;
  failurePolicy: string;
  evidence: string[];
  template: AgentTemplate;
};

type Capability = CatalogCapability | LlmCapability;

type TemplateForm = {
  templateId?: number;
  currentVersion?: number;
  name: string;
  description: string;
  agentType: Exclude<Agent["agentType"], "INPUT">;
  defaultRole: string;
  defaultSystemPrompt: string;
  inputSchema: string;
  outputSchema: string;
  supportedTools: string;
  supportedDataTypes: string;
};

const DEFAULT_INPUT_SCHEMA = {
  type: "object",
  title: "InputContext",
  properties: { symbol: { type: "string", description: "证券代码" } },
  required: ["symbol"],
  additionalProperties: true,
};

const DEFAULT_OUTPUT_SCHEMA = {
  type: "object",
  title: "LlmResult",
  properties: { summary: { type: "string", description: "结构化推理摘要" } },
  required: ["summary"],
  additionalProperties: true,
};

const emptyTemplateForm = (): TemplateForm => ({
  name: "",
  description: "",
  agentType: "ANALYSIS",
  defaultRole: "",
  defaultSystemPrompt: "",
  inputSchema: JSON.stringify(DEFAULT_INPUT_SCHEMA, null, 2),
  outputSchema: JSON.stringify(DEFAULT_OUTPUT_SCHEMA, null, 2),
  supportedTools: "",
  supportedDataTypes: "",
});

const formFromTemplate = (template: AgentTemplateDetail): TemplateForm => ({
  templateId: template.templateId,
  currentVersion: template.currentVersion,
  name: template.name,
  description: template.description || "",
  agentType: template.agentType as Exclude<Agent["agentType"], "INPUT">,
  defaultRole: template.defaultRole,
  defaultSystemPrompt: template.defaultSystemPrompt,
  inputSchema: JSON.stringify(template.inputSchema, null, 2),
  outputSchema: JSON.stringify(template.outputSchema, null, 2),
  supportedTools: template.supportedTools.join(", "),
  supportedDataTypes: template.supportedDataTypes.join(", "),
});

const llmTypeLabel: Record<Exclude<Agent["agentType"], "INPUT">, string> = {
  SCREENING: "选股 LLM",
  ANALYSIS: "分析 LLM",
  DECISION: "决策 LLM",
  REFLECTION: "复盘 LLM",
};

const llmDisplayName = (name: string) => name.replace(/\s*Agent$/i, " LLM");

const schemaLabel = (schema?: Record<string, unknown>) => {
  if (!schema) return "结构化对象";
  if (typeof schema.title === "string" && schema.title.trim()) return schema.title;
  const properties = schema.properties && typeof schema.properties === "object"
    ? Object.keys(schema.properties as Record<string, unknown>)
    : [];
  return properties.length ? `{ ${properties.slice(0, 3).join(", ")}${properties.length > 3 ? ", …" : ""} }` : "结构化对象";
};

const parseSchema = (value: string, label: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label}不是合法 JSON。`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label}必须是 JSON Schema 对象。`);
  }
  const schema = parsed as Record<string, unknown>;
  if (schema.type !== "object") throw new Error(`${label}的 type 必须为 object。`);
  if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties) || !Object.keys(schema.properties as Record<string, unknown>).length) {
    throw new Error(`${label}必须至少定义一个 properties 字段。`);
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== "string")) {
      throw new Error(`${label}的 required 必须是字段名数组。`);
    }
    const properties = schema.properties as Record<string, unknown>;
    const missing = schema.required.find((item) => !(item as string in properties));
    if (missing) throw new Error(`${label}的必填字段“${String(missing)}”未在 properties 中定义。`);
  }
  return schema;
};

const CATALOG_CAPABILITIES: CatalogCapability[] = [
  { id: "daily-bars", name: "历史 K 线读取", kind: "input", kindLabel: "输入适配器", description: "按市场、标的、周期和截止时间读取带来源信息的历史行情。", input: "InstrumentRef + MarketContext + AsOf", output: "BarSeries", markets: ["A 股", "港股", "美股"], source: "数据中心 / Daily Stock", state: "已有服务逻辑", deterministic: true, failurePolicy: "必需输入缺失时停止", evidence: ["数据源", "行情时间范围", "复权口径", "缺失区间"] },
  { id: "realtime-quote", name: "实时行情快照", kind: "input", kindLabel: "输入适配器", description: "读取价格、涨跌幅、量比、换手率与提供方时间戳。", input: "InstrumentRef + AsOf", output: "QuoteSnapshot", markets: ["A 股", "港股", "美股"], source: "Daily Stock 行情链路", state: "已有服务逻辑", deterministic: true, failurePolicy: "可降级到最近收盘价", evidence: ["提供方", "获取时间", "降级来源"] },
  { id: "fundamentals", name: "基本面聚合", kind: "input", kindLabel: "输入适配器", description: "聚合财务、估值、成长、分红、行业与概念归属。", input: "InstrumentRef + AsOf", output: "FundamentalSnapshot", markets: ["A 股", "港股", "美股"], source: "Daily Stock 基本面链路", state: "已有服务逻辑", deterministic: true, failurePolicy: "记录缺失维度后继续", evidence: ["财务截止期", "来源链", "覆盖维度"] },
  { id: "news-evidence", name: "新闻与公告证据", kind: "input", kindLabel: "输入适配器", description: "搜索、去重并保留具有时间、来源和标的关联的事件证据。", input: "InstrumentRef + SearchWindow", output: "NewsEvidenceSet", markets: ["A 股", "港股", "美股"], source: "Daily Stock 情报链路", state: "已有服务逻辑", deterministic: true, failurePolicy: "无搜索能力时明确缺失", evidence: ["标题", "发布时间", "来源链接", "检索维度"] },
  { id: "technical-features", name: "技术指标计算", kind: "tool", kindLabel: "确定性工具", description: "计算 MA、MACD、RSI、量价、波动率和回撤，不调用 LLM。", input: "BarSeries", output: "TechnicalFeatureSet", markets: ["A 股", "港股", "美股"], source: "Daily Stock 技术分析", state: "已有服务逻辑", deterministic: true, failurePolicy: "历史长度不足时停止该维度", evidence: ["指标参数", "使用区间", "最后一根有效 K 线"] },
  { id: "trend-structure", name: "趋势结构识别", kind: "tool", kindLabel: "确定性工具", description: "从行情和指标识别均线结构、突破、回踩、支撑与压力。", input: "BarSeries + TechnicalFeatureSet", output: "TrendStructure", markets: ["A 股", "港股", "美股"], source: "Daily Stock 趋势分析", state: "已有服务逻辑", deterministic: true, failurePolicy: "依赖缺失时跳过", evidence: ["触发规则", "关键价格", "结构标签"] },
  { id: "quality-gate", name: "数据质量门", kind: "rule", kindLabel: "治理规则", description: "检查市场、频率、截止时间、历史覆盖和数据源兼容性。", input: "EvidenceBundle", output: "ValidatedEvidenceBundle", markets: ["A 股", "港股", "美股"], source: "统一能力契约", state: "待能力化", deterministic: true, failurePolicy: "必需维度阻断，可选维度降级", evidence: ["缺失字段", "过期字段", "市场冲突", "降级说明"] },
  { id: "technical-rating", name: "技术趋势评级", kind: "rating", kindLabel: "评级模块", description: "把趋势、动量、量价和波动转换成统一的 0–100 评级卡。", input: "TechnicalFeatureSet + TrendStructure", output: "RatingCard", markets: ["A 股", "港股", "美股"], source: "统一评级协议", state: "设计蓝图", deterministic: true, failurePolicy: "证据不足时降低置信度", evidence: ["score", "confidence", "evidenceRefs[]", "warnings[]"] },
  { id: "fundamental-rating", name: "基本面质量评级", kind: "rating", kindLabel: "评级模块", description: "把盈利质量、成长、估值和分红转换成统一评级卡。", input: "FundamentalSnapshot", output: "RatingCard", markets: ["A 股", "港股", "美股"], source: "统一评级协议", state: "设计蓝图", deterministic: true, failurePolicy: "保留缺失维度并降低置信度", evidence: ["score", "confidence", "evidenceRefs[]", "warnings[]"] },
  { id: "weighted-rating", name: "多维评级聚合", kind: "rating", kindLabel: "评级模块", description: "按可配置权重合并多张评级卡，并保留每个维度的贡献。", input: "RatingCard[] + WeightPolicy", output: "CompositeRating", markets: ["A 股", "港股", "美股"], source: "统一评级协议", state: "设计蓝图", deterministic: true, failurePolicy: "缺失维度按权重策略处理", evidence: ["维度权重", "贡献分", "否决规则"] },
  { id: "universe-filter", name: "股票池硬过滤", kind: "rule", kindLabel: "治理规则", description: "按市场、流动性、市值、停牌和数据完整性过滤股票池。", input: "Universe + MarketSnapshot", output: "EligibleUniverse", markets: ["A 股", "港股", "美股"], source: "选股扫描链路", state: "待能力化", deterministic: true, failurePolicy: "不满足资格的标的直接排除", evidence: ["排除原因", "规则版本", "过滤前后数量"] },
  { id: "research-report", name: "研究报告输出", kind: "output", kindLabel: "输出模块", description: "校验研究草稿并输出可由单股研究页面消费的报告。", input: "StructuredResearchDraft + ValidatedEvidenceBundle", output: "ResearchReport", markets: ["A 股", "港股", "美股"], source: "单股研究产品契约", state: "设计蓝图", deterministic: true, failurePolicy: "结构校验失败时不生成报告", evidence: ["报告 Schema", "引用完整性", "缺失维度"] },
  { id: "candidate-list", name: "候选列表输出", kind: "output", kindLabel: "输出模块", description: "输出带排序依据、风险标记和证据引用的候选股票列表。", input: "RankedCandidates + CandidateRationale?", output: "CandidateList", markets: ["A 股", "港股", "美股"], source: "选股扫描产品契约", state: "设计蓝图", deterministic: true, failurePolicy: "解释缺失不影响确定性候选结果", evidence: ["排名规则", "候选分数", "风险标记"] },
];

const categories: Array<{ id: CapabilityKind; label: string; description: string; icon: typeof Database }> = [
  { id: "all", label: "全部能力", description: "输入、计算、推理与输出", icon: GitMerge },
  { id: "input", label: "输入适配器", description: "连接真实数据并标准化", icon: Database },
  { id: "tool", label: "确定性工具", description: "可复算的数据加工", icon: Calculator },
  { id: "rating", label: "评级模块", description: "统一输出 RatingCard", icon: Gauge },
  { id: "rule", label: "规则与治理", description: "过滤、校验与约束", icon: Braces },
  { id: "llm", label: "LLM 调用", description: "独立 Prompt 与输出契约", icon: Bot },
  { id: "output", label: "输出模块", description: "面向产品的最终产物", icon: FileOutput },
];

const iconByKind: Record<AtomicCapabilityKind, typeof Database> = { input: Database, tool: Wrench, rating: Gauge, rule: ShieldCheck, llm: Bot, output: FileOutput };
const stateClass: Record<Capability["state"], string> = { "已有服务逻辑": "text-success", "待能力化": "text-warning", "设计蓝图": "text-muted-text", "数据库版本": "text-success" };

export function CapabilityLibraryPreview({
  templates,
  selectedTemplate,
  detailLoading,
  onSelectTemplate,
  onReloadTemplates,
  onOpenComposer,
}: {
  templates: AgentTemplate[];
  selectedTemplate?: AgentTemplateDetail;
  detailLoading: boolean;
  onSelectTemplate: (templateId: number) => void;
  onReloadTemplates: (templateId?: number) => Promise<void>;
  onOpenComposer: () => void;
}) {
  const llmCapabilities = useMemo<LlmCapability[]>(() => templates.map((template) => ({
    id: `llm:${template.templateId}`,
    name: llmDisplayName(template.name),
    kind: "llm",
    kindLabel: llmTypeLabel[template.agentType as Exclude<Agent["agentType"], "INPUT">],
    description: template.description || "尚未填写这个 LLM 能力的用途说明。",
    input: selectedTemplate?.templateId === template.templateId ? schemaLabel(selectedTemplate.inputSchema) : "版本化 Input Schema",
    output: selectedTemplate?.templateId === template.templateId ? schemaLabel(selectedTemplate.outputSchema) : "版本化 Output Schema",
    markets: ["由工作流与策略约束"],
    source: `LLM 配置 API · v${template.currentVersion}`,
    state: "数据库版本",
    deterministic: false,
    failurePolicy: "无有效模型时停止并返回配置错误",
    evidence: ["Prompt 版本", "模型配置", "输入快照", "结构化输出"],
    template,
  })), [templates, selectedTemplate]);
  const capabilities = useMemo<Capability[]>(() => [...CATALOG_CAPABILITIES, ...llmCapabilities], [llmCapabilities]);
  const [category, setCategory] = useState<CapabilityKind>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("technical-features");
  const [form, setForm] = useState<TemplateForm>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const detailRef = useRef<HTMLElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => capabilities.filter((item) =>
    (category === "all" || item.kind === category) &&
    (!normalizedQuery || [item.name, item.description, item.input, item.output, item.source].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)))), [capabilities, category, normalizedQuery]);
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0] ?? capabilities[0];
  const SelectedIcon = iconByKind[selected.kind];

  useEffect(() => {
    if (category === "llm" && !selectedId.startsWith("llm:") && llmCapabilities[0]) {
      setSelectedId(llmCapabilities[0].id);
      onSelectTemplate(llmCapabilities[0].template.templateId);
    }
  }, [category, llmCapabilities, onSelectTemplate, selectedId]);

  const selectCapability = (item: Capability) => {
    setForm(undefined);
    setMessage("");
    setSelectedId(item.id);
    if (item.kind === "llm") onSelectTemplate(item.template.templateId);
    revealMobileDetail();
  };

  const revealMobileDetail = () => {
    if (typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 1279px)").matches) return;
    window.requestAnimationFrame(() => detailRef.current?.scrollIntoView?.({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    }));
  };

  const saveTemplate = async () => {
    if (!form || !form.name.trim() || !form.defaultRole.trim() || !form.defaultSystemPrompt.trim()) {
      setMessage("请填写名称、职责和 System Prompt。");
      return;
    }
    let inputSchema: Record<string, unknown>;
    let outputSchema: Record<string, unknown>;
    try {
      inputSchema = parseSchema(form.inputSchema, "Input Schema");
      outputSchema = parseSchema(form.outputSchema, "Output Schema");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "输入输出契约无效。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        agentType: form.agentType,
        defaultRole: form.defaultRole.trim(),
        defaultSystemPrompt: form.defaultSystemPrompt.trim(),
        inputSchema,
        outputSchema,
        supportedTools: form.supportedTools.split(/[,，\n]+/).map((item) => item.trim()).filter(Boolean),
        supportedDataTypes: form.supportedDataTypes.split(/[,，\n]+/).map((item) => item.trim()).filter(Boolean),
      };
      const saved = form.templateId
        ? await strategyWorkspaceApi.updateAgentTemplate(form.templateId, { ...payload, currentVersion: form.currentVersion || 1 })
        : await strategyWorkspaceApi.createAgentTemplate(payload);
      setForm(undefined);
      setCategory("llm");
      setSelectedId(`llm:${saved.templateId}`);
      setMessage(`已保存“${llmDisplayName(saved.name)}” · v${saved.templateVersion}`);
      await onReloadTemplates(saved.templateId);
    } catch {
      setMessage("保存 LLM 能力失败；如果版本已变化，请刷新后重试。");
    } finally {
      setBusy(false);
    }
  };

  const archiveTemplate = async () => {
    if (!selectedTemplate || !window.confirm(`归档“${llmDisplayName(selectedTemplate.name)}”？已发布工作流中的历史快照不会受影响。`)) return;
    setBusy(true);
    try {
      await strategyWorkspaceApi.archiveAgentTemplate(selectedTemplate.templateId);
      setForm(undefined);
      setMessage("LLM 能力已归档；历史工作流快照仍然保留。");
      await onReloadTemplates();
    } catch {
      setMessage("归档 LLM 能力失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="capability-center-panel-capabilities" aria-labelledby="capability-center-tab-capabilities" role="tabpanel">
      <div className="workspace-surface overflow-hidden p-0">
        <div className="grid min-h-[680px] grid-cols-[minmax(0,1fr)] xl:grid-cols-[220px_minmax(360px,0.9fr)_minmax(420px,1.1fr)]">
          <nav aria-label="能力分类" className="min-w-0 border-b border-border/70 p-3 xl:border-b-0 xl:border-r">
            <div className="px-2 pb-3 pt-1"><p className="text-sm font-semibold text-foreground">原子能力</p><p className="mt-1 text-xs leading-5 text-secondary-text">每项能力都必须公开可检查的输入与输出。</p></div>
            <div className="flex gap-1 overflow-x-auto pb-1 xl:block xl:space-y-1 xl:overflow-visible">
              {categories.map((item) => {
                const Icon = item.icon;
                const active = category === item.id;
                const count = item.id === "all" ? capabilities.length : capabilities.filter((capability) => capability.kind === item.id).length;
                return <button key={item.id} type="button" aria-pressed={active} onClick={() => { setCategory(item.id); setForm(undefined); setMessage(""); }} className={`flex min-h-12 shrink-0 items-center gap-3 rounded-lg border px-3 text-left transition-colors xl:w-full ${active ? "border-primary/25 bg-primary/10 text-foreground" : "border-transparent text-secondary-text hover:bg-hover/70 hover:text-foreground"}`}><Icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-text"}`} aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block whitespace-nowrap text-sm font-medium">{item.label}</span><span className="mt-0.5 hidden truncate text-[11px] text-muted-text xl:block">{item.description}</span></span><span className="text-xs tabular-nums text-muted-text">{count}</span></button>;
              })}
            </div>
            <div className="mt-4 border-t border-border/70 px-2 pt-4"><p className="text-[11px] leading-5 text-muted-text"><span className="font-medium text-success">LLM 调用已接入真实版本 API。</span> 输入、工具、评级、规则与输出仍展示现有服务和目标契约，不会伪造为可保存资产。</p></div>
          </nav>

          <div className="min-w-0 border-b border-border/70 xl:border-b-0 xl:border-r">
            <div className="border-b border-border/70 p-4">
              <div className="flex gap-2">
                <label className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-text" aria-hidden="true" /><span className="sr-only">搜索能力</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索能力、输入或输出" className="h-10 w-full rounded-lg border border-border bg-base pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" /></label>
                <button type="button" aria-label="新增 LLM 能力" className="btn-primary inline-flex shrink-0 items-center gap-2" onClick={() => { setCategory("llm"); setForm(emptyTemplateForm()); setMessage(""); revealMobileDetail(); }}><Plus className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">新增 LLM</span></button>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-text"><span>显示 {visible.length} 个能力</span><span>{category === "llm" ? "真实数据库能力" : "LLM 可编辑 · 其他能力待持久化"}</span></div>
            </div>
            <div className="divide-y divide-border/60 xl:max-h-[600px] xl:overflow-y-auto" aria-live="polite">
              {visible.map((item) => {
                const Icon = iconByKind[item.kind];
                const active = selected.id === item.id;
                return <button key={item.id} type="button" onClick={() => selectCapability(item)} aria-pressed={active} className={`w-full px-4 py-4 text-left transition-colors ${active ? "bg-primary/7" : "hover:bg-hover/55"}`}><span className="flex items-start gap-3"><span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${active ? "border-primary/25 bg-primary/10 text-primary" : "border-border bg-base text-muted-text"}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-foreground">{item.name}</span><span className={`text-[11px] font-medium ${stateClass[item.state]}`}>{item.state}{item.kind === "llm" ? ` v${item.template.currentVersion}` : ""}</span></span><span className="mt-1 block text-xs text-secondary-text">{item.kindLabel} · {item.source}</span><span className="mt-2 block text-sm leading-6 text-secondary-text">{item.description}</span></span></span></button>;
              })}
              {!visible.length ? <div className="px-5 py-12 text-center"><Filter className="mx-auto h-5 w-5 text-muted-text" aria-hidden="true" /><p className="mt-3 font-medium text-foreground">没有匹配的能力</p><p className="mt-1 text-sm text-secondary-text">清除搜索词、切换分类，或新增一个 LLM 调用。</p></div> : null}
            </div>
          </div>

          <aside ref={detailRef} className="min-w-0 scroll-mt-16 bg-base/25 p-5 sm:p-6" aria-label="能力契约详情">
            {message ? <p role="status" className="mb-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-secondary-text">{message}</p> : null}
            {form ? (
              <div className="space-y-4">
                <div><p className="text-xs font-medium text-primary">{form.templateId ? `编辑版本 v${form.currentVersion}` : "新增原子能力"}</p><h2 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-foreground">{form.templateId ? llmDisplayName(form.name) : "新建 LLM 调用"}</h2><p className="mt-2 text-xs leading-5 text-secondary-text">保存既有能力会创建新版本；输入与输出契约缺失或无效时不能保存。</p></div>
                <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-foreground">名称<input aria-label="LLM 能力名称" maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-base p-2.5" /></label><label className="text-sm text-foreground">推理分类<select aria-label="LLM 能力分类" value={form.agentType} onChange={(event) => setForm({ ...form, agentType: event.target.value as TemplateForm["agentType"] })} className="mt-1 w-full rounded-lg border border-border bg-base p-2.5"><option value="SCREENING">选股 LLM</option><option value="ANALYSIS">分析 LLM</option><option value="DECISION">决策 LLM</option><option value="REFLECTION">复盘 LLM</option></select></label></div>
                <label className="block text-sm text-foreground">说明<textarea aria-label="LLM 能力说明" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-1 min-h-16 w-full rounded-lg border border-border bg-base p-2.5" /></label>
                <label className="block text-sm text-foreground">推理职责<textarea aria-label="LLM 推理职责" required value={form.defaultRole} onChange={(event) => setForm({ ...form, defaultRole: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border border-border bg-base p-2.5" /></label>
                <label className="block text-sm text-foreground">System Prompt<textarea aria-label="LLM System Prompt" required value={form.defaultSystemPrompt} onChange={(event) => setForm({ ...form, defaultSystemPrompt: event.target.value })} className="mt-1 min-h-32 w-full rounded-lg border border-border bg-base p-2.5" /></label>
                <div className="grid gap-3 2xl:grid-cols-2"><label className="block text-sm text-foreground">Input Schema <span className="text-danger">*</span><textarea spellCheck={false} aria-label="LLM Input Schema" required value={form.inputSchema} onChange={(event) => setForm({ ...form, inputSchema: event.target.value })} className="mt-1 min-h-52 w-full rounded-lg border border-border bg-base p-3 font-mono text-xs leading-5" /></label><label className="block text-sm text-foreground">Output Schema <span className="text-danger">*</span><textarea spellCheck={false} aria-label="LLM Output Schema" required value={form.outputSchema} onChange={(event) => setForm({ ...form, outputSchema: event.target.value })} className="mt-1 min-h-52 w-full rounded-lg border border-border bg-base p-3 font-mono text-xs leading-5" /></label></div>
                <p className="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-xs leading-5 text-secondary-text">两端必须是 <code>type: object</code> 的 JSON Schema，并至少定义一个字段。工作流检查会拒绝缺少有效契约的节点。</p>
                <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-foreground">可用前置工具<input aria-label="LLM 兼容工具声明" value={form.supportedTools} onChange={(event) => setForm({ ...form, supportedTools: event.target.value })} placeholder="逗号分隔" className="mt-1 w-full rounded-lg border border-border bg-base p-2.5" /></label><label className="text-sm text-foreground">支持的数据类型<input aria-label="LLM 数据类型" value={form.supportedDataTypes} onChange={(event) => setForm({ ...form, supportedDataTypes: event.target.value })} placeholder="例如 kline, news" className="mt-1 w-full rounded-lg border border-border bg-base p-2.5" /></label></div>
                <div className="flex gap-2"><button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => void saveTemplate()}>{busy ? "正在保存…" : form.templateId ? "保存为新版本" : "创建 LLM 能力"}</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => setForm(undefined)}>取消</button></div>
              </div>
            ) : selected.kind === "llm" ? (
              detailLoading || selectedTemplate?.templateId !== selected.template.templateId ? <div className="flex items-center gap-2 text-sm text-secondary-text"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />正在读取 LLM 能力…</div> : <div><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium text-primary">{llmTypeLabel[selectedTemplate.agentType as Exclude<Agent["agentType"], "INPUT">]} · 数据库版本</p><h2 className="mt-1 break-words text-xl font-semibold tracking-[-0.02em] text-foreground">{llmDisplayName(selectedTemplate.name)}</h2><p className="mt-1 text-xs text-muted-text">当前 v{selectedTemplate.templateVersion} · 修改后生成新版本</p></div><Bot className="h-5 w-5 text-primary" aria-hidden="true" /></div><p className="mt-3 max-w-[62ch] text-sm leading-6 text-secondary-text">{selectedTemplate.description || "尚未填写这个 LLM 能力的用途说明。"}</p><dl className="mt-5 space-y-4"><div><dt className="text-xs font-medium text-muted-text">推理职责</dt><dd className="mt-1 text-sm leading-6 text-secondary-text">{selectedTemplate.defaultRole}</dd></div><div><dt className="text-xs font-medium text-muted-text">System Prompt</dt><dd className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap rounded-xl border border-border/70 bg-surface p-3 text-sm leading-6 text-secondary-text">{selectedTemplate.defaultSystemPrompt}</dd></div><div className="grid gap-3 2xl:grid-cols-2"><div><dt className="text-xs font-medium text-muted-text">Input Schema</dt><dd><pre className="mt-1 max-h-52 overflow-auto rounded-xl border border-border/70 bg-surface p-3 text-xs leading-5 text-secondary-text">{JSON.stringify(selectedTemplate.inputSchema, null, 2)}</pre></dd></div><div><dt className="text-xs font-medium text-muted-text">Output Schema</dt><dd><pre className="mt-1 max-h-52 overflow-auto rounded-xl border border-border/70 bg-surface p-3 text-xs leading-5 text-secondary-text">{JSON.stringify(selectedTemplate.outputSchema, null, 2)}</pre></dd></div></div></dl><div className="mt-5 flex gap-2"><button type="button" className="btn-primary inline-flex flex-1 items-center justify-center gap-2" onClick={() => setForm(formFromTemplate(selectedTemplate))}><Pencil className="h-4 w-4" aria-hidden="true" />直接编辑</button><button type="button" aria-label="归档 LLM 能力" className="btn-secondary text-danger" disabled={busy} onClick={() => void archiveTemplate()}><Trash2 className="h-4 w-4" aria-hidden="true" /></button></div><button type="button" onClick={onOpenComposer} className="btn-secondary mt-3 inline-flex w-full items-center justify-center gap-2">在工作流中使用 <ArrowRight className="h-4 w-4" aria-hidden="true" /></button></div>
            ) : (
              <div><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium text-primary">{selected.kindLabel}</p><h2 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-foreground">{selected.name}</h2></div><SelectedIcon className="h-5 w-5 text-primary" aria-hidden="true" /></div><p className="mt-3 max-w-[62ch] text-sm leading-6 text-secondary-text">{selected.description}</p><dl className="mt-6 overflow-hidden rounded-xl border border-border/70 bg-surface"><div className="grid grid-cols-[96px_1fr] border-b border-border/60 px-4 py-3 text-sm"><dt className="text-muted-text">输入端口</dt><dd><code className="break-all text-foreground">{selected.input}</code></dd></div><div className="grid grid-cols-[96px_1fr] border-b border-border/60 px-4 py-3 text-sm"><dt className="text-muted-text">输出端口</dt><dd><code className="break-all text-foreground">{selected.output}</code></dd></div><div className="grid grid-cols-[96px_1fr] border-b border-border/60 px-4 py-3 text-sm"><dt className="text-muted-text">执行性质</dt><dd className="text-foreground">确定性 · 可复算</dd></div><div className="grid grid-cols-[96px_1fr] border-b border-border/60 px-4 py-3 text-sm"><dt className="text-muted-text">失败策略</dt><dd className="text-foreground">{selected.failurePolicy}</dd></div><div className="grid grid-cols-[96px_1fr] px-4 py-3 text-sm"><dt className="text-muted-text">适用市场</dt><dd className="text-foreground">{selected.markets.join(" · ")}</dd></div></dl><div className="mt-5 border-t border-border/70 pt-5"><p className="text-sm font-medium text-foreground">每次运行必须留下</p><div className="mt-3 flex flex-wrap gap-2">{selected.evidence.map((item) => <span key={item} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-secondary-text">{item}</span>)}</div></div>{selected.output === "RatingCard" ? <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4"><div className="flex items-center gap-2"><Gauge className="h-4 w-4 text-primary" aria-hidden="true" /><p className="text-sm font-medium text-foreground">统一评级协议</p></div><code className="mt-3 block whitespace-pre-wrap text-xs leading-5 text-secondary-text">{"score: 0–100\nconfidence: 0–1\nevidenceRefs[]\nwarnings[]\nasOf"}</code></div> : null}<button type="button" onClick={onOpenComposer} className="btn-primary mt-6 inline-flex w-full items-center justify-center gap-2">进入工作流 <ArrowRight className="h-4 w-4" aria-hidden="true" /></button><p className="mt-2 text-center text-[11px] leading-5 text-muted-text">此类能力仍是现有服务/目标契约目录；当前不会伪造新增或保存结果。</p></div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
