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
export type AgentCategory = "input" | "analysis" | "decision" | "reflection";
export type ConnectionPreviewTab = "data" | "models";

export interface StrategyPreviewRenderContext {
  locale: PreviewLocale;
  preview: StrategyAppPreviewState;
  appFilter: "all" | StrategyAppStatus;
  detailTarget: StrategyDetailTarget;
  detailTab: StrategyDetailTab;
  agentCategory: AgentCategory;
  selectedAgentId: string;
  agentSearch: string;
  connectionTab: ConnectionPreviewTab;
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
  { id: "position-decision", category: "decision", name: "Position Decision Agent", purpose: { zh: "综合信号、账户和风险预算，输出持有、开仓或退出建议。", en: "Combines signals, account state, and risk budgets into hold, open, or exit advice." }, market: "Multi-market", input: "Analysis evidence", output: "Decision proposal", version: "v0.7", refs: 3 },
  { id: "reflection-agent", category: "reflection", name: "Reflection Agent", purpose: { zh: "从结果生成候选经验，不回写运行策略。", en: "Creates lesson candidates from results; never rewrites a running strategy." }, market: "Multi-market", input: "Result evidence", output: "Lesson candidate", version: "v0.5", refs: 3 },
  { id: "risk-reflection", category: "reflection", name: "Risk Reflection Agent", purpose: { zh: "复核决策是否忽略数据缺口、连续亏损或仓位风险。", en: "Reviews whether decisions ignore data gaps, loss streaks, or exposure risk." }, market: "Multi-market", input: "Decision + risk evidence", output: "Review verdict", version: "v0.3", refs: 2 },
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

function workbenchFlow(locale: PreviewLocale, scenarioId: string): Array<[string, string, string]> {
  if (scenarioId === "us-earnings") {
    return [
      ["INPUT", t(locale, "美股财报输入", "US earnings input"), t(locale, "财报日历与公告", "Calendar + filings")],
      ["ANALYSIS", t(locale, "事件分析", "Event analysis"), t(locale, "识别可验证事件窗口", "Find verifiable event windows")],
      ["DECISION", t(locale, "交易决策", "Trade decision"), t(locale, "生成限时行动建议", "Create time-bounded advice")],
      ["REFLECTION", t(locale, "风险反思", "Risk reflection"), t(locale, "检查跳空与流动性", "Review gap and liquidity risk")],
    ];
  }
  if (scenarioId === "crypto-trend") {
    return [
      ["INPUT", t(locale, "加密行情输入", "Crypto market input"), t(locale, "价格、成交量与资金费率", "Price, volume, and funding")],
      ["ANALYSIS", t(locale, "趋势分析", "Trend analysis"), t(locale, "识别趋势与流动性", "Read trend and liquidity")],
      ["DECISION", t(locale, "交易决策", "Trade decision"), t(locale, "输出受约束的方向建议", "Produce constrained direction advice")],
      ["REFLECTION", t(locale, "风险反思", "Risk reflection"), t(locale, "复核数据质量与敞口", "Review data quality and exposure")],
    ];
  }
  return [
    ["INPUT", t(locale, "港股行情与财报输入", "HK market + filing input"), t(locale, "整理日线与财报事实", "Prepare daily bars and filings")],
    ["ANALYSIS", t(locale, "质量趋势分析", "Quality trend analysis"), t(locale, "筛选基本面与趋势", "Filter quality and trend")],
    ["DECISION", t(locale, "交易决策", "Trade decision"), t(locale, "生成低换手建议", "Create low-turnover advice")],
    ["REFLECTION", t(locale, "风险反思", "Risk reflection"), t(locale, "检查集中度与数据缺口", "Review concentration and data gaps")],
  ];
}

export function renderStrategyWorkbench(context: StrategyPreviewRenderContext): string {
  const { locale, preview } = context;
  const scenario = scenarios.find((item) => item.id === preview.selectedScenarioId) ?? scenarios[0]!;
  const proposal = proposalById(scenario.proposalIds[0]!);
  const generatedApp = preview.apps.find((app) => app.origin === "PROTOTYPE" && app.proposalId === proposal.id);
  const flow = workbenchFlow(locale, scenario.id);
  return `${previewHeader(
    locale,
    "STRATEGY WORKBENCH · PROTOTYPE",
    t(locale, "编排工作台", "Strategy Workbench"),
    t(locale, "用自然语言描述目标，系统从 Agent 中心推荐一套可理解、可应用的多 Agent 方案。", "Describe the goal in natural language. The system recommends an understandable Multi-Agent plan from the Agent Center."),
    badge("SAMPLE"),
  )}
    <section class="workbench-shell">
      <div class="workbench-brief">
        <header><span>${t(locale, "你的想法", "Your idea")}</span><strong>${t(locale, "先说目标，不用画工作流", "Describe the goal, not the workflow")}</strong></header>
        <div class="workbench-scenarios" aria-label="${t(locale, "示例策略需求", "Sample strategy requests")}">
          ${scenarios.map((item) => `<button type="button" data-preview-scenario="${item.id}" aria-pressed="${item.id === scenario.id}">${esc(copy(locale, item.title))}</button>`).join("")}
        </div>
        <label class="workbench-prompt"><span>${t(locale, "策略描述", "Strategy description")}</span><textarea rows="6">${esc(copy(locale, scenario.request))}</textarea></label>
        <button type="button" class="primary-action" data-preview-recommend>${t(locale, "生成推荐方案", "Generate recommendation")}</button>
        <small>SAMPLE · ${t(locale, "当前不调用模型，也不会启动模拟", "No model call or simulation start in this preview")}</small>
      </div>

      <div class="workbench-blueprint">
        <header><div><span>${t(locale, "推荐方案", "Recommended plan")}</span><h2>${esc(proposal.name)}</h2><p>${esc(copy(locale, proposal.fit))}</p></div><span class="preview-evidence">SAMPLE</span></header>
        <div class="agent-blueprint" aria-label="${t(locale, "推荐 Agent 流程", "Recommended Agent flow")}">
          ${flow.map(([kind, name, description], index) => `<article><span>${index + 1} · ${kind}</span><strong>${esc(name)}</strong><small>${esc(description)}</small></article>`).join("")}
        </div>
        <dl class="blueprint-facts"><div><dt>${t(locale, "市场", "Market")}</dt><dd>${esc(proposal.market)}</dd></div><div><dt>${t(locale, "运行频率", "Frequency")}</dt><dd>${esc(proposal.frequency)}</dd></div><div><dt>${t(locale, "风险限制", "Risk")}</dt><dd>${esc(proposal.risk)}</dd></div><div><dt>${t(locale, "默认模型", "Default model")}</dt><dd>DeepSeek Chat · SAMPLE</dd></div></dl>
        <div class="blueprint-action"><div><strong>${generatedApp ? t(locale, "方案已经生成", "Plan generated") : t(locale, "确认后生成多 Agent 系统", "Confirm to generate the Multi-Agent system")}</strong><small>${generatedApp ? `${esc(generatedApp.name)} · ${esc(generatedApp.version)} · PAGE MEMORY` : t(locale, "只创建预览方案，不调用 Runtime", "Creates a preview plan only; Runtime is untouched")}</small></div><button type="button" class="primary-action" data-preview-create="${proposal.id}">${generatedApp ? t(locale, "重新生成版本", "Generate another version") : t(locale, "应用此方案", "Apply this plan")}</button></div>
      </div>
    </section>

    <section class="saved-strategies" aria-labelledby="saved-strategies-title"><header><div><span>${t(locale, "已保存方案", "Saved plans")}</span><h2 id="saved-strategies-title">${t(locale, "最近的多 Agent 系统", "Recent Multi-Agent systems")}</h2></div><small>${t(locale, "集中在工作台中，不再单独设置“我的策略应用”页面。", "Kept inside the workbench; there is no separate My Strategy Apps page.")}</small></header><div>${preview.apps.slice(0, 3).map((app) => `<article><div>${badge(app.origin)}<strong>${esc(app.name)}</strong></div><span>${esc(app.market)}</span><code>${esc(app.version)}</code><small>${app.status}</small></article>`).join("")}</div></section>`;
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
  const categories: Array<[AgentCategory, string, string]> = [["input", "输入 Agent", "Input Agents"], ["analysis", "分析 Agent", "Analysis Agents"], ["decision", "决策 Agent", "Decision Agents"], ["reflection", "反思 Agent", "Reflection Agents"]];
  return `${previewHeader(locale, "AGENT CENTER · SAMPLE CATALOG", t(locale, "Agent 中心", "Agent Center"), t(locale, "提前准备四类 Agent。编排工作台只会从这里选择能力，不会临时生成未知 Agent。", "Prepare four Agent categories in advance. The workbench selects from this catalog instead of inventing unknown Agents."), `<button type="button" class="secondary-action" disabled>${t(locale, "新增 Agent · 预览", "New Agent · preview")}</button>`)}
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
    { id: "01", name: "HK Quality Trend", version: "v0.3", status: t(locale, "运行中", "Running"), returnValue: "+2.4%", drawdown: "-1.8%", decision: t(locale, "继续观察 0700.HK，暂不加仓", "Hold 0700.HK; no add"), color: "accent" },
    { id: "02", name: "US Earnings Event", version: "v0.2", status: t(locale, "运行中", "Running"), returnValue: "+0.8%", drawdown: "-2.2%", decision: t(locale, "等待下一财报窗口", "Wait for the next earnings window"), color: "context" },
  ];
  return `${previewHeader(locale, "SIMULATION TRADING · PROTOTYPE", t(locale, "模拟交易", "Simulation Trading"), t(locale, "首页只比较模拟策略。最多同时运行三个方案，不提供真实交易入口。", "The home page compares simulation strategies only. Up to three plans can run; there is no live-trading entry."), `<span class="preview-badge preview-badge--prototype">2 / 3 ${t(locale, "运行中", "RUNNING")}</span>`)}
    <section class="simulation-overview">
      <header><div><span>${t(locale, "组合表现", "Combined performance")}</span><h2>${t(locale, "两个策略正在独立模拟", "Two strategies are running independently")}</h2></div><p>${t(locale, "曲线和数值均为页面预览样本。", "Curves and values are preview samples.")} <strong>SAMPLE · NOT CONNECTED</strong></p></header>
      <div class="simulation-chart">
        <div class="simulation-chart__axis"><span>+3%</span><span>0%</span><span>-3%</span></div>
        <svg viewBox="0 0 900 250" role="img" aria-label="${t(locale, "三个模拟槽位收益曲线", "Equity curves for three simulation slots")}">
          <path class="chart-grid" d="M0 40H900M0 125H900M0 210H900" />
          <polyline class="chart-line chart-line--accent" points="0,166 80,157 160,161 240,138 320,145 400,112 480,121 560,86 640,97 720,69 810,78 900,54" />
          <polyline class="chart-line chart-line--context" points="0,166 80,174 160,159 240,168 320,151 400,157 480,140 560,148 640,131 720,138 810,116 900,124" />
        </svg>
        <div class="simulation-chart__legend"><span><i class="is-accent"></i>HK Quality Trend</span><span><i class="is-context"></i>US Earnings Event</span></div>
      </div>
    </section>
    <section class="simulation-slot-grid simulation-slot-grid--simple" aria-label="${t(locale, "模拟策略", "Simulation strategies")}">
      ${slots.map((slot) => `<article class="simulation-slot simulation-slot--${slot.color}"><header><span>SLOT ${slot.id}</span><strong>${esc(slot.status)}</strong></header><h3>${slot.name} <code>${slot.version}</code></h3><div class="slot-metrics"><div><span>${t(locale, "收益", "Return")}</span><strong>${slot.returnValue}</strong></div><div><span>${t(locale, "最大回撤", "Max drawdown")}</span><strong>${slot.drawdown}</strong></div></div><p><span>${t(locale, "最近决策", "Latest decision")}</span>${esc(slot.decision)}</p><footer><small>PAPER · SAMPLE</small><button type="button" class="secondary-action" disabled>${t(locale, "查看详情 · 预览", "View details · preview")}</button></footer></article>`).join("")}
      <article class="simulation-slot simulation-slot--empty"><header><span>SLOT 03</span><strong>${t(locale, "空闲", "Available")}</strong></header><div><h3>${t(locale, "运行另一个策略", "Run another strategy")}</h3><p>${t(locale, "先在编排工作台生成方案，再放入这个模拟槽位。", "Generate a plan in the workbench, then place it in this slot.")}</p></div><button type="button" class="primary-action" data-view="orchestration">${t(locale, "去编排工作台", "Open workbench")}</button></article>
    </section>
    <section class="simulation-safety"><strong>${t(locale, "只有模拟交易", "Simulation only")}</strong><span>runtimeApplied=false · exchangeWriteAllowed=false</span><small>${t(locale, "真实交易入口已从本预览移除", "Live trading is removed from this preview")}</small></section>`;
}

export function renderConnectionSettingsPreview(locale: PreviewLocale, tab: ConnectionPreviewTab): string {
  const dataSources = [
    ["Market CSV", t(locale, "历史 K 线", "Historical bars"), t(locale, "已连接", "Connected"), "connected"],
    ["Binance Public", t(locale, "加密行情", "Crypto market data"), t(locale, "公开接口", "Public API"), "public"],
    ["Financial News", t(locale, "财经新闻", "Financial news"), t(locale, "未配置", "Not configured"), "missing"],
    ["Reddit / X", t(locale, "社交情绪", "Social sentiment"), t(locale, "未配置", "Not configured"), "missing"],
  ];
  const models = [
    ["DeepSeek", "deepseek-chat", t(locale, "已配置", "Configured"), "connected"],
    ["OpenAI", "gpt-5", t(locale, "未配置", "Not configured"), "missing"],
    ["Anthropic", "Claude", t(locale, "未配置", "Not configured"), "missing"],
    [t(locale, "本地模型", "Local model"), "OpenAI-compatible", t(locale, "未配置", "Not configured"), "missing"],
  ];
  const rows = tab === "data" ? dataSources : models;
  return `${previewHeader(locale, "CONNECTIONS · PROTOTYPE", t(locale, "连接配置", "Connections"), t(locale, "在一个地方管理数据源和模型 API。这里只展示是否接通，不把数据治理做成独立产品。", "Manage data sources and model APIs in one place. This page focuses on connectivity instead of a separate data-governance product."), `<button type="button" class="secondary-action" disabled>${tab === "data" ? t(locale, "新增数据源 · 预览", "Add data source · preview") : t(locale, "新增模型 · 预览", "Add model · preview")}</button>`)}
    <section class="connection-preview">
      <nav role="tablist" aria-label="${t(locale, "连接类型", "Connection types")}"><button type="button" role="tab" data-connection-preview-tab="data" aria-selected="${tab === "data"}">${t(locale, "数据源", "Data sources")}</button><button type="button" role="tab" data-connection-preview-tab="models" aria-selected="${tab === "models"}">${t(locale, "模型 API", "Model APIs")}</button></nav>
      <div class="connection-list">${rows.map(([name, detail, status, statusClass]) => `<article><div><strong>${esc(name)}</strong><span>${esc(detail)}</span></div><span class="connection-status connection-status--${statusClass}">${esc(status)}</span><button type="button" class="text-action" disabled>${t(locale, "配置 · 预览", "Configure · preview")}</button></article>`).join("")}</div>
      <aside><strong>${t(locale, "安全说明", "Security")}</strong><p>${t(locale, "API Key 只保存在后端。前端只显示是否已配置，不显示、复制或写入浏览器存储。", "API keys stay on the server. The UI shows configuration status only and never displays, copies, or stores secret values in browser storage.")}</p></aside>
    </section>`;
}
