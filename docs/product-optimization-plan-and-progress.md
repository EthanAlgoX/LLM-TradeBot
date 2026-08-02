# TradeBot 产品优化规划与进度

> 2026-08-02：M2 CSV Binding Composer 服务端修复已通过 333/333 自动化；真实 Chrome 可见 Binding 仍返回 `REQUEST_CONTRACT_INVALID`，M2 保持 IN_PROGRESS，下一步为 LOOP-016。

> 文档角色：汇总 2026-08-01 之前的产品讨论，作为后续产品优化、页面收敛和阶段验收的执行入口
> 最后更新：2026-08-01
> 产品基线：[`../PRODUCT.md`](../PRODUCT.md)
> 当前工程进度：[`product-roadmap-and-progress.md`](product-roadmap-and-progress.md)
> 架构与安全边界：[`architecture-and-delivery-plan.md`](architecture-and-delivery-plan.md)

## 1. 文档目标

当前仓库已经具备较深的 Draft、Graph、Artifact、Backtest、Walk-Forward、Approval、Paper Runtime、Causal Review 和 Reflection 基础，但产品入口、历史对话、数据管理、实验比较和多环境运行仍比较分散。

本文件只负责回答四个问题：

1. TradeBot 最终应该形成怎样的产品闭环；
2. 已确认需要优化哪些页面和能力；
3. 每项优化依赖什么、按什么顺序实施；
4. 如何判断一项工作已经完成，而不是只完成合同或静态界面。

本文件不是完成日志。每个阶段完成后更新状态、验收结果和下一阶段，不在正文末尾无限追加历史记录。

## 2. 产品定位与已确认方向

TradeBot 的核心定位保持不变：

> 用户通过自然语言连接数据、分析、决策与反思 Agent，形成版本化、可验证、可回测、可审计并能受控运行的交易系统。

与参数化固定交易流水线不同，TradeBot 的优势是动态 Agent 编排：

```text
Data Bindings
  -> Input Agents
  -> one or more Analysis Agents
  -> optional Context Assembler / Bull-Bear Debate
  -> Decision
  -> Portfolio
  -> Risk
  -> Execution
  -> Review / Reflection
```

其中只有以下动作安全链必须固定且不可绕过：

```text
Decision -> Portfolio -> Risk -> Execution
```

数据输入、分析节点、Prompt、模型、观察窗口、上下文汇总和 Reflection 拓扑都可以通过对话创建新 Draft Version；任何对话变更都不能直接热更新正在运行的 Agent。

## 3. 目标产品闭环

```text
数据中心
  -> 对话式编排 Agent
  -> Immutable Strategy / Workflow Version
  -> Contract Validation
  -> 实验场：Backtest / Walk-Forward / Comparison
  -> 模拟运行：实时 Paper Forward Test
  -> Shadow：真实环境旁路决策
  -> Human Approval / Canary
  -> Live Champion
  -> Runtime Audit / Trade Review / Reflection
  -> 新的 Strategy Candidate
```

目标不是让系统自动追逐短期收益最高的策略，而是持续发现“在当前目标、风险约束和证据范围内更好的 Challenger”，经过验证、灰度和人工审批后替换 Live Champion。

## 4. 目标一级信息架构

| 一级页面 | 回答的核心问题 | 主要内容 |
| --- | --- | --- |
| 交易 Agent | 当前模拟或真实 Agent 运行得怎么样 | 环境切换、收益、持仓、Agent 轨迹、风险、执行、运行控制 |
| 数据中心 | 系统有哪些数据，当前市场发生了什么 | Market Radar、Data Assets、Sources、Ingestion & Quality |
| 编排 Agent | 交易系统应该怎样连接和决策 | 历史对话、结构化 Draft、Agent Graph、Prompt/Diff、Validation |
| 实验场 | 哪个策略、模型、Prompt 或 Graph 更好 | Backtest、Walk-Forward、版本对比、实验 Scorecard |
| 审计记录 | 为什么产生这次决策和交易 | Run、Cycle、Trace、Artifact Lineage、Trade Review、Reflection |
| 连接配置 | 外部服务和权限如何接入 | Data/LLM Provider、Paper/只读/未来 Live Account、Secret 与权限 |

页面关系遵循“默认简单、按需深入”：首页先展示用户当前最需要判断的结果，Graph、Artifact、Prompt、Lineage 和工具调用作为详情或高级视图。

## 5. 核心领域对象

### 5.1 策略与编排

```text
Strategy Version
= Data Bindings
+ Agent Graph
+ Node Prompts
+ Model Bindings
+ Decision Contract
+ Risk Policy
+ Runtime Settings
+ Version / Fingerprint
```

Strategy Version 是不可变事实。修改 Prompt、数据源、Agent 参数或 Graph 都必须创建新版本。

### 5.2 数据

| 对象 | 含义 |
| --- | --- |
| Data Source | 外部供应商或原始接入点，例如 Binance、CSV、新闻、Reddit/X |
| Data Asset / Dataset | 经过登记、Schema 化并可被 Agent 使用的数据资产 |
| Dataset Snapshot | 某一时间点的不可变数据版本，用于可复现回测和比较 |
| Data Binding | 某个 Agent/Workflow 对 Dataset 或 Live View 的精确引用 |
| Data Pack | 可复用的一组数据绑定、质量要求和 Observation Window |

### 5.3 运行

| 对象 | 含义 |
| --- | --- |
| Trading Agent | Strategy Version 的一个运行实例 |
| Deployment | Strategy Version 到某个环境、账户、数据与执行模型的绑定 |
| Simulation Run | 使用实时数据和模拟撮合的持续 Paper 运行实例 |
| Shadow Run | 读取真实数据和账户快照、产生决策但不提交订单的实例 |
| Live Deployment | 允许受控真实执行的部署；当前尚未实现 |
| Champion | 当前控制真实风险预算的已批准版本 |
| Challenger | 正在 Paper/Shadow/Canary 中验证的候选版本 |

必须保持：

```text
Strategy Version != Trading Agent != Deployment
```

同一个 Strategy Version 可以同时存在于 Backtest、Paper、Shadow 和未来 Live 环境，但每个 Deployment 有独立环境、账户、数据和执行模型 fingerprint。

## 6. 数据中心规划

### 6.1 页面结构

```text
数据中心
├── Market Radar
├── Data Assets
├── Sources
└── Ingestion & Quality
```

#### Market Radar

吸收外部项目中“Data/市场雷达”的优点，但不是 Dataset 管理页。用于快速回答：

- 当前市场状态、波动和流动性如何；
- 哪些标的出现异常成交量、资金流、OI、事件或风险；
- 信号来自什么数据、更新时间和质量如何；
- 是否值得加入观察列表、创建 Market Thesis、送入编排或发起实验。

Market Radar 不直接下单。

#### Data Assets

管理 K 线、财务、宏观、新闻、公告、研报、Reddit/X、账户和交易历史等数据资产。详情至少包含：

- Overview；
- Schema & Preview；
- Quality；
- Versions / Snapshots；
- Lineage & Usage；
- License / Cost / Retention。

#### Sources

管理 Provider、Connector、鉴权状态、Capability、限流、刷新策略和健康状态。

#### Ingestion & Quality

管理同步任务、失败重试、时间戳语义、交易日历、缺失、重复、陈旧、未来数据泄漏和质量报告。

### 6.2 编排绑定

编排 Agent 必须能选择一个或多个 Data Binding：

```text
Kline -> Technical Agent
News -> Event Agent
Social -> Sentiment Agent
Fundamental -> Fundamental Agent
Macro -> Macro Agent
                 -> Context Assembler -> Decision
```

绑定模式至少包含：

- `live`：实时运行；
- `latest_snapshot`：当前最新不可变快照；
- `pinned_snapshot`：固定版本；
- `replay`：按历史 as-of 顺序回放。

Data Source Capability 必须在 Graph 创建和执行前验证；禁止使用日线伪造分钟线。

## 7. 对话式编排与历史会话

### 7.1 产品原则

```text
Conversation = 用户意图和解释过程
Draft Version = 配置真相
Audit Log = Runtime 实际事实
```

三者通过 `conversationId`、`draftId`、`versionId`、`fingerprint`、`experimentId`、`runId` 和 `traceId` 关联，但不能互相替代。

### 7.2 目标界面

```text
┌──────────────┬────────────────────────┬──────────────────┐
│ 历史会话      │ 当前对话                │ 当前策略上下文     │
│              │                        │                  │
│ BTC 趋势策略  │ 用户需求                │ Strategy Draft    │
│ 新闻事件策略  │ Copilot 理解             │ Version / Graph   │
│ 港股财报策略  │ Draft Diff             │ Data / Agents     │
│              │ Validation / Gates     │ Next Gate        │
└──────────────┴────────────────────────┴──────────────────┘
```

每个 Copilot Turn 应优先展示：

- 对需求的结构化理解；
- 数据、Agent、Prompt、Graph 和 Risk 的字段级 Diff；
- Capability 和 Contract Validation；
- Runtime 未应用边界；
- 下一步可执行门禁。

原始工具调用默认折叠。

### 7.3 历史会话后端

复用现有 append-only Conversation Replay，不建立第二套配置事实源。计划增加：

```text
listConversations(actorId, cursor, limit)
listTurns(actorId, conversationId, cursor, limit)
getLatestTurn(actorId, conversationId)
getLatestDraftReference(actorId, conversationId)
```

只读 API：

```text
GET /api/orchestration/conversations
GET /api/orchestration/conversations/:conversationId
GET /api/orchestration/conversations/:conversationId/turns
```

刷新页面后由服务端从最后一条 Response 恢复 Draft Reference；客户端不能自报当前 Draft。

### 7.4 会话分支

历史会话支持两种动作：

- 继续会话：在当前 Draft 上创建新版本；
- 创建实验分支：从某个不可变版本创建独立 Challenger。

示例：

```text
Atlas v12
├── A：更保守的 Decision Prompt
├── B：增加新闻 Agent
└── C：替换 LLM Model
```

分支进入实验场，不修改当前 Paper/未来 Live Deployment。

## 8. 实验场规划

实验场负责有限历史范围内的研究与验证，不等于持续 Paper 模拟。

### 8.1 比较模式

| 模式 | 固定项 | 变量 |
| --- | --- | --- |
| Strategy Comparison | Model、Dataset、Risk | 策略和 Prompt |
| Model Comparison | Strategy、Prompt、Dataset、Risk | 模型 |
| Agent Graph Comparison | Model、Dataset、Risk | Agent 拓扑 |
| Open Class | 无完全固定 | 只能描述差异，不能声称单因素因果 |

### 8.2 公平比较锁

受控比较必须固定：

- Dataset Snapshot；
- 起止时间与交易日历；
- Universe；
- 初始资金；
- 手续费、滑点和 Execution Model；
- Risk Budget、最大持仓数；
- Model/Prompt Version、Temperature、Context 和 Fallback；
- 运行失败处理策略。

### 8.3 Scorecard

至少包含：

- 净收益、年化收益；
- 最大回撤、波动率、连续亏损；
- Sharpe、Sortino、Calmar；
- 胜率、Profit Factor、盈亏比；
- Walk-Forward 和不同 Regime 稳定性；
- 交易数、换手率、费用、滑点、模型成本；
- 数据、Agent、模型和 Runtime 失败次数；
- 样本量和不确定性。

不使用不可解释的单一综合分。实验应表达为“目标 + 约束”，例如：

```text
最大化净收益
subject to:
  max drawdown < 8%
  trades >= 50
  walk-forward positive
  runtime failures = 0
```

实验赢家只能成为 Candidate，不能直接替换运行策略。

## 9. 交易页面：模拟与真实

### 9.1 已确认的产品决策

模拟和真实不拆成两个一级页面。它们可以同时在后台运行，交易 Agent 页面顶部使用分段选择器切换当前观察环境：

```text
[ 模拟运行 4 ] [ 真实运行 1 ]
```

该控件只切换视图，不启动、停止或替换任何 Agent。禁止使用容易被理解为启停开关的 Switch。

主要页面状态：

```text
LIVE_OVERVIEW
PAPER_OVERVIEW
PAPER_RUN_DETAIL(runId)
```

推荐 URL：

```text
/trading?environment=paper
/trading?environment=paper&run=paper-run-atlas-12
/trading?environment=live
```

### 9.2 真实运行视图

保持当前交易 Agent 的信息重心：

- 当前部署和账户；
- 当前标的、持仓、收益和风险；
- Agent 语义输出；
- Decision、Portfolio、Risk 和 Execution；
- Runtime Health；
- Close-only、Safe Stop 等紧急控制。

未来可以增加一张轻量 Challenger 摘要卡，但不能把 Live 页面变成策略排行榜。

### 9.3 模拟总览

模拟环境默认先回答“哪些策略表现更好”：

```text
模拟运行
├── 全部模拟：多策略收益曲线、排行榜、健康状态
└── 模拟实例详情
```

总览至少包含：

- 运行中、待观察、已停止实例数量；
- 共同运行区间；
- 标准化收益曲线；
- 实际净值切换；
- 收益、最大回撤、Sharpe、交易数、费用和健康状态；
- 选择最多 5 条曲线对比；
- 可选加入当前 Live Champion 作为虚线基准；
- 启动新模拟、停止、归档和进入详情。

多个实例可能有不同资金和起始时间，默认使用共同运行区间并将曲线归一化为 100 或 0%。不能只按累计收益直接排名。

### 9.4 模拟实例详情

```text
模拟运行 / Atlas v12

[表现] [Agent 轨迹] [交易记录] [配置与数据] [晋升评估]
```

#### 表现

收益、回撤、风险调整收益、虚拟仓位、费用、滑点和 Runtime Health。

#### Agent 轨迹

运行时不是“编排对话”。应展示每个 Cycle 的结构化语义轨迹：

```text
Data Inputs
-> Analysis Agents
-> Decision
-> Risk
-> Simulated Execution
```

节点详情可查看 Artifact、Prompt Version、Model、结构化 rationale、Evidence、Invalidation、Lineage、耗时和成本。默认不展示或保存模型隐藏推理过程。

#### 交易记录

模拟订单、成交、仓位、手续费、滑点和每笔交易对应的 Decision Trace。

#### 配置与数据

展示 Strategy、Graph、Prompt、Model、Data Pack、Execution Model、初始资金、开始时间和完整 fingerprint，并可打开来源编排对话或基于该版本创建分支。

#### 晋升评估

展示运行时长、样本、收益、回撤、Evidence、失败率和 Shadow 条件；动作只允许“继续模拟”“启动 Shadow”“加入晋升候选”，不直接替换 Live。

## 10. 环境与晋升路径

虽然界面首期使用“模拟 / 真实”两个观察入口，底层环境模型需要预留四级：

```text
Backtest -> Paper -> Shadow -> Live
```

| 环境 | 数据 | 订单 | 资金 | 目的 |
| --- | --- | --- | --- | --- |
| Backtest | 历史 Snapshot | 模拟 | 无 | 快速研究与排除 |
| Paper | 实时数据 | 模拟 | 虚拟 | Forward Test |
| Shadow | Live 同源数据和账户快照 | 不提交 | 无新增风险 | 验证真实环境行为 |
| Live | 实时数据 | 真实 | 真实 | 受控资金运行 |

当前项目只能宣称 Paper Only。Shadow 和 Live 都是后续阶段，Live 必须单独完成凭证、账户、执行、风控、预检、灰度和运维安全设计。

### 10.1 晋升门禁

示例门槛应由版本化 Promotion Policy 定义：

```text
Paper duration >= 30 days
effective trades >= 50
net return > 0
max drawdown < 8%
profit factor > 1.2
walk-forward passed
runtime failure count = 0
data missing rate < 1%
fingerprints current
```

达到门槛只能显示 `ELIGIBLE_FOR_SHADOW`，不能自动进入 Live。

### 10.2 Champion / Challenger

```text
Live Champion
├── Challenger A / Paper
├── Challenger B / Shadow
└── Challenger C / Canary
```

系统持续生成 Promotion Recommendation，说明表现差异、Graph/Prompt/Data/Risk Diff、样本范围和不确定性。推荐不等于批准。

### 10.3 灰度路径

```text
Paper
-> Shadow
-> Canary 5%
-> Canary 20%
-> Live 50%
-> Live Champion 100%
```

Canary 可以按资金比例、单一标的、最大持仓数、杠杆或独立子账户限制风险。

### 10.4 持仓交接

默认方案：

```text
旧 Champion：只管理切换前已有持仓，不再开新仓
新 Champion：只负责切换后的新交易机会
```

其他模式：

- 清仓后切换；
- 经过市场、标的、Position Schema、Risk 和逐仓接受检查后的显式持仓迁移。

禁止新策略无条件继承旧策略持仓。

### 10.5 回滚

每次替换必须记录 Previous/New Champion、Deployment fingerprint、切换时间、持仓归属、风险预算、审批和回滚条件。异常时可以自动进入 Close-only 并通知人工；自动恢复旧 Champion 或部署新版本不属于首期能力。

## 11. 当前实现快照

截至 2026-08-01：

| 项目 | 状态 | 事实 |
| --- | --- | --- |
| Dynamic Agent Draft / Graph / Validation | `REAL` | 已有严格合同、Registry、Capability、不可变 Draft 和 Graph Validation |
| Backtest / Walk-Forward / Approval | `REAL` | 已有真实服务与 Artifact 门禁 |
| Current Crypto Paper Runtime | `REAL` | 受控 Paper Binding、账户、运行安全和证据读取已存在 |
| Conversation Command Persistence | `REAL` | append-only replay 可用于幂等和单条恢复 |
| 用户可见历史会话 | `REAL` | M1 功能、视觉交互、328/328 自动化与真实 Chrome DevTools Storage/Network 证据均已通过 |
| Data Center | `UNAVAILABLE` | 已有 Capability Manifest，但无统一数据资产页面和 Dataset Binding UX |
| Market Radar | `UNAVAILABLE` | 尚无独立产品视图 |
| Experiment Arena UI | `PARTIAL` | Backtest/WF 后端存在；旧 Agent Lab UI 代码存在但路由不可达且仍有样例状态 |
| Multi-Simulation Overview | `UNAVAILABLE` | 当前没有多个 Paper Deployment 的统一曲线和排行榜 |
| Paper Run Detail Agent Trace | `PARTIAL` | Runtime Evidence/Artifact 基础存在，尚未形成完整模拟实例详情 |
| Shadow Runtime | `UNAVAILABLE` | 仅有部分 Shadow Lesson/Decision Context 概念，不等于交易策略 Shadow Deployment |
| Live Runtime | `UNAVAILABLE` | `exchangeWriteAllowed=false`，不得误写为已支持 |
| Champion / Challenger Promotion | `UNAVAILABLE` | 尚无 Promotion、Canary、Handover、Rollback 产品链 |

当前 Web 导航存在遗留：可见“编排 Agent”使用 `lab` View，而 `lab` 又映射到 Orchestration；真正的 `renderLab()` 不可达。后续应明确：

```text
orchestration -> 编排 Agent
lab / experiment -> 实验场
```

### 11.1 当前验证基线

2026-08-01 本地复核：

```text
npm run check       PASS
npm run build:web   PASS
npm run test:ts     320/320 PASS
```

两个待修复回归：

1. Current Crypto Paper Runtime 恢复持仓并进入 close-only 时，预期 `close_long`，实际没有动作；
2. Runtime Evidence 最新决策预期为 `hold`，实际为 `undefined`。

README 中的 `320/320 PASS` 当前已过期。恢复稳定测试基线是后续产品优化的前置任务。

## 12. 分阶段执行计划

### M0：稳定基线与页面路由收敛

状态：`COMPLETE`

- [x] 修复两个 TypeScript 测试回归；
- [x] 恢复 `320/320 PASS` 并更新 README；
- [x] 分离 Orchestration 与 Experiment View；
- [x] 明确 Mock、Real、Partial、Unavailable、Paper 和未来 Live 标识；
- [x] 保证当前 Paper 安全边界不退化。

验收：

- Type check、全部测试、Web build 和 diff check 通过；
- 编排页与实验页有独立稳定 URL/View；
- 切换模拟/真实/页面视图无 Runtime 副作用；
- 不增加交易所写接口。

### M1：历史对话 V1

状态：`COMPLETE`

- [x] Conversation Replay 增加会话与 Turn 的 SQL 有界分页读取、版本化 kind cursor、actor 隔离和 append-only 保护；
- [x] 增加历史会话只读 API，并对认证、ID、query、cursor 和方法 fail closed；
- [x] 页面刷新后恢复 conversationId 和服务端最新 Draft Reference；
- [x] 左侧历史会话、中间结构化对话、右侧策略上下文；
- [x] 新建会话、继续会话、分页去重与服务端 Turn 回读；
- [x] Turn 展示 Diff、Validation、Gate 和 Runtime-not-applied；
- [x] 中英文和桌面/窄屏真实 Browser 验证、会话创建/切换/刷新/重启恢复、Tool Activity 与键盘焦点验收；
- [x] Chrome DevTools 最终证据：localStorage、sessionStorage 和 Cookie 均无条目；可见 UI 触发的 `POST /api/orchestration/copilot/messages` 为 `200`。

验收：自动化已验证 Draft Authority、SQL pagination、actor 隔离、损坏 replay fail-closed、Runtime-not-applied，以及 Operator identity resolver 的 global/DEV/fail-closed 优先级；production sentinel 不进入 Web bundle，最新测试为 328/328 PASS。真实 Chrome 已完成自动身份、Storage（均为空）、UI 触发的 Copilot `POST /api/orchestration/copilot/messages` `200`、Draft Version 5、Console 清空刷新后无页面 error/warning 及 Runtime 安全验收。`LOOP-004` 在用户明确授权下由 Agent 直接操作 DevTools，未读取任何 value。

### M2：数据中心 V1

状态：`IN_PROGRESS`

- [x] 增加一级“数据中心”；
- [x] 首期接入现有 Binance Public 与 CSV Historical；
- [x] Data Assets 列表和详情；
- [x] Source Capability、更新时间和健康状态；
- [x] Dataset Snapshot、Schema Preview、Quality 和 Lineage；
- [x] 服务端不可变 Dataset Binding 合同、版本/fingerprint/capability 校验和 actor fail-closed；
- [x] Market Radar 首版仅展示当前已证实维度；当前 Regime、Mover、Volume、Funding/OI 均明确 unavailable；
- [x] 补齐“送入编排”在编排工作台的可见 Dataset intent 消费与待绑定确认卡片；
- [x] 提供可由 UI 确定性创建的 CSV-compatible Agent Draft（真实注册 CSV Graph、exact-set 校验与可见入口）；
- [x] 完成 CSV Binding 成功、不可变 Draft Version、权威引用与刷新恢复的正向 Chrome 验收；
- [x] 修复绑定后继续对话的 `INTERNAL_ORCHESTRATION_ERROR`，并通过自动化验证新版本保留 Dataset binding、CSV recipe/Graph 与重启 Authority；
- [ ] 修复真实 UI Binding 的 `REQUEST_CONTRACT_INVALID`，完成 Binding → 恢复 → Composer 的 Agent Chrome 闭环；
- [x] 完成真实 Chrome 的桌面、窄屏、绑定成功/拒绝和产品 Console 验收；Network 因 Agent Chrome 工具不提供读取能力，保持 `TOOL_UNAVAILABLE`，禁止人工替代。

验收：一个 Strategy Draft 可以引用服务端登记的数据版本，Validation 能阻止能力不匹配，回测 Evidence 能追溯 Dataset fingerprint。

进度：LOOP-015 已定位 CSV Historical Agent Template 缺少 `confidenceThreshold` 允许项及域错误被包装为通用 500，并修复权威 Draft 的 CSV recipe/Graph 精确选择和重启 replay mapping；333/333 自动化通过。真实 Chrome 中 CSV 资产与页面稳定，但确认 Binding 返回 `REQUEST_CONTRACT_INVALID`，因此 Composer 修复尚未取得端到端 Chrome 证据。下一步执行 LOOP-016，以共享 Schema 定位并修复前后端合同差异，再完成 Binding → 恢复 → Composer 闭环；M2 保持 `IN_PROGRESS`。

### M3：实验场 V1

状态：`PLANNED`

- [ ] 恢复并重构 Agent Lab 为实验场；
- [ ] 从历史会话或 Strategy Version 创建实验；
- [ ] 选择 2～5 个参与版本；
- [ ] 锁定 Dataset、时间、资金、费用、Risk 和 Model/Prompt 变量；
- [ ] 展示净值、回撤和核心 Scorecard；
- [ ] 配置 Diff；
- [ ] Backtest -> Walk-Forward -> Candidate；
- [ ] 不提供直接 Runtime Apply。

验收：同一 Experiment 可重放并得到相同 fingerprint；比较条件不一致时明确标记 Open Class 或拒绝因果结论。

### M4：多模拟运行中心

状态：`PLANNED`

- [ ] 交易 Agent 顶部增加“模拟 / 真实”分段选择器；
- [ ] 切换只改变视图，不影响后台 Runtime；
- [ ] 支持多个独立 Paper Deployment 和虚拟账户；
- [ ] Paper Overview 多曲线、共同区间、标准化收益和实例列表；
- [ ] 最多选择 5 条曲线，可加入 Live 基准占位；
- [ ] Paper Run Detail：表现、Agent 轨迹、交易、配置与数据、晋升评估；
- [ ] 从 Strategy Version 启动模拟；
- [ ] 停止、归档、重启和健康状态；
- [ ] Paper Execution Model 纳入费用、滑点、延迟和市场约束。

验收：至少两个策略能够并行持续运行且账户、Trace、Artifact 和曲线隔离；刷新页面不改变运行状态；详情可追溯到来源 Draft、数据和每笔交易。

### M5：Shadow 与晋升建议

状态：`FUTURE`

- [ ] 定义独立 Trading Strategy Shadow Deployment；
- [ ] 与目标 Live 数据、账户快照和 Decision Context 保持同源；
- [ ] 禁止 Execution 写入；
- [ ] Champion/Challenger 对比；
- [ ] 版本化 Promotion Policy；
- [ ] 产生 Promotion Recommendation，而非自动批准；
- [ ] Shadow Divergence 和 Runtime Health Evidence。

验收：Shadow 可以完整产生决策和证据，但任何路径都不能形成真实或 Paper 账户写入；数据、账户和版本漂移时 fail closed。

### M6：受控 Live 与 Canary

状态：`FUTURE / NOT AUTHORIZED`

前置条件：独立安全评审、显式产品授权、Shadow 完成、Live Adapter 与账户权限设计完成。

- [ ] Live Execution Port / Adapter；
- [ ] Secret Vault 和账户隔离；
- [ ] Live Preflight、Lease、Heartbeat、Fencing、Incident 和 Reconciliation；
- [ ] 独立风险预算；
- [ ] Canary 5% / 20% / 50%；
- [ ] Close-only、Safe Stop 和人工审批；
- [ ] 不允许 Copilot 或 LLM 直接部署或下单。

验收标准必须在该阶段开始前单独制定。当前不得实现或宣称 Live 可用。

### M7：Champion 替换、持仓交接与回滚

状态：`FUTURE`

- [ ] Champion/Challenger Deployment 状态机；
- [ ] Promotion Approval；
- [ ] 旧策略管理旧仓、新策略只开新仓的默认交接；
- [ ] 清仓切换和显式兼容迁移；
- [ ] Previous Champion 保留；
- [ ] Rollback Plan、触发条件和审计；
- [ ] 异常自动 Close-only，策略恢复仍需受控授权。

验收：任何切换都能解释版本、证据、审批、风险预算和持仓归属；新策略不能无条件继承旧持仓；回滚不会绕过 Risk 与账户控制。

## 13. 跨阶段不可破坏边界

1. 唯一动作链保持 `Decision -> Portfolio -> Risk -> Execution`；
2. Copilot、LLM、Analysis 和 Reflection 都不能直接下单；
3. Conversation 只能创建或解释 Draft，不能成为配置真相；
4. Draft、Evidence、Approval、Lesson 和 Experiment Winner 都不能热更新运行中策略；
5. 数据必须保留 as-of、Snapshot、Schema、Capability 和 lineage；
6. 必需数据缺失时阻止新开仓，可选数据只能按显式 Failure Policy 降级；
7. Backtest、Paper、Shadow 和 Live 必须区分环境与 Execution Model；
8. 模拟/真实视图切换不得产生 Runtime 副作用；
9. Strategy Promotion 必须包含风险约束、证据、不确定性、审批和回滚；
10. 当前保持 Paper Only 和 `exchangeWriteAllowed=false`，直到 M6 获得独立授权。

## 14. 进度维护规则

1. 每个里程碑只能使用 `IN_PROGRESS`、`PLANNED`、`FUTURE` 或 `COMPLETE`；
2. `COMPLETE` 必须同时满足合同、真实服务端绑定、持久化、自动化测试和必要 UI 操作验证；
3. 只有 Schema 或静态页面时不得标记完成；
4. 每次完成里程碑后更新本文件的状态、复核命令和未完成项；
5. 详细工程事实继续写入 [`product-roadmap-and-progress.md`](product-roadmap-and-progress.md) 和 [`project-status-and-handoff.md`](project-status-and-handoff.md)；
6. 若产品决策变化，先更新本文件，再创建下一 Loop Prompt；
7. Live、自动替换、自动恢复或账户写入的范围变化必须由用户显式授权，不能从本规划自行推导授权。

## 15. 当前推荐下一步

```text
M0 恢复稳定基线和路由
-> M1 历史对话 V1
-> M2 数据中心 V1
-> M3 实验场 V1
-> M4 多模拟运行中心
```

完成 M4 后，TradeBot 将形成首个完整、仍保持 Paper Only 的产品闭环：

```text
管理数据
-> 对话编排动态 Agent
-> 历史实验验证
-> 多策略实时模拟
-> 运行审计与反思
-> 产生下一版候选
```

Shadow、Live、Champion 替换和自动化晋升属于后续独立安全阶段，不阻塞当前 Paper 产品价值的形成。
