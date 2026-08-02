# LOOP-018 — M3 实验场 V1

```text
Loop ID：LOOP-018
里程碑：M3 实验场 V1
状态：COMPLETE（由 LOOP-020 完成全链验收）
前置 Loop：LOOP-017（COMPLETE，M2 数据中心 V1 已关闭）
执行环境：本地仓库 + 实现后由 Agent 直接控制真实 Google Chrome
浏览器要求：实现后必需；禁止用户手工验收或 DevTools 交接
验收模式：EXPERIMENT_LAB_AND_AGENT_CHROME_VERIFIED
```

关闭结果：LOOP-020 已完成严格合同、SQLite 权威聚合、真实 Graph Evidence、Replay、Candidate、双尺寸 Agent Chrome 与重启恢复验收；M3 已关闭。

## 目标

把当前静态、Mock 的 `Agent Lab` 收敛为真实、可重放、服务端权威的“实验场 V1”：

1. 从 actor-owned 的历史 Conversation/Configuration Strategy Version 中选择 2～5 个参与者；
2. 锁定 Dataset、时间、Universe、资金、费用、滑点、Execution/Risk、Model/Prompt 与失败策略；
3. 使用现有真实 Graph Backtest 与 Walk-Forward Evidence runner 执行相同条件的实验；
4. 展示真实净值曲线、最大回撤、核心 Scorecard、配置 Diff、公平比较结论与 Evidence lineage；
5. 满足目标与约束的版本只能形成不可变 Candidate，不得直接 Apply Runtime、审批或发布到 Paper/Live。

同一 Experiment 在输入和注册依赖不变时必须得到相同 fingerprint 与相同 Evidence refs；条件不一致时只能标记 `OPEN_CLASS` 并做描述性比较，或在能力不兼容时 fail closed，不能声称单因素因果或伪造赢家。

## 当前事实与复用边界

- 当前 `renderLab()` 是静态 Mock：固定 Atlas 3.9、伪造回测指标，并包含审批/Paper 发布按钮。M3 必须移除这些假数据和误导动作。
- `#lab` 与 `#experiment` 当前都映射到同一静态页面；可以在 V1 中统一为同一真实实验工作台，但路由和导航语义必须明确，不产生双重挂载。
- 已有可复用的真实能力：
  - immutable Configuration Draft/Version、历史 Conversation、actor authority；
  - `ExecutableStrategyConfigurationService` 与派生的 profile/candidate set；
  - registered Dataset/Graph/Profile/Walk-Forward Plan；
  - `GraphBacktestRunner`、`GraphWalkForwardRunner`、`DurableGraphEvidenceJobService` 和 SQLite Evidence jobs；
  - Graph Backtest/Walk-Forward Artifact、metrics、cycles、fingerprint 与 promotion eligibility 验证。
- 现有 `StrategyEvidenceApprovalService` 面向“当前配置 → Evidence → Approval/Paper Plan”，会检查 latest Configuration scope。实验场需要比较历史不可变版本，不得放宽或改写这条生产晋升语义。
- 实验场应复用底层 runner/job/artifact，不建立第二套回测计算；但需要独立 Experiment aggregate 锁定参与者及其传递依赖快照，并与 Approval/Paper Plan 隔离。
- Graph trading metrics 当前真实提供 total return、max drawdown、trade/fill/risk rejection/cycle counts 和每周期 equity；未提供 Sharpe、Sortino、Profit Factor 等指标时必须显示 `unavailable`，不得客户端推测或填 Mock。
- 当前完整自动化基线：336/336 PASS；M2 的 Conversation epoch、Dataset Binding 与 Runtime safety 不得回归。

## 强制安全边界

- 全程 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。
- M3 不得调用或暴露 approve、materialize-to-runtime、Paper Plan、Paper Run、deploy、order 或 exchange-write 动作。
- Backtest/Walk-Forward 可以使用隔离的 simulated execution state，但不得触碰当前 Paper/Live account、positions、journal 或 Runtime supervisor。
- 参与者、Dataset、Graph、Profile、Prompt/Model、Risk 与 Evidence 必须由服务端解析和校验；客户端只能提交允许的 opaque IDs、枚举、时间和有界目标/约束。
- 禁止把任意代码、SQL、URL、文件路径、模型密钥、Prompt 正文、Runner 名称或执行实现从客户端注入实验。
- 保持 actor isolation、append-only、完整 version/fingerprint authority、strict Zod contracts、有界 cursor、idempotency 与 fail-closed。
- 禁止直接修改/清空 `data/local-paper-workspace*`、SQLite 或浏览器资料制造实验参与者或结果。
- 禁止要求用户点击、截图、打开 DevTools 或口头验收；实现后由 Agent 直接控制真实 Google Chrome。
- 保留用户既有修改；禁止 `reset`、`checkout`、`clean` 或回退无关改动。

## 第一阶段：审计与垂直切片设计

先阅读：

- `renderLab()`、当前路由与工作台挂载生命周期；
- Configuration Draft、Conversation proposal/Tool Activity 与 actor ownership；
- Executable Strategy materialization 的传递依赖解析；
- Graph Evidence contracts、runner、job repository/service；
- Strategy Evidence/Approval 与 Historical Semantic Evaluation；
- 产品规划第 7.4、8.1～8.3 节。

然后明确一条最小生产链路，不同时维护 Mock 与真实两套 Lab。推荐组件边界：

```text
Experiment Catalog / Eligible Participants Read Model
    -> Experiment Service + Append-only SQLite Repository
    -> Existing Graph Evidence Job Service
    -> Experiment Scorecard / Diff / Candidate Projection
    -> Authenticated Experiment HTTP
    -> Experiment Workspace UI
```

不得以 CLI 子进程、临时 JSON 文件、localStorage、页面内随机曲线或内存 Map 作为生产事实源。

## 第二阶段：严格 Experiment 合同

在 contracts 中定义并导出严格 Schema/类型，至少包含以下概念。字段命名可按现有约定调整，但语义不能缺失。

### 1. Eligible Participant

- actor-owned Strategy Configuration `draftId/versionId/fingerprint`；
- source Conversation reference（若可由服务端回放事实证明；否则明确 `unavailable`）；
- materialized executable strategy reference/fingerprint；
- transitive Agent/Prompt/Graph/Profile refs 与 fingerprints；
- Market Pack、data-source set、Dataset compatibility；
- eligibility：`eligible / stale / invalid / unsupported` 与稳定 issue codes；
- `runtimeApplied=false`。

Catalog/read model 必须有界分页，只返回当前 actor 可见的版本；不得因为客户端知道 versionId 就跨 actor 暴露。

### 2. Experiment Lock

服务端解析并锁定：

- registered Dataset `id/version/fingerprint`、timezone、trading calendar；
- `startAt/endAt` 与实际可用 schedule；
- Universe/symbol scope；
- initial capital、fee bps、slippage bps、execution model；
- Risk budget、最大持仓/最大 notional 等可用风险事实；
- Model/Prompt version、temperature/context/fallback；当前 rule-only 或无模型时明确记录 `none/rule`，不得伪造模型配置；
- failure policy；
- registered Walk-Forward Plan reference；
- objective 与 constraints。

目标/约束采用受控 Schema，不接受表达式或代码。V1 至少支持：

- objective：`maximize_total_return`；
- constraints：可选 `maxDrawdownPctLte`、`minimumTradeCount`、`walkForwardPositive`、`runtimeFailureCountEqZero`；
- 所有数值有合理上限，服务端验证。

### 3. Participant Snapshot

每个 Experiment participant 必须锁定：

- `participantId` 与 label；
- Strategy Configuration 完整 ref；
- materialized executable strategy/source fingerprint；
- historical plan、compiled graph、profile/candidate-set refs；
- transitive Agent/Prompt refs；
- server-derived config snapshot/diff-safe projection；
- backtest/walk-forward job/evidence refs；
- participant lifecycle 与 issue codes。

Strategy payload 当前可能只引用 child draft IDs。Experiment 创建时必须记录当时解析到的确切 child version/fingerprint 和 source fingerprint；后续 child Draft 更新不能悄悄改变既有 Experiment。若 pinned dependency 无法重放，应标记 stale/unavailable，而不是切到 latest。

### 4. Comparability

支持并由服务端判定：

- `STRATEGY_COMPARISON`：Dataset、时间、Universe、Execution、Risk、Model 必须相同，只允许策略/Prompt 的声明维度变化；
- `MODEL_COMPARISON`：Strategy/Prompt/Dataset/Risk 相同，只允许 Model 变化；
- `AGENT_GRAPH_COMPARISON`：Dataset/Execution/Risk/Model 相同，只允许 Graph/topology 变化；
- `OPEN_CLASS`：固定条件无法满足，只能描述差异，不输出因果赢家；
- `INCOMPATIBLE`：Market/Dataset/Graph/metric mode 等不兼容，拒绝运行。

客户端可表达期望模式，但最终 `controlled/open_class/incompatible`、allowed diffs 和 issue codes 由服务端根据实际 fingerprints/locks 计算。不得让客户端声明“公平”。

### 5. Experiment、Scorecard 与 Candidate

- Experiment lifecycle 至少包含 `draft / backtest_partial / backtest_complete / walk_forward_partial / evidence_complete / candidate_ready / insufficient / stale / failed`；
- 2～5 个参与者，去重且顺序确定；
- definition fingerprint 不受 `createdAt`、展示顺序或客户端 label 影响；
- 每个 participant 的真实 Scorecard：现有 Evidence 支持的指标、标准化 equity points、Walk-Forward folds/validation metrics、费用/失败数据（仅在真实可得时）；
- unavailable metrics 显式列出；
- Diff 由服务端对安全配置投影生成，不能下发 secret/prompt 全文；
- Candidate 只引用 participant + Experiment/Evidence fingerprints，状态为 `candidate_for_validation` 或等价语义，`runtimeApplied=false`；
- `OPEN_CLASS`、Evidence 不完整、约束失败或 promotion-ineligible 时不得生成 Candidate。

禁止使用现有 `BacktestExperimentTrial.score` 或另一个不可解释综合分直接宣布赢家。排序必须先应用目标与约束，并展示原始指标、样本量和不确定/不充分状态。

## 第三阶段：持久化、服务和 API

### 1. SQLite Repository

- Experiment definition、状态版本、participant evidence refs 与 Candidate 均 append-only；禁止 UPDATE/DELETE 覆盖历史。
- actor-scoped creation idempotency；相同 key + 相同 request 返回同一 Experiment，相同 key + 不同 fingerprint 冲突。
- 列表和历史使用 SQL 有界分页、版本化 kind-bound cursor、稳定 tie-break；损坏 JSON/fingerprint fail closed。
- 服务重启后恢复相同 definition/status/result fingerprint，不依赖内存索引。

### 2. Experiment Service

- 列出 eligible participants 和 registered lock options；
- 创建 Experiment 时解析所有服务端 refs、物化并锁定 participant snapshot，计算 comparability/fingerprint；
- 为每个 participant 创建隔离、稳定 idempotency 的 Backtest/Walk-Forward jobs，复用现有 Graph runner/job repository/artifact verification；
- jobs 可顺序或有界并发执行，最多 5 个 participant，不得无界 Promise/队列；
- 部分失败必须保留每个 participant 状态，不能把缺失结果算作 0；
- Evidence 完成后投影真实 Scorecard/equity/Diff，并根据 objective/constraints 计算 Candidate eligibility；
- replay 必须使用锁定 refs；相同 Experiment 重放复用或验证同一 evidence fingerprint，不读取 Draft latest 替换输入；
- 不调用 `StrategyEvidenceApprovalService.approve()`、Paper Plan 或 Runtime API。

### 3. HTTP

建议最小路由（可按现有 handler 风格调整）：

```text
GET  /api/orchestration/experiments/catalog
GET  /api/orchestration/experiments?limit=&cursor=
POST /api/orchestration/experiments
GET  /api/orchestration/experiments/:experimentId
POST /api/orchestration/experiments/:experimentId/backtest
POST /api/orchestration/experiments/:experimentId/walk-forward
POST /api/orchestration/experiments/:experimentId/candidate
POST /api/orchestration/experiments/:experimentId/replay
```

- Bearer actor 由服务端派生；GET 只读，POST body strict 且有界；未知方法 405、未知资源 404。
- 不提供 approve/apply/deploy/run-paper/order 路由。
- 错误仅返回稳定 code 和安全 issue path，不泄露内部 SQL、路径、Prompt、Token 或 payload。
- 挂载到正确的 local Paper composition，日志继续显示 Exchange Write disabled。

## 第四阶段：真实实验场 UI

移除 `renderLab()` 中固定 Atlas 3.9、伪造 8.7%/4.6% 等指标、Mock evidence、人工审批和“发布到模拟运行”按钮。建议新增独立 `experiment-workspace-api.ts`/CSS 并以有界 host lifecycle 挂载，复用 M2 的 request cancellation/identity guard，避免 MutationObserver render loop。

### 页面结构

1. 实验列表/状态：actor-scoped、分页、刷新恢复；
2. 创建实验：从服务端 eligible Strategy Versions 选择 2～5 个，选择比较模式、Dataset/time、registered Walk-Forward Plan、目标/约束；
3. Fairness Lock：清楚展示锁定项、变化项、`CONTROLLED / OPEN CLASS / INCOMPATIBLE` 和 issue codes；
4. Evidence stages：Backtest → Walk-Forward → Candidate，动作分离、busy/idempotency/失败状态明确；
5. 结果比较：
   - 同时间轴 equity curve（交易模式）；
   - total return、max drawdown、trade/fill/risk rejection/cycles；
   - Walk-Forward fold 和 validation 指标；
   - unavailable metrics；
   - participant config Diff；
   - objective/constraint PASS/FAIL；
6. Evidence lineage：Experiment/participant/Dataset/Graph/Profile/job/artifact fingerprints 的截断可读展示；
7. Candidate：只显示“候选，可进入后续验证”，明确 `runtimeApplied=false`，没有部署按钮。

### UI 状态与可访问性

- loading、empty、readonly、invalid、open class、partial、failed、stale、complete 必须显式，不显示旧 Mock 兜底。
- 中文/英文完整，1440×900 与 820×760 无横向溢出、无遮挡；表格/曲线在窄屏可读。
- 键盘可操作、focus visible、label/aria-live/错误关联完整；曲线必须有文本 Scorecard 替代。
- 切换 `#lab/#experiment`、语言、实验或分页不触发 job、Candidate 或 Runtime 副作用；陈旧异步响应不能覆盖当前实验。

## 第五阶段：自动化验收

至少覆盖：

1. actor-owned eligible participant 列表有界分页；跨 actor、未知/陈旧/无效 Strategy Version 不可见或 fail closed。
2. 2 和 5 participant 正向创建；1、6、重复 participant、非 strategy、非 materializable、不同 Market/Dataset 不兼容拒绝。
3. participant snapshot 锁定传递 child version/fingerprint；源 Draft 后续变化不改变既有 Experiment fingerprint/replay input。
4. controlled comparison 的 locks 一致；单变量之外漂移自动变 `OPEN_CLASS`；不兼容 metric mode/Graph/Dataset 为 `INCOMPATIBLE`。
5. Backtest/Walk-Forward 为每个 participant 创建隔离、有界、幂等 jobs；部分失败不伪造成 0 或完整。
6. Scorecard/equity 直接来自已验证 Graph Evidence Artifact；篡改 artifact/result/manifest fingerprint fail closed。
7. 同一 Experiment replay 得到相同 definition/evidence/result fingerprint；SQLite 重启恢复相同状态、分页和 Candidate。
8. objective/constraints 判定可解释；Open Class、样本不足、约束失败、Evidence 缺失或 promotion-ineligible 不生成 Candidate。
9. Candidate append-only、actor-scoped、idempotent，且没有 Approval/Paper Plan/Runtime/Order 副作用。
10. HTTP 未认证、跨 actor、畸形 percent ID、非法 cursor、超大 body、未知方法/路由 fail closed。
11. Web 不含 Mock 指标/发布按钮；视图切换、重挂载和异步请求不会重复 job 或形成 load/render storm。
12. 保持 M1/M2 Conversation/Data Binding 回归和唯一动作链不变。

最终运行：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

## 第六阶段：Agent Chrome 验收（实现后必需）

使用加载当前代码的单一 `npm run dev:paper`。端口占用时先只读识别，只处理本项目陈旧进程；不得误杀无关进程或清空 workspace。

### A. 正向准备与创建

1. Agent 在真实 Chrome 打开 `http://127.0.0.1:5174/#experiment`，中文、1440×900；确认静态 Atlas/Mock 指标和 Paper 发布按钮已消失。
2. 若少于两个 eligible Strategy Version，只能通过可见编排 UI 新建两个 CSV-compatible 会话/Draft；不得直接 API、Console 或数据库造数据。
3. 在实验场选择 2 个兼容 participant，选择服务端登记的 CSV Dataset/time/Walk-Forward Plan，设置受控 objective/constraints，创建 Experiment。
4. 确认 Fairness Lock、participant refs、Dataset version/fingerprint、Graph/Profile refs、比较类型与 `runtimeApplied=false` 可见。

### B. Evidence、比较与 Candidate

1. 通过可见按钮运行 Backtest；观察每个 participant 的真实状态和结果，无随机/Mock 数值。
2. 运行 Walk-Forward；确认 folds/validation 与 Evidence refs 可见。
3. 查看同时间轴 equity curve、核心 Scorecard、unavailable metrics、配置 Diff 和约束结果。
4. 条件满足时通过独立可见动作创建 Candidate；确认它只是 `candidate_for_validation`，没有 Apply/Approve/Deploy/Paper Run 动作。
5. 刷新并重启本项目 Web/API 后恢复同一 Experiment、participant、evidence、scorecard、Candidate 和 fingerprints；重放后 fingerprint 稳定且没有重复 jobs。

### C. 负向、公平性和隔离

- 通过可见 UI 验证少于 2 个参与者时创建禁用或明确拒绝。
- 选择不满足受控锁的组合时显示 `OPEN_CLASS` 或 `INCOMPATIBLE`；Open Class 不显示因果赢家且不能创建 Candidate。
- 新建/切换第二 Experiment，确认状态、异步响应和结果不串；切回后恢复。
- 全程确认 `runtimeApplied=false`、Paper Only、Exchange writes OFF；交易页/Paper 状态未因实验变化。

### D. 英文、响应式、Console/Network

- English、820×760：创建器、Fairness Lock、阶段、曲线/Scorecard、Diff、错误和 Candidate 可读，无横向滚动、无遮挡。
- 清空 Console 后执行主流程并刷新；TradeBot 页面 error 为 0，扩展异步消息错误单独标注。
- 若 Agent Chrome 提供 Network，仅记录非敏感 `method path status`，确认 Experiment GET/POST、jobs/replay 无意外 401/5xx 且请求有界。
- 若 Network 不可用，记录 `TOOL_UNAVAILABLE`，禁止人工、Playwright、内置浏览器、curl、日志或数据库替代；其他必验项通过时不单独阻止 M3。

## M3 关闭规则与下一 Loop

只有 contracts、SQLite、服务/API、真实 UI、自动化和 Agent Chrome 全部满足本 Prompt 时，才将 M3 标为 `COMPLETE`。

完成时：

1. 将 LOOP-018 与 M3 标为 `COMPLETE`，准确记录测试数量与 Chrome 证据。
2. 更新三份规划/路线图/交接文档。
3. 创建唯一编号 `LOOP-019`，进入 M4 多模拟运行中心，并明确浏览器要求。
4. 更新 `docs/next-loop-prompt.md` 指向 LOOP-019。

若范围未完整实现或 Chrome 任一产品项未验证：LOOP-018/M3 保持 `IN_PROGRESS`，创建唯一编号 LOOP-019 继续 M3；不得覆盖本文件、提前进入 M4 或要求人工验收。

## Git 要求

- 任何代码或文档修改都必须创建范围明确的 commit 并 push 当前分支到 `origin`，即使 M3 未关闭。
- 提交前检查 staged diff；禁止提交 `data/local-paper-workspace*`、SQLite、Token、Secret、环境凭据、Evidence 临时文件或浏览器产物。
- push 后验证远端 branch ref 与本地 HEAD 一致。
- 不创建 PR，除非用户明确要求。

## 最终报告格式

```text
Loop ID：LOOP-018
验收模式：EXPERIMENT_LAB_AND_AGENT_CHROME_VERIFIED / IN_PROGRESS
浏览器要求：实现后必需；Agent 已使用真实 Chrome / Chrome 控制未完成
Experiment contracts/repository/API：PASS / FAIL
Eligible participants 与 actor isolation：PASS / FAIL
2～5 participant 与 Fairness Lock：PASS / FAIL
Backtest Evidence：PASS / NOT VERIFIED
Walk-Forward Evidence：PASS / NOT VERIFIED
真实 Scorecard/equity/Diff：PASS / NOT VERIFIED
Replay fingerprint：PASS / NOT VERIFIED
Candidate only/no deploy：PASS / NOT VERIFIED
中文 1440×900：PASS / NOT VERIFIED
英文 820×760：PASS / NOT VERIFIED
负向/Open Class：PASS / FAIL
Console：PASS / NOT VERIFIED
Network：PASS / TOOL_UNAVAILABLE / NOT VERIFIED（PASS 时仅 method/path/status）
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false / NOT VERIFIED
自动化：check；test:ts x/x；build:web；diff-check
M3：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-019（M4 / M3）
Git：commit <hash>；branch <name>；push PASS / FAIL；未创建 PR
```
