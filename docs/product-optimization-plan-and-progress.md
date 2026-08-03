# TradeBot 产品优化规划与进度

> 2026-08-03：LOOP-044 F3 仍为 `IN_PROGRESS`。修复 Agent Center 分类切换未请求服务端 Catalog 的 hydration 缺陷；同一 `local:operator` 经受控 `dev:paper` 重启后，真实 Chrome 已恢复 Input、Analysis、Decision、Reflection Published entries。补齐 runtime 生命周期释放后，`npm run test:ts` 自然打印 `376/376` TAP 汇总并退出 0。中文已验证澄清、Published provenance/DAG、锁定 Portfolio → Risk Gate → Paper Execution 链与 legacy `PROVENANCE_UNAVAILABLE` 只读边界；完整 Apply→修改→reload/restart 和英文窄屏/focus/快速切换仍须由 LOOP-045 收尾。保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

> 2026-08-03：LOOP-032 已完成 F1 Agent Center V1：SQLite append-only 生命周期、服务端 Diff、Catalog、Clone lineage、Archive 和受限 deterministic 测试台均以 Bearer actor/精确版本 authority 持久化；不触发 Runtime 或交易写入。

> 2026-08-03：LOOP-038 F3 为 `IN_PROGRESS`：已补齐 Recommendation 精确 provenance、actor/scope-bound cursor API 及 restart/actor/负向自动化；真实 Chrome 仅经 Agent Center 生命周期发布 Analysis/Decision/Reflection test Agents。Web/API 重启会换发本地 Bearer actor，故历史恢复按隔离规则为空，无法完成同 actor 重启验收。下一步为 LOOP-039；保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

> 2026-08-03：LOOP-029 已完成预览后的功能化路线整理。后续固定按“Agent 中心版本基础 → 连接能力完善 → LLM 编排推荐 → 预上线与回测 → 最多三个真实模拟实例”逐步接入，M6 Live 继续暂停。

> 文档角色：汇总 2026-08-01 之前的产品讨论，作为后续产品优化、页面收敛和阶段验收的执行入口
> 最后更新：2026-08-03
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

TradeBot 的核心定位更新为：

> 用户先在 Agent 中心准备可复用、可版本化的输入、分析、决策与反思 Agent；编排工作台再通过自然语言理解需求、推荐动态 Agent Graph，并在用户确认后生成可验证、可回测、可审计、可受控运行的 Strategy Draft。

自然语言不是无约束的自由工作流编辑器。LLM 只能推荐 Agent 中心已有的明确版本，并返回结构化 `nodes + edges`；前端负责展示，服务端负责 Registry 解析、Schema 兼容、DAG、权限和成本校验。用户可以修改推荐并重新生成，也可以选择是否应用，但不能通过对话上传实现、执行代码或绕过固定安全节点。

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

数据输入、分析节点、Prompt、模型、观察窗口、上下文汇总和 Reflection 拓扑都可以形成新 Draft Version；Agent 自身配置在 Agent 中心版本化，Strategy Graph 在编排工作台版本化。任何修改都不能直接热更新正在运行的 Agent。

## 3. 目标产品闭环

```text
连接配置
  -> Agent 中心：配置 Agent Version
  -> 编排工作台：对话推荐 Dynamic DAG
  -> Immutable Strategy / Workflow Version
  -> Contract Validation
  -> Preflight / Backtest / Walk-Forward
  -> 模拟交易：最多三个 Paper Forward Test
  -> Shadow：真实环境旁路决策
  -> Human Approval / Canary
  -> Live Champion
  -> Runtime Audit / Trade Review / Reflection
  -> 新的 Strategy Candidate
```

目标不是让系统自动追逐短期收益最高的策略，而是持续发现“在当前目标、风险约束和证据范围内更好的 Challenger”，经过验证、灰度和人工审批后替换 Live Champion。

## 4. 已确认的四页信息架构

| 一级页面 | 回答的核心问题 | 主要内容 |
| --- | --- | --- |
| 模拟交易 | 哪几个策略正在模拟、表现和推理过程怎样 | 最多三个 Paper Strategy、收益曲线、回撤、最近决策、按轮次的子 Agent Artifact 对话、停止与详情 |
| 编排工作台 | 我的策略需求应使用哪些 Agent、如何连接 | 对话、澄清、动态 DAG 推荐、Agent Version 引用、应用 Strategy Draft、Preflight/Backtest 门槛 |
| Agent 中心 | 系统有哪些可复用 Agent、它们如何理解输入 | Input/Analysis/Decision/Reflection 四类，数据/上游、Model、用户 Prompt、Schema、测试和不可变版本 |
| 连接配置 | 数据与模型能力是否可用 | Data Source/Dataset、Model Provider/API、能力探测、健康状态和后端 Secret 引用 |

实验、审计、Data Asset 深度治理和 Runtime 运维能力不删除，但不占一级导航：Backtest/Walk-Forward 作为编排方案的验证步骤；Trace/Lineage 作为模拟详情；Data Asset 质量作为连接详情。页面关系遵循“默认简单、按需深入”。

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

状态：`COMPLETE`

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
- [x] 以共享严格 Schema 修复真实 UI Binding 的 `REQUEST_CONTRACT_INVALID`（根因：`idempotencyKey` 超过 160 字符）；
- [x] 完成 Binding → 刷新/重启恢复 → Composer 的 Agent Chrome Authority 闭环；
- [x] 完成真实 Chrome 的桌面、窄屏、绑定成功/拒绝和产品 Console 验收；Network 因 Agent Chrome 工具不提供读取能力，保持 `TOOL_UNAVAILABLE`，禁止人工替代。

验收：一个 Strategy Draft 可以引用服务端登记的数据版本，Validation 能阻止能力不匹配，回测 Evidence 能追溯 Dataset fingerprint。

进度：LOOP-017 已关闭 M2。根因是 Web `refreshHistory()` 重新从列表/localStorage 猜测 active conversation，且无 epoch guard 的旧 `loadConversation()` 可覆盖 `currentDraft`，不是服务端 Binding 写入或 Turn 排序错误。Binding 现对原 conversation 定向 read-after-write，并逐项核验 latest Draft/version/fingerprint 与 CSV binding；列表刷新不改变选择。服务端 newest-first 页以显式 oldest-to-newest 展示合并，Authority 始终取 newest item；A/B response、pending/result 以 conversation/binding epoch 隔离。Agent Chrome 完成中文 1440×900、英文 820×760、Binding、刷新、本项目服务重启、Composer `confidenceThreshold=0.72`、刷新、A/B 往返和无 Draft disabled 负向；Draft v3 保留 CSV preset/source/binding，Runtime 保持未应用。自动化 336/336 PASS；Network 为 `TOOL_UNAVAILABLE`。

### M3：实验场 V1

状态：`COMPLETE`

- [x] 恢复并重构 Agent Lab 为服务端权威实验场；
- [x] 从 actor-owned Strategy Version 创建实验；
- [x] 选择 2～5 个参与版本并严格拒绝 invalid/unsupported/stale；
- [x] 锁定 Dataset、时间、Execution、Risk 和 Model/Prompt 可得变量；
- [x] 展示有界净值、回撤和真实 Scorecard；
- [x] 展示服务端配置 Diff、changed/locked dimensions 和 Evidence lineage；
- [x] 完成 Backtest -> Walk-Forward -> Replay -> Candidate；
- [x] 不提供 Approval、Deploy、Paper Run 或 Runtime Apply。

验收：同一 Experiment 可重放并得到相同 fingerprint；比较条件不一致时明确标记 Open Class 或拒绝因果结论。

进度：LOOP-020 新增严格 Experiment contracts、actor-bound cursor、append-only definition/event、不可变 snapshot、可比性判定、真实约束、durable artifact Replay 与唯一第一名 Candidate。修复历史计划和 CSV 注册定义随进程时间漂移、Walk-Forward 派生幂等键超长、目录 eligibility 预检不完整，以及 1118 点净值文本导致的 DOM 膨胀。Agent Chrome 通过中文 1440×900、英文 820×760、Open Class/少于两名负向、两个差异策略的真实 Evidence、Candidate、刷新和服务重启恢复；Network 为 `TOOL_UNAVAILABLE`，仅观察到扩展自身消息通道错误。自动化为 353/353 PASS。

### M4：多模拟运行中心

状态：`COMPLETE`（LOOP-023）

- [x] 交易 Agent 顶部增加“模拟 / 真实”分段选择器；
- [x] 切换只改变视图，不影响后台 Runtime；
- [x] 支持多个独立 Paper Deployment 和虚拟账户；
- [x] Paper Overview 多曲线、共同区间、标准化收益和实例列表；
- [x] 最多选择 5 条曲线；真实视图明确不可用；
- [x] Paper Run Detail：表现、Agent 轨迹、交易、配置与数据、晋升评估；
- [x] 从 Strategy Version 经真实预检启动模拟；
- [x] 停止、close-only、归档、重启和健康状态；
- [x] Paper Execution Model 保留既有费用、滑点、市场约束和持久账户事实。

验收：至少两个策略能够并行持续运行且账户、Trace、Artifact 和曲线隔离；刷新页面不改变运行状态；详情可追溯到来源 Draft、数据和每笔交易。

进度：LOOP-023 将现有 Current Crypto Paper Binding 构造成 deployment/run/account scope；SQLite append-only projection 加入幂等 fact key、lease/fencing、心跳、退避和 active-only 重启恢复。真实 Agent Chrome 以不同 Strategy Version 创建并启动两个实例，确认独立账户、曲线、Artifact lineage 和持续周期；停止 A 触发受控 `close_long` 并终止，B 持续运行，随后 Web/API 重启后 B 恢复、A 不复活。中文 1440×900 与英文 820×760、刷新、五 Tab、Live unavailable/Exchange writes OFF 均通过；Network/清空 Console 为 `TOOL_UNAVAILABLE`，仅见 Chrome 扩展异步消息错误。全量测试通过，`tests-ts` 当前含 380 个 `test()` 用例。

### M5：Shadow 与晋升建议

状态：`COMPLETE`（LOOP-024；仅 Shadow 与只读晋升建议）

- [x] 定义独立、actor/deployment/run/cycle-scoped 的 append-only Shadow facts；
- [x] 从明确 M4 cycle/account snapshot 与 Artifact lineage 读取同源事实；
- [x] 注册只读 adapter，无 Execution Port，所有写入能力均为 false；
- [x] Champion/Challenger 同 scope 描述性对比；
- [x] 服务端版本化 Promotion Policy；
- [x] 仅产生 terminal、只读 Promotion Recommendation，不自动批准；
- [x] 显式记录 Shadow Divergence、Runtime Health、数据质量和证据缺口。

验收：Shadow 真实消费 M4 持久事实，任何路径均不写真实或 Paper 账户；数据、账户、Artifact 或版本漂移 explicit unavailable/stale 且 fail closed。LOOP-024 新增严格 contracts、SQLite 独立 `shadow_*` append-only 表、只读 GET/POST history API 与 M4 中心入口；客户端只提交 idempotency key 和 source run/cycle。自动化覆盖独立事实、零 M4 投影写入、actor/cursor 隔离、并发幂等、重启恢复、missing/stale/ambiguous 与 terminal recommendation。Agent Chrome 在中文 1440×900、英文 820×760 验证实际 M4 A/B 实例、快速切换、刷新和 Web/API 重启；Network 与 Console clear 均为 `TOOL_UNAVAILABLE`，可读取的 Console warning/error 为空。

### R0：Strategy App 产品预览框架

状态：`COMPLETE`（LOOP-026；`PROTOTYPE_ONLY / AWAITING_USER_PRODUCT_REVIEW`）

- [x] 新的产品导航：总览、策略助手、我的策略应用、Agent 中心、数据中心、实验场和交易中心；既有 M0～M5 hash 入口保持可达；
- [x] 策略助手提供三组 Sample 意图和带 Data / Agent / Risk / Assumption / Gap / Evidence boundary 的 Proposal；
- [x] “创建策略应用”只创建当前页面内存中的 `PROTOTYPE`，刷新后恢复 Sample，绝不物化后端版本；
- [x] Strategy App 详情提供七个只读 Tab，并将 Risk / Execution 明确显示为系统锁定；
- [x] Agent 中心将 Data Source / Dataset 与 Input Agent 分开，提供三类只读目录、搜索、筛选与详情；
- [x] Market Radar、实验场 handoff 和三槽位容量均为显式 `SAMPLE / NOT CONNECTED`，现有真实 Data Center、Experiment、Paper / Shadow 页面保留在其下；
- [x] 未来 Live Champion 仍为 `NOT AUTHORIZED`，产品预览固定 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

验收：新增纯状态测试覆盖最多三个 active simulation slot、第四个意图拒绝且 `runtimeCall=none`、Sample / Prototype 标签和页面内存创建。真实 Agent Chrome 已完成中文 1440×900 主路径及英文 820×760 七 Tab / 无横向滚动；Data Center、Experiment 与现有 Paper / Shadow 入口可达。Console clear 与 Network 读取不可用，记录为 `TOOL_UNAVAILABLE`；没有用户手工验收替代。

### R1：四页简化产品预览

状态：`COMPLETE`（LOOP-027；`PROTOTYPE_ONLY / AWAITING_USER_PRODUCT_REVIEW`）

- [x] 默认首页改为“模拟交易”，只显示最多三个模拟槽位、对比曲线、收益、回撤和最近决策；移除 Live 与真实交易入口；
- [x] “策略助手”和“我的策略应用”合并为“编排工作台”：自然语言需求、受约束推荐、四段 Agent 流程、应用方案和最近方案在同一页；
- [x] Agent 中心拆成输入、分析、决策、反思四类目录；
- [x] 数据中心与连接页面合并为“连接配置”，只保留数据源与模型 API 两个 Tab；
- [x] 旧总览、实验场、审计、复杂 Runtime 控制和 Outbox Monitor 退出普通用户一级界面；后端实现和安全合同未删除；
- [x] 应用方案只生成当前页面内存 `PROTOTYPE`，`runtimeApplied=false`、`exchangeWriteAllowed=false`。

验收：Agent Chrome 在中文 1440×900 验证模拟首页与应用方案，在中英文 820×760 验证四类 Agent、数据源/模型切换和无横向滚动；Console error 为 0。`npm run check`、受影响预览测试 2/2、`npm run build:web` 和 `git diff --check` 通过。完整测试套件仍有既有 `orchestration-copilot` 异步 SQLite 关闭问题，不将其伪报为本轮全绿；本轮未修改该后端测试链。

### R1.1：模拟与编排对话面

状态：`COMPLETE`（LOOP-028；`PROTOTYPE_ONLY / AWAITING_USER_PRODUCT_REVIEW`）

- [x] 从历史实现恢复子 Agent Artifact 对话的核心表达：轮次、生成时间、回复上游、发送下游、成功/降级；
- [x] 模拟页底部可在两个运行策略间切换各自的 Agent 对话；
- [x] 编排工作台取消固定右侧流程，以单一聊天线程承载用户需求、助手推荐和动态 Agent 拓扑；
- [x] 不同策略返回不同的 Agent 数量、分支和汇聚关系，修改自然语言后追加新的推荐，而不是改写一张固定图；
- [x] 应用方案后显示预上线检查、回测、模拟槽位三个门槛，但全部保持 Preview Pending；
- [x] 所有行为仍为页面内存 Sample/Prototype，`runtimeApplied=false`、`exchangeWriteAllowed=false`。

验收：Agent Chrome 在 1440×900 完成 Simulation Dialogue、Workbench 动态 Crypto 推荐与 Apply，在 820×760 验证零横向溢出和 US Earnings Dialogue 切换；Console error 0。自动化与构建通过，未新增后端、持久化、LLM 或 Runtime 调用。

### F1：Agent 中心 V1——可版本化配置

状态：`IN_PROGRESS`（下一步 LOOP-032）

目标：把当前 Sample Catalog 变成四类 Agent 的真实管理与版本中心，并优先复用已有 Registry、Configuration Draft、Model Adapter 与 Dataset 事实。

- [x] 定义 `AgentDefinition` 与不可变 `AgentVersion`，覆盖 Input、Analysis、Decision、Reflection 四类；Input/Analysis 可创建，Decision/Reflection 保持 Planned；
- [ ] 每个版本精确绑定 Agent Template、数据或上游 Artifact、Model Connection Ref、Prompt Bundle、输入/输出 Schema、工具权限、预算和 fingerprint；
- [ ] Input Agent 将确定性 Connector/Normalizer 与可编辑语义解读 Prompt 分开，禁止 LLM 改写原始事实；
- [ ] 用户可编辑层显示为 System Prompt，但平台安全规则、工具权限、输出 Schema、Risk/Execution 边界保持系统锁定；
- [x] Prompt 修改、模型修改、数据源修改或上游合同修改都创建新 Draft Version，不能覆盖 Published/Running Version；v2 要求精确 parent `versionId + fingerprint`；
- [x] Agent 详情提供服务端权威概览、数据/上游、模型、可编辑行为 Prompt、锁定 System Prompt 边界、Schema/测试台状态与版本历史；
- [ ] 支持创建、克隆、保存 Draft、校验、发布到 Catalog 和归档；不支持动态上传代码或 Adapter。

LOOP-030/031 已完成真实版本合同、Repository/API、Input/Analysis v1→v2、服务端 authority、历史、持久幂等和重启恢复。LOOP-032 只补测试台、版本 Diff、校验/发布/克隆/归档、四类 Agent 真实边界、SQLite 测试资源释放和 Chrome 收尾。每轮有修改都提交、推送，但只有真实持久化、恢复、隔离和 UI 全链均通过时 F1 才能标记 `COMPLETE`。

浏览器要求：实现后必需，由 Agent 直接操作真实 Chrome；文档和纯合同中间轮可标记 `NOT_REQUIRED`，但不能据此关闭 F1。

### F2：连接配置 V1——数据与模型能力

状态：`COMPLETE`（LOOP-033/034）

- [x] 数据连接显示 Provider、Market、Capability、Schema、Observation Window、历史覆盖、实时性、质量与 Dataset Snapshot；
- [x] 模型连接显示 Provider、Model、Base URL 类型、JSON/Tool 能力、上下文窗口、限流、成本预算和健康状态；
- [x] Secret 只在后端安全存储或引用，任何 GET、日志、浏览器 Storage、Artifact 和 Prompt 都不得返回 Secret value；
- [x] 提供连接测试、能力探测、禁用和影响范围，已被 Agent Version 引用的连接不能静默删除；
- [x] Agent 中心选择的是 Connection/Dataset 的稳定 ID 与版本，不复制凭证或自由 URL。

依赖：复用 M2 Data Asset/Capability 事实和现有 Model Provider 配置；不建立第二套 Dataset 或 Secret 模型。浏览器要求：实现后必需。

### F3：编排工作台 V2——真实 LLM 推荐动态 DAG

状态：`IN_PROGRESS`（下一步 LOOP-044）

- [ ] 用户自然语言先产生结构化 Strategy Intent；需求不完整时只返回澄清问题，不强行编排；
- [ ] LLM 通过注册 Tool/Structured Output 返回说明、`nodes`、`edges`、假设、缺口和推荐理由，不返回 HTML；
- [ ] 所有节点必须引用 F1 已发布的精确 Agent Version，禁止发明 Agent、Prompt、Model、Data Source 或实现；
- [ ] 支持一对多、多对一、并行分支和汇聚，例如 K 线 → 短/中/长周期，新闻 → 情绪，全部汇入 Decision；
- [ ] 服务端校验 DAG 无非法环、Artifact Schema 兼容、数据能力可达、必需输入完整、并发/Token/成本有界；
- [ ] Portfolio、Risk Gate、Paper Execution 是系统补齐并锁定的动作链，LLM 不能删除、绕过或重排；
- [ ] 前端把结构化结果渲染为当前对话内动态拓扑；窄屏降级为明确的上游/下游列表；
- [ ] “应用此方案”创建不可变 Strategy Draft 和完整 Agent/Data/Model/Prompt fingerprints，不启动 Runtime。

依赖：F1 Agent Version Catalog；模型能力来自 F2。浏览器要求：实现后必需。

### F4：预上线检查与历史验证

状态：`PLANNED`

- [ ] Preflight 检查 Agent/Graph/Data/Model/Prompt/Schema/Tool/预算与固定安全链；
- [ ] 验证失败返回稳定 issue code、具体节点和修复建议，绝不自动降级为可运行；
- [ ] 通过后复用现有 Backtest、Walk-Forward、Experiment Evidence 和 Replay，不建立第二套回测系统；
- [ ] 对话中的方案卡展示门禁状态、Evidence lineage、版本 Diff 和 stale；
- [ ] Prompt、Agent、Dataset、Graph、Execution Model 任一变化都会产生新 fingerprint 并使旧 Evidence stale；
- [ ] 验证结束仍是 `runtimeApplied=false`，用户另行选择是否加入模拟槽位。

依赖：F3 的真实 Strategy Draft。浏览器要求：实现后必需。

### F5：模拟交易 V2——接回真实 M4 Runtime

状态：`PLANNED`

- [ ] 只有 F4 合格的 Strategy Version 才能申请模拟槽位；
- [ ] 同一 actor 最多三个 active Paper Deployment，超过上限服务端 fail closed，而非仅前端禁用；
- [ ] 每个实例绑定独立 Strategy/Data/Model/Prompt/Execution fingerprints、虚拟账户、预算、调度与 Token 使用上限；
- [ ] 复用 M4 deployment/run/account/lease/fencing/close-only/restart recovery，不创建第二套模拟 Runtime；
- [ ] 收益曲线、回撤、交易、风险和每轮子 Agent 对话读取真实 cycle/artifact projections；
- [ ] Artifact 对话必须按显式 lineage 展示轮次、时间、上游、并行分支、汇聚与下游，不用 DOM 顺序推断因果；
- [ ] 停止一个实例不影响其他实例；刷新和 Web/API 重启后恢复；页面始终没有 Live 或交易所写入口。

依赖：F4 合格版本和现有 M4。浏览器要求：实现后必需。

### F6：功能收敛与运营护栏

状态：`PLANNED`

- [ ] Token、调用次数、延迟和模型错误按 Agent/Run 可见并有硬预算；
- [ ] Agent Version、Strategy Version、Run、Artifact 和 Evidence 可从四页互相追溯；
- [ ] 统一 loading/empty/error/stale/permission 状态、中英文、键盘焦点和窄屏；
- [ ] 清理 Sample 与真实事实混排，真实未接通时明确 unavailable，不补造数据；
- [ ] 建立页面性能、最大节点数、最大 Artifact 数和长对话分页护栏。

F6 是四页真实功能闭环的关闭阶段，不包含 M6 Live。

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
-> M3 实验场 V1（COMPLETE）
-> M4 多模拟运行中心（COMPLETE：LOOP-023）
-> M5 Shadow 与晋升建议（COMPLETE：LOOP-024）
-> R0 Strategy App 产品预览框架（COMPLETE：LOOP-026）
-> R1 四页与对话面预览（COMPLETE：LOOP-027 / LOOP-028）
-> F1 Agent 中心 V1（NEXT：LOOP-030）
-> F2 连接配置 V1
-> F3 编排工作台 V2
-> F4 预上线检查与历史验证
-> F5 模拟交易 V2
-> F6 功能收敛与运营护栏
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

用户已经确认四页与动态 DAG 方向，可以从 F1 开始逐模块功能化。M6 的 Live、Canary、Champion 替换和任何自动化晋升仍属于独立安全阶段；完成 F1～F6 不能被解释为 Live 授权，也不得恢复 LOOP-025。
