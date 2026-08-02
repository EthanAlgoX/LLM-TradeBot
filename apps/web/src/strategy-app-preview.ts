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
  workbenchDraft: string;
  realAgents?: Array<{ definition: { definitionId: string; category: AgentCategory }; version: { versionId: string; versionIndex: number; fingerprint: string; payload: { name: string; dataRef?: string; upstreamArtifactSchemaRefs: string[]; modelRef?: string } } }>;
  agentCenterToken?: string;
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
type WorkbenchNode = {
  id: string;
  kind: AgentCategory;
  name: Copy;
  description: Copy;
  downstream: string[];
};
type SimulationMessage = {
  id: string;
  cycle: number;
  agent: Copy;
  completedAt: string;
  summary: Copy;
  sourceIds: string[];
  status: "success" | "fallback";
};

const copy = (locale: PreviewLocale, value: Copy): string => locale === "zh-CN" ? value.zh : value.en;
const esc = (value: string): string => value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
const t = (locale: PreviewLocale, zh: string, en: string): string => locale === "zh-CN" ? zh : en;

export function inferWorkbenchScenarioId(prompt: string): string {
  const normalized = prompt.toLowerCase();
  if (/(btc|eth|crypto|bitcoin|加密|币圈|资金费率)/u.test(normalized)) return "crypto-trend";
  if (/(us stock|u\.s\.|美股|nasdaq|nyse|earnings|财报事件)/u.test(normalized)) return "us-earnings";
  return "hk-low-risk";
}

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

function workbenchFlow(scenarioId: string): WorkbenchNode[] {
  if (scenarioId === "us-earnings") {
    return [
      { id: "event-input", kind: "input", name: { zh: "财报事件输入", en: "Earnings Event Input" }, description: { zh: "整理财报日历与公告时间", en: "Normalizes calendar and filing times" }, downstream: ["event-analysis", "liquidity-analysis"] },
      { id: "event-analysis", kind: "analysis", name: { zh: "事件窗口分析", en: "Event Window Analysis" }, description: { zh: "识别可验证的事件窗口", en: "Finds verifiable event windows" }, downstream: ["event-decision"] },
      { id: "liquidity-analysis", kind: "analysis", name: { zh: "流动性分析", en: "Liquidity Analysis" }, description: { zh: "检查盘前盘后成交约束", en: "Checks extended-hours constraints" }, downstream: ["event-decision"] },
      { id: "event-decision", kind: "decision", name: { zh: "限时决策", en: "Time-bounded Decision" }, description: { zh: "汇总事件与流动性证据", en: "Combines event and liquidity evidence" }, downstream: ["event-reflection"] },
      { id: "event-reflection", kind: "reflection", name: { zh: "跳空风险反思", en: "Gap-risk Reflection" }, description: { zh: "复核跳空风险与策略失效", en: "Reviews gap risk and strategy expiry" }, downstream: [] },
    ];
  }
  if (scenarioId === "crypto-trend") {
    return [
      { id: "crypto-market", kind: "input", name: { zh: "加密行情输入", en: "Crypto Market Input" }, description: { zh: "整理价格与成交量", en: "Structures price and volume" }, downstream: ["trend-analysis", "liquidity-analysis"] },
      { id: "funding-input", kind: "input", name: { zh: "资金费率输入", en: "Funding Input" }, description: { zh: "独立标记资金费率与缺口", en: "Separates funding and missing data" }, downstream: ["liquidity-analysis"] },
      { id: "trend-analysis", kind: "analysis", name: { zh: "趋势分析", en: "Trend Analysis" }, description: { zh: "判断趋势方向与持续性", en: "Reads direction and persistence" }, downstream: ["crypto-decision"] },
      { id: "liquidity-analysis", kind: "analysis", name: { zh: "流动性分析", en: "Liquidity Analysis" }, description: { zh: "检查滑点与资金费率风险", en: "Reviews slippage and funding risk" }, downstream: ["crypto-decision"] },
      { id: "crypto-decision", kind: "decision", name: { zh: "交易决策", en: "Trade Decision" }, description: { zh: "输出受约束的方向建议", en: "Produces constrained direction advice" }, downstream: ["crypto-reflection"] },
      { id: "crypto-reflection", kind: "reflection", name: { zh: "风险反思", en: "Risk Reflection" }, description: { zh: "复核数据质量与敞口", en: "Reviews data quality and exposure" }, downstream: [] },
    ];
  }
  return [
    { id: "hk-market", kind: "input", name: { zh: "港股行情输入", en: "HK Market Input" }, description: { zh: "整理日线与成交量", en: "Structures daily bars and volume" }, downstream: ["quality-analysis", "trend-analysis"] },
    { id: "hk-filing", kind: "input", name: { zh: "财报输入", en: "Filing Input" }, description: { zh: "提取财报质量事实", en: "Extracts earnings-quality facts" }, downstream: ["quality-analysis"] },
    { id: "quality-analysis", kind: "analysis", name: { zh: "质量分析", en: "Quality Analysis" }, description: { zh: "筛选基本面与财报变化", en: "Filters fundamentals and filing changes" }, downstream: ["hk-decision"] },
    { id: "trend-analysis", kind: "analysis", name: { zh: "趋势分析", en: "Trend Analysis" }, description: { zh: "判断趋势与换手节奏", en: "Reads trend and turnover cadence" }, downstream: ["hk-decision"] },
    { id: "hk-decision", kind: "decision", name: { zh: "低换手决策", en: "Low-turnover Decision" }, description: { zh: "合并质量与趋势证据", en: "Combines quality and trend evidence" }, downstream: ["hk-reflection"] },
    { id: "hk-reflection", kind: "reflection", name: { zh: "风险反思", en: "Risk Reflection" }, description: { zh: "检查集中度与数据缺口", en: "Reviews concentration and data gaps" }, downstream: [] },
  ];
}

function renderWorkbenchFlow(locale: PreviewLocale, scenarioId: string): string {
  const nodes = workbenchFlow(scenarioId);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const stages: Array<[AgentCategory, string, string]> = [
    ["input", "输入", "INPUT"],
    ["analysis", "分析", "ANALYSIS"],
    ["decision", "决策", "DECISION"],
    ["reflection", "反思", "REFLECTION"],
  ];
  return `<div class="chat-agent-flow" aria-label="${t(locale, "推荐 Agent 编排关系", "Recommended Agent topology")}">
    ${stages.map(([kind, zh, en]) => {
      const stageNodes = nodes.filter((node) => node.kind === kind);
      return `<section class="chat-agent-stage chat-agent-stage--${kind}"><header><span>${t(locale, zh, en)}</span><small>${stageNodes.length} AGENT${stageNodes.length === 1 ? "" : "S"}</small></header>${stageNodes.map((node) => {
        const downstream = node.downstream.map((id) => nodeById.get(id)).filter((item): item is WorkbenchNode => Boolean(item));
        return `<article><strong>${esc(copy(locale, node.name))}</strong><p>${esc(copy(locale, node.description))}</p><footer><span>→</span>${downstream.length ? downstream.map((item) => `<b>${esc(copy(locale, item.name))}</b>`).join("") : `<b>${t(locale, "流程结束", "End of flow")}</b>`}</footer></article>`;
      }).join("")}</section>`;
    }).join("")}
  </div>`;
}

export function renderStrategyWorkbench(context: StrategyPreviewRenderContext): string {
  const { locale, preview } = context;
  const scenario = scenarios.find((item) => item.id === preview.selectedScenarioId) ?? scenarios[0]!;
  const composerValue = context.workbenchDraft || copy(locale, scenario.request);
  return `${previewHeader(
    locale,
    "STRATEGY WORKBENCH · PROTOTYPE",
    t(locale, "编排工作台", "Strategy Workbench"),
    t(locale, "整个工作台就是一段策略对话。每次回复都会带回一张新的 Agent 编排方案，不使用固定流程画布。", "The workbench is one strategy conversation. Every reply carries a new Agent plan instead of relying on a fixed workflow canvas."),
    badge("SAMPLE"),
  )}
    <section class="workbench-conversation" aria-label="${t(locale, "策略编排对话", "Strategy orchestration conversation")}">
      <header class="workbench-conversation__bar"><div><span></span><strong>${t(locale, "策略助手在线", "Strategy Advisor online")}</strong></div><small>${t(locale, "只推荐 Agent 中心已有能力", "Catalog Agents only")}</small></header>
      <div class="workbench-thread" role="log" aria-live="polite">
        <article class="workbench-message is-assistant is-intro"><div class="workbench-message__avatar">AI</div><div><header><strong>${t(locale, "策略助手", "Strategy Advisor")}</strong><time>${t(locale, "开始对话", "Conversation started")}</time></header><p>${t(locale, "告诉我你想做哪个市场、什么类型的策略和风险偏好。我会推荐 Agent 组合，但不会直接启动模拟或下单。", "Tell me the market, strategy style, and risk preference. I will recommend an Agent combination without starting a simulation or placing an order.")}</p></div></article>
        ${preview.workbenchExchanges.map((exchange, index) => {
          const exchangeScenario = scenarios.find((item) => item.id === exchange.scenarioId) ?? scenarios[0]!;
          const proposal = proposalById(exchange.proposalId);
          const prompt = exchange.prompt || copy(locale, exchangeScenario.request);
          const generatedApp = preview.apps.find((app) => app.origin === "PROTOTYPE" && app.proposalId === proposal.id);
          return `<article class="workbench-message is-user"><div><header><strong>${t(locale, "你", "You")}</strong><time>${t(locale, `第 ${index + 1} 次需求`, `Request ${index + 1}`)}</time></header><p>${esc(prompt)}</p></div><div class="workbench-message__avatar">ME</div></article>
            <article class="workbench-message is-assistant"><div class="workbench-message__avatar">AI</div><div><header><strong>${t(locale, "策略助手", "Strategy Advisor")}</strong><time>${t(locale, `推荐 ${index + 1}`, `Recommendation ${index + 1}`)}</time></header><p>${esc(copy(locale, proposal.fit))}</p>
              <section class="workbench-plan" aria-label="${t(locale, "编排好的策略方案", "Orchestrated strategy plan")}">
                <header><div><span>${t(locale, "推荐方案", "Recommended plan")}</span><h2>${esc(proposal.name)}</h2></div><span class="preview-evidence">SAMPLE · DYNAMIC</span></header>
                ${renderWorkbenchFlow(locale, exchangeScenario.id)}
                <dl class="blueprint-facts"><div><dt>${t(locale, "市场", "Market")}</dt><dd>${esc(proposal.market)}</dd></div><div><dt>${t(locale, "运行频率", "Frequency")}</dt><dd>${esc(proposal.frequency)}</dd></div><div><dt>${t(locale, "风险限制", "Risk")}</dt><dd>${esc(proposal.risk)}</dd></div><div><dt>${t(locale, "使用能力", "Capabilities")}</dt><dd>${workbenchFlow(exchangeScenario.id).length} Agents · ${t(locale, "来自 Agent 中心", "from Agent Center")}</dd></div></dl>
                <footer class="blueprint-action"><div><strong>${generatedApp ? t(locale, "方案已应用为策略草案", "Plan applied as a strategy draft") : t(locale, "是否应用这个编排方案？", "Apply this orchestrated plan?")}</strong><small>${generatedApp ? `${esc(generatedApp.name)} · ${esc(generatedApp.version)} · PAGE MEMORY` : t(locale, "应用只生成候选系统，不启动 Runtime", "Apply creates a candidate system without starting Runtime")}</small></div><button type="button" class="primary-action" data-preview-create="${proposal.id}">${generatedApp ? t(locale, "生成新版本", "Create new version") : t(locale, "应用此方案", "Apply this plan")}</button></footer>
                ${generatedApp ? `<div class="workbench-gates"><div><span>${t(locale, "预上线检查", "Preflight")}</span><strong>${t(locale, "待运行", "PENDING")}</strong></div><div><span>${t(locale, "回测检查", "Backtest")}</span><strong>${t(locale, "待运行", "PENDING")}</strong></div><div><span>${t(locale, "模拟槽位", "Simulation slot")}</span><strong>${t(locale, "尚未加入", "NOT ASSIGNED")}</strong></div><button type="button" class="secondary-action" data-preview-validation>${t(locale, "进入检查 · 预览", "Open checks · preview")}</button></div>` : ""}
              </section>
            </div></article>`;
        }).join("")}
      </div>
      <footer class="workbench-composer">
        <div class="workbench-scenarios" aria-label="${t(locale, "示例策略需求", "Sample strategy requests")}">${scenarios.map((item) => `<button type="button" data-preview-scenario="${item.id}" aria-pressed="${item.id === scenario.id}">${esc(copy(locale, item.title))}</button>`).join("")}</div>
        <label class="workbench-prompt"><span>${t(locale, "继续描述或修改策略", "Describe or revise the strategy")}</span><textarea rows="4" data-workbench-prompt>${esc(composerValue)}</textarea></label>
        <div class="workbench-composer__actions"><small>SAMPLE · ${t(locale, "规则匹配预览，不调用模型", "Rule-matched preview; no model call")}</small><button type="button" class="primary-action" data-preview-recommend>${t(locale, "发送并生成方案", "Send and generate plan")}</button></div>
      </footer>
    </section>`;
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
  const real = context.realAgents?.filter((item) => item.definition.category === agentCategory) ?? [];
  const categories: Array<[AgentCategory, string, string]> = [["input", "输入 Agent", "Input Agents"], ["analysis", "分析 Agent", "Analysis Agents"], ["decision", "决策 Agent", "Decision Agents"], ["reflection", "反思 Agent", "Reflection Agents"]];
  return `${previewHeader(locale, "AGENT CENTER · VERSIONED CONFIGURATION", t(locale, "Agent 中心", "Agent Center"), t(locale, "真实服务端版本事实；编排工作台只能引用已登记版本。", "Server-authoritative version facts; the workbench may reference registered versions only."))}
    <section class="agent-center-toolbar"><nav role="tablist" aria-label="${t(locale, "Agent 分类", "Agent categories")}">${categories.map(([id, zh, en]) => `<button type="button" role="tab" data-agent-category="${id}" aria-selected="${agentCategory === id}">${t(locale, zh, en)}</button>`).join("")}</nav><label><span>${t(locale, "搜索", "Search")}</span><input id="agent-center-search" type="search" value="${esc(agentSearch)}" placeholder="${t(locale, "名称、市场、输入或输出", "Name, market, input, or output")}"></label></section>
    <section class="agent-center-layout"><div class="agent-catalog"><span>REAL · SERVER AUTHORITY</span>${real.map((item) => `<button type="button" class="preview-agent-card" data-real-agent="${esc(item.definition.definitionId)}"><strong>${esc(item.version.payload.name)}</strong><span>v${item.version.versionIndex} · ${esc(item.definition.category)}</span><small>${esc((item.version.payload.dataRef ?? item.version.payload.upstreamArtifactSchemaRefs.join(", ")) || "—")} · ${esc(item.version.payload.modelRef ?? "deterministic")}</small><em>${esc(item.version.fingerprint)}</em></button>`).join("") || `<p class="preview-empty">${t(locale, "尚无真实 Agent。", "No real Agents yet.")}</p>`}</div><aside class="agent-detail"><span>CREATE · REAL VERSION</span><h2>${t(locale, "受控配置", "Controlled configuration")}</h2><p>${t(locale, "只编辑行为层；平台规则、工具权限和输出 Schema 已锁定。", "Edit behavior only; platform rules, tool permissions and output schema are locked.")}</p><label><span>Bearer token</span><input data-agent-token type="password" value="${esc(context.agentCenterToken ?? "")}"></label><label><span>${t(locale, "名称", "Name")}</span><input data-agent-name value="${t(locale, "市场输入", "Market Input")}"></label><label><span>${t(locale, "用户 Prompt", "User prompt")}</span><textarea data-agent-prompt>${t(locale, "解释已标准化事实。", "Explain normalized facts.")}</textarea></label><button type="button" class="primary-action" data-create-real-agent>${t(locale, "创建 Input v1", "Create Input v1")}</button><button type="button" class="secondary-action" data-create-real-analysis>${t(locale, "创建 Analysis", "Create Analysis")}</button><dl><div><dt>System Prompt</dt><dd>LOCKED · reference only</dd></div><div><dt>Runtime</dt><dd>Paper Only · runtimeApplied=false · exchangeWriteAllowed=false</dd></div><div><dt>Test bench</dt><dd>PLANNED</dd></div></dl></aside></section>`;
}

export function renderDataCenterPrelude(locale: PreviewLocale): string {
  return `<section class="market-radar-preview"><header><div><span>MARKET RADAR · SAMPLE</span><h2>${t(locale, "Market Radar 预览", "Market Radar preview")}</h2><p>${t(locale, "该区域用于验证信息架构，并非已接入市场数据。下方 Data Center 保留现有真实资产、质量与 Lineage 页面。", "This region validates information architecture, not connected market data. The Data Center below retains the existing registered-asset, quality, and lineage surface.")}</p></div>${badge("SAMPLE")}</header><div><article><strong>Hong Kong</strong><span>${t(locale, "财报与趋势", "Earnings + trend")}</span><small>UNAVAILABLE</small></article><article><strong>US equities</strong><span>${t(locale, "财报事件", "Earnings events")}</span><small>NOT CONNECTED</small></article><article><strong>Crypto</strong><span>${t(locale, "趋势与流动性", "Trend + liquidity")}</span><small>UNAVAILABLE</small></article></div></section>`;
}

export function renderExperimentHandoff(locale: PreviewLocale, appName?: string): string {
  return `<section class="experiment-handoff"><div><span>STRATEGY APP HANDOFF · ${appName ? "PROTOTYPE" : "NOT CONNECTED"}</span><h2>${appName ? esc(appName) : t(locale, "Strategy App 未来比较对象", "Strategy App future comparison object")}</h2><p>${appName ? t(locale, "此 handoff 只提供可见的页面上下文，不会启动 Backtest、Walk-Forward、Candidate 或 Runtime。", "This handoff carries visible page context only; it will not start Backtest, Walk-Forward, Candidate, or Runtime.") : t(locale, "从 Strategy App 详情进入后，所选应用会在此显示为页面内存上下文。", "When entered from Strategy App detail, the selected app appears here as page-memory context.")}</p></div><code>PROTOTYPE / NOT CONNECTED</code></section>`;
}

const simulationDialogues: Record<string, readonly SimulationMessage[]> = {
  "hk-quality-trend": [
    { id: "hk-18-market", cycle: 18, agent: { zh: "港股行情输入 Agent", en: "HK Market Input Agent" }, completedAt: "2026-08-03T09:31:08+08:00", summary: { zh: "已完成 0700.HK 日线与成交量窗口清洗；价格位于 20 日均线上方，但量能只达到近 20 日中位数的 0.91 倍。", en: "Cleaned the daily and volume windows for 0700.HK. Price is above the 20-day average, while volume is 0.91× its 20-day median." }, sourceIds: [], status: "success" },
    { id: "hk-18-filing", cycle: 18, agent: { zh: "财报输入 Agent", en: "Filing Input Agent" }, completedAt: "2026-08-03T09:31:12+08:00", summary: { zh: "最近一期收入与自由现金流字段完整；未发现本轮新增财报，沿用已登记快照并标记时效。", en: "The latest revenue and free-cash-flow fields are complete. No new filing arrived this round, so the registered snapshot remains with freshness marked." }, sourceIds: [], status: "success" },
    { id: "hk-18-quality", cycle: 18, agent: { zh: "质量分析 Agent", en: "Quality Analysis Agent" }, completedAt: "2026-08-03T09:31:18+08:00", summary: { zh: "盈利质量保持稳定，现金流未恶化；由于财报不是本轮新增信息，质量信号置信度维持 0.72。", en: "Earnings quality remains stable and cash flow has not deteriorated. Since the filing is not new this round, confidence stays at 0.72." }, sourceIds: ["hk-18-market", "hk-18-filing"], status: "success" },
    { id: "hk-18-trend", cycle: 18, agent: { zh: "趋势分析 Agent", en: "Trend Analysis Agent" }, completedAt: "2026-08-03T09:31:19+08:00", summary: { zh: "中期上行结构仍在，但短期成交量确认不足，不建议追涨。", en: "The medium-term uptrend remains intact, but short-term volume confirmation is insufficient; avoid chasing." }, sourceIds: ["hk-18-market"], status: "success" },
    { id: "hk-18-decision", cycle: 18, agent: { zh: "低换手决策 Agent", en: "Low-turnover Decision Agent" }, completedAt: "2026-08-03T09:31:25+08:00", summary: { zh: "综合质量与趋势证据：继续观察 0700.HK，维持现有模拟仓位，本轮不加仓。", en: "Combined quality and trend evidence: keep watching 0700.HK, retain the simulated position, and do not add this round." }, sourceIds: ["hk-18-quality", "hk-18-trend"], status: "success" },
    { id: "hk-18-reflection", cycle: 18, agent: { zh: "风险反思 Agent", en: "Risk Reflection Agent" }, completedAt: "2026-08-03T09:31:29+08:00", summary: { zh: "决策未忽略数据时效与成交量缺口。候选经验：只有量能恢复到阈值以上，才重新评估加仓。", en: "The decision accounted for freshness and the volume gap. Lesson candidate: reconsider adding only after volume recovers above threshold." }, sourceIds: ["hk-18-decision"], status: "success" },
    { id: "hk-19-market", cycle: 19, agent: { zh: "港股行情输入 Agent", en: "HK Market Input Agent" }, completedAt: "2026-08-03T10:01:06+08:00", summary: { zh: "新一轮价格变化有限，成交量确认仍未达到策略阈值。", en: "Price movement is limited in the new round and volume confirmation remains below the strategy threshold." }, sourceIds: ["hk-18-reflection"], status: "success" },
    { id: "hk-19-decision", cycle: 19, agent: { zh: "低换手决策 Agent", en: "Low-turnover Decision Agent" }, completedAt: "2026-08-03T10:01:20+08:00", summary: { zh: "维持 HOLD；没有新的开仓或加仓动作。", en: "Maintain HOLD; no new opening or add action." }, sourceIds: ["hk-19-market"], status: "success" },
  ],
  "us-earnings-event": [
    { id: "us-7-event", cycle: 7, agent: { zh: "财报事件输入 Agent", en: "Earnings Event Input Agent" }, completedAt: "2026-08-03T09:35:04+08:00", summary: { zh: "确认下一财报窗口尚未进入策略观察期；公告时间来自已登记 Sample 日历。", en: "The next earnings window has not entered the strategy observation period. The announcement time comes from the registered sample calendar." }, sourceIds: [], status: "success" },
    { id: "us-7-analysis", cycle: 7, agent: { zh: "事件窗口分析 Agent", en: "Event Window Analysis Agent" }, completedAt: "2026-08-03T09:35:11+08:00", summary: { zh: "当前不满足事件触发条件，暂不构造方向信号。", en: "Current conditions do not meet the event trigger, so no directional signal is formed." }, sourceIds: ["us-7-event"], status: "success" },
    { id: "us-7-liquidity", cycle: 7, agent: { zh: "流动性分析 Agent", en: "Liquidity Analysis Agent" }, completedAt: "2026-08-03T09:35:12+08:00", summary: { zh: "盘后流动性字段未连接，按策略规则降级为只观察。", en: "After-hours liquidity is not connected, so the strategy falls back to observe-only." }, sourceIds: ["us-7-event"], status: "fallback" },
    { id: "us-7-decision", cycle: 7, agent: { zh: "限时决策 Agent", en: "Time-bounded Decision Agent" }, completedAt: "2026-08-03T09:35:18+08:00", summary: { zh: "等待下一财报窗口；本轮不建立模拟仓位。", en: "Wait for the next earnings window; do not open a simulated position this round." }, sourceIds: ["us-7-analysis", "us-7-liquidity"], status: "success" },
    { id: "us-7-reflection", cycle: 7, agent: { zh: "跳空风险反思 Agent", en: "Gap-risk Reflection Agent" }, completedAt: "2026-08-03T09:35:23+08:00", summary: { zh: "只观察符合缺失数据规则。上线前必须补齐盘后流动性来源并重新回测。", en: "Observe-only follows the missing-data rule. Extended-hours liquidity must be connected and backtested before release." }, sourceIds: ["us-7-decision"], status: "success" },
  ],
};

function renderSimulationDialogue(locale: PreviewLocale, dialogueId: string): string {
  const messages = simulationDialogues[dialogueId] ?? simulationDialogues["hk-quality-trend"]!;
  const byId = new Map(messages.map((message) => [message.id, message]));
  const children = new Map<string, SimulationMessage[]>();
  for (const message of messages) for (const sourceId of message.sourceIds) children.set(sourceId, [...(children.get(sourceId) ?? []), message]);
  const cycles = [...new Set(messages.map((message) => message.cycle))].sort((left, right) => left - right);
  const anchors = new Map(messages.map((message) => [message.id, `preview-${message.id}`]));
  const formatTime = (value: string): string => new Date(value).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const renderMessage = (message: SimulationMessage): string => {
    const parents = message.sourceIds.map((id) => byId.get(id)).filter((item): item is SimulationMessage => Boolean(item));
    const next = children.get(message.id) ?? [];
    return `<article class="runtime-agent-room-message" id="${anchors.get(message.id)}" data-status="${message.status}"><div class="runtime-agent-room-message__avatar" aria-hidden="true">${esc(copy(locale, message.agent).slice(0, 1).toUpperCase())}</div><div class="runtime-agent-room-message__turn"><header><strong>${esc(copy(locale, message.agent))}</strong><span class="runtime-agent-room-message__cycle">${t(locale, `第 ${message.cycle} 轮`, `ROUND ${message.cycle}`)}</span><time datetime="${esc(message.completedAt)}">${t(locale, "生成于", "Generated")} ${esc(formatTime(message.completedAt))}</time><span>${message.status === "success" ? t(locale, "完成", "COMPLETE") : t(locale, "降级", "FALLBACK")}</span></header>${parents.length ? `<div class="runtime-agent-room-message__reply">↳ ${t(locale, "回复", "Replying to")} ${parents.map((parent) => `<a href="#${anchors.get(parent.id)}">${esc(copy(locale, parent.agent))}</a>`).join(t(locale, "、", ", "))}</div>` : ""}<div class="runtime-agent-room-message__bubble"><p>${esc(copy(locale, message.summary))}</p></div><footer><span>→ ${t(locale, "发送给", "Send to")}</span>${next.length ? next.map((child) => `<a href="#${anchors.get(child.id)}">${esc(copy(locale, child.agent))}</a>`).join("") : `<span>${t(locale, "无下游 Agent", "No downstream Agent")}</span>`}</footer></div></article>`;
  };
  return `<section class="simulation-dialogue" aria-labelledby="simulation-dialogue-title"><header><div><span>${t(locale, "多轮运行 · 子 Agent 对话", "MULTI-ROUND · SUB-AGENT DIALOGUE")}</span><h2 id="simulation-dialogue-title">${t(locale, "模拟策略正在怎样思考", "How the simulation is reasoning")}</h2><p>${t(locale, "像聊天记录一样查看每个子 Agent 在哪一轮输出、回复了谁、以及把结果交给哪个下游 Agent。", "Read each sub-Agent output like a chat: its round, upstream reply, timestamp, and downstream recipient.")}</p></div><span class="preview-evidence">SAMPLE · ARTIFACT SHAPE</span></header><nav aria-label="${t(locale, "选择模拟策略对话", "Choose a simulation dialogue")}"><button type="button" data-simulation-dialogue="hk-quality-trend" aria-pressed="${dialogueId === "hk-quality-trend"}">SLOT 01 · HK Quality Trend</button><button type="button" data-simulation-dialogue="us-earnings-event" aria-pressed="${dialogueId === "us-earnings-event"}">SLOT 02 · US Earnings Event</button></nav><div class="runtime-agent-room" role="log"><div class="runtime-agent-room__status"><span></span>${t(locale, "Agent 语义频道", "Agent semantic channel")} · ${cycles.length} ${t(locale, "轮", "rounds")} · ${messages.length} artifacts</div>${cycles.map((cycle, index) => `<section class="runtime-agent-round ${index === cycles.length - 1 ? "is-current" : ""}"><header class="runtime-agent-round__marker"><span>${t(locale, `第 ${cycle} 轮`, `ROUND ${cycle}`)}</span><strong>${index === cycles.length - 1 ? t(locale, "最新一轮", "LATEST ROUND") : t(locale, "已完成", "COMPLETED")}</strong><small>${messages.filter((message) => message.cycle === cycle).length} ${t(locale, "条 Agent 输出", "AGENT MESSAGES")}</small></header>${messages.filter((message) => message.cycle === cycle).map(renderMessage).join("")}</section>`).join("")}</div></section>`;
}

export function renderTradeCenterPreview(locale: PreviewLocale, dialogueId = "hk-quality-trend"): string {
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
    <section class="simulation-safety"><strong>${t(locale, "只有模拟交易", "Simulation only")}</strong><span>runtimeApplied=false · exchangeWriteAllowed=false</span><small>${t(locale, "真实交易入口已从本预览移除", "Live trading is removed from this preview")}</small></section>
    ${renderSimulationDialogue(locale, dialogueId)}`;
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
