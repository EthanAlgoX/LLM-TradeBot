# TradeBot 当前状态与接手说明

> 2026-08-03 接手更新：LOOP-029 已完成四页产品的功能化规划。用户已确认动态 DAG 与 Agent 中心可配置数据/模型/Prompt/版本的方向；下一步从 F1 Agent 中心真实版本管理开始。M0～M5 后端、M5 Shadow 与 Paper Only 边界未修改，M6 Live 仍未授权。

> 快照日期：2026-08-03
> 适用仓库：`/Users/hyx/Documents/workspace/tradebot`
> 历史交接：[`archive/project-status-and-handoff-through-2026-07-29.md`](archive/project-status-and-handoff-through-2026-07-29.md)
> 下一任务：[`next-loop-prompt.md`](next-loop-prompt.md)

> Git 快照规则：从 2026-08-01 起，每轮对代码或文档产生任何修改后，必须在最终汇报前创建范围明确的 commit 并推送当前分支到 `origin`。即使里程碑仍为 `PARTIAL`，执行记录和下一 Loop Prompt 的修改也必须提交、推送；禁止提交本地运行数据、Token、Secret 或 `data/local-paper-workspace*`。

## 1. 接手结论

仓库当前包含大量未提交的 Runtime、Web、SQLite、合同、测试和文档修改，均应视为用户工作并完整保留。

禁止：

- `git reset`
- `git checkout --`
- `git clean`
- 覆盖或回退无关修改
- 未经明确要求提交 Git

当前最新完成 Loop 是 **F1～F6 功能化规划（LOOP-029）**。它只更新文档，不修改实现或 Runtime。下一实现入口是 **F1 Agent 中心 V1（LOOP-030）**，浏览器在实现后必需；M5 真实边界继续 fail closed。

## 2. 当前可运行链路

```text
Registered Crypto Preset
-> Conversation Command
-> Registered Copilot Tools
-> Immutable Configuration / Pipeline Draft
-> Contract Validation
-> Backtest
-> Walk-Forward
-> Human Approval
-> Approved Paper Plan (NOT_APPLIED)
-> Controlled Paper Runtime
-> Runtime / Causal / Trade Review
-> Comparative Evidence
-> Lesson Candidate Human Review
-> Immutable Candidate Validation Binding
-> Real Configuration / Graph Validation
-> Existing Strategy Evidence Binding
-> Backtest -> Walk-Forward
-> Lesson Human Approval Gate (not executed)
-> Immutable Lesson Human Approval
-> Approved Lesson Artifact (Decision Context NOT_APPLIED)
-> ApprovedReflectionLesson Materialization (production facts currently unavailable)
-> Shadow Decision Context (NOT_APPLIED)
-> M5 Shadow snapshot comparison / terminal read-only recommendation (NOT_APPLIED)
```

Draft、Review、Handoff 和 Approval 都不会自动修改 Runtime。

## 3. 当前真实后端

### Orchestration 与 Strategy

- Registry、Capability、Preset、Agent Template 和 Pipeline Graph Validator。
- SQLite Configuration Draft 不可变版本和 Evidence stale。
- Registered Historical Graph Executor、Backtest、Walk-Forward。
- Strategy Evidence Binding、Human Approval、Approved Paper Plan。
- Conversation-first Copilot Tool Registry 与 Bearer API。

### Runtime

- Current Crypto Paper Binding 继续复用现有 `DecisionPipeline`。
- M4 supervisor 为每个 deployment/run/account 创建隔离 runtime handle，持久化 run/cycle/trade/artifact projection，并使用有界调度、lease/fencing、heartbeat 与退避恢复 active 实例。
- Selector `topN=1`，当前持仓进入 Position Monitor。
- Decision → Portfolio → Risk → Execution 不变。
- Preflight、Lease、Heartbeat、Fencing、Close-only、Drain、Safe Stop。
- Paper Only，`exchangeWriteAllowed=false`。

### Review

真实只读路由：

```text
POST /api/orchestration/trade-reviews/comparisons
POST /api/orchestration/lesson-candidates/inspect
POST /api/orchestration/lesson-candidates/reviews
POST /api/orchestration/lesson-candidates/reviews/history
POST /api/orchestration/lesson-candidates/validation-bindings
POST /api/orchestration/lesson-candidates/validation-handoff
POST /api/orchestration/lesson-candidates/evidence-gates
POST /api/orchestration/lesson-candidates/approvals
POST /api/orchestration/lesson-candidates/approvals/status
POST /api/orchestration/lesson-candidates/materializations
```

### M5 Shadow

真实只读路由：

```text
GET  /api/orchestration/paper-deployments/:deploymentId/shadows
POST /api/orchestration/paper-deployments/:deploymentId/shadows
```

- POST 只接受 idempotency key 与明确的 source run/cycle；actor、deployment、Champion/Challenger、策略/数据/图/执行/风险 fingerprint、adapter 和 policy 均由服务端解析。
- M4 `cycle`/`artifact` projection 仅通过精确 fact key 读取。Shadow facts 落在独立的不可更新、不可删除 `shadow_definitions`、`shadow_events`、`shadow_projection_events`。
- registered `CurrentCryptoReadOnlyShadowAdapter` 没有 Execution Port，`runtimeApplied=false`、`exchangeWriteAllowed=false`、`executionReachable=false`；没有账户、position、order、fill、journal、risk/safety 或 Artifact 写入路径。
- recommendation 只会是 `insufficient_data`、`observe` 或 `recommend_validation`，并始终 `readOnly=true`、`terminal=true`；它不能批准、部署、替换 Champion、启动、停止、归档、Apply Runtime 或写交易所。

当前行为：

- Comparative Evidence 从 Paper Account 读取真实 closed trade outcome。
- Comparator 由服务端按同 Graph、Market Pack、Symbol 和先前平仓时间选择。
- Reflection Candidate 必须来自显式 `sourceTradeIds`。
- 人工 Review 持久化到 SQLite，支持最新优先的有界 cursor 分页。
- Validation Binding 只接受 `selectedTradeId` 和幂等键；Actor、Draft、Graph 与 fingerprint 均由服务端派生。
- 服务端从 Trade Graph ref 推导 Pipeline Draft，并反查唯一最新 Strategy Draft；零匹配或多匹配 fail closed。
- SQLite binding append-only，支持 parent fingerprint 和版本历史，禁止 update/delete。
- Validation Handoff 重新核对 Candidate、Review、Evidence、最新 Draft 和 Graph fingerprint；漂移返回 stale。
- 双层验证通过后只返回 `nextGate=backtest`，不会创建 Evidence、Approved Lesson、Strategy mutation 或 Runtime apply。
- Evidence Gate 请求只允许 Trade、幂等键和 `inspect|run_backtest|run_walk_forward`；Dataset、Profile、Candidate Set、Plan、Runner、Evidence、Approval、Draft 和 Graph 均由服务端控制或拒绝。
- 复用现有 Strategy Evidence Binding 与注册 Evidence Job；Backtest 和 Walk-Forward 双通过后只返回 `approval_required`，不执行 Approval。
- Lesson Approval 独立于 Strategy Approval；审批前重新验证现有 Evidence Artifact，SQLite 记录不可更新/删除。
- Approve 创建包含完整服务端 scope 的 Approved Lesson Artifact；Reject 不删除 Candidate/Evidence；两者均不修改 Decision Context 或 Runtime。
- Materialization 重新核对 Approval、Evidence Gate、Candidate、Market 和 fingerprint，复用现有 `ApprovedReflectionLessonSchema`。
- 当前生产 Reflection Report 只有 recommendations/adjustments/sourceTradeIds，缺少完整语义 Candidate，API 返回 `semantic_facts_unavailable`；不会由 LLM 或客户端补写。

## 4. Web 状态

已接真实 API：

- Strategy Workspace 与 Copilot Draft orchestration。
- Runtime Controls 和 Runtime Evidence。
- Causal Run/Cycle/Trade Review。
- Comparative Evidence、Candidate Review、Review History。
- Contract Validation Handoff 状态与稳定 issue code。
- M5 Shadow / Promotion assessment：真实 source scope、lineage、data quality/health、evidence gaps、描述性 diff、只读 recommendation 和有限历史分页。

R1 页面内存预览（非真实 API）：

- 模拟交易：两个运行 Sample、一个空闲槽位、对比曲线和最近决策；
- 编排工作台：三组自然语言 Sample、对话内动态 Agent DAG、应用方案与 Pending 验证门槛；
- Agent 中心：Input、Analysis、Decision、Reflection 四类；
- 连接配置：数据源与模型 API 两个 Tab；
- 所有内容都标记 `SAMPLE`、`PROTOTYPE`、`NOT CONNECTED` 或 `UNAVAILABLE`，不混入真实 Data / Paper / Shadow facts；
- 创建 Prototype 不写 Storage、Cookie、API、SQLite、Runtime 或交易；第四 Simulation Start intent 只返回页面状态拒绝，`runtimeCall=none`。

已规划但未实现的功能化顺序：

```text
F1 Agent Center V1
-> F2 Connections V1
-> F3 Workbench V2 / real LLM structured DAG
-> F4 Preflight + Backtest + Walk-Forward
-> F5 Simulation V2 / existing M4 integration / max 3
-> F6 Hardening
```

F1 的用户可编辑 System Prompt 只是 Agent 行为层；平台安全规则、工具权限、输出 Schema、Portfolio/Risk/Execution 权限不可编辑。任何 Prompt、Model、Data 或上游合同修改都创建新 Agent Version，不热更新已发布或运行版本。

必须区分：

- `MOCK`
- `DRAFT`
- `VALIDATED`
- `APPROVED_NOT_APPLIED`
- `ACTIVE PAPER RUNTIME`
- `RECENT TERMINAL RUN`
- `VALIDATION_UNAVAILABLE`
- `STALE`

Copilot 没有 Runtime Apply、Start、Pause、Safe Stop 或下单工具。Runtime Controls 仍走独立受控链路。

## 5. 当前不可用或未闭环

- 通用 Graph Paper Runtime。
- 第二真实市场垂直切片。
- M6 Live/Canary、账户权限、交易所写接口、自动晋升、Champion 替换或持仓迁移（均未授权）。
- Slack、Email、Webhook 实际发送适配器。

Comparative Evidence 当前由 active production composition 的内存索引支持 Review 命令；Review History 持久化，但重启后旧 Comparative Evidence 本身不能凭客户端 ID 恢复。后续若持久化 Evidence，必须复用现有 Evidence 事实和 fingerprint，不建立第二套证据模型。

## 6. 最新验证

LOOP-027 R1 完成后的最新验证：

```text
npm run check       PASS
npm run test:ts     PARTIAL（既有 orchestration-copilot 异步 SQLite 关闭问题）
npm run build:web   PASS
git diff --check    PASS
npm run dev:paper   STARTED（Web/API 已存在）
```

启动地址：

```text
Web: http://127.0.0.1:5174/
API: http://127.0.0.1:8787
```

产品预览不启动 Runtime、Worker 或额外后台程序；应用方案仍显示 `runtimeApplied=false`、`exchangeWriteAllowed=false`。受影响的预览状态测试为 2/2 PASS。

浏览器状态：LOOP-027 Agent 直接控制真实 Chrome。中文 1440×900 验证模拟首页、编排工作台和应用方案；中文/英文 820×760 验证 Agent 四分类、连接配置两个 Tab，所有页面 `scrollWidth=clientWidth`，Console error 0。页面已留在中文模拟交易首页。

LOOP-028 R1.1 完成后的最新验证：

- 模拟交易底部复用旧 Runtime Evidence 的 Artifact lineage 表达，两个 Sample 策略均显示 Agent 输出轮次、时间、上游与下游；
- 编排工作台变为单一聊天线程，修改为 Crypto 需求后追加 `Crypto Trend Guard`，其 6-Agent 拓扑不同于原 HK 方案；
- 应用 Crypto 方案后出现 Preflight、Backtest、Simulation Slot 三个 Pending 门槛，未启动 Runtime；
- Agent Chrome 1440×900 与 820×760 均为零横向溢出，US Dialogue 切换成功，Console error 0；
- `npm run check`、`npm run build:web`、受影响测试和 `git diff --check` 通过。

LOOP-029 只整理规划与进度文档：不修改产品代码、SQLite、浏览器状态或本地运行数据，因此浏览器要求为 `NOT_REQUIRED`。文档把旧六页/“自然语言直接编排”表述统一为四页、Agent 中心预配置和 LLM 受约束推荐，并建立 F1～F6 顺序与 LOOP-030 唯一入口。

## 7. 下一阶段

状态为 **FUNCTIONALIZATION_PLANNED / READY_FOR_F1**：

1. 执行 [`LOOP-030`](loop-prompts/loop-030-f1-agent-center-versioned-configuration-v1.md)，建立真实 Agent Definition/Version、Repository/API 和 Agent 中心详情工作台；
2. LOOP-030 实现后必须由 Agent 直接操作真实 Chrome 验证；禁止用静态 DOM、API 或用户手工代替 UI 证据；
3. F1 允许引用已有 Registry、Dataset 和 Model facts，但不得动态上传代码、暴露 Secret 或实现 Runtime Apply；
4. 保持 M0～M5 runtime、M5 Shadow、账户和交易所写边界不变；不执行 LOOP-025 / M6。

### LOOP-021 审计与验证（2026-08-02）

- `npm run check`、`npm run test:ts`（358/358）、`npm run build:web` 与 `git diff --check` 均通过。
- `npm run dev:paper` 发现 5174/8787 已由本项目当前服务占用，遵循 Loop 要求未中断；该服务明确显示 `Paper Only` 与 `Exchange writes OFF`。
- Agent 直接控制真实 Google Chrome 检查中文交易页：页面连接成功，Console error 为 0；但页面只提供单一 `Paper Runtime control`，未提供“模拟 / 真实”分段、Deployment 创建、Overview、多曲线或五 Tab Detail，故不能进行两实例和双尺寸的产品验收。
- LOOP-021 当时转入 `LOOP-022` continuation；该历史结论现已由 LOOP-022 的执行结果和 LOOP-023 接续取代。M4 仍不得创建 Live、自动 Candidate 部署或交易所写路径。

### LOOP-022 审计与验证（2026-08-02）

- 新增 actor/deployment/kind-bound cursor 的 run/cycle/trade/artifact 持久 Projection，并完成模拟/真实无副作用切换、Simulation Overview、创建入口和五个 Detail Tab 的惰性请求界面。
- `npm run check`、`npm run test:ts`（359/359）、`npm run build:web` 与 `git diff --check` 均通过。
- Agent Chrome 已完成中文/英文、1440×900/820×760、窄屏无横向滚动和 Console error=0；Network 为 `TOOL_UNAVAILABLE`。Runtime 保持 Paper Only、`runtimeApplied=false`、`exchangeWriteAllowed=false`。
- M4 未关闭：Deployment scheduler 尚未接入现有唯一 Paper 动作链，不能验证两个实例的真实 cycle、独立交易事实、close-only 和 Web/API 重启恢复。下一步执行 [`LOOP-023`](loop-prompts/loop-023-m4-deployment-scoped-paper-cycle-closeout-v1.md)。

### LOOP-023 审计与验证（2026-08-02）

- 将现有 Current Crypto binding 接入 deployment/run/account scope；每次执行均复用 `Decision -> Portfolio -> Risk -> Execution`，持久化真实 cycle、trade 与 Artifact lineage，未新增模拟撮合器或 exchange write。
- SQLite aggregate 增加幂等 projection fact key、active deployment recovery、lease/fencing、heartbeat、退避与 terminal state 保护；测试覆盖陈旧 worker 拒绝、重复事实抑制、两实例恢复和 close-only `close_long`。
- Agent Chrome 在中文 1440×900 从两个可见 Strategy Version 创建、预检和启动 A/B；观察独立 account/equity/heartbeat/curve/artifact，停止 A 后受控平仓且 B 持续。刷新与 Web/API 重启后 B 恢复、A 保持 stopped。英文 820×760 无横向滚动且 keyboard focus 可见。
- `npm run check`、`npm run test:ts`（全量通过；当前 380 个 `test()` 用例）、`npm run build:web` 与 `git diff --check` 通过。Runtime 始终为 Paper Only、`runtimeApplied=false`、`exchangeWriteAllowed=false`；Network 和 Console clear 为 `TOOL_UNAVAILABLE`，日志仅见 Chrome 扩展异步消息错误。
- M4 为 `COMPLETE`；下一步执行 [`LOOP-024`](loop-prompts/loop-024-m5-shadow-promotion-recommendations-v1.md)。

### LOOP-024 审计与验证（2026-08-02）

- 新增 shared Shadow/Promotion contracts、独立 SQLite `shadow_definitions`、`shadow_events`、`shadow_projection_events` 和不可变触发器。definition/event/projection 与 M4 表完全分离，actor/deployment/run/cycle source scope、idempotency、unique source scope、opaque cursor 与重启恢复均由服务端约束。
- M5 service 仅用 `projectionByFactKey` 精确读取现有 M4 cycle/artifact projections，再核验 source run、account/Artifact lineage 和 server materialized Strategy/Dataset/Graph/Execution/Risk fingerprints。missing -> unavailable、drift -> stale、source mismatch -> `SHADOW_SOURCE_SCOPE_AMBIGUOUS`；不从 latest 补造事实。
- `CurrentCryptoReadOnlyShadowAdapter` 没有 Execution Port，且暴露 `executionReachable=false`、`exchangeWriteAllowed=false`。Shadow 不写 M4 account、positions、orders、fills、cycle journal、risk/safety 或 existing artifacts；独立测试在前后比较 M4 cycle/artifact projections。
- 服务端 policy `1.0.0` 只发 terminal/read-only `insufficient_data`、`observe`、`recommend_validation`，而 Shadow entry 不提供 Start/Stop/Archive/Apply/replace 控件。Champion/Challenger 仅在同 scope 内报告 decision/risk/expected exposure/data quality/health/evidence gaps，明确不声称因果或收益。
- 自动化：`npm run check`、`npm run test:ts`、`npm run build:web`、`git diff --check` PASS；M5 测试覆盖独立事实、隔离/分页、client injection 拒绝、并发幂等、recovery、terminal 不重复和 missing/stale/ambiguous fail-closed，M4 双实例/close-only 回归同时通过。
- Agent Chrome：中文 1440×900 和英文 820×760 均读取真实 M4 A/B Shadow record；快速实例切换无串台，Simulation/Live 切换无副作用，刷新和重启 Web/API 后 source/recommendation 持久恢复，窄屏 `scrollWidth=clientWidth=820`。Network 及 Console clear 能力为 `TOOL_UNAVAILABLE`；可读取的 Console warning/error 为 `[]`。M5 为 `COMPLETE`，下一步为 [`LOOP-025`](loop-prompts/loop-025-m6-live-canary-authorization-gate-v1.md) 的非操作性 M6 授权门槛准备。

### LOOP-026 审计与验证（2026-08-02）

- 新增隔离的 Web 页面内存模块：`strategy-app-preview-state.ts` 只管理 Sample / Prototype 状态和三槽位产品规则；`strategy-app-preview.ts` 与 CSS 承载可移除的预览视图。没有 API、SQLite、localStorage、sessionStorage、Cookie、LLM、Worker 或 Runtime 调用。
- 策略助手提供港股低风险趋势与财报、美股财报事件、加密趋势三个 Sample 场景；Proposal 显示数据、Agent、风险、频率、假设、缺口和 Evidence 状态。创建后进入 `PROTOTYPE · PAGE MEMORY` 详情，刷新恢复初始 Sample。
- Strategy App 详情提供 Overview、Agents、Data、Strategy logic、Risk & runtime、Evidence、Versions 七个只读 Tab；Risk / Execution 标记为 SYSTEM LOCKED，Live 始终 `UNAVAILABLE / NOT AUTHORIZED / Exchange writes OFF`。
- Agent Chrome 验收：中文 1440×900 完成主路径；英文 820×760 无横向溢出，七 Tab、三类 Agent、搜索/详情和既有 Data Center / Experiment / Paper / Shadow 入口可达。Console clear 与 Network 读取为 `TOOL_UNAVAILABLE`；Runtime 安全保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。
- 自动化：`npm run check`、`npm run test:ts`、`npm run build:web`、`git diff --check` 通过；新增测试覆盖三槽位、第四意图拒绝 / 无 Runtime 调用、Sample / Prototype 边界和页面内存创建。
- LOOP-026 为 `COMPLETE / READY_FOR_USER_REVIEW`。下一步仅为 `AWAITING_USER_PRODUCT_REVIEW`，不得擅自进入 M6。

### M1 实施状态（2026-08-01）

- 已完成：SQLite Conversation Replay read model、actor-scoped SQL-bounded cursor pagination、Conversation/Turn/detail Bearer GET API、Draft Reference 服务端恢复、三栏历史会话工作台和 `conversationId` localStorage 恢复。
- 已完成：Authority 对完整 `draftId/versionId/fingerprint` 比较；跨会话/actor 无历史 Draft 继承 fail closed；严格 pagination/id 校验、只读端点 `405`、不存在会话 `404`、`runtimeApplied=false` 传播与 HTTP/状态测试。
- 已完成身份桥：干净的单命令 `npm run dev:paper` 启动会将同一随机 Operator Token 注入 API 与 loopback Vite；Strategy Workspace 使用 global runtime injection → DEV Vite injection → manual page-memory fallback 的顺序，不依赖一次性 session event。production build 不读取该 token。
- 验证通过：`npm run check`、`npm run test:ts`（最新 328/328）、`npm run build:web`、production sentinel leak check、`git diff --check`；干净重启后 5174 和 8787 均可达，且启动日志确认 Web/API、development injection 与 Exchange Write disabled。
- 本轮浏览器插件复验：干净 local Paper workspace 中，5174 自动认证为 Real backend connected；第一会话的 v2 Draft、第二会话、会话隔离、1440 中文与 820 英文、刷新与一次 Web/API 重启均通过，重启后恢复已选会话的 2 Turn/v2，且始终 `runtimeApplied=false`、控制台无 warning/error。原损坏 local workspace 已移至可恢复备份 `data/local-paper-workspace.backup-20260801T183000`。
- 后续真实 Chrome 已确认 session、conversation list、turn list 均为 200 且无 401，受控 Copilot 成功创建 Draft Version 3，Console 无 warning/error，Runtime/Exchange 安全边界保持成立。
- LOOP-003 保持未完成用户手工交接的历史记录。LOOP-004 中用户明确授权 Agent 直接操作真实 Chrome DevTools：localStorage、sessionStorage 与 Cookie 均为空；可见 Composer 触发的 `POST /api/orchestration/copilot/messages` 为 `200`，产生仅 Draft 的 Version 5；Console 清空并刷新后无 TradeBot 页面 error/warning。全程未读取或复制 Storage/Cookie/request value，Runtime 仍为 `runtimeApplied=false`、Paper Only、Exchange writes OFF。
- LOOP-005（M2 数据中心 V1）为 `PARTIAL`：新增服务端登记 Data Assets API、Binance Public/CSV Historical 的真实来源标签、CSV Snapshot/Schema/Quality/Lineage 投影，以及 Dataset version/fingerprint/capability 的不可变 Configuration Draft binding。Binding 由 Bearer actor 限制，跨 actor、缺失 Dataset、非法版本和能力不匹配均 fail closed；所有结果仍为 `runtimeApplied=false`。
- 新增一级“数据中心”页面与 Market Radar。没有登记的实时 Binance Snapshot 不会伪造成实盘数据；当前 Regime、Mover、Volume、Funding/OI 均标记 unavailable。"送入编排"只导航至受控 Draft 意图，不含 Runtime Apply、Paper Run 或交易所写入。
- 自动化在本轮首版通过：`npm run check`、`npm run test:ts` 328/328、`npm run build:web`。但 Chrome 控制通道在点击和刷新后两次超时重置，未能完成 LOOP-005 强制的 1440×900/820×760、可见绑定/拒绝、Console 与 Network 验收；不得标记 M2 COMPLETE。
- LOOP-006（M2 收尾）仍为 `PARTIAL`：本地 Paper 服务成功启动，`npm run check`、`npm run test:ts`（328/328）、`npm run build:web` 与 `git diff --check` 均通过；但 Chrome 控制通道明确不可用，故未执行或声称完成真实 Chrome 的桌面/窄屏、资产标签、CSV 正向 UI 绑定与刷新恢复、负向路径、Console/Network 验收。没有修改产品代码或 `data/local-paper-workspace*`。
- LOOP-007（M2 Chrome 收尾）仍为 `PARTIAL`：真实 Chrome 已启动，但页面导航控制持续超时；未伪造中文/英文响应式、资产标签、CSV UI 绑定、负向路径或 Console/Network 结论，也未修改产品代码。自动化仍为 328/328 PASS，Runtime 安全边界保持不变。
- LOOP-008（M2 用户协同 Chrome 收尾）仍为 `PARTIAL`：真实 Chrome 控制通道不可用，执行窗口未完成计划中的用户手工交接，因此桌面/窄屏、资产标签、CSV UI 绑定与刷新恢复及 Console/Network 均没有可判定的浏览器证据。Runtime 安全边界与 328/328 自动化基线保持不变；未修改本地 workspace 数据。
- LOOP-009（M2 用户手工 Chrome 验收）仍为 `PARTIAL`：服务可达，真实 Chrome 页面能够打开，但执行窗口再次尝试 Agent 控制并连续超时；所有浏览器项均为未取得证据，而非产品失败。没有敏感值暴露，也没有代码、文档或本地 workspace 数据修改。
- LOOP-010 首次执行仍为 `IN_PROGRESS`：本地服务和页面可达，check、328/328 tests、34-module Web build 与 diff-check 通过，Git 干净且已同步；但 Agent Chrome 在读取页面 DOM 时超时重置，未取得 UI、响应式或 Console/Network 证据，也未修改代码或文档。
- 后续 P0 诊断确认超时根因不是后端进程过多，而是数据中心 MutationObserver 监听自身 `innerHTML` 更新形成无限 render/load。修复前独立 Chrome Renderer 约 89% CPU/3.6GB RSS；改为 host identity 有界挂载并取消离页请求后约 0.2% CPU/212MB RSS，Data Assets 请求稳定。check、329/329 tests、35-module Web build、diff-check、1440/820 无横向溢出及 Console error=0 均通过；完整 Agent Chrome 正向绑定/刷新恢复和 Network 仍留在 LOOP-010 V2。
- LOOP-010 以 `PARTIAL` 结束：P0 卡死修复已提交并推送为 `7f2017180cc1b15b660e5a66d0ec80b729c8497b`，但独立性能冒烟不替代完整 Agent Chrome CSV 正向绑定、刷新恢复和 Network 证据，M2 仍为 `IN_PROGRESS`。
- LOOP-011 为 `PARTIAL`：真实 Agent Chrome 已通过性能护栏、中文 1440×900、英文 820×760 和资产真实性；修复的 1440px 顶栏溢出已提交为 `cfe074724a5837872011b5c7eeab865c4a0fc562`。验收同时确认编排侧没有消费 `tradebot:orchestration-data-intent`，“送入编排”只导航，CSV 正向绑定、刷新恢复和 Network 因此未完成。
- LOOP-012 为 `PARTIAL`：提交 `52d27785bfc055c7f6dc2a90b74831853cb45d04` 已实现 CSV intent 消费者、待绑定卡片、确认 Binding、append-only Conversation Draft Reference 更新与恢复路径；自动化为 329/329 PASS。真实 Agent Chrome 已确认 CSV/Binance 资产真实性、卡片与安全提示，但运行中的后端没有产生 CSV-backed Market/Agent Draft，故正向绑定、刷新恢复、继续对话、响应式和 Console/Network 未取得完整证据。
- 根因是 Current Crypto recipe/Graph 的注册 data-source set 为 Binance Public；显式请求 CSV 会被正确的 Graph exact-set 校验拒绝，不得放宽。LOOP-013 已通过独立 CSV Historical Preset/Graph 和可见创建入口解决该能力缺口，提交 `b7d9fa65a5a9a3220685a5003592a3940c5797ad` 已推送；331/331 自动化通过。Agent Chrome 已确认中文资产、真实 CSV Draft 创建与启用确认动作，但未完成 Binding 成功态、权威引用与刷新恢复、继续对话、英文窄屏及 Console/Network 观察，故 LOOP-013 为 `PARTIAL`、M2 仍为 `IN_PROGRESS`。
- LOOP-014 为 `PARTIAL`：提交 `69d785d710f2db2293227137b494a9ba5aa5d999` 已修复 Conversation Replay 缺失 Dataset version/fingerprint 投影，以及同毫秒追加权威 Turn 的稳定排序；332/332 自动化通过。Agent Chrome 已验证 CSV 正向 UI Binding、Authority 与刷新恢复、中文 1440×900、英文 820×760、负向 fail-closed 和产品 Console。继续对话实际返回 `INTERNAL_ORCHESTRATION_ERROR`，因此 M2 不关闭；Network 因 Agent Chrome 不提供读取能力而未验证，不要求用户人工补验。
- LOOP-015 为 `IN_PROGRESS`：提交 `0ca86b7c2a2c1de70c2891cec6a832d3bbb0119f` 已修复 CSV Historical Agent Template 的允许字段、域错误到 HTTP 的稳定映射、按权威 Draft 精确选择 CSV recipe/Graph，以及服务重启后的 replay mapping；333/333 自动化通过。Agent Chrome 中文 1440×900 页面稳定且 CSV 资产可见，但可见 Binding 返回 `REQUEST_CONTRACT_INVALID`，故 Binding → Composer、英文窄屏与负向闭环未验证；Console 无产品 error，Network 为 `TOOL_UNAVAILABLE`。
- LOOP-016 为 `PARTIAL`：提交 `c68aad5819accbe99db6a3ab17b2b9c300cb6ea6` 已将 Dataset Binding request 收拢为前后端共享严格 Schema，并把超过 160 字符的旧拼接 idempotency key 改为稳定有界 `binding.<uuid>`；334/334 自动化和正式 handler 幂等/fail-closed 通过。Agent Chrome 中合同错误已消失，但 Binding 后历史恢复会切换到非 CSV Draft 上下文，因此正向闭环、Composer、英文窄屏与 Authority 恢复未验证；Console 无产品 error，Network 为 `TOOL_UNAVAILABLE`。
- LOOP-017 为 `COMPLETE`：提交 `b78a6f76e99bc5e17fb5e70586cf5907fc619b9a` 已确认服务端 Binding/Turn 排序正确，并修复 Web 全局 history/localStorage 重新选择、陈旧 load 响应覆盖、Turn merge Authority 与 pending/result 跨会话污染。Binding 后现对原 conversation 定向 read-after-write，并校验完整 Draft/Dataset identity；336/336 自动化通过。Agent Chrome 已完成 CSV Binding、刷新、本项目服务重启、Composer、A/B 往返、分页、中文 1440×900、英文 820×760、负向和 Console；Runtime 保持未应用，Network 为 `TOOL_UNAVAILABLE`。M2 已关闭。
- LOOP-018、LOOP-019、LOOP-020 均为 `COMPLETE`：LOOP-020 将 Experiment contracts、Repository/API、不可变 snapshot、comparability、Evidence、constraints、Replay、Candidate 和 Web 状态补齐，新增 deterministic plan/CSV registration、完整 eligibility、Walk-Forward 有界派生键和 equity DOM 护栏。353/353 自动化通过。Agent Chrome 完成真实差异策略的 Backtest、109-fold Walk-Forward、唯一 Candidate、Replay、Open Class、少于两名负向、中英文双尺寸与 Web/API 重启恢复；Runtime 始终未应用，Network 为 `TOOL_UNAVAILABLE`。下一步执行 [`LOOP-021`](loop-prompts/loop-021-m4-multi-paper-runtime-center-v1.md)。

完整 Prompt：[`next-loop-prompt.md`](next-loop-prompt.md)。

## 8. 开发与验证命令

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
npm run dev:paper
```

除非任务明确要求，不要自动修改或提交 `.playwright-cli/`、`output/`、SQLite 数据库和其他本地产物。
## Latest Loop：Production Semantic Candidate Persistence

- `ReflectionReportSchema` 现在可携带严格 `semanticLessonCandidates`，Rule Reflection 仅用服务端失败 Trade 和 Decision Artifact 生成确定性语义事实。
- `SQLiteReflectionStore` 同事务保存 Report/Candidate，Candidate 表 append-only，并拒绝同 ID fingerprint 漂移。
- Review、Validation、Approval 与 Materialization 共享同一个持久化 Candidate ID/fingerprint；旧的 report/sourceTrade 合成 Candidate 已移除。
- Review Web 展示 Semantic Facts 和 verified lineage，仍无 Runtime Apply 或交易控制。
- 当前 Materialization 可恢复真实 Approved Lesson；Shadow Decision Context Base 仍 unavailable，下一 Loop 处理只读历史 Replay。
- 交易行为未改变：Paper Only、Selector topN=1、Position Monitor、Decision→Portfolio→Risk→Execution 和 Runtime Safety 保持原样。
- 验证结果：check PASS、TypeScript tests 293/293 PASS、Web build PASS（31 modules，59ms）、diff-check PASS；浏览器不可用时不标记视觉验证通过。
## Latest Loop：Approved Lesson Shadow Decision Context Replay

- 新增 Artifact Ledger Shadow Base Adapter，恢复并映射真实 data/analysis/Bull/Bear/Decision/Portfolio/Risk Agent Artifact。
- DecisionPipeline 只扩充 Ledger 输入，记录 Portfolio 与 Runtime control 快照；Agent 入参、选择、Risk 和 Execution 行为不变。
- Materialization Shadow Projection 支持 validated/unavailable/stale 和稳定 lineage issue code。
- Production Composition 在配置 Artifact DB 时启用真实 Shadow Replay；重启恢复保持 fingerprint 稳定。
- Web 展示只读 Shadow 历史重放状态，无 Runtime Apply 或交易操作。
- 验证结果：check PASS、TypeScript tests 298/298 PASS、Web build PASS（31 modules，65ms）、diff-check PASS；浏览器不可用时不标记视觉验证通过。
## Latest Loop：Shadow Replay Durability and Approval Audit

- 新增 SQLite append-only Shadow Audit Repository、严格审计合同和 Bearer 历史 API。
- Materialization 仅在 Shadow validated 后 append，幂等冲突和 fingerprint 漂移 fail closed。
- Web 在现有 Approval 区域展示审计版本和 Approval/Candidate/Context lineage。
- 未增加 Apply、Start、Pause、Safe Stop 或交易工具；现有 Runtime 行为不变。
- 验证结果：check PASS、TypeScript tests 302/302 PASS、Web build PASS（31 modules，62ms）、diff-check PASS。

## Latest Loop：Generic Configurable Input and Multi-Agent Semantic Pipeline

- 产品边界已校正：TradeBot 是“通用注册输入 + 可配置多 Agent”的交易系统，不按 A 股、港股、美股、币圈拆成独立产品流程。
- 新增严格 Semantic Pipeline Preview 合同、核心服务与 Bearer API：`POST /api/orchestration/configuration/semantic-pipeline/preview`。
- API 只接受现有 Strategy Configuration Version 和幂等键；Actor、Market、Source、Capability、Agent Template 与拓扑均由服务端事实解析。
- 返回 Data Source Capability、Observation Window、多 Agent 输入/输出 Artifact 类型、Validation issue 和下一门禁。
- 当前只完成真实配置/拓扑投影，未执行生产输入或 Agent 推理，未创建 Decision Context；全部 Apply/Exchange 标志为 false，现有交易行为不变。
- 验证结果：check PASS、TypeScript tests 307/307 PASS、Web build PASS（31 modules，70ms）、diff-check PASS。
- 下一阶段执行 [`next-loop-prompt.md`](next-loop-prompt.md) 中的 Registered Semantic Input Execution and Decision Context Assembly。

## Latest Loop：Registered Semantic Input Execution and Decision Context Assembly

- 新增严格执行 Command/Record、核心执行服务、SQLite append-only Repository 和 Bearer execute API。
- 本地生产组合只注册有界 fixture source 与确定性 Agent Adapter；客户端不能上传事实、实现、Runner、代码、URL、SQL、路径、账户或 Runtime 参数。
- Observation、Assessment 和可选 Decision Context 直接使用现有语义合同；没有第二套 Artifact 或 Decision Context 模型。
- 完整服务端 Portfolio/Risk/Data Quality 快照可以生成 validated Decision Context；当前默认生产组合缺快照时返回 `DECISION_CONTEXT_SNAPSHOT_UNAVAILABLE`。
- Preview/config fingerprint 漂移 fail closed 为 stale；执行幂等结果持久化且禁止 update/delete。
- Web 新增中英文稀疏执行摘要与 loading/stale/ready/unavailable 状态，不提供 Runtime Apply 或交易工具。
- 所有结果未应用 DecisionPipeline 或 Runtime，现有 Selector、Position Monitor、Risk、Execution 和 Paper Safety 行为不变。
- 验证结果：check PASS、TypeScript tests 313/313 PASS、Web build PASS（31 modules，69ms）、diff-check PASS。
- 下一阶段执行 [`next-loop-prompt.md`](next-loop-prompt.md) 中的 Generic Historical Semantic Evaluation Loop。

## Latest Loop：Generic Historical Semantic Evaluation

- 新增严格 Evaluation Command/Response、核心桥接服务、Bearer API：`POST /api/orchestration/semantic-evaluation/actions`。
- 桥接层从 SQLite Semantic Execution 恢复严格 Observation/Assessment，并校验未来数据、Dataset Data Source scope、lineage 和当前 Preview/Agent Adapter fingerprint。
- 通过后复用现有 Strategy Evidence Service 的 Binding、Backtest、Walk-Forward 和 Human Approval；没有第二套 Evidence Job、Artifact 或 Approval。
- Operator 创建/运行 Evidence，Approver 只在现有 Binding 双 Evidence 通过后批准，角色链不被桥接层绕过。
- 结果保持 `runtimeApplied=false`、`exchangeWriteAllowed=false`；Approved Paper Plan 不自动激活。
- 验证结果：check PASS、TypeScript tests 319/319 PASS、Web build PASS（31 modules，70ms）、diff-check PASS。
- 下一阶段执行 [`next-loop-prompt.md`](next-loop-prompt.md) 中的 Generic Paper Runtime Migration Readiness Loop。
