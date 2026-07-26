# TradeBot 架构与交付规划

> 文档角色：下一阶段产品与技术架构的权威基线
> 状态：方案已确认，增量实施尚未开始
> 最后更新：2026-07-26
> 当前进度与新窗口接手说明：`project-status-and-handoff.md`

## 1. 产品目标

TradeBot 将从当前以加密货币 Paper Trading 为中心的固定 Pipeline，演进为一个跨市场、可编排、可回测、可审计、可受控进化的 Multi-Agent 交易系统。

系统必须同时满足：

- 默认提供高质量的 Multi-Agent 交易模板；
- 复杂任务拆给输入最小、职责单一的 Agent，保持 LLM 上下文干净；
- 支持任意数量和粒度的观察窗口，包括单周期和无 K 线的事件驱动策略；
- 支持加密货币、A 股、港股、美股及后续市场；
- 数据源、Agent 和 Pipeline 可以配置、组合、版本化和回放；
- Copilot 可以通过受控后端工具创建配置草案，但不能直接修改运行策略或下单；
- 回测、Walk-Forward、人工审批与 Paper Running 形成同一个发布生命周期；
- Reflection 只产生待验证经验，运行系统不能未经验证地自我修改。

## 2. 不可破坏的安全边界

1. LLM 不直接产生可执行订单。唯一动作出口保持为：

   ```text
   Decision -> Portfolio -> Risk -> Execution
   ```

2. Copilot 只能查询、解释、创建草案、校验和发起验证任务。
3. Pipeline、Agent、Strategy、Lesson 的修改不能热更新到正在运行的版本。
4. 所有发布必须经过：

   ```text
   Draft -> Contract Validation -> Backtest -> Walk-Forward
         -> Human Approval -> Paper Running
   ```

5. “暂停新开仓 / 仅允许平仓”是唯一可立即生效的人工风险控制。
6. 必需数据缺失、时间未对齐或契约不兼容时，默认禁止新开仓。
7. Secret、环境变量、完整 LLM Prompt 和敏感账户信息不得写入 Artifact Ledger 或前端状态。
8. 当前阶段不接入交易所写接口，不改变 `packages/` 中现有交易系统的安全行为。

## 3. 从旧 LLM-TradeBot 继承什么

旧项目值得继承的核心是“任务拆解和干净上下文”：

- Trend Agent 只看大级别结构；
- Setup Agent 只判断交易形态和位置；
- Trigger Agent 只判断短级别触发；
- Multi-Period Parser 压缩并检查周期一致性；
- Decision Agent 只消费结构化摘要；
- Risk Agent 独立审计并拥有否决权；
- Reflection Agent 从历史交易中总结经验。

不能直接继承的部分：

- 固定 `1h/15m/5m`；
- 只支持加密货币；
- 把 Reflection 文本直接长期注入 Decision Prompt；
- 用全局状态或聊天记录代表可执行配置；
- 将前端配置直接视为已经部署；
- 动态执行用户生成的任意 Agent 代码。

## 4. 总体领域模型

下一阶段先建立五个基础注册表/版本模型：

```text
Market Pack Registry
Data Source Registry
Agent Template / Instance Registry
Pipeline Graph Registry
Experiment / Release Registry
```

关键实体：

```text
MarketPack
DataSourceDefinition
DataSourceCapability
ConnectorDefinition
ObservationWindow
AgentTemplate
AgentConfig
PipelineNode
PipelineEdge
PipelineGraphVersion
StrategyProfileVersion
DataSnapshotVersion
ExecutionModelVersion
BacktestRun
WalkForwardRun
HumanMarketThesis
EpisodeMemory
LessonCandidate
ValidatedLesson
ReleaseCandidate
```

这些实体都需要：

- 稳定 ID；
- schema version；
- 人类可读版本；
- 内容 fingerprint；
- 创建者和创建时间；
- 当前生命周期状态；
- 来源与变更 Diff；
- 审计关联。

## 5. Market Pack：隔离不同市场的规则

Pipeline 和通用 Agent 不应知道自己连接的是 Binance、A 股还是美股。Market Pack 负责注入特定市场语义：

```text
Market Pack
├── Instrument / Symbol 规范
├── 交易日历、时区、交易时段
├── 行情和事件数据约定
├── 复权、拆股、分红和公司行动
├── 最小价格变动、交易单位
├── 手续费、税费、资金费率、滑点
├── T+0 / T+1 / 结算
├── 涨跌停、停牌、盘前盘后
├── 风险规则
└── Backtest Execution Simulator
```

目标 Market Pack：

| Market Pack | 特有能力 |
|---|---|
| Crypto | 7×24、永续、杠杆、资金费率、强平 |
| A Share | 交易日历、T+1、涨跌停、停牌、印花税 |
| HK Stock | 港币结算、午间休市、价位档 |
| US Stock | 盘前盘后、公司行动、美元结算 |

首期不要求同时实现全部市场。先完成 Market Pack 合同和 Crypto Pack 迁移，再用第二个市场证明抽象有效。

## 6. 数据源、Connector 与处理 Agent

三者必须分离：

```text
Data Provider
  -> Connector（鉴权、请求、限流、缓存、重试）
  -> Normalizer / Processing Agent
  -> Typed Market Artifact
```

### 6.1 数据源能力清单

每个用户数据源接入后，先探测并生成能力清单：

```ts
interface DataSourceCapability {
  sourceId: string;
  dataType:
    | "ohlcv"
    | "tick"
    | "orderbook"
    | "news"
    | "fundamental"
    | "macro"
    | "alternative";
  markets: string[];
  availableIntervals?: string[];
  historyStart?: string;
  supportsRealtime: boolean;
  updateCadence?: string;
  timezone: string;
  timestampSemantics: "event_time" | "publish_time" | "close_time";
  tradingCalendar?: string;
  supportsAggregation: boolean;
  completeness: number;
  latencyMs?: number;
}
```

能力探测至少验证：

- Schema 映射；
- 时间字段和时区；
- 数据粒度；
- 历史覆盖；
- 实时更新方式；
- 缺失率、重复率和时间乱序；
- 聚合资格；
- 市场和标的覆盖；
- 鉴权状态，但不暴露 Secret。

### 6.2 Observation Window

K 线 interval 不能代表所有数据，因此使用更通用的观察窗口：

```ts
interface ObservationWindow {
  kind:
    | "bar_interval"
    | "rolling_window"
    | "event_batch"
    | "reporting_period";
  value: number;
  unit:
    | "second"
    | "minute"
    | "hour"
    | "day"
    | "week"
    | "month"
    | "quarter";
}
```

示例：

- K 线：`5 minute bar_interval`；
- 新闻：`6 hour rolling_window`；
- 公告：`event_batch`；
- 财报：`quarter reporting_period`；
- 订单簿：`30 second rolling_window`。

### 6.3 粒度转换规则

- 允许从可信细粒度数据聚合到更粗粒度；
- 所有派生数据必须记录源数据、转换器版本、日历和 lineage；
- 聚合只使用 `asOf` 前已经完整闭合的数据；
- 禁止用日线、月线反向伪造分钟或 Tick 数据；
- 不允许用“填充”掩盖关键输入缺失。

## 7. 灵活的多周期/多窗口 Agent 模板

多周期是一种默认能力，不是固定结构。

```ts
interface HorizonConfiguration {
  mode: "single" | "multi" | "event_driven";
  horizons: HorizonSpec[];
}

interface HorizonSpec {
  id: string;
  role?: "regime" | "setup" | "trigger" | "custom";
  observationWindow: ObservationWindow;
  sourceId: string;
  agentTemplateId: string;
  required: boolean;
}
```

合法 Pipeline 包括：

```text
日线 Analysis -> Decision -> Risk
```

```text
周线 Regime + 日线 Setup -> Reconciler -> Decision -> Risk
```

```text
1h Regime + 15m Setup + 5m Trigger
  -> Cross-Horizon Reconciler -> Decision -> Risk
```

```text
News Event -> Entity Link -> Impact Analysis
  -> Context Fusion -> Decision -> Risk
```

`Regime/Setup/Trigger` 是语义职责；具体时间粒度由用户策略和数据能力共同决定。`Cross-Horizon Reconciler` 只有在多个窗口需要融合时才存在。

### 7.1 能力协商

创建模板时执行：

```text
读取 DataSourceCapability
  -> 匹配 Agent 输入要求
  -> 检查原生或允许派生的窗口
  -> 生成兼容配置
  -> 展示降级与限制
  -> 用户确认
```

如果用户要求 5 分钟 Agent，但数据源只有日线，系统必须阻止编译，并建议：

- 切换单周期日线模板；
- 接入分钟级数据源；
- 使用日/周/月多窗口模板。

## 8. Agent Registry 与受约束编排

每个后端 Agent Template 必须预先实现和登记：

```ts
interface AgentTemplate {
  templateId: string;
  version: string;
  name: string;
  inputSchemas: string[];
  outputSchema: string;
  configSchema: string;
  supportedMarkets: string[];
  supportedDataTypes: string[];
  capabilities: string[];
  timeoutPolicy: string;
  fallbackPolicy: string;
}
```

用户不能通过对话任意生成和执行后端代码。Copilot 只能调用 Registry 中已安装的模板，并生成 `AgentConfig`。

推荐模板类别：

- Market Universe / Selector；
- Data Fetch / Normalize / Quality；
- Regime / Setup / Trigger / Custom Horizon；
- News Collector / Deduplicator / Entity Link / Impact；
- Fundamental / Macro；
- Context Fusion / Cross-Horizon Reconciler；
- Bull / Bear Case；
- Decision；
- Portfolio / Risk；
- Execution / Position Monitor；
- Review / Reflection / Evidence Validation。

### 8.1 Pipeline Graph

当前固定 `PipelineDependencies` 将逐步演进为版本化图：

```ts
interface PipelineNode {
  nodeId: string;
  agentTemplateId: string;
  agentVersion: string;
  configVersion: string;
  required: boolean;
}

interface PipelineEdge {
  fromNodeId: string;
  fromOutput: string;
  toNodeId: string;
  toInput: string;
}
```

Pipeline Compiler 必须验证：

- Schema 兼容；
- Market Pack 兼容；
- Data Source 能力；
- Observation Window 和时间对齐；
- 必需节点是否存在；
- 是否绕过 Decision/Risk/Execution 边界；
- 超时、fallback 和权限策略；
- 是否存在循环、悬空节点或未消费输出；
- 回测数据是否覆盖完整图。

## 9. 结构化 Agent Artifact

Agent 之间不得传递无边界的长文本作为系统事实。推荐统一输出：

```ts
interface AnalysisArtifact {
  artifactId: string;
  traceId: string;
  agentId: string;
  agentVersion: string;
  market: string;
  symbol?: string;
  observationWindow?: ObservationWindow;
  direction?: "long" | "short" | "neutral";
  strength?: number;
  confidence: number;
  evidence: EvidenceReference[];
  invalidationConditions: string[];
  expiresAt?: string;
  status: "success" | "fallback" | "error";
  summary: string;
}
```

Decision Agent 只消费经过 Schema 校验和压缩的 Decision Context，不读取所有原始数据、聊天历史或完整 Prompt。

## 10. Copilot：自然语言编排控制层

右侧 Copilot 的后端工具边界：

```text
list_market_packs
list_data_sources
inspect_data_source_capability
list_agent_templates
inspect_agent_template
create_data_source_draft
create_agent_draft
update_agent_draft
validate_agent_config
validate_pipeline_edge
connect_draft_nodes
compile_pipeline_draft
compare_pipeline_versions
start_backtest
start_walk_forward
submit_for_approval
query_trade_review
```

交互结果必须落成结构化实体并同步出现在画布上：

- Draft Data Source；
- Draft Agent；
- Draft Pipeline Node/Edge；
- 参数和版本 Diff；
- 校验结果；
- Backtest/Walk-Forward 任务；
- 审批状态。

聊天记录不是配置真相；版本化 Registry 和 Pipeline Graph 才是。

## 11. 回测系统

回测复用同一 Pipeline Graph、Agent 合同和 Market Pack，不建立另一套策略逻辑。

每次回测绑定：

```text
MarketPackVersion
DataSnapshotVersion
PipelineGraphVersion
StrategyProfileVersion
ExecutionModelVersion
```

### 11.1 通用回测能力

- Event/Historical Clock；
- 按 `asOf` 回放数据；
- 规则 Agent 确定性重放；
- LLM 输出录制/固定或明确禁止进入参数选择；
- 模拟订单、费用、滑点和流动性；
- 权益、回撤、交易、拒绝与 Agent 诊断；
- Trace 与 Artifact 回放；
- Baseline 对照、网格、消融、Walk-Forward；
- Dataset 和配置 fingerprint。

### 11.2 市场特有执行

Market Pack 提供：

- Crypto：资金费率、杠杆和强平；
- A 股：T+1、涨跌停、停牌和税费；
- 港股：午间休市、价位档；
- 美股：盘前盘后、公司行动。

不能用同一个简化撮合假设宣称支持所有市场。

### 11.3 与前述功能联动

任何 Agent/Data Source/Pipeline 修改都创建 Candidate。Research & Validation 工作区显示：

```text
Draft
  -> Data Coverage
  -> Contract Validation
  -> Backtest
  -> Ablation / Baseline Comparison
  -> Walk-Forward
  -> Human Approval
  -> Paper Running
```

每一笔回测交易都可以打开完整因果链：

```text
Source -> Normalize -> Analysis -> Reconcile -> Decision
       -> Risk -> Simulated Execution -> Review
```

## 12. 受控持续进化

系统分为两个循环：

### 12.1 快循环

```text
Data -> Analysis Agents -> Decision -> Risk -> Execution
```

只能读取已经批准的 Pipeline、Profile 和 Lesson，不能运行时自我改写。

### 12.2 慢循环

```text
Episode Memory
  -> Reflection
  -> Lesson Candidate
  -> Evidence Validation / Counterfactual Replay
  -> Backtest / Ablation / Walk-Forward
  -> Human Approval
  -> Validated Lesson or Strategy Candidate
```

推荐经验合同：

```ts
interface ValidatedLesson {
  lessonId: string;
  hypothesis: string;
  applicableMarkets: string[];
  applicableRegimes: string[];
  supportingTradeIds: string[];
  contradictingTradeIds: string[];
  sampleSize: number;
  confidence: number;
  validFrom: string;
  expiresAt: string;
  targetAgentId: string;
  adjustmentType: "warning" | "weight_cap" | "risk_constraint";
  maxInfluence: number;
  approvalStatus: string;
}
```

后续进化机制：

- 反事实回放；
- Agent 贡献度归因；
- 消融测试；
- 置信度校准；
- 按市场状态分组；
- 经验冲突检测；
- 经验过期和自动降权；
- 区分分析、决策、风险和执行错误。

## 13. Runtime 降级与安全

每个输入声明：

```text
Required：缺失则禁止新开仓
Optional：缺失时按显式规则降级
Fallback：切换已批准的备用源或规则 Agent
```

默认策略：

- 必需数据缺失：禁止新开仓；
- 可选 Agent 失败：记录 fallback，并降低置信度；
- 时间未对齐：拒绝该批输入；
- 已有持仓：继续运行最低安全级 Position Monitor；
- 关键行情完全中断：进入 Only Close；
- 所有降级写入 Trace 和 Artifact Ledger。

## 14. Web 信息架构

### 14.1 运行控制台

首屏只突出：

- Agent 是否运行；
- 当前市场和 Pipeline；
- Selector 当前选中的一个新标的；
- 当前持仓和风险；
- 当前发布阶段；
- 最近一次决策原因；
- 人工待办；
- Pause New Openings。

### 14.2 系统编排

- 左侧：Market Pack、Data Source、Agent Template Catalog；
- 中间：稀疏 Pipeline Canvas；
- 右侧：当前节点配置与编排 Copilot；
- Draft 节点使用明确的未发布状态；
- 点击节点查看输入、输出、版本、延迟、fallback 和 Artifact 摘要。

### 14.3 研究与验证

- Candidate 与 Running 版本 Diff；
- 数据覆盖；
- 回测、消融、Walk-Forward；
- 交易级 Trace；
- 人工审批门禁。

### 14.4 连接与基础设施

- Data Source / Connector；
- LLM Provider 与 Agent scope；
- Paper/只读账户；
- Secret Vault；
- 数据健康、权限和连接审计。

Web 保持完整中英文切换、清晰字体、宽桌面和窄笔记本响应式。它不能退化成满屏小卡片或聊天优先页面。

## 15. 当前实现基线

截至 2026-07-26，已经实现：

- TypeScript monorepo 基础、strict contracts 和 Zod 校验；
- Selector 候选池排名，默认只允许一个新标的进入下游；
- CSV 和 Binance Futures Public 数据源；
- 固定 `5m/15m/1h` 的多周期快照；
- Data Quality、Analysis、Bull/Bear、Decision、Portfolio、Risk；
- Paper Execution、Position Monitor、账户级风控；
- Stage Event、Trace、SQLite Agent Artifact Ledger 和 Trade Review；
- Strategy Profile、fingerprint、Run Manifest；
- 回测、参数实验、Baseline、Walk-Forward；
- DeepSeek Bull/Bear/Reflection 和规则 fallback；
- Web 的运行控制台、Agent Lab、审计、连接配置与中英文 UI 原型。

尚未实现：

- Market Pack Registry；
- 通用 Data Source Registry 和能力探测；
- 任意 Observation Window 合同；
- 通用 Market/Event Artifact；
- Agent Template/Instance Registry；
- 版本化 Pipeline Graph 和 Compiler；
- Copilot 后端工具/API；
- Web 与 Runtime 的 HTTP/事件连接；
- 跨市场撮合与第二个 Market Pack；
- Lesson Candidate/Validated Lesson 证据门禁；
- Agent 贡献度、反事实和消融编排；
- 完整候选发布与审批服务。

## 16. 交付路线

| 阶段 | 目标 | 主要交付 | 状态 |
|---|---|---|---|
| 0 | 当前固定 Crypto Paper 基础 | Contracts、固定 Pipeline、Paper、Trace、回测、Web 原型 | **已完成基础** |
| 1 | 架构合同冻结 | Market Pack、Capability、Observation Window、Agent Template、Pipeline Graph schemas/ADR | **下一步** |
| 2 | 数据源注册与能力协商 | Registry、探测、覆盖矩阵、聚合 lineage、运行时缺失策略 | **未开始** |
| 3 | Agent Registry 与 Graph Compiler | Template/Instance、Schema edge validation、固定 Pipeline 兼容编译 | **未开始** |
| 4 | 能力自适应默认模板 | single/multi/event 模板、可选 Reconciler、Crypto 固定链迁移 | **未开始** |
| 5 | Copilot 编排 API | 受控工具、结构化 Draft、Diff、Canvas 联动 | **未开始** |
| 6 | 统一实验与发布 | Candidate、Backtest、消融、Walk-Forward、Approval、Paper release | **部分基础已有** |
| 7 | 第二市场证明 | 选择 A 股或美股 Market Pack、数据与执行模拟器 | **未开始** |
| 8 | 受控持续进化 | Episode、Lesson Candidate、验证、审批、注入限制 | **Reflection 基础已有** |
| 9 | Live 安全设计 | 单独的权限、幂等、对账、恢复和审计项目 | **不在当前范围** |

## 17. 下一窗口的实施顺序

新窗口不要直接从画布 UI 或多市场 Connector 开始。推荐顺序：

1. 重新读取本文件、`PRODUCT.md` 和 `project-status-and-handoff.md`；
2. 审计当前 contracts、ports、fixed Pipeline 和 Web mock；
3. 先编写架构合同与 ADR，不改变现有运行行为；
4. 增加向后兼容的 `DataSourceCapability`、`ObservationWindow`、`AgentTemplate`、`PipelineGraph` schemas；
5. 给当前 Binance/CSV 固定实现生成 Capability Manifest；
6. 实现 Pipeline Draft 校验器和 Compiler 的最小垂直切片；
7. 再实现 Web 的系统编排工作区和 Copilot mock/API；
8. 接通统一 Backtest Candidate；
9. 最后选择第二个 Market Pack 验证抽象。

每一阶段都必须：

- contract 和 fixture 先行；
- 保持当前 tests 通过；
- 不接入交易所写接口；
- 不让前端 Secret 进入持久状态；
- 不把 mock 或规划写成已上线能力；
- 不提交 Git，除非用户明确要求。

---

## 2026-07-26 路线图重新对齐

当前架构与后续交付顺序已统一整理到 `docs/product-roadmap-and-progress.md`。后续以该文档的状态矩阵、M1 至 M8 依赖顺序和验收标准作为当前实施入口。

本轮纠偏后的主线是：

`语义 Artifact → 旧 LM Preset 行为迁移 → Historical Graph Executor → 任意 Graph Backtest/Walk-Forward → Market/Agent Draft API → Copilot Tool Loop → Web 完整编排体验`

已有 Runtime Safety、Outbox、Dispatcher、Worker、Audit Export 和 Retention 继续保留，但除阻断性安全缺陷外不再优先扩展。当前固定 DecisionPipeline、Selector `topN=1`、`--symbols` 候选池语义、Position Monitor、Paper Account、Risk、Execution 和 Runtime Safety 行为保持不变。
