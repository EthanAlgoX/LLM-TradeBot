# TradeBot 当前状态与接手说明

> 快照日期：2026-08-01
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

当前最新完成 Loop 是 **Approved Lesson Semantic Materialization**。它复用现有语义合同，并在缺少完整 Reflection Semantic Candidate 时 fail closed，不从 recommendations 猜测正文或失败模式。

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

- Approved Lesson 的持久化、Evidence/Approval 和 Decision Context 生产闭环。
- 通用 Graph Paper Runtime。
- 第二真实市场垂直切片。
- 交易所写接口。
- Slack、Email、Webhook 实际发送适配器。

Comparative Evidence 当前由 active production composition 的内存索引支持 Review 命令；Review History 持久化，但重启后旧 Comparative Evidence 本身不能凭客户端 ID 恢复。后续若持久化 Evidence，必须复用现有 Evidence 事实和 fingerprint，不建立第二套证据模型。

## 6. 最新验证

M1 历史对话 V1 完成后的最新完整基线：

```text
npm run check       PASS
npm run test:ts     PASS (328/328)
npm run build:web   PASS (31 modules, 82ms)
git diff --check    PASS
npm run dev:paper   STARTED
```

启动地址：

```text
Web: http://127.0.0.1:5174/
API: http://127.0.0.1:8787
```

启动日志确认 Comparative Trade Review、Runtime Evidence 与 Orchestration/API 已启用，exchange write capability disabled。

浏览器状态：M1 已通过真实 Chrome 完成 1440×900、820×760、中英文、会话恢复、Storage/Network、Console 与 Runtime 安全验收。M2 实现完成后仍必须使用真实 Chrome 验证数据中心可见工作流；不能只以自动化测试替代。

## 7. 下一阶段

执行 **数据中心 V1**（M2）：

1. 增加一级“数据中心”入口与服务端登记的 Data Assets 列表/详情。
2. 首期复用现有 Binance Public 与 CSV Historical 能力。
3. 展示 Snapshot、Schema、Quality、Lineage、更新时间与健康状态。
4. 让 Strategy Draft 显式绑定不可变 Dataset version/fingerprint。
5. 对缺失资产、跨 actor 引用和能力不匹配 fail closed。
6. 提供基于当前真实能力的 Market Radar，不伪造不可用数据。
7. 在真实 Chrome 中完成数据绑定、拒绝路径、窄屏和 Runtime 安全验收。

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
- 下一步执行唯一编号 [`LOOP-009`](loop-prompts/loop-009-m2-user-manual-chrome-acceptance-v1.md)（M2 用户手工 Chrome 验收，不进入 M3）。本轮不再要求 Agent 控制 Chrome：必须先向用户发出逐项验收表并等待回复，不能因控制通道不可用再次提前结束。

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
