# TradeBot 当前状态与接手说明

> 快照日期：2026-07-31
> 适用仓库：`/Users/hyx/Documents/workspace/tradebot`
> 历史交接：[`archive/project-status-and-handoff-through-2026-07-29.md`](archive/project-status-and-handoff-through-2026-07-29.md)
> 下一任务：[`next-loop-prompt.md`](next-loop-prompt.md)

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

Lesson Evidence Gate Projection 完成后的基线：

```text
npm run check       PASS
npm run test:ts     PASS (288/288)
npm run build:web   PASS (31 modules, 82ms)
git diff --check    PASS
npm run dev:paper   STARTED
```

启动地址：

```text
Web: http://127.0.0.1:5174/
API: http://127.0.0.1:8787
```

启动日志确认 Comparative Trade Review 与 Strategy Evidence API 已启用，exchange write capability disabled。

浏览器限制：宿主内置 Browser 列表为空并返回 `Browser is not available: iab`。Approved Lesson Semantic Materialization 的 1440×900、820×760、中英文、语义状态展示和 Console 尚未验证，不能标记为通过。

## 7. 下一阶段

执行 **Production Semantic Candidate Persistence Loop**：

1. 让生产 Reflection 路径持久化真实 `ReflectionLessonCandidateSchema`，不再只有 recommendations。
2. Candidate 必须绑定 source Trade、Decision Artifact、Market、regime 和 supporting evidence lineage。
3. Review Candidate 与 Semantic Candidate fingerprint 必须统一或具备显式绑定。
4. 不把 Candidate 或 Lesson 接入活跃 DecisionPipeline。

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
