# TradeBot 产品路线图与实施进度

> 状态日期：2026-07-27
> 文档角色：当前产品范围、完成度、实施顺序和验收标准的统一入口
> 产品定位：跨市场、可编排、可回测、可审计、可受控进化的 Human-in-the-loop Multi-Agent 交易系统

## 1. 当前结论

TradeBot 已经越过“只有页面原型和固定 Pipeline”的阶段，形成了以下可运行基础：

```text
Architecture Contracts
  -> Graph Validation / Registry / Compiler
  -> Semantic Presets
  -> Historical Graph Execution
  -> Graph Backtest / Walk-Forward Evidence
  -> Strategy Draft / Approval / Approved Paper Plan
  -> Controlled Current Crypto Paper Runtime
  -> Runtime Operations / Evidence Dashboard
```

但产品仍未完成。当前最关键缺口不是继续扩展运维组件，而是把现有后端能力收敛为用户可理解的“对话式配置与编排”闭环，然后补齐因果审计、Reflection Lesson 和第二真实市场。

## 2. 状态定义

| 状态 | 含义 |
| --- | --- |
| 已完成 | 有可运行代码、自动化测试，并已接入当前组合根或有明确调用入口 |
| 部分完成 | 合同和固定路径可用，但产品闭环、市场覆盖或交互仍有缺口 |
| 计划中 | 边界和依赖明确，尚未实现 |
| Mock | 只用于界面表达，不代表后端或 Runtime 已支持 |
| 后置 | 必须等待前置闭环稳定，不应提前开发 |

## 3. 产品需求对齐

### 3.1 多市场

用户最终可以基于后端已注册能力创建不同市场的配置草案。每个市场需要真实 Market Pack、Connector、Data Source Capability、Calendar、Risk Policy 和 Backtest Execution Model。

当前准确状态：Crypto 有真实固定路径；CSV 用于历史证据；A 股、港股、美股尚未形成真实可运行切片。

### 3.2 Multi-Agent 编排

用户可以创建单周期、任意多周期或事件驱动 Pipeline。编排应以对话为主、直接编辑为辅。后端只能使用预注册 Agent Template 和允许字段，不能动态执行用户代码。

### 3.3 语义交接

完整结构化行情或事件数据按 Observation Window 进入对应 Agent。Agent 输出自然语言判断与结构化证据，Decision 汇总多 Agent 语义、Approved Lesson、持仓、Portfolio、Risk 和 lineage，再由唯一权限链形成动作。

### 3.4 策略与回测

策略变更必须创建版本化 Draft，并经过 Contract Validation、Graph Backtest、Walk-Forward、Human Approval 和 Paper Running。回测和 Paper Runtime 必须共享合同和风险边界，不允许回测另写一套逻辑绕过 Risk。

### 3.5 Reflection

Reflection 只能产生 Lesson Candidate。Candidate 需要证据、适用范围、反例、生命周期和审批；未经批准不得进入 Decision Context，更不能直接修改 Prompt、权重、仓位或风险参数。

## 4. 当前进度总览

### 4.1 已完成

| 能力 | 当前实现 |
| --- | --- |
| 架构合同 | Market Pack、Data Source、Capability、Observation Window、Data Lineage、Agent Template/Config、Pipeline Graph、Validation Result 均为严格 Zod 合同 |
| Graph Validator | 检查节点/边、Schema、市场、数据源、窗口能力、合法聚合、必需输入、悬空节点、循环、Fallback 和执行权限边界 |
| Data Source Capability | Binance Futures Public、CSV Historical Source 与只读 Daily Research Source 声明服务端注册能力 |
| 当前 Crypto Graph | 等价描述 Selector、DataSync、DataQuality、Analysis、Bull/Bear、Decision、Portfolio、Risk、Execution、Position Monitor 和 Reflection |
| Graph Registry / Compiler | SQLite Draft、版本化、校验、后端实现注册和确定性编译 |
| 语义合同与 Preset | Market Observation、Semantic Assessment、Decision Context、Semantic Decision、Lesson Candidate/Approved Lesson 边界；Crypto、daily、event-only Preset |
| Historical Graph Executor | 仅执行后端注册 Plan，按 DAG、typed Artifact、Required/Optional/Fallback 运行并保留 lineage |
| Graph Evidence | Graph Backtest、Walk-Forward、隔离 Session、Durable Job、幂等、lease、orphan recovery 和 Evidence fingerprint |
| Configuration Draft | Market、Agent、Prompt/Policy、Strategy Draft，父 fingerprint 并发保护、Diff 和 Evidence staleness |
| Strategy Evidence / Approval | Backtest + Walk-Forward 门禁、Artifact 校验、Human Approval 和 Approved Paper Plan |
| Current Crypto Paper Runtime | 服务端注册 Binding，复用现有 DecisionPipeline、Selector topN=1、Position Monitor、Paper Account、Risk、Execution、Safety 和 Reflection |
| Runtime 控制 | Preflight、Start、close-only、stop/drain、lease、heartbeat、fencing、incident 和 orphan clearance |
| 运维审计 | Operational Outbox、Dispatcher、retry、dead letter、Worker、Retention Preview 和 immutable audit 基础 |
| Runtime Evidence | 严格只读合同与 API，聚合 latest run/cycle、Paper Account、Position Monitor、Agent Artifact、Decision/Risk/Execution、Reflection 和 lineage |
| Web Runtime | Preflight/Start/Pause/Safe Stop 控件、运行会话恢复、ACTIVE/RECENT/SAMPLE Evidence、中文/英文和响应式布局 |
| Conversation-first Orchestration | 严格 Conversation 合同、服务端 Tool Registry、Intent-to-Pipeline Draft、Configuration Draft Version、字段 Diff、Capability/Validation、Evidence/Approval Gate、Bearer Actor 派生与 Web Copilot 抽屉 |

### 4.2 部分完成

| 能力 | 已有基础 | 主要缺口 |
| --- | --- | --- |
| 市场自由配置 | Market Pack、Capability、Configuration Draft | 只有后端预注册能力可用，尚无第二真实市场闭环 |
| Agent 策略修改 | 对话可修改服务端白名单字段、创建不可变版本、返回 Diff，并在已有 Evidence 时标记 stale | 当前只开放注册 Analysis/Decision 参数白名单；不能动态注册实现或修改 Runtime |
| Evidence Tool 可用性 | Copilot 已注册 Backtest、Walk-Forward 与 Approval 工具，并复用现有 Evidence Workflow | 是否可实际完成取决于服务端注册 Runner/数据集；默认无 Runner 时明确失败，不伪造 Evidence |
| 旧 LM 行为迁移 | 语义合同与当前 Crypto Preset | 当前 Rule Artifact 部分只显示 stage summary；需要更深入的真实 thesis/evidence 因果审阅 |
| Reflection | 固定 Runtime 有 Reflection，合同已有 Candidate/Approved Lesson 边界 | 缺少持久化 Candidate 审阅、Evidence Validation、Approval 和 Approved Lesson 投入 Decision Context 的产品闭环 |
| Causal Trade Review | Trace、Artifact Ledger、Runtime Evidence Read Model | 缺少按 Run/Cycle/Trade 的检索、节点输入输出、决策原因和 lineage 浏览器 |
| 外部运维通知 | Outbox/Dispatcher/Worker 已完成 | Slack、Email、Webhook 未注册，当前不发送网络通知 |

### 4.3 尚未实现或后置

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 第二真实市场 | 计划中 | 需要完整 Market Pack、Connector、Capability、Calendar、Risk、Backtest 和测试 |
| 通用 Graph Paper Runtime | 后置 | 当前 Paper Runtime 仍绑定 Current Crypto DecisionPipeline，不能提前替换 |
| 任意动态 Agent 代码 | 明确不做 | 只允许后端预注册实现 |
| 交易所写接口 | 明确不做 | 当前保持 Paper Only / No Exchange Write |
| 自动策略自修改 | 明确不做 | Reflection 和 Copilot 都不能热改 Runtime |

## 5. 里程碑状态

| 里程碑 | 状态 | 结果 |
| --- | --- | --- |
| M0 Architecture Contracts + Capability + Graph Validator | 已完成 | 第一架构垂直切片完成 |
| M1 Semantic Artifact + Preset Baseline | 已完成 | 旧 LM 语义交接进入严格合同 |
| M2 Historical Graph Executor | 已完成 | 注册 Plan 可按 DAG 执行 |
| M3 Graph Backtest + Walk-Forward Evidence | 已完成 | 任意注册历史 Plan 可生成版本化证据 |
| M4 Configuration Draft + Compiler Bridge | 已完成 | Market/Agent/Policy/Strategy Draft 与 Historical Plan 桥接 |
| M5 Strategy Evidence + Approval | 已完成 | 证据绑定、人工审批和 Approved Paper Plan |
| M6 Controlled Current Crypto Paper Runtime | 已完成 | Preflight、Activation、Run、Safety、Stop/Drain 和审计 |
| M7 Runtime State + Evidence Dashboard | 已完成 | Web 会话恢复与真实只读运行证据水合 |
| M8 Conversation-first Orchestration | 已完成 | 对话调用注册工具创建/更新 Draft，展示 Diff、能力、验证和门禁，永久不修改 Runtime |
| M9 Causal Review + Reflection Lesson Lifecycle | 下一阶段 | Run/Trade 因果审阅与 Lesson 审批闭环 |
| M10 Second Real Market Vertical Slice | 计划中 | 用第二市场证明架构抽象 |
| M11 General Graph Paper Runtime | 后置 | 历史与审批闭环稳定后再泛化 Runtime |

## 6. 已完成：M8 Conversation-first Orchestration

### 6.1 已接真实后端

用户现在可以在现有 Copilot 抽屉中完成：

1. 查看已注册 Market Pack、Data Source Capability、Preset 和 Agent Template。
2. 描述目标市场、数据源、观察窗口和 Agent 处理方式。
3. 由后端把自然语言 Intent 编译为严格 Configuration / Pipeline Draft。
4. 展示结构化 Draft、版本 Diff、Capability 限制和 Validation Issues。
5. 通过注册工具发起 Backtest 与 Walk-Forward Evidence Job；没有服务端 Runner 时明确返回失败。
6. 只有 Backtest 与 Walk-Forward 通过后才能提交 Human Approval。
7. 始终显示 `runtimeApplied=false`，不直接启动或修改运行中的 Pipeline。

### 6.2 仍有边界

- 只使用现有后端注册工具和 Template。
- 不增加动态代码执行、URL、SQL、文件路径或 Provider 注入。
- 不重写 DecisionPipeline。
- 不把画布作为必经入口；Graph 可以作为稀疏只读预览或高级编辑器。
- 当前只承诺注册的 Crypto、daily 和 event-only 模板能力。
- 不增加交易所写接口。
- Daily Research Source 用于真实 Capability 拒绝与日线研究边界，不代表第二真实市场。
- Approval 结果是 `APPROVED_NOT_APPLIED`；Paper Runtime 激活仍属于独立 Runtime Controls。
- Web 状态栏中的 `MOCK`、`ACTIVE PAPER RUNTIME` 和 `RECENT TERMINAL RUN` 是边界说明，不由 Copilot 创建。

### 6.3 已验证场景

- Current Crypto Preset 创建持久化 Configuration Draft 与 Pipeline Draft，返回稳定 Draft ID、版本与 fingerprint。
- 只读 1d Source 请求 5m 时返回 `UPSAMPLING_FORBIDDEN` 和 `OBSERVATION_WINDOW_UNSUPPORTED`，不创建可编译版本。
- 5m 到 1h 合法聚合复用 Graph Validator 能力判断并保留 transformer lineage。
- 允许的 Agent 字段产生新版本、父 fingerprint 和字段 Diff；已有 Evidence 自动 stale。
- 禁止字段、过期父 fingerprint、未注册 Tool/Preset/Market/Source/Agent 和 Approval 越级全部 fail closed。
- HTTP 严格拒绝客户端 Actor、Role、Runner、Evidence、代码、SQL、URL、路径、Runtime 与 Risk bypass 注入。

## 7. 后续优先顺序

### Loop 1：Causal Run / Trade Review

增加按 Run、Cycle、Trace 和 Trade 的只读查询，展示真实 Agent thesis、evidence、Decision、Portfolio、Risk、Execution、Position Monitor、Reflection 和 lineage。

### Loop 2：Reflection Lesson Lifecycle

实现 Lesson Candidate 持久化、反例/样本证据、Human Approval、Approved Lesson 和受限 Decision Context 注入；不得自动修改运行策略。

完成这两个 Loop 后，再选择第二真实市场。通用 Graph Paper Runtime 继续后置。

## 8. Web 信息架构

默认不再新增独立、复杂的“系统编排”页面。推荐：

- 顶部或侧边：交易运行控制；
- 主区：账户、持仓、当前周期和真实证据；
- Copilot 抽屉：自然语言编排、Draft Diff、Validation 和发布门禁；
- 高级模式：结构化表单和稀疏 Graph 预览；
- 审计入口：按 Run/Cycle/Trade 查看因果链。

所有 Web 状态必须明确区分：

- `SAMPLE`；
- `MOCK`；
- `DRAFT`；
- `VALIDATED`；
- `APPROVED_NOT_APPLIED`；
- `ACTIVE PAPER RUNTIME`；
- `RECENT TERMINAL RUN`。

## 9. 持续安全不变量

1. Selector `topN=1` 不变，symbols 只是候选池。
2. 当前持仓始终进入 Position Monitor。
3. Required 数据缺失或时间不对齐时禁止新开仓。
4. 只有细粒度到粗粒度的可信聚合被允许并记录 lineage。
5. Copilot 只创建结构化 Draft。
6. Decision、Portfolio、Risk、Execution 是唯一动作链路。
7. Reflection 只创建 Candidate。
8. 唯一即时风险控制是暂停新开仓 / 仅允许平仓。
9. 不热改运行 Pipeline。
10. 不接入交易所写接口。

## 10. 最近质量基线

2026-07-27 完成 Conversation-first Draft Orchestration 后：

| 门禁 | 结果 |
| --- | --- |
| `npm run check` | 通过 |
| `npm run test:ts` | 通过，216/216 |
| `npm run build:web` | 通过 |
| `git diff --check` | 通过 |
| `npm run dev:paper` | 启动通过，Web 5174 / API 8787，CSV Evidence Runner 已注册 |
| 本轮浏览器视口与 Console | 当前执行环境未提供可连接的内置浏览器会话，未完成视觉/Console 复核；沿用上一基线，不宣称本轮已复核 |

自动化门禁覆盖当前未提交工作区。下一窗口应在可用浏览器会话中补做 1440×900 / 820×760、中英文、三个 Conversation 场景与 Console 复核。

## 11. 当前不能宣称

- 已自由接入任意市场。
- A 股、港股或美股已经可运行。
- Copilot 已经可以部署或热改策略。
- Reflection 已经会自动优化运行策略。
- 当前 Graph Canvas 已经修改 Runtime。
- 外部通知已经发送。
- 已支持交易所写入或实盘下单。
## 2026-07-27: Causal Run / Trade Review Loop

- 已接真实后端：Bearer 保护的只读 Run、Cycle、Trade Review API；精确读取现有 Paper Runtime Run/Cycle、Trace、Agent Artifact 和 Reflection SQLite 事实。
- 已接真实后端：按服务端已知 opaque ID 检索 Run/Cycle/Trade，周期游标分页，Agent 安全输入/输出字段、Selector/Position Monitor/Decision/Portfolio/Risk/Execution 动作链、显式 lineage 与 Trade Review Presenter 摘要。
- 安全边界：未知查询字段、actor/SQL/path/code/URL/Runtime 参数注入、未知 Run/Cycle/Trade、无效游标均 fail closed；接口只读，`runtimeApplied=false`，`exchangeWriteAllowed=false`。
- 证据语义：ACTIVE、RECENT、PARTIAL、UNAVAILABLE 与 SAMPLE 分开表达；时间顺序仅标记为 `observed_sequence`，不推断因果关系；Reflection 仍只是 Lesson Candidate。
- Web：现有 Audit Log 接入真实 Causal Review，使用 Run → Cycle → Trade 稀疏审阅结构；旧静态记录保留并明确标注为 SAMPLE FALLBACK；未增加 Graph 画布或 Runtime 控制。
- Runtime 行为：未修改 DecisionPipeline、Selector topN=1、Position Monitor、Decision → Portfolio → Risk → Execution、Paper Account、Risk、Execution 或 Runtime Safety。
- 验证目标：TypeScript 测试 226/226；`npm run check`、`npm run test:ts`、`npm run build:web`、`git diff --check` 全部通过；浏览器验证结果见交接文档。
- 下一阶段：在本闭环稳定后进入 Causal Run / Trade Review 的真实操作员使用反馈与单笔 Trade Review 深化，而不是增加新的编排画布。
## 2026-07-27: Explicit Trade Lineage and Single-Trade Review

- Paper Position、Order、Fill、Closed Trade 和 Agent Artifact 使用向后兼容的显式 Trade/Position/Entry/Exit 引用；新交易记录完整 lineage，历史无引用记录保持 partial。
- `DecisionPipeline` 只增加证据元数据：Decision → Portfolio → Risk → Execution 和 Position Monitor → Exit 的交易行为、Risk 判断、费用与成交模型不变。
- Single Trade Review 从现有 Paper Account snapshot、Trace、Artifact Ledger 和 Reflection Store 读取事实；费用与 realized PnL 不由 Presenter 重算。
- Reflection 记录 `sourceTradeIds`，仍是 `candidateOnly` 且 `runtimeApplied=false`。
- Audit Log 在现有 Causal Review 内展示 Entry/Exit、Order、Fill、Position、PnL、费用和稳定缺失证据 code；没有新增独立 Graph 页面。
- 验证目标：TypeScript 测试 232/232；完整 check、test、Web build、diff-check 和真实浏览器结果见交接文档。

### 2026-07-27 Explicit Trade Lineage Loop 最终验证补记

- 真实浏览器已验证 `1440x900` 与 `820x760` 的中文、英文界面，均无页面或 Causal Review 横向溢出。
- 新创建的 Paper 持仓 `trade:paper:3` 显示完整 Entry Order / Decision / Portfolio / Risk / Execution / Fill 显式引用，并保持 `active_position`、只读、`runtimeApplied=false`。
- 由旧版持仓产生的平仓 `trade:paper:2` 按事实显示 `partial_evidence`，保留完整 Exit 引用并返回稳定的 Entry/Fill 缺失证据码；系统未猜测或补造历史因果关系。
- Reflection 仍仅是显式关联的 Lesson Candidate；没有显式关联时显示 unavailable，不会改变策略或 Runtime。
- 浏览器控制台为 `0 errors / 0 warnings`。最终门禁基线为 TypeScript tests `232/232`。

### 2026-07-27 Comparative Trade Evidence and Human Lesson Review Loop

- 新增严格的 `TradeOutcomeEvidence`、`TradeComparisonPolicy`、`ComparativeTradeEvidence` 与 Lesson Candidate Review 合同；所有请求合同拒绝未知字段和可执行注入。
- 新增服务端比较服务：仅从注册 Trade facts 中选择同 Pipeline Graph fingerprint、Market Pack 和 symbol 的历史已平仓交易，使用最近一笔作为 baseline，结果明确 `causalClaim=false`。
- 新增人工 Lesson Candidate Review 服务：仅允许 `accept_for_validation` 或 `reject`，校验 Candidate/Evidence fingerprint、Trade 归属与幂等键，并持久化不可变 SQLite review record。
- `accept_for_validation` 不创建 `ApprovedReflectionLesson`、策略修改、Runtime Apply、订单或交易所写入；下一门禁仍是 Contract Validation。
- 新增受 Bearer Authentication 保护的独立 HTTP Handler。客户端不能控制 actor、role、比较策略、runner、SQL、code、path、URL、Runtime 参数或 Risk bypass。
- 当前生产组合根和 Web 尚未挂载该独立 Handler，状态为 backend implemented / composition unavailable；现有 Causal Review Web 未在本轮修改。
- TypeScript tests 为 `241/241`。现有 Selector `topN=1`、Position Monitor、Decision -> Portfolio -> Risk -> Execution、Paper Account、Risk、Execution 和 Runtime Safety 行为未改变。

### 2026-07-27 Production Comparative Review Wiring Loop

- 新增 `ProductionComparativeTradeReviewComposition`，直接复用 `SQLitePaperAccountStore.load`、`SQLiteReflectionStore.latest`、既有 Bearer Auth 接口与 SQLite Lesson Review Repository。
- Paper closed Trade 在边界层转换为 `TradeOutcomeEvidence`；PnL、fees、quantity、entry/exit price 和 timestamps 原样保留，Market/Data Source/Graph/Schema refs 完全由服务端组合配置提供。
- Reflection 只有在报告包含显式 `sourceTradeIds` 时才生成稳定 Candidate；无显式 Trade 关联时 Candidate inspection 返回 unavailable，不按时间或相似性推断。
- 生产组合提供 compare、candidate inspect、candidate review 三条认证 Handler 路径，完整链路保持 `runtimeApplied=false`、`exchangeWriteAllowed=false`、`approvedLessonCreated=false`。
- 当前 main orchestration server 和 Causal Review Web 尚未实例化该新 composition；模块为 production-wired and integration-tested，但不是已部署 UI。
- TypeScript tests 为 `245/245`。现有交易动作链、Paper Account 计算、Risk、Execution 与 Runtime Safety 行为未改变。
## 2026-07-29: Main Server Comparative Review Mount and Causal Review UI Loop

- The main loopback Orchestration HTTP server now mounts the existing
  `ProductionComparativeTradeReviewComposition` for comparison, candidate
  inspection, and human candidate review.
- Bearer identity and approver role are derived by the server. Paper Account,
  Reflection, review database, Market Pack, Data Source, Graph, and Schema
  references are server-owned.
- The existing Causal Review now shows a sparse comparative evidence section
  for an explicitly selected closed trade, including raw PnL, fees, holding
  duration, baseline values, and deltas.
- The Web only offers `accept_for_validation` and `reject`. It does not expose
  Runtime Apply, trading, Start, Pause, Risk bypass, or exchange-write actions.
- Accepted candidates remain Lesson Candidates entering Contract Validation.
  `approvedLessonCreated=false`, `strategyMutationCreated=false`,
  `runtimeApplied=false`, and `exchangeWriteAllowed=false`.
- No DecisionPipeline, Selector, Position Monitor, Portfolio, Risk, Execution,
  Paper Account, or Runtime Safety behavior changed.
- Validation: `npm run check` passed, `npm run test:ts` passed 248/248,
  `npm run build:web` passed with 27 modules, and `git diff --check` passed.
- `npm run dev:paper` started successfully and reported Comparative Trade
  Review enabled. The connected browser control surface exposed no browser
  instance, so the requested four viewport and Console checks remain
  explicitly unverified rather than inferred.
## 2026-07-29: Bounded Human Review History and Continuity Loop

- Added a strict, Bearer-authenticated, read-only history projection over the
  existing immutable Lesson Candidate review records.
- History is resolved from the server-owned Reflection Candidate, sorted
  newest-first, limited to 20 records, and paginated with an opaque cursor.
- Causal Review now restores accepted-for-validation or rejected state after a
  reload and shows a compact bounded history.
- History does not create Approved Lessons, strategy mutations, Runtime
  changes, or exchange writes.
- No trading, DecisionPipeline, Selector, Position Monitor, Risk, Execution,
  Paper Account, or Runtime Safety behavior changed.
- Validation: `npm run check` passed, `npm run test:ts` passed 251/251,
  `npm run build:web` passed with 27 modules, and `git diff --check` passed.
- `npm run dev:paper` started successfully with the mounted Comparative Review
  composition. The connected browser control surface still exposed no browser
  instance, so Chinese/English desktop and compact visual checks remain
  explicitly unavailable.

## 2026-07-29 Accepted Candidate Contract Validation Handoff Loop

- 已接真实后端：`POST /api/orchestration/lesson-candidates/validation-handoff` 使用 Bearer Authentication，从 Reflection Catalog、SQLite 人工复核历史和当前 Comparative Evidence 服务端派生 handoff。
- 已接真实后端：Candidate 与 Comparative Evidence fingerprint 连续性检查；变化时返回稳定 stale issue code 并 fail closed。
- 已复用现有边界：只有服务端绑定同时匹配 Review、Candidate、Evidence fingerprint，且携带现有 Pipeline Graph Validator 结果时，才投影 `validation_failed` 或 `validation_passed`。
- 当前真实状态：生产组合尚无 Lesson Candidate 到 Configuration Draft / Pipeline Graph 的服务端绑定，因此被接受的候选稳定返回 `validation_unavailable` 和 `VALIDATION_DRAFT_BINDING_NOT_AVAILABLE`；这不是 mock，也不表示验证失败或通过。
- Web 已接真实 API：Comparative Trade Review 显示 Contract Validation handoff、稳定 issue code、下一门禁和 `runtimeApplied=false`，不提供 Runtime 或交易控制。
- 未改变现有 Runtime、DecisionPipeline、Selector、Position Monitor、Risk、Execution、Paper Account 或 Runtime Safety 行为；仍为 Paper Only 且 `exchangeWriteAllowed=false`。
- 下一阶段：建立受控、服务端拥有的 Accepted Review → 现有 Configuration Draft Version 绑定，再调用现有 Configuration Validation / Graph Validator；仍不创建 Approved Lesson，不进入 Runtime。
- 本轮验证：`npm run check` 通过；`npm run test:ts` 257/257 通过；`npm run build:web` 通过（28 modules，71ms）；`git diff --check` 通过；`npm run dev:paper` 启动成功。
- 浏览器验证：宿主内置 Browser 返回可用实例列表为空，未能执行 1440×900 / 820×760 中英文视觉、交互和 Console 检查；不得视为已通过。
