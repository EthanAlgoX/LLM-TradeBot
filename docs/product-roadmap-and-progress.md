# TradeBot 产品路线图与实施进度

> 状态日期：2026-07-26  
> 文档角色：当前产品范围、实施顺序、完成度和验收标准的统一入口  
> 产品定位：跨市场、可编排、可回测、可审计、可受控进化的 Human-in-the-loop Multi-Agent 交易系统

## 1. 文档使用约定

本文件负责回答四个问题：

1. TradeBot 最终要形成什么产品能力。
2. 当前仓库已经具备什么，哪些只是局部实现。
3. 后续阶段应按什么依赖顺序推进。
4. 每个阶段达到什么标准才算完成。

状态定义：

| 状态 | 含义 |
| --- | --- |
| 已完成 | 已有可运行代码和自动化测试，且已接入当前组合根或明确可被调用 |
| 部分完成 | 已有合同、局部实现或固定路径，但尚未形成完整产品闭环 |
| 计划中 | 已确定边界和依赖，尚未实现 |
| Mock | 仅用于界面表达或接口占位，不代表 Runtime 已支持 |
| 暂缓 | 当前已有足够基础，不应继续抢占产品主线优先级 |

文档优先级：

1. `PRODUCT.md` 定义长期产品原则和不可突破的安全边界。
2. `docs/architecture-and-delivery-plan.md` 保存架构推导和交付历史。
3. 本文件定义当前阶段的实施顺序与完成度。
4. `docs/project-status-and-handoff.md` 保存最近一次可继续开发的工程交接信息。
5. 其他专题文档说明具体模块，不单独改变路线图优先级。

## 2. 已重新对齐的产品需求

### 2.1 市场配置

TradeBot 需要允许用户基于后端已注册能力创建不同市场的配置草案，包括 Market Pack、交易日历、时区、标的规则、Data Source、Observation Window、Agent Template 和风险约束。

“自由配置市场”不等于客户端可以注入任意代码、模块、Provider、URL、SQL、文件路径或交易所写接口。所有可执行能力必须由后端预先实现、注册、版本化并经过合同校验。

### 2.2 Agent 编排

用户需要能够针对不同市场编排单周期、双周期、任意多周期或完全事件驱动的 Multi-Agent Pipeline。

Pipeline 不得写死固定拓扑，也不得把 5m、15m、1h 当成系统级约束。默认 Crypto Preset 可以继续声明当前真实支持的 5m、15m、1h，但其他 Preset 应由 Data Source Capability 和 Agent 合同决定可用窗口。

系统应提供从旧 LM Multi-Agent 系统迁移而来的预设方案。当前固定 Crypto Pipeline 已有等价 Graph Manifest，但“旧系统语义交接行为的完整迁移”仍未完成，不能把 Graph 外形等价当成行为等价。

### 2.3 语义交接

旧 LM Multi-Agent 系统的关键不是简单数值信号，而是受控的语义交接：

1. DataSync 提供完整、结构化、带 lineage 的 K 线或事件数据。
2. 数据按 Observation Window 分发给对应的 Analysis Agent。
3. 每个 Agent 对自己的窗口输出自然语言判断，同时附带可验证的结构化字段和证据引用。
4. Bull、Bear 或其他研究 Agent 继续输出带立场、信心和证据的语义判断。
5. Decision 汇总所有 Agent 判断、已批准反思经验、当前持仓、Portfolio 状态、Risk 预算、Data Quality 和 lineage，形成综合决策。
6. 只有 Decision → Portfolio → Risk → Execution 可以形成执行动作。

语义内容必须装在严格合同中。系统既不能把语义压缩成单一分数，也不能允许没有 Schema、证据和 lineage 的任意文本在执行链路中传播。

### 2.4 策略与回测

完整回测能力最终必须以“已版本化、已校验、已编译的 Pipeline Graph”为运行对象，而不是只支持当前固定 DecisionPipeline。

回测、Walk-Forward 和 Paper Running 必须使用同一组核心 Agent 合同、语义 Artifact、Decision 边界、Portfolio/Risk 规则和数据闭合原则。允许执行环境不同，但不得出现回测路径绕开 Runtime 风险边界的情况。

### 2.5 对话式操作

Copilot 最终应通过后端工具完成以下受控操作：

- 创建或修改策略 Draft。
- 选择已注册 Market Pack 和 Data Source。
- 配置 Observation Window。
- 选择已注册 Agent Template 并创建 AgentConfig Draft。
- 修改允许编辑的 Prompt、策略参数、阈值、权重和依赖关系。
- 发起 Contract Validation、Backtest 和 Walk-Forward。
- 汇总验证错误和证据结果。
- 提交 Human Approval。

Copilot 不能动态执行任意代码，不能直接修改运行中的 Pipeline，不能直接下单，不能绕过 Risk，不能把 Draft 表现为已部署状态。

### 2.6 Reflection

Reflection 只允许在交易后产生 `Lesson Candidate`。Candidate 应包含失败交易引用、语义经验、失败模式、适用市场或 regime、置信度、证据和生命周期状态。

未经人工批准的 Candidate 不得进入 Decision Context。Reflection 不得直接修改 Decision Prompt、Agent 权重、仓位、Risk 参数或运行中的 Pipeline。

## 3. 当前进度总览

### 3.1 已完成的基础能力

| 能力 | 状态 | 当前实现 |
| --- | --- | --- |
| 架构合同 | 已完成 | Market Pack、Data Source、Capability、Observation Window、Data Lineage、Agent Template/Config、Pipeline Graph 及验证结果均已有 Zod 合同 |
| Pipeline Graph Validator | 已完成 | 覆盖节点/边、Schema、市场、数据源、窗口能力、聚合方向、必需输入、悬空节点、循环、权限边界和 Required/Optional/Fallback |
| Data Source Capability | 已完成 | Binance Futures Public 与 CSV Historical Source 可声明真实能力 |
| 当前 Crypto Graph Manifest | 已完成 | 已描述 Selector、DataSync、DataQuality、Analysis、Bull/Bear、Decision、Portfolio、Risk、Execution、Position Monitor、Reflection |
| Graph Registry 与 Compiler | 已完成 | 后端注册、版本化 Draft、校验、编译和受控 promotion gate 已具备 |
| Draft 持久化与 HTTP | 已完成 | SQLite Draft、严格请求校验、Bearer Auth 和服务端身份派生已具备 |
| 固定路径历史证据 | 已完成 | CSV Backtest、Walk-Forward、Evidence Job 和 Artifact Ledger 已具备 |
| Paper Plan 与 Runtime Safety | 已完成 | 审批、激活、preflight、lease、heartbeat、fencing、stop/drain、incident/orphan clearance 已具备 |
| 运维事件交付 | 已完成 | SQLite Outbox、注册 Dispatcher、重试、Dead Letter、JSONL Audit Sink、定时 Worker 已具备 |
| 审计保留 | 已完成 | Retention Preview、Immutable Export Manifest、受控清理和 Tombstone 已具备 |

### 3.2 部分完成的产品能力

| 能力 | 状态 | 缺口 |
| --- | --- | --- |
| 多市场配置 | 部分完成 | 合同和 Market Pack 抽象已存在，真实可运行市场仍主要是 Crypto；尚无完整的市场创建、验证、证据和启用闭环 |
| 按市场编排 Agent | 部分完成 | Template、Config、Graph、Validator、Registry、Compiler 已存在；任意编译 Graph 尚不能执行 |
| 旧 LM Preset 迁移 | 部分完成 | 当前固定 Crypto Pipeline 已有等价 Graph 外形；语义 Artifact、Prompt/策略映射和行为一致性测试尚未完成 |
| 完整回测 | 部分完成 | 固定 Pipeline 的 CSV 回测与 Walk-Forward 可运行；任意 Graph Backtest 尚未实现 |
| Reflection | 部分完成 | 当前固定链路可生成反思报告；通用 Lesson Candidate、审批和 Decision Context 注入尚未形成合同闭环 |
| Web 系统编排 | 部分完成 | 已能展示当前 Graph、Capability、门禁和运维状态；市场/Agent 编辑、语义 Artifact 检视和真实 Copilot 工具闭环尚未完成 |
| Agent 策略修改 | 部分完成 | Draft 和模板基础已存在；Prompt/Policy 合同、差异审阅、证据绑定与审批工具尚未完成 |

### 3.3 尚未形成闭环的核心能力

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 通用语义 Artifact 合同 | 计划中 | 尚无统一的 Market Observation、Agent Semantic Assessment、Decision Semantic Context 和 Semantic Decision Artifact |
| 通用 Graph Executor | 计划中 | Compiler 输出尚不能由受控 Executor 按 DAG 和 typed artifact 执行 |
| 任意 Graph Backtest | 计划中 | 尚不能把版本化 Graph 作为回测和 Walk-Forward 的统一执行对象 |
| 对话式策略工具 | 计划中 | Copilot 尚不能通过注册工具创建 Draft、校验、回测、提交审批 |
| 多市场真实 Adapter | 计划中 | A 股、港股、美股等仍只有架构方向，没有真实 Market Pack、Connector 和数据证据 |
| 通用 Graph Paper Runtime | 计划中 | 当前 Paper Runtime 仍绑定固定 Crypto DecisionPipeline，不应在历史执行与证据链成熟前泛化 |

## 4. 当前优先级纠偏

Runtime Safety、Outbox、Dispatcher、Worker、Audit Export 和 Retention 已经提供了足够的受控运行基础。除非发现阻断主线的安全缺陷，近期不再继续扩展通知渠道、运维控制台或额外保留策略。

接下来必须优先完成以下产品主链：

`语义 Artifact → 旧 LM Preset 行为迁移 → Historical Graph Executor → 任意 Graph Backtest/Walk-Forward → Market/Agent Draft API → Copilot Tool Loop → Web 完整编排体验`

依赖关系如下：

| 前置能力 | 解锁能力 |
| --- | --- |
| 语义 Artifact | 可审计的 Agent 交接、Reflection Lesson、Decision 汇总 |
| Preset 行为迁移 | 当前固定系统与新 Graph 模型之间的兼容基准 |
| Historical Graph Executor | 任意 Graph 单次历史决策运行和 NodeRun 证据 |
| Graph Backtest | 策略修改的统一证据门禁 |
| Draft API | Copilot 和 Web 的安全编辑入口 |
| Copilot Tool Loop | 对话式配置、修改、校验和回测 |
| 完整证据链 | 通用 Graph Paper Runtime 的安全启用 |

## 5. 目标架构分层

### 5.1 Market 层

- `MarketPackDefinition`：市场规则、交易日历、时区、标的约束和兼容 Schema。
- `DataSourceDefinition`：数据提供者身份和生命周期。
- `DataSourceCapability`：真实可用的数据类型、原生窗口和允许聚合能力。
- `Connector`：负责连接外部或本地数据源，不承担策略处理。
- `Processing Agent`：负责清洗、校验、聚合、特征和 lineage，不伪造源数据能力。

### 5.2 Agent 与 Artifact 层

建议新增以下核心合同：

| 合同 | 责任 |
| --- | --- |
| `MarketObservationArtifact` | 保存完整结构化 OHLCV、事件批次或报告期数据，以及 asOf、日历、时区和 lineage |
| `SemanticEvidenceReference` | 引用输入 Artifact、指标、时间区间、事件或其他可验证证据 |
| `AgentSemanticAssessment` | 保存 Agent 的语义判断、方向、信心、regime、证据、失效条件和风险标记 |
| `ReflectionLessonCandidate` | 保存 Reflection 产生但尚未批准的经验 |
| `ApprovedReflectionLesson` | 保存经人工批准、允许进入 Decision 的版本化经验 |
| `DecisionSemanticContext` | 汇总多个窗口判断、研究判断、Approved Lessons、持仓、Portfolio、Risk、Data Quality 和 lineage |
| `SemanticDecisionArtifact` | 保存 Decision 的语义结论、行动意图、信心、证据和约束，不直接等同于订单 |
| `GraphExecutionRun` | 保存一次编译 Graph 的执行身份、输入、计划版本、状态和结果 |
| `GraphNodeRun` | 保存节点输入输出 Schema、Artifact fingerprint、lineage、状态和稳定错误码 |

`AgentSemanticAssessment` 至少应包含：

- `agentConfigId`
- `observationWindowId`
- `direction`
- `confidence`
- `regime`
- `semanticThesis`
- `supportingEvidence`
- `invalidationConditions`
- `riskFlags`
- `sourceArtifactRefs`
- `lineageFingerprint`
- `schemaVersion`
- 稳定 ID、版本、生命周期和创建时间

### 5.3 Graph 执行层

Graph Executor 只能执行 Compiler 产出的、引用已注册实现的 execution plan。

Executor 必须：

- 按 DAG 拓扑执行节点。
- 按合同传递 typed artifacts。
- 实现 Required、Optional、Fallback 语义。
- 为每个 NodeRun 记录输入、输出、fingerprint、lineage 和稳定错误码。
- 对 Schema、lineage、窗口、市场或实现不匹配执行 fail closed。
- 拒绝客户端提交模块、代码、Provider、URL、SQL、文件路径或未注册 Prompt 执行器。
- 保持 Decision → Portfolio → Risk → Execution 唯一动作链路。
- 保持当前 Position Monitor 对现有持仓的处理。

### 5.4 Evidence 与 Promotion 层

所有可运行策略版本继续遵守：

`Draft → Contract Validation → Backtest → Walk-Forward → Human Approval → Paper Running`

每一步必须引用同一个 Graph Version fingerprint，或保存可审计的父子版本关系。任何 Graph、AgentConfig、Prompt、风险参数或 Market Pack 的实质变化都必须使旧证据失效。

### 5.5 Copilot 层

Copilot 只调用后端注册工具，不拥有运行时代码执行权。

第一组工具建议为：

| 工具 | 作用 |
| --- | --- |
| `list_market_packs` | 获取已注册市场能力 |
| `list_data_sources` | 获取真实数据能力和窗口 |
| `list_agent_templates` | 获取可用 Agent 模板及输入输出 Schema |
| `create_pipeline_draft` | 创建结构化 Graph Draft |
| `update_agent_config_draft` | 修改允许编辑的 Prompt/Policy/参数 |
| `validate_pipeline_draft` | 运行合同和 Graph Validator |
| `start_graph_backtest` | 针对确定 Graph Version 发起历史证据任务 |
| `start_walk_forward` | 发起 Walk-Forward 任务 |
| `summarize_evidence` | 获取结构化证据摘要，不重写证据 |
| `submit_for_approval` | 提交人工审批，不自动批准 |

## 6. 后续里程碑

### M1：语义 Artifact 与 Preset 行为基线

状态：下一阶段，最高优先级。

交付内容：

- 新增 Market Observation、Semantic Assessment、Decision Context、Decision Artifact、Lesson Candidate 和 Approved Lesson 的严格 Zod 合同。
- 提供当前固定数据结构到新 Artifact 的兼容映射，不破坏 `MultiTimeframeSnapshot` 和现有 Adapter。
- 将当前 Crypto Multi-Agent 系统注册为正式 Preset，明确其默认 5m、15m、1h 只是当前数据能力，不是框架约束。
- 增加至少一个 daily 单周期 Preset 和一个 event-only research Preset，用于证明合同没有写死 K 线或固定周期。
- 明确 Selector、Position Monitor、Reflection 和 Decision 的语义输入输出。
- Reflection 只产生 Lesson Candidate；测试证明未批准 Candidate 不进入 Decision，Approved Lesson 可以进入。

验收标准：

- 多个 Observation Window 的完整结构化数据能映射为独立 Agent 输入。
- 每个 Agent 输出可读语义判断和结构化证据字段。
- Decision Context 能汇总多窗口语义、Bull/Bear、Approved Lessons 和 Portfolio/Risk 状态。
- 所有 Artifact 均有稳定 ID、Schema、fingerprint、版本、状态、时间和 lineage。
- 当前固定 DecisionPipeline 行为不变。

明确不做：

- 不在本阶段替换当前 Paper Runtime。
- 不允许任意 Prompt 或代码注入。
- 不宣称 A 股、港股、美股已经可运行。

### M2：Historical Graph Executor

状态：依赖 M1。

交付内容：

- 实现受控、可重放的 Historical Graph Executor。
- 仅执行已注册 Node Executor 和 Compiler 产出的 plan。
- 实现 DAG、typed artifacts、Required/Optional/Fallback 和稳定错误码。
- 将当前固定 rule-based 或受限 LLM Agent 绑定为注册 executor。
- 支持对一个 historical `asOf` 执行完整 Graph decision cycle。
- 复用当前 Portfolio、Risk 和 Simulated Execution，不复制另一套风险规则。
- 保存 GraphExecutionRun、GraphNodeRun 和 Artifact lineage。

验收标准：

- 当前 Crypto Preset 可对 CSV 历史数据完成一次完整 decision cycle。
- daily 单周期 Preset 可运行。
- event-only research Preset 可运行到研究输出；若无 Decision/Execution 权限则不得产生动作。
- 未注册 executor、Schema 不匹配、lineage 不完整和未来数据全部 fail closed。
- Required 失败会阻断，Optional 失败可记录后继续，Fallback 只能使用合同声明的后备节点。
- 决策动作必须经过 Portfolio 和 Risk。

### M3：任意 Graph Backtest 与 Walk-Forward

状态：依赖 M2。

交付内容：

- 以版本化 Graph 为回测对象，为每个 historical `asOf` 调用同一个 Graph Executor。
- 复用 CSV Historical Source 和现有数据闭合逻辑。
- 将 NodeRun、Decision、Risk、Fill、Portfolio 和 Reflection Artifact 写入证据账本。
- 支持 Walk-Forward split、训练窗口、验证窗口和样本外证据。
- Graph、AgentConfig、Prompt、Market Pack、Data Source Capability 变更触发证据失效。
- 提供受控 HTTP Job API 和幂等键。

验收标准：

- 当前 Crypto Preset Graph Backtest 与现有固定回测在明确容差内一致。
- 单周期 daily、多周期和 event-only Graph 均有对应测试。
- 防未来数据测试覆盖 Observation、Agent Artifact、Reflection Lesson 和 Portfolio 状态。
- Backtest 和 Walk-Forward 结果可以直接用于 Promotion Gate。
- 客户端不能提交执行模块、任意路径、URL、代码或 actor 身份。

### M4：Market、Agent 与 Strategy Draft API

状态：依赖 M1，可与 M3 后半段有限并行。

交付内容：

- Market Pack Catalog、Data Source Catalog、Agent Template Catalog 和 Preset Catalog。
- Market Configuration Draft、AgentConfig Draft、Prompt/Policy Draft 和 Pipeline Draft。
- 版本差异、fingerprint、合同验证、证据失效提示和审批状态。
- 新市场接入清单，明确 Market Pack、Connector、Capability、Calendar、Schema、Risk Profile 和测试要求。

验收标准：

- 用户可使用后端注册项组装不同市场草案。
- 用户可修改允许编辑的 Agent Prompt、Policy 和参数。
- Draft 不会修改运行中的 Graph。
- 所有变更均产生版本、审计和稳定验证错误。

### M5：Copilot Tool Loop

状态：依赖 M3 和 M4。

交付内容：

- 将 Catalog、Draft、Validation、Backtest、Walk-Forward 和 Approval 暴露为注册工具。
- 对话能够把自然语言意图转换为结构化 Draft patch。
- Copilot 展示影响范围、验证错误、证据缺口和下一门禁。
- 高影响动作要求明确的人类确认。

验收标准：

- “把日线 Agent 的趋势判断改为更保守”只生成可审阅 Draft。
- “接入某市场”只生成缺失能力清单或使用已注册 Market Pack，不伪造 Adapter 已存在。
- “增加新闻 Agent”只能选择已注册模板和兼容 Data Source。
- Copilot 不能直接批准、激活、下单、改 Risk 或修改运行中 Pipeline。

### M6：Web 系统编排工作区完善

状态：依赖 M4；M5 完成后接入真实 Copilot。

交付内容：

- 左侧 Catalog：Market、Data Source、Agent Template 和 Preset。
- 中间稀疏 Canvas：Graph、分支、Observation Window、Draft 和门禁。
- 右侧 Inspector：节点配置、语义合同、差异、验证错误和 Copilot Draft。
- 单独的 Evidence 视图：Backtest、Walk-Forward、NodeRun lineage 和 Artifact。
- 单独的 Lesson Review：Candidate 审阅、批准、拒绝和适用范围。

验收标准：

- 中英文模式内容完整且语义一致。
- Draft、Validated、Backtested、Approved、Paper Running 状态不会混淆。
- 原生与派生窗口、Data Lineage、Schema 错误和权限边界可被理解。
- 桌面和较窄笔记本无明显溢出、遮挡、密集小字或不可读内容。
- 无 Runtime API 的部分必须明确标记 Mock。

### M7：第二个真实市场垂直切片

状态：依赖 M3 和 M4。

选择原则：

- 优先选择有合法、稳定、可测试历史数据源的市场。
- 必须先实现 Market Pack、Calendar、Capability、Connector、Schema、Risk Profile 和历史证据。
- 不从日线伪造分钟数据。
- 不接入交易所写接口。

验收标准：

- 第二市场能使用同一个 Graph Executor、Backtest、Walk-Forward、Draft 和 Approval 流程。
- 市场特有规则位于 Market Pack，不散落进通用 Agent 或 Web。
- 通过跨市场兼容性和隔离测试。

### M8：通用 Graph Paper Runtime

状态：后置阶段。

只有当 M1 至 M7 的合同、历史执行、证据、Draft 和审批闭环稳定后，才将 Paper Runtime 从固定 Crypto DecisionPipeline 泛化为受控 Graph Runtime。

验收标准：

- 只运行已批准 Graph Version 和完全匹配的证据 fingerprint。
- 保持 lease、heartbeat、fencing、stop/drain、incident、outbox、audit 和 retention 行为。
- 保持“暂停新开仓 / 仅允许平仓”为唯一立即生效的人工风险控制。
- 任何配置变更都创建新版本，不热改运行实例。

## 7. 近期三个开发 Loop

### Loop A：Semantic Contracts + Presets

目标：先把旧 LM Multi-Agent 的语义交接变成系统一等合同，并建立行为迁移基线。

主要测试：

- 多窗口完整结构化输入。
- 多 Agent 语义输出。
- Bull/Bear 汇总。
- Approved Lesson 注入。
- 未批准 Candidate 拒绝。
- daily 单周期。
- event-only。
- Schema 和 lineage mismatch fail closed。
- 当前 Crypto Preset 合同通过。

### Loop B：Historical Graph Executor

目标：让 Compiler 产出的注册 Graph 完成一次可审计历史决策运行。

主要测试：

- DAG 顺序。
- Required/Optional/Fallback。
- 未注册 executor 拒绝。
- 稳定 NodeRun 错误。
- CSV 防未来数据。
- Decision → Portfolio → Risk → Simulated Execution。
- Position Monitor 继续接收当前持仓。
- Reflection 只输出 Candidate。

### Loop C：Graph Backtest + Walk-Forward

目标：把任意已验证 Graph 变成可重复回测、可做样本外验证、可进入 Promotion Gate 的版本化策略。

主要测试：

- 当前 Crypto Preset 回测。
- daily 单周期回测。
- 多周期回测。
- event-only research 回测。
- fingerprint 变更导致证据失效。
- 防未来数据。
- 幂等 Job。
- HTTP 注入拒绝。

## 8. Web 信息架构

Web 不应把所有配置同时铺满屏幕。推荐保持三栏核心结构并使用渐进展开：

| 区域 | 默认展示 | 深入操作 |
| --- | --- | --- |
| 左侧 Catalog | 当前市场、Preset、Data Source、Agent Template | 搜索、筛选、Capability 和兼容性 |
| 中间 Canvas | 稀疏 Graph、主执行链、研究分支、后处理分支 | Window、Schema、lineage 和门禁覆盖层 |
| 右侧 Inspector | 当前节点摘要和关键配置 | Prompt/Policy Draft、验证、证据、版本差异和 Copilot |

必须明确展示：

- 当前固定 Crypto Preset。
- 单周期、多周期和 event-only Preset。
- Data Source 原生窗口和允许派生窗口。
- Agent Semantic Assessment 与 Decision Context。
- Lesson Candidate 是否批准。
- Draft 与 Runtime 的隔离。
- Backtest、Walk-Forward 和 Approval 门禁。
- Schema、周期、市场和权限不兼容错误。

## 9. 安全与治理不变量

以下约束不是路线图待办，而是所有阶段必须持续满足的不变量：

1. Pipeline 默认支持 Multi-Agent，但拓扑和窗口不得写死。
2. Data Source 决定粒度，日线不能反向生成 5m。
3. 细粒度到粗粒度聚合必须记录 lineage、转换版本、时区和交易日历。
4. Data Provider、Connector 和 Processing Agent 分层。
5. 市场规则通过 Market Pack 隔离。
6. Agent 和执行器只能由后端预注册。
7. Copilot 只创建结构化 Draft。
8. Decision、Portfolio、Risk、Execution 是唯一动作链路。
9. LLM 不直接下单、不绕过 Risk、不修改运行中 Pipeline。
10. 所有策略变化必须经过验证、回测、Walk-Forward、人工审批和 Paper Running。
11. Reflection 只能创建 Lesson Candidate。
12. 唯一立即生效的人工风险控制是暂停新开仓或仅允许平仓。
13. 不接入 Binance 或其他交易所写接口。
14. Selector `topN=1` 行为保持不变，`--symbols` 仍只表示候选池。
15. 当前持仓继续进入 Position Monitor。

## 10. 质量门禁

每个实现 Loop 完成后必须运行：

- `npm run check`
- `npm run test:ts`
- `npm run build:web`
- `git diff --check`

如果修改 Web 且环境具备可控浏览器，还必须检查：

- 宽桌面。
- 较窄笔记本。
- 中文。
- 英文。
- 无明显溢出、遮挡、过密文字和不可读小字。

如果浏览器不可用，必须在交接中明确记录未完成视觉验证，不能声称已验证。

## 11. 最近验证基线

最近一个已完成实现 Loop 的验证结果：

| 命令 | 结果 |
| --- | --- |
| `npm run check` | 通过 |
| `npm run test:ts` | 通过，130/130 |
| `npm run build:web` | 通过 |
| `git diff --check` | 通过 |
| 浏览器视觉检查 | 未执行，当前没有可控的 in-app Browser 实例 |

该基线只代表最近已完成代码状态。后续任何代码变更都必须重新运行完整门禁。

## 12. 当前明确不是“已完成”的能力

为避免产品展示超前于 Runtime，以下表述目前不得使用：

- “TradeBot 已支持自由接入任意市场”。
- “任意 Pipeline Graph 已可运行或回测”。
- “Copilot 已能修改和部署策略”。
- “旧 LM Multi-Agent 系统已完整迁移”。
- “Reflection 会自动优化运行策略”。
- “A 股、港股、美股已经可用”。
- “Web Canvas 的配置已经修改 Runtime”。

当前准确表述应是：TradeBot 已完成架构合同、Graph 校验/注册/编译、固定 Crypto 历史证据与受控 Paper Runtime 的坚实基础；下一步正在把语义 Multi-Agent 行为、任意 Graph 历史执行和统一回测提升为产品核心能力。

## 13. 下一阶段完成定义

M1 至 M3 完成后，TradeBot 应达到第一个真正面向用户核心需求的闭环：

1. 用户选择一个后端注册 Preset 或版本化 Graph。
2. Data Source Capability 决定可用 Observation Window。
3. 完整结构化数据按窗口进入不同 Agent。
4. Agent 通过受控语义 Artifact 交接判断与证据。
5. Decision 汇总多 Agent、Approved Lessons、Portfolio 和 Risk Context。
6. 动作经过 Portfolio、Risk 和 Simulated Execution。
7. 同一个 Graph 可以完成历史单次执行、Backtest 和 Walk-Forward。
8. 所有 NodeRun、Artifact、lineage、Decision、Risk 和结果都可审计。
9. 当前固定 Crypto Pipeline 和 Paper Runtime 行为保持不变。

达到该闭环后，再扩大 Web 编辑、Copilot 和第二真实市场，能够避免界面和对话能力建立在不可执行的 Graph 之上。

## 14. M1 实施记录（2026-07-26）

M1 的合同与 Preset 行为基线已进入代码：

- 新增 Market Observation、Semantic Evidence、Agent Semantic Assessment、Reflection Lesson Candidate、Approved Lesson、Decision Semantic Context 和 Semantic Decision Artifact。
- 新增旧固定多周期 OHLCV Snapshot 到逐窗口 Observation Artifact 的兼容映射。
- 新增后端只读 Preset Catalog，包含当前 Crypto Multi-Agent、daily 单周期能力模板和 event-only research 能力模板。
- 当前 Crypto Preset 保留 Position Monitor、Decision → Portfolio → Risk → Execution 权限链和交易后 Reflection。
- daily 与 event-only 明确标记 `capability_required`，不宣称当前 Adapter 已支持。
- 本阶段没有替换现有 DecisionPipeline、Paper Runtime 或 Web 行为。

M1 完成后，下一主线是 M2 Historical Graph Executor。最终状态以本轮质量门禁结果和 `docs/project-status-and-handoff.md` 最新记录为准。
