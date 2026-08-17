import { Check, CircleAlert, Clipboard, Database, FileArchive, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { toApiErrorMessage } from "../api/error";
import { strategyWorkspaceApi, type StrategyDataSource } from "../api/strategyWorkspace";
import { AppPage, Card, PageHeader } from "../components/common";
import { dataSourceMarketSummary } from "../utils/strategyMarkets";

const GUIDE_BODY = `# LLM TradeBot 策略生成与交付指南

你是一名资深 Python 策略工程师。请根据下面的想法，生成一份完整、可测试、可交付给 LLM TradeBot 的黑盒策略包。不要只给示例或伪代码；请创建所有交付文件，并在最后逐项列出文件与测试结果。

## 我的策略想法

<在这里描述，例如“A 股日线均值回归交易策略”>

## 1. 先确定唯一策略类型

策略必须且只能选择一种 purpose，并使用对应输出契约：

- research_report → ResearchReport：输入一只股票、市场、截止时间及平台授予的证据；输出证券标识、截止时间、摘要、研究维度、风险、证据引用、数据覆盖和降级原因。它只生成研究报告，不进入交易回测或订单执行。
- candidate_screening → CandidateList：输入市场、候选范围、截止时间、数据快照和筛选参数；输出市场、候选证券、排名分数、入选理由、风险、筛选统计、证据引用和降级原因。它只生成候选清单，不创建订单。
- trading_decision → DecisionProposal：输入市场、证券范围、截止时间、数据快照、组合上下文与风险边界；输出研究动作、证券标识、方向或目标权重、置信度、依据、风险、失效条件和有效期。它只能生成研究决策提案，不得创建订单、成交或虚构收益。

若我的想法不足以判断类型，请在动手前只询问这个关键问题，不要自行扩展成多个策略。

## 2. 数据依赖选择规则

本指南末尾附有从 LLM TradeBot 数据中心动态读取的目录快照。生成策略时必须遵守：

- 只声明策略真正需要的数据，不要因为目录中存在某个来源就默认依赖它；
- 每项依赖必须引用快照中 status 为 available 的真实 sourceId，不得虚构数据源或连接标识；
- 同一种数据可以声明多个可接受的 sourceIds，由平台按市场和可用性匹配；
- 区分 required 与 optional：缺少必需数据时结构化失败，缺少可选数据时才允许明确降级；
- 如果当前目录没有满足需求的来源，请将它列为“平台待补依赖”，不得使用假数据或未声明网络请求绕过。

## 3. 必须交付的目录

strategy-package/
├── strategy.yaml
├── strategy.py
├── STRATEGY.md
├── README.md
├── schemas/
│   ├── input.json
│   └── output.json
├── tests/
│   └── test_strategy.py
└── requirements.lock

## 4. strategy.yaml 要求

必须声明：

- strategyId：稳定、唯一、使用小写字母/数字/连字符；
- name、version、purpose、runtime、entrypoint、markets；
- inputs.schema 与 outputs.contract / outputs.schema；
- documentation.file，固定指向 STRATEGY.md；
- dataRequirements：逐项声明 id、数据类型、真实 sourceIds、适用市场、频率、回看范围、用途、required 和 onMissing；必需依赖固定 onMissing: fail，可选依赖固定 onMissing: degrade；
- parameters：声明名称、类型、默认值、允许范围和用途。
- configurable：声明允许网站配置的 markets、timeframes 与 runIntervals；不要把最终市场和运行周期写死在策略代码中。

entrypoint 使用 strategy:run。不得在 manifest 或代码中写入密钥、令牌、账号或本机绝对路径。

## 5. 统一执行接口

实现以下等价接口：

def run(context: StrategyContext) -> StrategyResult:
    ...

context 的真实字段为：runId、strategyId、strategyVersion、mode、asOf、inputs、parameters、configuration、data、dataCoverage 和 warnings。market、universe、timeframe、dataSources、risk 与 screeningPolicy 位于 configuration；平台授予的数据快照位于 data，并以依赖 id、kind 或 sourceId 为键。实现必须可重复运行；相同输入与参数应得到可解释的一致结果。策略只能读取 context，不得访问平台文件、数据库、环境变量或网络。

## 6. 输入、输出与失败约束

- schemas/input.json 与 schemas/output.json 必须是可解析的 JSON Schema，并与 run 的真实读写字段一致。
- 所有输出 Schema 必须把 status、contract、dataCoverage 和 warnings 声明为 required；contract 必须是本策略类型的固定契约。result 承载契约对应的业务结果。
- 缺少必需数据时，返回结构化失败：status、reasonCode、message、missingInputs；不得补造行情、新闻、财务数据、订单、成交、持仓或收益。
- 缺少可选数据时允许降级，但必须在 dataCoverage 和 warnings 中说明缺失项及其对结论的影响。
- trading_decision 的结果仅为 DecisionProposal；禁止调用券商接口或直接执行交易。

## 7. STRATEGY.md（策略说明）要求

这不是开发 README。请用普通用户可理解的中文独立说明：

1. 策略名称、类型与一句话目标；
2. 核心思想与适用场景；
3. 适用市场、证券范围、时间周期和运行频率；
4. 数据依赖表：逐项列出数据名称、kind、required/optional、真实 sourceId、适用市场、频率/回看范围、用途，以及缺失时的失败或降级行为；
5. 从输入到输出的完整处理步骤；
6. 参数、默认值、允许范围及调整影响；
7. 输出内容以及应该如何解读；
8. 数据缺失、外部服务失败时的降级与失败行为；
9. 已知限制、风险边界和明确不做的事情；
10. 建议的回测区间、基准、成本假设、关注指标和通过条件。

不得声称尚未实际验证的收益、胜率、回撤或有效性。若策略包含 LLM，说明它在哪一步使用、收到什么上下文、输出如何被 Schema 校验，以及失败时如何降级。

strategy.yaml 与 STRATEGY.md 中的数据依赖必须一一对应；测试也必须覆盖每项 required/optional 依赖的缺失行为。

## 8. 实现与测试质量

- 确定性计算优先使用纯函数，并固定时间、随机种子和排序规则。
- 当前上传内核执行器不允许直接调用 LLM 或外部服务；如果需要这些能力，只能消费平台未来明确注入到 context 的结果。不得自行联网或读取密钥。
- 至少测试：正常输入、边界参数、缺少必需数据、缺少可选数据、输出 Schema 校验、相同输入重复运行。
- 当前受限执行器只允许指南列出的 Python 标准库；requirements.lock 必须为空或只写注释。测试请优先使用标准库 unittest。
- README.md 只说明开发者如何安装依赖、运行测试和调用入口，不替代 STRATEGY.md。

## 9. 最终交付检查

完成前请实际运行测试，并在最终回答中提供：

1. 策略类型与输出契约；
2. 生成的完整文件清单；
3. 策略说明摘要及 STRATEGY.md 位置；
4. 测试命令和真实结果；
5. 策略依赖清单：列出选用的真实 sourceId、必需/可选属性、用途，以及仍需平台补充的数据或权限；
6. 未实现、未验证或需要进一步确认的边界。

不要把未运行的测试写成通过，也不要把交易回测或交易能力写成已经可用。ZIP 上传、静态检查和受限函数调用已经可用；当前自动数据授予仅覆盖平台本地 OHLCV，其他必需数据在未由调用方提供时必须结构化失败。`;

const kindLabels: Record<StrategyDataSource["kind"], string> = {
  kline: "K 线与行情",
  news: "新闻与资讯",
  fundamentals: "基本面",
  other: "其他研究数据",
};
const kindOrder: StrategyDataSource["kind"][] = ["kline", "news", "fundamentals", "other"];

function oneLine(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() || "未提供说明";
}

function buildGenerationGuide(sources: StrategyDataSource[]) {
  const sorted = [...sources].sort((left, right) => {
    const byKind = kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind);
    return byKind || left.sourceId.localeCompare(right.sourceId);
  });
  const catalog = sorted.length
    ? sorted.map((source) => {
        const status = source.selectable ? "available" : "unavailable";
        const markets = source.markets?.length ? source.markets.join(", ") : "未标注";
        const provider = source.providerName ? ` | provider: ${oneLine(source.providerName)}` : "";
        return `- [${status}] sourceId: ${source.sourceId} | name: ${oneLine(source.name)} | kind: ${source.kind} (${kindLabels[source.kind]}) | markets: ${markets} | access: ${source.selectionMode || "未标注"}${provider} | description: ${oneLine(source.description)}`;
      }).join("\n")
    : "当前目录没有返回任何数据源。不要虚构依赖；请把所需数据列为平台待补依赖。";
  return `${GUIDE_BODY}\n\n## 10. 当前数据中心目录快照（动态生成）\n\n只有 status: available 的条目可以写入 dataRequirements.sourceIds；unavailable 仅用于说明当前缺口。\n\n${catalog}`;
}

const MANIFEST_EXAMPLE = `strategyId: cn-mean-reversion
name: A股均值回归研究策略
version: 1.0.0
purpose: trading_decision
runtime: python
entrypoint: strategy:run
markets: [cn]
configurable:
  markets: [cn, hk, us]
  timeframes: [1d, 1w]
  runIntervals: [1d, 1w]
inputs:
  schema: schemas/input.json
outputs:
  contract: DecisionProposal
  schema: schemas/output.json
documentation:
  file: STRATEGY.md
dataRequirements:
  - id: primary_ohlcv
    type: market.ohlcv
    kind: kline
    sourceIds: [system_market_data]
    markets: [cn]
    frequency: 1d
    lookback: 120
    required: true
    usage: 计算均线、波动率与研究信号
    onMissing: fail
parameters:
  - name: moving_average_days
    type: integer
    default: 20
  - name: entry_threshold
    type: number
    default: -0.05`;

const contracts = [
  {
    name: "ResearchReport",
    purpose: "research_report",
    input: "一只股票、市场、截止时间、行情/基本面/新闻证据",
    output: "摘要、维度评级、风险、证据引用和数据覆盖情况",
    destination: "单股研究",
  },
  {
    name: "CandidateList",
    purpose: "candidate_screening",
    input: "市场、候选范围、数据快照和筛选参数",
    output: "候选股票、排序分数、入选理由、风险和降级说明",
    destination: "选股扫描",
  },
  {
    name: "DecisionProposal",
    purpose: "trading_decision",
    input: "市场、股票范围、数据快照、组合上下文和风险边界",
    output: "研究动作、目标权重、置信度、依据、风险和有效期",
    destination: "验证中心 / 运行中心",
  },
];

export default function StrategyDevelopmentGuidePage() {
  useEffect(() => {
    document.title = "策略生成指南 - LLM TradeBot";
  }, []);
  const [copied, setCopied] = useState(false);
  const [sources, setSources] = useState<StrategyDataSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [sourceError, setSourceError] = useState("");
  const [copyError, setCopyError] = useState("");
  const generationGuide = useMemo(() => buildGenerationGuide(sources), [sources]);

  const loadSources = async () => {
    setLoadingSources(true);
    setSourceError("");
    try {
      setSources(await strategyWorkspaceApi.listDataSources());
    } catch (error) {
      setSourceError(toApiErrorMessage(error, "无法读取数据中心目录。请重试后再复制指南。"));
    } finally {
      setLoadingSources(false);
    }
  };

  useEffect(() => {
    void loadSources();
  }, []);

  const copyPrompt = async () => {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(generationGuide);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopyError("复制失败。请允许浏览器访问剪贴板后重试。");
    }
  };

  const availableSources = sources.filter((source) => source.selectable);

  return (
    <AppPage className="space-y-7">
      <PageHeader
        eyebrow="Strategy package specification"
        title="策略生成指南"
        description="复制时会把当前数据中心目录一并写入指南，让外部工具生成策略内核、策略说明和可校验的数据依赖。"
        actions={<Link to="/strategies" className="btn-secondary">返回策略中心</Link>}
      />

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0 space-y-7">
          <section aria-labelledby="copy-prompt-heading" className="min-w-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="copy-prompt-heading" className="text-lg font-semibold text-foreground">复制完整策略生成指南</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-secondary-text">替换“我的策略想法”后直接交给 Codex 或 Claude Code。复制内容会包含当前数据目录，并要求同时生成实现、测试、策略说明和数据依赖清单。</p>
              </div>
              <button type="button" className="btn-primary inline-flex shrink-0 self-start items-center gap-2" disabled={loadingSources || Boolean(sourceError)} onClick={() => void copyPrompt()}>
                {loadingSources ? <LoaderCircle className="h-4 w-4 animate-spin" /> : copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                {loadingSources ? "正在读取数据目录" : copied ? "已复制动态指南" : "复制动态指南"}
              </button>
            </div>
            {sourceError ? <div role="alert" className="mt-4 flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger sm:flex-row sm:items-center sm:justify-between"><span className="flex items-start gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{sourceError}</span><button type="button" className="btn-secondary inline-flex shrink-0 items-center justify-center gap-2" onClick={() => void loadSources()}><RefreshCw className="h-4 w-4" />重新读取目录</button></div> : null}
            {copyError ? <p role="alert" className="mt-3 text-sm text-danger">{copyError}</p> : null}
            <pre className="mt-4 max-h-[520px] w-full min-w-0 overflow-auto rounded-xl border border-border bg-base p-5 text-xs leading-6 text-foreground" aria-busy={loadingSources}><code>{loadingSources ? "正在从数据中心生成最新指南…" : generationGuide}</code></pre>
          </section>

          <section aria-labelledby="data-catalog-heading" className="min-w-0 border-t border-border/70 pt-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="data-catalog-heading" className="text-lg font-semibold text-foreground">本次指南包含的数据目录</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-secondary-text">外部工具只能把“可用”来源写入策略依赖；尚未配置的来源会作为缺口提示，不会被误认为已经接入。</p>
              </div>
              <button type="button" className="btn-secondary inline-flex shrink-0 self-start items-center gap-2" disabled={loadingSources} onClick={() => void loadSources()}><RefreshCw className={`h-4 w-4 ${loadingSources ? "animate-spin" : ""}`} />刷新数据目录</button>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 sm:grid-cols-4">
              {kindOrder.map((kind) => <div key={kind} className="bg-card px-4 py-4"><dt className="text-xs text-secondary-text">{kindLabels[kind]}</dt><dd className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">{loadingSources ? "—" : availableSources.filter((source) => source.kind === kind).length}</dd><p className="mt-1 text-xs text-muted-text">当前可用</p></div>)}
            </dl>
            {!loadingSources && !sourceError ? sources.length ? <div className="mt-4 overflow-hidden rounded-xl border border-border/70 bg-surface"><ul className="divide-y divide-border/70">{sources.map((source) => <li key={source.sourceId} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Database className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span className="font-medium text-foreground">{source.name}</span><code className="break-all text-xs text-muted-text">{source.sourceId}</code></div><p className="mt-1 text-sm leading-6 text-secondary-text">{source.description || "未提供用途说明"}</p><p className="mt-1 text-xs text-muted-text">{kindLabels[source.kind]} · {dataSourceMarketSummary(source)}</p></div><span className={`w-fit rounded-md px-2 py-1 text-xs font-medium ${source.selectable ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{source.selectable ? "可写入策略依赖" : "尚不可用"}</span></li>)}</ul></div> : <div className="mt-4 rounded-xl border border-dashed border-border px-5 py-7"><p className="font-medium text-foreground">当前数据目录为空</p><p className="mt-1 text-sm leading-6 text-secondary-text">指南会要求外部工具列出平台待补依赖，不会虚构数据源。</p></div> : null}
          </section>

          <section aria-labelledby="contract-heading" className="min-w-0 border-t border-border/70 pt-7">
            <h2 id="contract-heading" className="text-lg font-semibold text-foreground">三类策略输出契约</h2>
            <p className="mt-1 text-sm leading-6 text-secondary-text">策略内部可以使用规则、工具、LLM 或多 Agent，但必须只选择一种对外产出。</p>
            <div className="mt-4 overflow-x-auto rounded-xl border border-border/70 bg-surface">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-border/70 bg-subtle/50 text-xs text-secondary-text">
                  <tr><th className="px-4 py-3 font-medium">契约</th><th className="px-4 py-3 font-medium">输入边界</th><th className="px-4 py-3 font-medium">必须输出</th><th className="px-4 py-3 font-medium">产品入口</th></tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {contracts.map((contract) => (
                    <tr key={contract.name}>
                      <td className="px-4 py-4 align-top"><code className="font-medium text-primary">{contract.name}</code><span className="mt-1 block text-xs text-muted-text">{contract.purpose}</span></td>
                      <td className="max-w-[260px] px-4 py-4 align-top leading-6 text-secondary-text">{contract.input}</td>
                      <td className="max-w-[300px] px-4 py-4 align-top leading-6 text-secondary-text">{contract.output}</td>
                      <td className="px-4 py-4 align-top font-medium text-foreground">{contract.destination}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="manifest-heading" className="min-w-0 border-t border-border/70 pt-7">
            <h2 id="manifest-heading" className="text-lg font-semibold text-foreground">策略包清单</h2>
            <p className="mt-1 text-sm leading-6 text-secondary-text">`strategy.yaml` 是平台读取策略身份、运行入口、数据需求、参数和输出契约的唯一入口。</p>
            <pre className="mt-4 overflow-auto rounded-xl border border-border bg-base p-5 text-xs leading-6 text-foreground"><code>{MANIFEST_EXAMPLE}</code></pre>
          </section>
        </main>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Card variant="bordered" padding="lg">
            <FileArchive className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="mt-4 font-semibold text-foreground">建议目录</h2>
            <pre className="mt-3 text-xs leading-6 text-secondary-text">{`strategy-package/\n├── strategy.yaml\n├── strategy.py\n├── STRATEGY.md\n├── README.md\n├── schemas/\n├── tests/\n└── requirements.lock`}</pre>
          </Card>
          <Card variant="bordered" padding="lg">
            <ShieldCheck className="h-5 w-5 text-warning" aria-hidden="true" />
            <h2 className="mt-4 font-semibold text-foreground">当前接入边界</h2>
            <p className="mt-2 text-sm leading-6 text-secondary-text">现有三条初始策略通过可信 Python 适配器调用成熟链路。自定义包完成静态检查后，可在独立受限子进程中调用 run(context)；当前只允许标准库、禁止直接网络和平台文件访问，并限制执行时间、文件、进程与输出大小。</p>
          </Card>
          <Card variant="bordered" padding="lg">
            <h2 className="font-semibold text-foreground">发布前检查</h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-secondary-text">
              <li>输入与输出 Schema 可解析</li>
              <li>市场与数据需求兼容</li>
              <li>入口函数和依赖完整</li>
              <li>固定样本冒烟测试通过</li>
              <li>不包含密钥和未声明网络调用</li>
            </ul>
          </Card>
        </aside>
      </div>
    </AppPage>
  );
}
