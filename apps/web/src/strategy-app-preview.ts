import {
  type PreviewOrigin,
  type StrategyApp,
  type StrategyAppPreviewState,
  type StrategyAppStatus,
  previewBoundaryLabel,
  strategyAppStatuses,
} from "./strategy-app-preview-state.js";

export type PreviewLocale = "zh-CN" | "en";
export type StrategyDetailTarget = "proposal" | "app";
export type StrategyDetailTab = "overview" | "agents" | "data" | "logic" | "risk" | "evidence" | "versions";
export type AgentCategory = "input" | "analysis" | "decision";

export interface StrategyPreviewRenderContext {
  locale: PreviewLocale;
  preview: StrategyAppPreviewState;
  appFilter: "all" | StrategyAppStatus;
  detailTarget: StrategyDetailTarget;
  detailTab: StrategyDetailTab;
  agentCategory: AgentCategory;
  selectedAgentId: string;
  agentSearch: string;
  experimentHandoffAppName?: string;
}

type Copy = { zh: string; en: string };
type Proposal = {
  id: string;
  name: string;
  market: string;
  frequency: string;
  fit: Copy;
  data: string;
  agents: string;
  risk: string;
  assumptions: string;
  gap: string;
};
type Scenario = {
  id: string;
  title: Copy;
  request: Copy;
  intent: Array<[Copy, string]>;
  clarifications: Copy[];
  proposalIds: string[];
};
type Agent = {
  id: string;
  category: AgentCategory;
  name: string;
  purpose: Copy;
  market: string;
  input: string;
  output: string;
  version: string;
  refs: number;
};

const copy = (locale: PreviewLocale, value: Copy): string => locale === "zh-CN" ? value.zh : value.en;
const esc = (value: string): string => value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
const t = (locale: PreviewLocale, zh: string, en: string): string => locale === "zh-CN" ? zh : en;

const proposals: readonly Proposal[] = [
  {
    id: "hk-quality-trend", name: "HK Quality Trend", market: "Hong Kong equities", frequency: "Daily + earnings event",
    fit: { zh: "以低换手趋势跟随配合财报质量过滤，优先回避高波动追涨。", en: "Low-turnover trend following with earnings-quality filters; avoids chasing volatility." },
    data: "Registered filings + delayed market snapshot", agents: "Input · Quality · Trend · Risk Gate", risk: "1.0× notional cap · no leverage", assumptions: "Issuer filings are registered and comparable", gap: "Earnings timeliness not connected",
  },
  {
    id: "hk-defensive-income", name: "HK Defensive Income", market: "Hong Kong equities", frequency: "Weekly", fit: { zh: "以股息质量和波动预算构建防御性观察篮子。", en: "A defensive observation basket using dividend quality and volatility budgets." }, data: "Sample issuer fundamentals", agents: "Input · Fundamental · Portfolio · Risk Gate", risk: "Single-sector cap", assumptions: "Dividend fields are comparable", gap: "No live corporate-action feed",
  },
  {
    id: "us-earnings-event", name: "US Earnings Event", market: "US equities", frequency: "Event-driven", fit: { zh: "围绕财报前后可验证事件窗口建立有限期研究候选。", en: "A time-bounded research candidate around verifiable earnings windows." }, data: "Sample earnings calendar + filings", agents: "Event Input · Analysis · Decision · Risk Gate", risk: "Gap-risk guard · expiry", assumptions: "Event timestamps are correct", gap: "Earnings feed not connected",
  },
  {
    id: "crypto-trend-guard", name: "Crypto Trend Guard", market: "Crypto perpetuals", frequency: "4h / daily", fit: { zh: "将趋势、流动性和资金费率假设分开呈现，保留独立 Risk Gate。", en: "Separates trend, liquidity, and funding assumptions while retaining an independent Risk Gate." }, data: "Sample public-market dimensions", agents: "Market Input · Trend · Decision · Risk Gate", risk: "Paper-only exposure budget", assumptions: "Public dimensions pass quality gates", gap: "No registered realtime snapshot",
  },
];

const scenarios: readonly Scenario[] = [
  {
    id: "hk-low-risk", title: { zh: "港股低风险趋势与财报", en: "HK low-risk trend + earnings" },
    request: { zh: "我想关注港股中基本面稳健、趋势向上且财报不恶化的标的。低换手、低风险，先做可验证研究。", en: "I want Hong Kong equities with resilient fundamentals, an upward trend, and non-deteriorating earnings. Low turnover, low risk, research first." },
    intent: [[{ zh: "市场", en: "Market" }, "Hong Kong equities"], [{ zh: "目标", en: "Objective" }, "Quality trend research"], [{ zh: "风险", en: "Risk" }, "Low / no leverage"], [{ zh: "频率", en: "Frequency" }, "Daily + earnings event"]],
    clarifications: [{ zh: "可接受的行业集中度？", en: "Acceptable sector concentration?" }, { zh: "财报滞后与缺失时是否只观察？", en: "Observe-only when filings are late or missing?" }], proposalIds: ["hk-quality-trend", "hk-defensive-income"],
  },
  {
    id: "us-earnings", title: { zh: "美股财报事件", en: "US earnings event" },
    request: { zh: "我想研究美股财报前后的事件机会，但不想把预期当作事实。", en: "I want to research US earnings-event opportunities without treating expectations as facts." },
    intent: [[{ zh: "市场", en: "Market" }, "US equities"], [{ zh: "目标", en: "Objective" }, "Event research"], [{ zh: "风险", en: "Risk" }, "Time-bounded"], [{ zh: "频率", en: "Frequency" }, "Event-driven"]],
    clarifications: [{ zh: "研究窗口和持有期上限？", en: "Research window and maximum holding period?" }, { zh: "是否排除盘后流动性不足标的？", en: "Exclude after-hours liquidity constraints?" }], proposalIds: ["us-earnings-event"],
  },
  {
    id: "crypto-trend", title: { zh: "加密趋势", en: "Crypto trend" },
    request: { zh: "我想研究加密趋势，但必须将数据质量、资金费率和风险约束单独说清。", en: "I want to research crypto trends, with data quality, funding, and risk constraints kept distinct." },
    intent: [[{ zh: "市场", en: "Market" }, "Crypto perpetuals"], [{ zh: "目标", en: "Objective" }, "Trend research"], [{ zh: "风险", en: "Risk" }, "Paper-only budget"], [{ zh: "频率", en: "Frequency" }, "4h / daily"]],
    clarifications: [{ zh: "哪些市场维度必须可用？", en: "Which market dimensions are mandatory?" }, { zh: "数据不完整时是否禁止新开仓？", en: "Block new openings when data is incomplete?" }], proposalIds: ["crypto-trend-guard"],
  },
];

const agents: readonly Agent[] = [
  { id: "market-input", category: "input", name: "Market Input Agent", purpose: { zh: "清洗、聚合与结构化已登记市场输入。", en: "Cleans, aggregates, and structures registered market inputs." }, market: "Multi-market", input: "Registered datasets", output: "Structured observation", version: "v1.2", refs: 4 },
  { id: "filing-input", category: "input", name: "Filing Input Agent", purpose: { zh: "将财报字段整理为可审阅的观察事实。", en: "Shapes filing fields into reviewable observations." }, market: "HK / US equities", input: "Registered filings", output: "Earnings observation", version: "v0.6", refs: 2 },
  { id: "quality-analysis", category: "analysis", name: "Quality Analysis Agent", purpose: { zh: "解释质量和趋势假设，不能创建订单。", en: "Explains quality and trend assumptions; cannot create orders." }, market: "HK / US equities", input: "Structured observation", output: "Quality assessment", version: "v0.4", refs: 2 },
  { id: "trend-analysis", category: "analysis", name: "Trend Analysis Agent", purpose: { zh: "对已验证时间窗口给出趋势上下文。", en: "Provides trend context for verified observation windows." }, market: "Crypto / equities", input: "Market observation", output: "Trend assessment", version: "v0.8", refs: 3 },
  { id: "decision-synthesis", category: "decision", name: "Decision Synthesis Agent", purpose: { zh: "汇总结构化证据，输出受约束的决策建议。", en: "Combines structured evidence into constrained decision advice." }, market: "Multi-market", input: "Assessments", output: "Decision proposal", version: "v1.0", refs: 5 },
  { id: "reflection-agent", category: "decision", name: "Reflection Agent", purpose: { zh: "从结果生成候选经验，不回写运行策略。", en: "Creates lesson candidates from results; never rewrites a running strategy." }, market: "Multi-market", input: "Result evidence", output: "Lesson candidate", version: "v0.5", refs: 3 },
];

export function proposalById(id: string): Proposal {
  return proposals.find((proposal) => proposal.id === id) ?? proposals[0]!;
}

function badge(origin: PreviewOrigin): string {
  return `<span class="preview-badge preview-badge--${origin.toLowerCase()}">${previewBoundaryLabel(origin)}</span>`;
}

function previewHeader(locale: PreviewLocale, kicker: string, title: string, description: string, action = ""): string {
  return `<section class="preview-page-intro"><div><span>${esc(kicker)}</span><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${action}</section>`;
}

export function renderStrategyOverview(context: StrategyPreviewRenderContext): string {
  const { locale } = context;
  const stats: Array<[string, string, string]> = [
    [t(locale, "Market Radar", "Market Radar"), t(locale, "3 个市场视角", "3 market lenses"), "SAMPLE · NOT CONNECTED"],
    [t(locale, "最近 Strategy App", "Recent Strategy App"), "HK Quality Trend · v0.3", "SAMPLE"],
    [t(locale, "正在实验", "Experimenting"), "2 applications", "SAMPLE"],
    [t(locale, "Simulation Capacity", "Simulation Capacity"), "2 / 3 Running", "SAMPLE"],
  ];
  return `${previewHeader(locale, "STRATEGY APP · PROTOTYPE", t(locale, "策略应用总览", "Strategy App overview"), t(locale, "用于评审信息架构与路径的页面内存预览；所有数字和市场摘要均未连接真实服务。", "A page-memory preview for reviewing information architecture and paths; no values or market summaries are connected to a real service."), `<button type="button" class="primary-action" data-view="advisor">${t(locale, "描述策略目标", "Describe a strategy goal")}</button>`)}
    <section class="preview-overview-grid" aria-label="${t(locale, "策略应用摘要", "Strategy App summary")}">
      ${stats.map(([label, value, boundary]) => `<article><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(boundary)}</small></article>`).join("")}
    </section>
    <section class="preview-boundary-strip"><div><strong>${t(locale, "数据与 Agent 健康", "Data & Agent health")}</strong><span>${t(locale, "仅显示界面样本。请前往数据中心查看已登记资产，前往 Agent 中心查看能力目录。", "Interface samples only. Use Data Center for registered assets and Agent Center for the capability catalog.")}</span></div><button type="button" class="text-action" data-view="trade-center">${t(locale, "查看最近决策与晋升建议", "View decisions & promotion advice")}</button></section>`;
}

export function renderStrategyAdvisor(context: StrategyPreviewRenderContext): string {
  const { locale, preview } = context;
  const scenario = scenarios.find((item) => item.id === preview.selectedScenarioId) ?? scenarios[0]!;
  const scenarioProposals = scenario.proposalIds.map(proposalById);
  return `${previewHeader(locale, "STRATEGY ADVISOR · SAMPLE", t(locale, "策略助手", "Strategy Advisor"), t(locale, "描述投资目标后获得受约束的 Strategy App 建议。此演示不调用 LLM、不创建 Draft 或 Runtime。", "Describe an investment goal and receive constrained Strategy App suggestions. This demo does not call an LLM or create a Draft or Runtime."), badge("SAMPLE"))}
    <section class="advisor-layout">
      <aside class="advisor-scenarios" aria-label="${t(locale, "示例需求", "Sample requests")}"><span>${t(locale, "选择 Sample 需求", "Choose a sample request")}</span>${scenarios.map((item) => `<button type="button" data-preview-scenario="${item.id}" class="${item.id === scenario.id ? "is-selected" : ""}" aria-pressed="${item.id === scenario.id}"><strong>${esc(copy(locale, item.title))}</strong><small>${esc(copy(locale, item.request))}</small></button>`).join("")}</aside>
      <div class="advisor-conversation"><section class="advisor-message"><span>${t(locale, "用户需求 · SAMPLE", "User request · SAMPLE")}</span><p>${esc(copy(locale, scenario.request))}</p></section><section class="advisor-intent"><header><div><span>STRATEGY INTENT · SAMPLE</span><h2>${t(locale, "结构化意图", "Structured intent")}</h2></div><button type="button" class="text-action" data-preview-adjust>${t(locale, "调整需求", "Adjust request")}</button></header><dl>${scenario.intent.map(([label, value]) => `<div><dt>${esc(copy(locale, label))}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl><div class="advisor-clarifications"><strong>${t(locale, "必要澄清", "Required clarifications")}</strong><ul>${scenario.clarifications.map((item) => `<li>${esc(copy(locale, item))}</li>`).join("")}</ul></div></section></div>
    </section>
    <section class="proposal-section" aria-labelledby="proposal-title"><header><div><span>RECOMMENDATIONS · SAMPLE</span><h2 id="proposal-title">${t(locale, "Strategy App Proposal", "Strategy App proposals")}</h2></div><small>${t(locale, "推荐基于演示场景，不是模型输出或策略匹配结果。", "Suggestions are scenario samples, not model output or strategy-matching results.")}</small></header><div class="proposal-grid">${scenarioProposals.map((proposal) => renderProposalCard(locale, proposal)).join("")}</div></section>`;
}

function renderProposalCard(locale: PreviewLocale, proposal: Proposal): string {
  return `<article class="proposal-card"><header><div>${badge("SAMPLE")}<h3>${esc(proposal.name)}</h3><p>${esc(proposal.market)} · ${esc(proposal.frequency)}</p></div><span class="preview-evidence">EVIDENCE · UNAVAILABLE</span></header><p>${esc(copy(locale, proposal.fit))}</p><dl><div><dt>${t(locale, "数据", "Data")}</dt><dd>${esc(proposal.data)}</dd></div><div><dt>${t(locale, "Agent", "Agents")}</dt><dd>${esc(proposal.agents)}</dd></div><div><dt>${t(locale, "风险", "Risk")}</dt><dd>${esc(proposal.risk)}</dd></div><div><dt>${t(locale, "假设 / 缺口", "Assumption / gap")}</dt><dd>${esc(proposal.assumptions)} · ${esc(proposal.gap)}</dd></div></dl><footer><button type="button" class="secondary-action" data-preview-proposal="${proposal.id}">${t(locale, "查看详情", "View details")}</button><button type="button" class="primary-action" data-preview-create="${proposal.id}">${t(locale, "创建策略应用", "Create Strategy App")}</button></footer></article>`;
}

export function renderMyStrategyApps(context: StrategyPreviewRenderContext): string {
  const { locale, preview, appFilter } = context;
  const apps = preview.apps.filter((app) => appFilter === "all" || app.status === appFilter);
  return `${previewHeader(locale, "MY STRATEGY APPS · PAGE MEMORY", t(locale, "我的策略应用", "My Strategy Apps"), t(locale, "Sample 与当前页面内存中的 Prototype 应用明确分隔；刷新会恢复初始 Sample。", "Sample and current page-memory Prototype apps are explicitly separated; refresh restores the initial Sample."), `<button type="button" class="secondary-action" data-view="advisor">${t(locale, "打开策略助手", "Open Strategy Advisor")}</button>`)}
    <nav class="preview-filter-row" aria-label="${t(locale, "应用状态筛选", "App status filter")}"><button type="button" data-strategy-status="all" aria-pressed="${appFilter === "all"}">${t(locale, "全部", "All")}</button>${strategyAppStatuses.map((status) => `<button type="button" data-strategy-status="${status}" aria-pressed="${appFilter === status}">${esc(status)}</button>`).join("")}</nav>
    <section class="strategy-app-list">${apps.map((app) => renderAppRow(locale, app, app.id === preview.selectedAppId)).join("") || `<p class="preview-empty">${t(locale, "没有匹配的页面内存应用。", "No page-memory apps match this filter.")}</p>`}</section>`;
}

function renderAppRow(locale: PreviewLocale, app: StrategyApp, selected: boolean): string {
  return `<article class="strategy-app-row ${selected ? "is-selected" : ""}"><div><div class="preview-row-title">${badge(app.origin)}<h2>${esc(app.name)}</h2></div><p>${esc(app.market)} · <code>${esc(app.version)}</code></p></div><div class="strategy-app-row__status"><span>${esc(app.status)}</span><small>${app.origin === "PROTOTYPE" ? t(locale, "刷新后清除", "Clears on refresh") : t(locale, "演示样本", "Demo sample")}</small></div><button type="button" class="secondary-action" data-preview-app="${app.id}">${t(locale, "查看详情", "View details")}</button></article>`;
}

export function renderStrategyAppDetail(context: StrategyPreviewRenderContext): string {
  const { locale, preview, detailTarget, detailTab } = context;
  const isProposal = detailTarget === "proposal";
  const proposal = proposalById(preview.selectedProposalId);
  const app = preview.apps.find((item) => item.id === preview.selectedAppId) ?? preview.apps[0]!;
  const item = isProposal ? proposal : app;
  const origin = isProposal ? "SAMPLE" : app.origin;
  const status = isProposal ? t(locale, "Proposal · 未创建", "Proposal · not created") : app.status;
  const tabs: Array<[StrategyDetailTab, string, string]> = [["overview", "概览", "Overview"], ["agents", "Agent 组成", "Agents"], ["data", "数据", "Data"], ["logic", "策略逻辑", "Strategy logic"], ["risk", "风险与运行配置", "Risk & runtime"], ["evidence", "Evidence", "Evidence"], ["versions", "版本", "Versions"]];
  return `${previewHeader(locale, isProposal ? "STRATEGY APP PROPOSAL · SAMPLE" : "STRATEGY APP · PAGE MEMORY", esc(item.name), t(locale, "只读产品预览。创建动作仅在当前页面内存中生成 Prototype，不会物化后端版本。", "Read-only product preview. Create makes a Prototype in current page memory only; it does not materialize a backend version."), `${badge(origin)}<span class="preview-status-summary">${esc(status)}</span>`)}
    <section class="strategy-detail"><nav class="strategy-detail-tabs" role="tablist" aria-label="${t(locale, "策略应用详情", "Strategy App detail")}">${tabs.map(([id, zh, en]) => `<button type="button" role="tab" data-strategy-detail-tab="${id}" aria-selected="${detailTab === id}">${t(locale, zh, en)}</button>`).join("")}</nav><div class="strategy-detail-content" role="tabpanel">${renderDetailTab(locale, detailTab, proposal, app, isProposal)}</div></section>
    <footer class="strategy-detail-actions"><button type="button" class="secondary-action" data-view="strategy-apps">${t(locale, "返回我的应用", "Back to My Apps")}</button>${isProposal ? `<button type="button" class="primary-action" data-preview-create="${proposal.id}">${t(locale, "创建策略应用", "Create Strategy App")}</button>` : `<button type="button" class="primary-action" data-preview-experiment="${app.id}">${t(locale, "去实验场", "Go to Experiment Arena")}</button>`}</footer>`;
}

function renderDetailTab(locale: PreviewLocale, tab: StrategyDetailTab, proposal: Proposal, app: StrategyApp, isProposal: boolean): string {
  const name = isProposal ? proposal.name : app.name;
  if (tab === "overview") return `<div class="detail-summary"><div><span>${t(locale, "应用定位", "App position")}</span><strong>${esc(name)}</strong><p>${esc(isProposal ? copy(locale, proposal.fit) : t(locale, "当前为页面内存 Prototype / Sample 详情，没有服务端版本。", "Current page-memory Prototype / Sample detail; there is no backend version."))}</p></div><dl><div><dt>${t(locale, "市场", "Market")}</dt><dd>${esc(isProposal ? proposal.market : app.market)}</dd></div><div><dt>${t(locale, "状态", "Status")}</dt><dd>${esc(isProposal ? "Proposal · SAMPLE" : app.status)}</dd></div><div><dt>${t(locale, "运行时", "Runtime")}</dt><dd>runtimeApplied=false</dd></div></dl></div>`;
  if (tab === "agents") return `<section class="detail-stack"><p>${t(locale, "输入 Agent 将原料清洗为结构化观察；分析、决策与反思 Agent 只产生受约束的建议。", "Input Agents turn raw material into structured observations; analysis, decision, and reflection Agents produce constrained advice only.")}</p><div class="detail-agent-grid"><span>Market Input Agent · INPUT</span><span>Quality / Trend Analysis · ANALYSIS</span><span>Decision Synthesis · DECISION</span><span>Reflection Agent · DECISION</span></div></section>`;
  if (tab === "data") return `<section class="detail-stack"><span class="preview-evidence">DATA · NOT CONNECTED</span><h3>${t(locale, "数据不是 Agent", "Data is not an Agent")}</h3><p>${t(locale, "Data Source 与 Dataset 是原料；Input Agent 负责清洗、聚合和特征加工。此应用没有接入真实数据。", "Data Sources and Datasets are ingredients; an Input Agent cleans, aggregates, and shapes features. No real data is connected to this app.")}</p><dl class="detail-data-list"><div><dt>Source</dt><dd>${esc(isProposal ? proposal.data : "SAMPLE dataset reference")}</dd></div><div><dt>Quality</dt><dd>UNAVAILABLE · not evaluated</dd></div><div><dt>Lineage</dt><dd>NOT CONNECTED</dd></div></dl></section>`;
  if (tab === "logic") return `<section class="logic-flow" aria-label="${t(locale, "只读策略逻辑", "Read-only strategy logic")}">${["Input", "Analysis", "Decision", "Portfolio", "Risk", "Execution"].map((node, index) => `<div class="${node === "Risk" || node === "Execution" ? "is-locked" : ""}"><span>${index + 1}</span><strong>${node}</strong><small>${node === "Risk" || node === "Execution" ? t(locale, "系统锁定", "SYSTEM LOCKED") : t(locale, "只读", "READ ONLY")}</small></div>`).join("")}<div class="logic-flow__return"><strong>Result → Reflection</strong><small>${t(locale, "有界证据，不回写策略", "Bounded evidence; never rewrites strategy")}</small></div></section>`;
  if (tab === "risk") return `<section class="risk-lock-grid"><article><span>RISK GATE · SYSTEM LOCKED</span><h3>${t(locale, "风险独立否决", "Independent risk veto")}</h3><p>${t(locale, "不显示为可编辑 Prompt Agent。", "Not shown as an editable Prompt Agent.")}</p></article><article><span>EXECUTION · SYSTEM LOCKED</span><h3>${t(locale, "执行保持 Paper Only", "Execution remains Paper Only")}</h3><p>runtimeApplied=false · exchangeWriteAllowed=false</p></article><article><span>LIVE · UNAVAILABLE</span><h3>${t(locale, "没有授权", "Not authorized")}</h3><p>Exchange writes OFF</p></article></section>`;
  if (tab === "evidence") return `<section class="detail-stack"><span class="preview-evidence">EVIDENCE · UNAVAILABLE</span><p>${t(locale, "此预览不会生成 Artifact、Backtest、Walk-Forward 或 Shadow 写入。", "This preview creates no Artifact, Backtest, Walk-Forward, or Shadow write.")}</p></section>`;
  return `<section class="version-timeline"><div><code>${esc(isProposal ? "proposal" : app.version)}</code><strong>${t(locale, "当前预览", "Current preview")}</strong><small>${isProposal ? "SAMPLE · NOT CONNECTED" : previewBoundaryLabel(app.origin)}</small></div><div><code>—</code><strong>${t(locale, "未来版本", "Future versions")}</strong><small>${t(locale, "需经验证流程创建", "Created only through a verified lifecycle")}</small></div></section>`;
}

export function renderAgentCenter(context: StrategyPreviewRenderContext): string {
  const { locale, agentCategory, selectedAgentId, agentSearch } = context;
  const visible = agents.filter((agent) => agent.category === agentCategory && `${agent.name} ${agent.market} ${agent.input} ${agent.output}`.toLowerCase().includes(agentSearch.toLowerCase()));
  const selected = agents.find((agent) => agent.id === selectedAgentId) ?? visible[0] ?? agents[0]!;
  const categories: Array<[AgentCategory, string, string]> = [["input", "输入 Agent", "Input Agents"], ["analysis", "分析 Agent", "Analysis Agents"], ["decision", "决策与反思 Agent", "Decision & Reflection"]];
  return `${previewHeader(locale, "AGENT CENTER · SAMPLE CATALOG", t(locale, "Agent 中心", "Agent Center"), t(locale, "统一浏览 Input、Analysis、Decision 与 Reflection 能力。目录为 Sample，不支持创建、保存 Prompt 或发布。", "Browse Input, Analysis, Decision, and Reflection capabilities in one place. This is a Sample catalog; creation, Prompt saving, and publishing are unavailable."), `<button type="button" class="secondary-action" disabled>NOT CONNECTED</button>`)}
    <section class="agent-center-toolbar"><nav role="tablist" aria-label="${t(locale, "Agent 分类", "Agent categories")}">${categories.map(([id, zh, en]) => `<button type="button" role="tab" data-agent-category="${id}" aria-selected="${agentCategory === id}">${t(locale, zh, en)}</button>`).join("")}</nav><label><span>${t(locale, "搜索", "Search")}</span><input id="agent-center-search" type="search" value="${esc(agentSearch)}" placeholder="${t(locale, "名称、市场、输入或输出", "Name, market, input, or output")}"></label></section>
    <section class="agent-center-layout"><div class="agent-catalog">${visible.map((agent) => `<button type="button" class="preview-agent-card ${agent.id === selected.id ? "is-selected" : ""}" data-preview-agent="${agent.id}"><strong>${esc(agent.name)}</strong><span>${esc(agent.market)} · ${esc(agent.version)}</span><small>${esc(agent.input)} → ${esc(agent.output)}</small><em>${agent.refs} ${t(locale, "个应用引用", "app references")}</em></button>`).join("") || `<p class="preview-empty">${t(locale, "没有匹配的 Sample Agent。", "No Sample Agents match.")}</p>`}</div><aside class="agent-detail"><span>SAMPLE · READ ONLY</span><h2>${esc(selected.name)}</h2><p>${esc(copy(locale, selected.purpose))}</p><dl><div><dt>${t(locale, "类型", "Type")}</dt><dd>${esc(selected.category)}</dd></div><div><dt>${t(locale, "支持市场", "Markets")}</dt><dd>${esc(selected.market)}</dd></div><div><dt>${t(locale, "输入 / 输出", "Input / output")}</dt><dd>${esc(selected.input)} → ${esc(selected.output)}</dd></div><div><dt>${t(locale, "版本", "Version")}</dt><dd>${esc(selected.version)} · NOT CONNECTED</dd></div></dl><button type="button" class="secondary-action" disabled>${t(locale, "创建或发布不可用", "Create or publish unavailable")}</button></aside></section>`;
}

export function renderDataCenterPrelude(locale: PreviewLocale): string {
  return `<section class="market-radar-preview"><header><div><span>MARKET RADAR · SAMPLE</span><h2>${t(locale, "Market Radar 预览", "Market Radar preview")}</h2><p>${t(locale, "该区域用于验证信息架构，并非已接入市场数据。下方 Data Center 保留现有真实资产、质量与 Lineage 页面。", "This region validates information architecture, not connected market data. The Data Center below retains the existing registered-asset, quality, and lineage surface.")}</p></div>${badge("SAMPLE")}</header><div><article><strong>Hong Kong</strong><span>${t(locale, "财报与趋势", "Earnings + trend")}</span><small>UNAVAILABLE</small></article><article><strong>US equities</strong><span>${t(locale, "财报事件", "Earnings events")}</span><small>NOT CONNECTED</small></article><article><strong>Crypto</strong><span>${t(locale, "趋势与流动性", "Trend + liquidity")}</span><small>UNAVAILABLE</small></article></div></section>`;
}

export function renderExperimentHandoff(locale: PreviewLocale, appName?: string): string {
  return `<section class="experiment-handoff"><div><span>STRATEGY APP HANDOFF · ${appName ? "PROTOTYPE" : "NOT CONNECTED"}</span><h2>${appName ? esc(appName) : t(locale, "Strategy App 未来比较对象", "Strategy App future comparison object")}</h2><p>${appName ? t(locale, "此 handoff 只提供可见的页面上下文，不会启动 Backtest、Walk-Forward、Candidate 或 Runtime。", "This handoff carries visible page context only; it will not start Backtest, Walk-Forward, Candidate, or Runtime.") : t(locale, "从 Strategy App 详情进入后，所选应用会在此显示为页面内存上下文。", "When entered from Strategy App detail, the selected app appears here as page-memory context.")}</p></div><code>PROTOTYPE / NOT CONNECTED</code></section>`;
}

export function renderTradeCenterPreview(locale: PreviewLocale): string {
  const slots = [
    ["1", "HK Quality Trend · v0.3", "RUNNING", "+2.4%", "-1.8%", "14k / 30k", "$4.20", "Next: 09:30 UTC", "HEALTH · SAMPLE", "Promotion: observe"],
    ["2", "US Earnings Event · v0.2", "RUNNING", "+0.8%", "-2.2%", "9k / 30k", "$3.10", "Next: event window", "HEALTH · SAMPLE", "Promotion: unavailable"],
    ["3", "Available", "AVAILABLE", "—", "—", "0 / 30k", "—", "No scheduled cycle", "NOT CONNECTED", "Promotion: unavailable"],
  ];
  return `${previewHeader(locale, "TRADE CENTER · PRODUCT PREVIEW", t(locale, "交易中心", "Trade Center"), t(locale, "产品预览明确区分未来 Simulation Capacity 与现有真实 Paper / Shadow 页面。这里不会请求 Start、Stop、Archive 或 Runtime Apply。", "This preview distinguishes future Simulation Capacity from the existing real Paper / Shadow surfaces. It does not request Start, Stop, Archive, or Runtime Apply."), `<span class="live-unavailable">LIVE UNAVAILABLE · NOT AUTHORIZED · Exchange writes OFF</span>`)}
    <section class="simulation-rules"><div><span>${t(locale, "账户 Scope", "Account scope")}</span><strong>${t(locale, "未来最多 1 个 Live Champion", "Future maximum: 1 Live Champion")}</strong><small>NOT AUTHORIZED</small></div><div><span>${t(locale, "工作区", "Workspace")}</span><strong>${t(locale, "最多 3 个 active Paper Challenger", "Maximum 3 active Paper Challengers")}</strong><small>SAMPLE · UI capacity only</small></div><div><span>${t(locale, "不占槽位", "Does not occupy a slot")}</span><strong>Archived · stopped · Shadow evidence</strong><small>Shadow is bounded evidence</small></div></section>
    <section class="simulation-slots"><header><div><span>SIMULATION CAPACITY · SAMPLE</span><h2>2 / 3 Running</h2></div><p>${t(locale, "第四个启动意图会在产品状态层被拒绝；本预览没有任何 Runtime 调用。", "A fourth start intent is rejected in product state; this preview makes no Runtime call.")}</p></header><div class="simulation-slot-grid">${slots.map((slot) => `<article class="simulation-slot ${slot[2] === "AVAILABLE" ? "is-available" : ""}"><header><span>Slot ${slot[0]}</span><strong>${slot[2]}</strong></header><h3>${slot[1]}</h3><dl><div><dt>${t(locale, "收益 / 回撤", "Return / drawdown")}</dt><dd>${slot[3]} / ${slot[4]} <small>SAMPLE</small></dd></div><div><dt>${t(locale, "今日 Token", "Today's tokens")}</dt><dd>${slot[5]}</dd></div><div><dt>${t(locale, "预计成本", "Estimated cost")}</dt><dd>${slot[6]}</dd></div><div><dt>${t(locale, "下一周期", "Next cycle")}</dt><dd>${slot[7]}</dd></div><div><dt>${t(locale, "Runtime / 数据", "Runtime / data")}</dt><dd>${slot[8]}</dd></div><div><dt>${t(locale, "晋升", "Promotion")}</dt><dd>${slot[9]}</dd></div></dl></article>`).join("")}</div></section>`;
}
