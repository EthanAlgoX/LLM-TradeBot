# TradeBot 产品路线图与当前进度

> 2026-08-02：LOOP-023 已完成 M4 多模拟运行中心：真实 deployment-scoped Paper cycle、两实例隔离、lease/fencing、close-only、刷新和 Web/API 重启恢复均已由 Agent Chrome 验证；全量测试通过，`tests-ts` 当前含 380 个 `test()` 用例。下一阶段为 LOOP-024 的 M5 Shadow 与晋升建议，仍不授权 Live 或交易所写入。

> 文档角色：当前完成度、剩余缺口和交付顺序的权威快照
> 最后更新：2026-07-31
> 产品基线：[`../PRODUCT.md`](../PRODUCT.md)
> 架构基线：[`architecture-and-delivery-plan.md`](architecture-and-delivery-plan.md)
> 当前交接：[`project-status-and-handoff.md`](project-status-and-handoff.md)
> 历史记录：[`archive/product-roadmap-and-progress-through-2026-07-29.md`](archive/product-roadmap-and-progress-through-2026-07-29.md)

## 1. 当前结论

TradeBot 已从固定 Crypto Paper Pipeline 扩展出真实的 Registry、Capability、Graph Validation、Configuration Draft、Historical Evidence、Strategy Evidence、Approval、受控 Paper Runtime、Conversation-first Copilot、Causal Review 和 Human Lesson Candidate Review 垂直切片。产品一级抽象已经校正为“通用注册输入 + 可配置多 Agent”，具体市场只作为 Market Pack 元数据和执行约束。

当前不是多市场生产系统，也不是通用 Graph Runtime。生产可运行范围仍是服务端注册的 Current Crypto Paper Binding；M4 已能从已物化 Strategy Version 启动多个隔离的 Paper deployment。Draft、Approval、Lesson Candidate 和 Validation Handoff 均不会自动修改正在运行的 Runtime。

当前验证基线：

```text
npm run check       PASS
npm run test:ts     PASS (328/328)
npm run build:web   PASS (31 modules, 70ms)
git diff --check    PASS
npm run dev:paper   STARTED
```

当前宿主的内置浏览器列表为空，因此 Approved Lesson Semantic Materialization 的桌面/窄屏、中英文、语义状态展示和 Console 仍未完成浏览器复核。

## 2. 能力进度

| 能力 | 状态 | 当前事实 |
| --- | --- | --- |
| DecisionPipeline 与交易安全链 | `REAL` | Selector `topN=1`；当前持仓进入 Position Monitor；唯一动作链为 Decision → Portfolio → Risk → Execution |
| Crypto Paper Runtime | `REAL` | 服务端注册 Binding、Preflight、Lease、Heartbeat、Fencing、Close-only、Drain、Safe Stop 和持久化运行记录 |
| Exchange 写入 | `UNAVAILABLE` | Paper Only，`exchangeWriteAllowed=false`，没有 Binance 或其他交易所写接口 |
| Market/Data/Agent Registry | `REAL` | Market Pack、Data Source Capability、Agent Template、Preset 均由服务端注册；客户端不能上传实现 |
| Pipeline Graph 与 Validator | `REAL` | 检查 Schema、Observation Window、Lineage、权限链、Release Gate 和注册实现 |
| Historical Graph Execution | `REAL` | 只执行后端注册 Plan/Runner；支持 Backtest 与 Walk-Forward Artifact |
| Configuration Draft | `REAL` | SQLite 不可变版本、parent fingerprint、字段级 Diff、validation 和 Evidence stale |
| Strategy Evidence / Approval | `REAL` | Backtest、Walk-Forward、Human Approval 和 Approved Paper Plan 使用现有单一门禁链 |
| Conversation-first Copilot | `REAL` | 自然语言编译为注册工具调用；创建/修改 Draft；展示 Capability、Validation、Diff 和 Gate |
| Copilot Runtime Apply / 下单 | `UNAVAILABLE` | Copilot 没有 Start、Pause、Safe Stop、Apply 或交易工具 |
| Runtime Evidence / Causal Review | `REAL` | 读取 Run、Cycle、Trace、Artifact、Trade 和 Reflection；缺失 lineage 不推断因果 |
| Explicit Trade Lineage | `REAL` | 新 Paper 交易记录稳定 Trade/Position/Order/Fill/Artifact 引用；旧数据保持 partial evidence |
| Comparative Trade Evidence | `REAL` | 服务端选择同 Graph/Market/Symbol 最近历史基线；只做描述性比较，不声称因果 |
| Lesson Candidate Human Review | `REAL` | Accept-for-validation / Reject、Bearer Actor、幂等不可变 SQLite 历史和有界分页 |
| Accepted Candidate Draft Binding / Validation | `REAL` | 服务端唯一解析 Strategy Draft 和 Pipeline Draft；SQLite append-only binding；真实 Configuration/Graph Validation；漂移 stale |
| Lesson Evidence Gate Projection | `REAL` | validation-passed binding 服务端关联现有 Strategy Evidence Binding；复用真实 Backtest/Walk-Forward Job；双通过后仅返回 approval required |
| Lesson Human Approval | `REAL` | 独立于 Strategy Approval 的 Bearer Human Approval；SQLite append-only；Approve 创建 NOT_APPLIED Approved Lesson Artifact，Reject 关闭审批 |
| Approved Lesson Semantic Materialization | `PARTIAL` | 服务复用现有 ApprovedReflectionLesson/DecisionSemanticContext 合同并严格检查 scope；生产 Reflection Report 缺完整语义 Candidate，当前返回 unavailable |
| Approved Lesson 生产闭环 | `UNAVAILABLE` | 不会从 Review 自动创建 Approved Lesson，也不会自动进入 Decision Context |
| 通用 Graph Paper Runtime | `UNAVAILABLE` | 当前仍复用稳定的 Current Crypto `DecisionPipeline`，不由 Draft 热替换 |
| 通用配置语义管线预览 | `REAL` | 从现有 Strategy/Agent Configuration Draft 与服务端 Registry 解析 Data Source Capability、Observation Window 和多 Agent 拓扑；Bearer API 严格拒绝客户端实现与 Runtime 参数 |
| 注册语义输入执行 | `REAL` | 服务端注册的有界事实源和 Agent Adapter 产生现有 Observation/Assessment 合同，SQLite append-only 持久化并提供 Bearer execute API |
| 通用 Decision Context 组装 | `PARTIAL` | 完整服务端 Portfolio/Risk/Data Quality 快照可组装现有 DecisionSemanticContext；当前本地生产组合缺该快照时明确 unavailable |
| 通用历史语义评估桥 | `REAL` | Semantic Execution 经 Source/Capability/Lineage/Adapter 校验后复用现有 Strategy Evidence Binding、Graph Job、Backtest、Walk-Forward 和 Human Approval |
| 外部通知 | `UNAVAILABLE` | Operational Outbox 不等于 Slack、Email 或 Webhook 已发送 |

## 3. 已完成阶段

### M0-M2：交易 Runtime 基础

- Multi-Agent DecisionPipeline、Selector、Data Quality、Portfolio、Risk、Execution、Position Monitor。
- Paper Account、Trace、Artifact Ledger、Reflection、Backtest、Walk-Forward。
- Runtime Safety、Preflight、Lease、Heartbeat、Fencing、Close-only、Drain 和操作审计。

### M3-M5：可编排研究与发布链

- 版本化 Market/Data/Agent/Pipeline 合同与 Registry。
- Observation Window Capability、合法聚合和 lineage。
- Pipeline Graph Validator、Historical Graph Executor、Configuration Draft。
- Graph Backtest / Walk-Forward Evidence、Human Approval、Approved Paper Plan。

### M6-M8：受控产品工作区

- Strategy Workspace、Runtime Controls、Runtime Evidence。
- Conversation-first Copilot Registry 和 Orchestration API。
- Draft Proposal、字段级 Diff、Validation Issue、Evidence Gate 和 Runtime 隔离展示。

### M9-M11：Causal Trade Review 与 Human Lesson Review

- Run/Cycle/Trade 只读 Causal Review。
- 新 Paper 交易显式 lineage 和 Single-Trade Review。
- Comparative Evidence、Reflection Candidate Inspect、人工接受/拒绝和持久化 Review History。
- Accepted Candidate 的只读 Contract Validation Handoff；stale 指纹 fail closed。
- Accepted Review 到 Configuration Draft / Pipeline Graph 的服务端不可变 binding，以及真实双层 Contract Validation。

## 4. 当前关键缺口

### 已完成：Accepted Review 到现有 Draft 的服务端绑定

当前服务端可以从 Trade Graph ref 推导 Pipeline Draft，并反查唯一最新 Strategy Configuration Draft。创建结果持久化为不可变版本：

```text
accepted_for_validation
-> server-owned Draft / Graph resolution
-> Configuration Validation
-> Pipeline Graph Validation
-> validation_failed | validation_passed
-> runtimeApplied=false
```

客户端只提交 `selectedTradeId` 与幂等键，不能提交 Draft、Graph 或 fingerprint。无匹配或多匹配都会 fail closed；任一最新 fingerprint 漂移都会 stale。

### 已完成：Lesson Evidence Gate Projection

客户端只提交 Trade、幂等键和受限动作。服务端从当前 validation-passed binding 解析唯一注册 Evidence Scope，复用现有 Strategy Evidence Binding、Backtest、Walk-Forward Job 与 Artifact 验证；任一 scope 漂移均返回 stale。双 Evidence 通过后仅返回 `approval_required`。

### 已完成：Lesson Human Approval

只有 Evidence Gate 为 `approval_required` 且现有 Backtest/Walk-Forward Artifact 重新验证通过时才允许批准。Approved Lesson 包含 Candidate、Review、Validation、Evidence、Market、Graph、Configuration、历史范围、有效期和 revocation 状态，但保持 `decisionContextApplied=false`。

### 已完成：Approved Lesson Semantic Materialization 边界

服务端只从完整 `ReflectionLessonCandidateSchema` 物化现有 `ApprovedReflectionLessonSchema`，并可验证 Shadow `DecisionSemanticContextSchema`。当前生产 Reflection Report 没有 semanticLesson、failurePattern、confidence 和 supportingEvidence，因此 fail closed 为 unavailable，不伪造事实。

### P0：Production Semantic Candidate Persistence

在真实 Contract Validation、Backtest、Walk-Forward 和 Human Approval 全部完成前，不得创建 Approved Lesson。后续需要明确：

- Lesson 的适用 Market、Graph、Regime、样本和有效期；
- Evidence 与 Candidate fingerprint 连续性；
- Approved Lesson 如何以只读、可撤销、可审计引用进入 Decision Context；
- Strategy mutation 与 Lesson approval 是否分离。

### P2：Review UI 操作验证

- 完成 1440×900、820×760 的中英文真实浏览器检查。
- 覆盖 accepted、rejected、stale、validation unavailable/failed/passed。
- 确认无横向溢出、不可读小字和 Console error/warning。

### P3：通用输入与 Agent 执行

只有完成 Lesson 闭环后再评估：

- 通用 Graph Paper Runtime；
- 服务端注册 Semantic Input Executor 和 Agent Adapter；
- 用现有语义 Artifact 组装只读 Decision Context；
- 外部通知适配器。

这些工作不能削弱当前 Crypto Runtime 安全边界。

## 5. 接下来三个 Loop

1. **Registered Semantic Input Execution and Decision Context Assembly Loop**：从服务端注册数据源和 Agent Adapter 产生现有语义 Artifact，并只读组装 Decision Context。
2. **Generic Historical Semantic Evaluation Loop**：让同一配置与 Artifact 链进入现有 Historical Graph Executor、Backtest 和 Walk-Forward。
3. **Generic Paper Runtime Migration Plan Loop**：只有前两步通过后，再设计不重写现有 DecisionPipeline 的可回退迁移方案。

当前应执行的完整任务见 [`next-loop-prompt.md`](next-loop-prompt.md)。

## 7. 2026-07-31：Generic Configurable Input and Multi-Agent Semantic Pipeline

- 状态：`REAL`（配置与拓扑投影）。Bearer API 从现有不可变 Strategy/Agent Draft 和服务端 Registry 解析 Market Pack、Data Source Capability、Observation Window 与多个 Agent Template。
- 产品校正：具体市场不再作为一级功能列表；相同管线可承载任意服务端注册的结构化输入。
- 当前边界：尚未执行生产数据加载或 Agent 推理，下一门禁为 `registered_semantic_input_execution`；`decisionContextCreated=false`、`runtimeApplied=false`、`exchangeWriteAllowed=false`。
- 验证：`check` PASS；TypeScript tests 307/307 PASS；Web build PASS（31 modules，70ms）；diff-check PASS。

## 8. 2026-07-31：Registered Semantic Input Execution and Decision Context Assembly

- 状态：`REAL`（语义执行）/ `PARTIAL`（Decision Context）。服务端注册 source/adapter 生成现有严格 Observation 与 Assessment Artifact，并 append-only 持久化完整执行 Record。
- `POST /api/orchestration/configuration/semantic-pipeline/execute` 只接受 Configuration Version、Preview fingerprint 和幂等键；事实、Agent 实现、Actor、Runner、URL、SQL、路径、账户和 Runtime 参数均不可由客户端控制。
- Preview fingerprint 漂移返回 stale；Portfolio/Risk/Data Quality 快照缺失返回稳定 unavailable code，不补造 Decision Context。
- 所有结果保持 `decisionContextApplied=false`、`runtimeApplied=false`、`exchangeWriteAllowed=false`，现有交易行为不变。
- 验证：`check` PASS；TypeScript tests 313/313 PASS；Web build PASS（31 modules，69ms）；diff-check PASS。

## 9. 2026-07-31：Generic Historical Semantic Evaluation

- 新桥接层不保存 Evidence Artifact，只调用现有 Strategy Evidence Binding、Graph Evidence Job、Backtest、Walk-Forward 和 Human Approval。
- 客户端只提交 Execution ID、受控动作和幂等键；Dataset、Data Source、Profile、Candidate Set、Plan、历史范围、Runner、Evidence 和 Actor 均由服务端解析。
- bar/event 输入均进入同一门禁投影；未来事实、Capability scope、lineage 和 Agent Adapter 漂移在 Evidence 前 fail closed。
- Approval 仍要求 Backtest 与 Walk-Forward 双通过及 Approver 角色；结果为 `APPROVED_NOT_APPLIED`，不自动启动 Paper Runtime。
- 验证：`check` PASS；TypeScript tests 319/319 PASS；Web build PASS（31 modules，70ms）；diff-check PASS。

## 6. 持续不变量

1. Selector `topN=1`，symbols 只是候选池。
2. 当前持仓继续进入 Position Monitor。
3. 唯一动作链是 Decision → Portfolio → Risk → Execution。
4. Copilot、LLM、Reflection 和 Lesson 都不能直接下单或绕过 Risk。
5. Draft、Evidence、Approval 和 Lesson 不热更新运行中的 Pipeline。
6. 唯一允许立即生效的人工风险控制是暂停新开仓 / 仅允许平仓。
7. Paper Only，`exchangeWriteAllowed=false`。
8. 不重写当前稳定 DecisionPipeline，除非后续有独立、完整、可回退的通用 Runtime 迁移计划。

## 2026-08-01：M1 Conversation History V1

- 状态：`COMPLETE`。实现已完成：Conversation Replay 以 SQL CTE/window query 与 `LIMIT limit + 1` 提供 actor-scoped conversation/turn 分页；cursor 为版本化、kind-bound 的 opaque 合同，SQLite 仍 append-only。
- Bearer read-only API：`GET /api/orchestration/conversations`、`GET /api/orchestration/conversations/:conversationId`、`GET /api/orchestration/conversations/:conversationId/turns`；畸形分页、无效 ID、跨 actor 和写入请求均 fail closed。
- Web 以服务端 Turn 为唯一对话事实，localStorage 只保存 `conversationId`；工作台收敛为历史会话、当前对话、策略上下文三栏并适配窄屏。
- Operator identity：Strategy Workspace 现使用 global runtime injection → DEV Vite injection → manual page-memory fallback；不再依赖可能丢失的一次性 session event。所有读取 Vite token 的 Web 模块均限制在 DEV，production sentinel leak check 通过。
- 验证：Draft Authority 对完整 `draftId/versionId/fingerprint` fail-closed；Repository 覆盖双 actor、跨 kind cursor、稳定分页、重启恢复、损坏 replay 和 append-only；新增身份解析优先级/fail-closed 回归。最新完整自动化为 `npm run test:ts` 328/328 PASS，check、Web build 与 diff-check 同步通过；production sentinel absent；干净 `dev:paper` 服务地址可达。
- 本轮浏览器插件验收：以干净 local Paper workspace 完成真实后端连接、第一会话创建与 v2 不可变 Draft、第二会话创建、两会话往返切换隔离、1440 中文和 820 英文无横向溢出、刷新及 Web/API 重启后自动认证与已选会话（2 Turn、v2）恢复；全程 `runtimeApplied=false`，控制台无 warning/error。原有损坏的本地 workspace 已可恢复地移至 `data/local-paper-workspace.backup-20260801T183000`，未删除。
- 后续真实 Chrome 验收已确认：session、conversation list、turn list 均为 200 且无 401；受控 Copilot 成功创建 Draft Version 3；Console 无 warning/error；`runtimeApplied=false`、Paper Only 与 Exchange writes OFF 保持成立。
- LOOP-003 保持未完成的历史交接记录。LOOP-004 中用户明确授权 Agent 直接操作真实 Chrome DevTools：localStorage、sessionStorage 与 Cookie 均为空；可见 Composer 触发的 `POST /api/orchestration/copilot/messages` 为 `200`，生成仅 Draft 的 Version 5；清空 Console 并刷新后无 TradeBot 页面 error/warning。没有读取 value、请求载荷或响应。
- M2 数据中心 V1 为 `COMPLETE`：LOOP-017 确认服务端 Binding 写入和 `createdAt DESC, idempotencyKey DESC` latest 排序正确；缺陷是 Web 全局 history/localStorage 重新选择与无 identity guard 的旧 load response 覆盖。Binding 后现定向回读原 conversation，并校验完整 Draft/version/fingerprint 与 Dataset binding；列表不再改变 active selection，A/B/pending state 由 epoch 隔离。Agent Chrome 已完成中文 1440×900 与英文 820×760 的 Binding、刷新、服务重启、Composer、A/B 往返和无 Draft disabled 负向；`runtimeApplied=false`、Paper Only、Exchange writes OFF。336/336 自动化通过，Network 仍为 `TOOL_UNAVAILABLE`。
- M3 实验场 V1 为 `COMPLETE`：Experiment definition/event 为 actor-scoped、append-only、可重启恢复；Dataset/range/Execution/Risk/Model/Prompt 和 participant refs 被不可变锁定，Controlled/Open Class/Incompatible 由服务端判定。Backtest 与 Walk-Forward 复用 Durable Graph Evidence，Replay 重新读取并验证 job request/artifact/manifest/result，Candidate 只选择满足约束的唯一第一名且保持 `runtimeApplied=false`。LOOP-020 同时修复 deterministic plan/CSV definition fingerprint、完整 materialization eligibility、Walk-Forward 派生键上限和有界 equity DOM。Agent Chrome 已通过中文 1440×900、英文 820×760、负向、109-fold Evidence、Replay、Candidate 和 Web/API 重启恢复；353/353 自动化通过，Network 为 `TOOL_UNAVAILABLE`。
## 2026-07-31：Production Semantic Candidate Persistence

- 状态：`REAL`。Rule Reflection 已生成并持久化严格 Semantic Candidate，Review 与 Materialization 使用同一 append-only Store。
- 事实不足：缺失败 Trade、entry trace 或 Decision Artifact 时不生成 Candidate，不从 recommendations 或客户端输入猜测。
- 安全边界：`decisionContextApplied=false`、`runtimeApplied=false`、`exchangeWriteAllowed=false`；现有交易行为不变。
- 验证基线：`npm run check` PASS；`npm run test:ts` 293/293 PASS；`npm run build:web` PASS（31 modules，59ms）；`git diff --check` PASS。
- 当前 P0：Approved Lesson Shadow Decision Context Replay，只读构造并验证历史 `DecisionSemanticContextSchema`。
## 2026-07-31：Approved Lesson Shadow Decision Context Replay

- 状态：`REAL`（对新记录具备完整历史快照时）。现有 Materialization 已接入 SQLite Artifact Ledger Shadow Base Adapter。
- 旧记录缺 Portfolio/Runtime control 快照时明确 unavailable，不补造历史事实。
- Market Pack 或 entry Decision Artifact fingerprint 漂移时 Shadow 状态为 stale。
- 安全边界：Shadow Context 不进入 DecisionPipeline，所有 Apply/Mutation/Exchange Write 标志保持 false。
- 验证基线：`npm run check` PASS；`npm run test:ts` 298/298 PASS；`npm run build:web` PASS（31 modules，65ms）；`git diff --check` PASS。
- 当前 P0：Shadow Replay Durability and Approval Audit。
## 2026-07-31：Shadow Replay Durability and Approval Audit

- 状态：`REAL`。validated Shadow Materialization 已 append-only 持久化并可分页查询。
- 审计链显式绑定 Approval、Candidate、Approved Lesson、Decision Context 和历史 lineage。
- unavailable/stale Shadow 不写入 validated 审计记录；所有记录保持 Runtime Not Applied。
- 验证基线：check PASS；TypeScript tests 302/302 PASS；Web build PASS（31 modules，62ms）；diff-check PASS。
- 当前 P0：Lesson Governance Revocation and Supersession。
