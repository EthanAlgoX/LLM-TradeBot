# LOOP-062 — F4 Production Runner Terminal 与 v1/v2 收尾

Loop ID：`LOOP-062`

里程碑：F4 Preflight / Backtest / Walk-Forward Evidence

验收模式：`VERIFY_FIRST_DIAGNOSE_FIX_IF_NEEDED_AND_AGENT_CHROME_VERIFY`

浏览器要求：**必需**。只能由 Agent 直接操作真实 Chrome；禁止用户人工验收、人工 DevTools 交接或以用户口述结果代替。

基线：`main` / `a444058`，`npm run test:ts` 自然 TAP `387/387 PASS`。

---

## 1. 当前确定事实

LOOP-061 已实现 Graph Evidence 的第一版有界执行合同：

- registered Walk-Forward workload 可计算为：

```text
5 folds
1 candidate
10 backtest invocations
150 cycles
maxWorkBudget = 300 cycles
```

- server-owned execution deadline 为 45 秒；
- lease 为 60 秒，deadline 早于 lease；
- `GraphEvidenceExecutionContext` 提供 `AbortSignal + deadlineAt + checkpoint()`；
- GraphWalkForwardRunner 在 fold/candidate/backtest 边界检查；
- GraphBacktestRunner 在每个 `session.execute()` 与 `captureCycleOutcome()` 前后检查；
- deadline 映射为 durable terminal：

```text
status = failed
failureCode = GRAPH_JOB_EXECUTION_DEADLINE_EXCEEDED
```

- deadline/failure 无 Evidence Artifact；
- complete/fail 都要求 exact owner 且 lease 未过期；
- expired owner 不可写 terminal，restart 可把 expired running 恢复为 orphaned；
- 自动化覆盖 work budget、deadline failure、lease fencing 和 checkpoint，387/387 PASS。

真实 Chrome 已确认：

- 新鲜 v1 Preflight passed；
- Backtest 点击后立即显示 scoped running，旧按钮移除；
- 只观察约 9 秒时还没有 terminal；
- 未继续 v2/reload/restart；
- 无 Approval、Runtime、Simulation 或交易副作用。

必须准确理解当前证据：

> 9 秒小于 server-declared 45 秒 deadline，因此“9 秒未 terminal”不能单独证明产品失败，也不能证明 production runner 没有执行 deadline。必须先观察完整合同窗口，再决定是否修改代码。

同时，当前 checkpoint 只位于 `session.execute()` 外围。若单个 production cycle 在 `session.execute()` 内长时间占用 CPU，deadline 只能在该调用返回后被发现，无法保证 45 秒内实际停止。这是本轮需要用证据确认或修复的风险点。

---

## 2. 本轮目标顺序

严格按以下顺序执行：

1. 使用当前 HEAD，不改代码，先验证真实 Backtest 是否在 45 秒 deadline 加有限持久化余量内 success 或 deadline terminal。
2. 同时测量页面/API 响应性和单个 production cycle 最大耗时。
3. 若当前实现已按合同 terminal，保留代码，不做无必要重构，直接继续 v1→Walk-Forward。
4. 若超过合同窗口仍 running，定位 execution context 在 production composition 中的第一个丢失点。
5. 最小修复真实 `session.execute()` 内的 cooperative checkpoint，或在证据证明不可协作时使用可终止 worker。
6. 完成新鲜 v1 原页 Evidence 正向链。
7. 只有 v1 terminal 后，创建同 Draft immutable v2。
8. 完成 v1 stale/read-only、v2 独立 Evidence、reload/restart、双尺寸和 Console 收尾。

不得跳过 verify-first，不能因为 9 秒未完成就直接引入 worker、队列、轮询或新 Job authority。

---

## 3. 强制安全与范围边界

本轮只允许修改：

- Graph Evidence production runner 的 execution-context 传播；
- GraphBacktestSession / registered semantic historical execution 的有界 checkpoint；
- deadline、lease/fencing、terminal projection 和响应性；
- Workbench F4 success/failure/timeout UI；
- 与以上行为直接相关的合同、测试和文档。

本轮禁止：

- Human Approval、Approver 操作或 Approved Paper Plan；
- Simulation Slot、Runtime Apply、Deployment、Run 或 Paper cycle；
- Account、Position、Order、Fill 或交易所写入；
- Live、Canary、Champion 自动替换、持仓迁移；
- 恢复 LOOP-025 / M6；
- 新建第二套 Job、Artifact、Draft、Conversation 或 F4 authority；
- 只用 `Promise.race`/HTTP timeout 而不停止底层工作；
- timeout 后让旧 runner 继续占用 CPU 或写迟到 success；
- 为通过浏览器验收而静默缩小 Dataset、fold、candidate、cycle 或日期范围；
- 用历史已成功卡片、reload 后结果或重新点击替代原页 terminal；
- 无限 polling、无界重试或固定长 sleep；
- 使用 localStorage/sessionStorage 作为 Evidence authority；
- 客户端伪造 succeeded、Evidence ready 或 approval required；
- 暴露 Cookie、Bearer、Token、Secret 或完整敏感 payload；
- 修改或提交 `data/local-paper-workspace*`。

必须始终保持：

```text
runtimeApplied=false
Paper Only
exchangeWriteAllowed=false
```

F4 未 `COMPLETE` 前不得进入 F5。

---

## 4. 执行前检查

1. 完整阅读：
   - `docs/product-optimization-plan-and-progress.md`
   - `docs/product-roadmap-and-progress.md`
   - `docs/project-status-and-handoff.md`
   - `docs/next-loop-prompt.md`
   - LOOP-059～LOOP-061 Prompt 与 handoff。
2. 阅读当前生产执行链：
   - `packages/runtime/src/sqlite-graph-evidence-jobs.ts`
   - `packages/core/src/graph-backtest-evidence.ts`
   - `packages/runtime/src/registered-graph-backtest-session.ts`
   - `packages/runtime/src/registered-semantic-historical-node-executors.ts`
   - `packages/runtime/src/production-csv-graph-evidence.ts`
   - `packages/core/src/strategy-evidence-approval-service.ts`
   - `packages/runtime/src/strategy-workbench-service.ts`
3. 执行 `git status --short --branch`，保留用户既有修改，不覆盖无关文件。
4. 确认 `main` 包含 `a444058`，确认本地与 `origin/main` 关系。
5. 只使用一个当前 HEAD 的 `npm run dev:paper`；识别 5174/8787 监听者，不误杀无关进程。
6. 不清空 workspace 数据；通过正常产品生命周期创建新鲜 actor-scoped Draft。

---

## 5. Phase A：不改代码的完整 deadline 验证

先用当前 HEAD 对新鲜 v1 Backtest 做一次完整观察，禁止先改实现。

### 5.1 时间边界

- 记录点击时刻 `T0`，只保留相对耗时，不记录敏感 payload。
- 0～45 秒为 server-declared execution window。
- 额外只允许最多 5 秒用于 terminal 持久化、HTTP 返回和 DOM render。
- 总观察上限为 50 秒；不得用一个阻塞 50 秒的 sleep，应每 5～10 秒由 Agent 重新读取可见页面/服务状态并保持沟通。

50 秒内必须出现以下之一：

```text
A. succeeded terminal，进入后续 gate
B. failed / GRAPH_JOB_EXECUTION_DEADLINE_EXCEEDED terminal
C. 其他稳定 explicit failure terminal
```

若 50 秒后仍显示 running，则 deadline contract 在 production composition 中 FAIL。

### 5.2 响应性证据

Backtest running 期间验证：

- 当前页面仍可滚动、获得键盘焦点并显示安全状态；
- Web 静态页面仍可读取；
- API 的无副作用轻量 read/health 能在有界时间响应；
- 不出现整站卡死、持续 100% 单核且事件循环无法调度的现象；
- 不调用 LLM、不消耗模型 token。

允许使用 read-only 本地诊断命令测量响应性，但不得用 API/日志替代 Chrome 的 terminal DOM 验收，也不得读取认证敏感值。

### 5.3 Phase A 分支

如果 succeeded：

- 记录真实耗时和 workload；
- 不修改 runner 架构；
- 继续 Walk-Forward，同样观察至 success/deadline terminal；
- positive v1 必须最终 Evidence ready 才能继续 v2。

如果 deadline terminal：

- 验证 Job terminal failed、failureCode 稳定、lease 清理、无 Artifact、页面不再 running；
- 这证明负向合同通过，但 v1 正向链仍 FAIL；
- 必须测量并优化/隔离合法注册 workload，使正向 fixture 在平台预算内真实成功，不能把 timeout 当 Evidence ready。

如果 50 秒后仍 running：

- 进入 Phase B；
- 不得 reload 后看到 failed 就把原页 terminal 写成 PASS；
- 必须找出 checkpoint 未在 45 秒内执行的具体调用。

---

## 6. Phase B：仅在需要时诊断 production checkpoint

针对同一个 action/job，建立无敏感生命周期 trace：

```text
DurableGraphEvidenceJobService context created
→ GraphBacktestRunner.run(context)
→ sessionFactory.create
→ GraphBacktestSession.execute(asOf, idempotencyKey)
→ registered semantic executor
→ node executor / data loading / analysis / decision
→ captureCycleOutcome
→ checkpoint
→ Repository complete/fail
→ HTTP response
→ exact-version merge/render
```

必须记录并定位：

1. execution context 是否传入 `GraphBacktestRunner`。
2. 是否在进入 `GraphBacktestSession.execute()` 后丢失。
3. 单个 `session.execute()` 最大 wall-clock 耗时。
4. 该调用内部是否有可插入的 node/cycle checkpoint。
5. `AbortSignal` 是否只有外层持有，内部从不读取。
6. deadline timer 在主线程是否按时触发。
7. 若 timer 延迟，主线程被哪个同步段阻塞。
8. deadline 后是否仍继续加载数据、生成 Artifact 或推进 cycle。
9. lease 到期前 Job 是否已 terminal。
10. HTTP、Repository 和 DOM 的第一个未发生事件。

根因必须具体到函数、接口和事件顺序。不能只写：

- “真实数据比较慢”；
- “Chrome 等待不够”；
- “可能是 event loop”；
- “再把 deadline 调长”；
- “自动化是通过的”。

DEV-only trace 只能记录事件名、相对耗时、数量、状态和 opaque identity 是否相等；禁止记录 prompt、Token、Cookie、Secret 或完整 payload，完成后删除或 production 禁用。

---

## 7. 修复原则

### 7.1 优先最小协作式修复

若 production `session.execute()` 内部由多个可控 node/await 阶段组成：

- 将 `GraphEvidenceExecutionContext` 类型化传入 `GraphBacktestSession.execute()`；
- 继续传入 registered semantic historical executor/节点执行边界；
- 在每个有界 node、数据窗口、Agent adapter、decision stage 前后 checkpoint；
- 每次长 await 返回后 checkpoint；
- `captureCycleOutcome` 前后继续检查；
- 不使用全局变量或隐式 singleton signal；
- 非 Evidence Runtime 调用方不得被意外改变。

只在 `session.execute()` 前后加检查不算完成；必须让最大不可中断段小于声明的停止上限。

### 7.2 单段 CPU 不可协作时

若测量证明某个同步段会独占事件循环，且无法安全分块：

- 使用可终止 worker/thread/process 隔离该段；
- worker 输入只能是服务端注册、可序列化的 plan/ref/data snapshot；
- parent 保持 Job lease/fencing 和 Artifact commit authority；
- deadline 时真实 terminate worker；
- worker crash/timeout 映射为稳定 failure；
- worker 不能直接写 Job/Evidence authority；
- 测试和服务关闭后无遗留 worker/process/temp file。

不得因为一个未测量的 9 秒等待直接引入 worker。

### 7.3 Work budget 完整性

- Walk-Forward 已有 300-cycle 上限；确认独立 Backtest 也有 server-owned schedule/cycle 上限。
- 客户端不能提交或扩大 budget/deadline。
- 超 budget 在重计算前 fail closed，不写 partial Artifact。
- 不得静默裁剪合法计划并标记 succeeded。
- 如果合法 production workload 稳定超过同步 45 秒，而又不能安全优化，应明确采用已有 durable Job 的 accepted/running/terminal 模型；不得让同步 HTTP 无限等待。
- 如采用异步 completion，必须复用同一 Job/projection，使用 exact job/version、server-declared deadline 和有界 observation；禁止第二 authority 和无限 polling。

### 7.4 Terminal 与迟到结果

- success、explicit failure、deadline failure 都必须 durable terminal。
- deadline 后底层工作实际停止。
- terminal 后 lease/owner 清理。
- failed/deadline Job 不写 Evidence Artifact。
- 迟到 resolve/reject 不能二次终结或覆盖。
- duplicate/retry 复用同一 idempotent Job。
- reload 只恢复服务器 terminal，不恢复客户端临时 running。

---

## 8. 自动化测试要求

除保留 387/387 基线外，至少覆盖：

### 8.1 Production composition 传播

1. `GraphEvidenceExecutionContext` 从 Durable Job 传入 production `GraphBacktestSession.execute()`。
2. registered semantic executor/node 边界读取同一 context。
3. 单个长 cycle 在 deadline 后有界停止，而不是返回后才发现 timeout。
4. deadline 后不再调用后续 node/cycle/capture。
5. production provider/session 正常 close，无 SQLite、timer、worker 泄漏。
6. 非 Evidence 调用路径行为保持不变。

### 8.2 Terminal/Repository

1. positive production-like Backtest 在 deadline 内 succeeded。
2. positive production-like Walk-Forward 在 deadline 内 succeeded。
3. cooperative timeout 实际停止、terminal failed、无 Artifact。
4. explicit failure terminal 稳定。
5. expired owner/late result 继续被 fencing。
6. duplicate idempotency 不创建第二 Job/Artifact。
7. restart expired running → orphaned/recoverable，旧 owner 不能写。
8. Backtest 和 Walk-Forward work budget 都由服务端注册事实决定。

### 8.3 Workbench integration

1. action → running render → production terminal → exact-version render。
2. success 进入后续 gate；deadline/failed 显示稳定错误并允许安全重试。
3. history/action 任意交错不覆盖 terminal。
4. route/conversation/version 切换后迟到响应不串台。
5. reload 不恢复临时 running。
6. 同 Draft v1→v2 保持 Evidence/version 隔离。
7. 无 Approval、Runtime、Simulation 或交易事实。

测试必须使用受控时钟/fixture，不能真实等待 45 秒。至少一条集成测试覆盖：

```text
Durable Job
→ production session execution context
→ checkpoint/deadline or success
→ Repository terminal
→ Workbench terminal render
```

---

## 9. 自动化门禁

必须全部执行并取得真实最终结果：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

要求：

- `test:ts` 必须自然结束并报告最终 TAP 数量、exit 0；
- 不得使用 kill 把未结束测试写成 PASS；
- 本轮拥有的 timer、worker、runner、server、SQLite handle 必须关闭；
- 不得只运行聚焦测试后宣称全量通过。

---

## 10. Agent 真实 Chrome 验收

只能由 Agent 操作真实 Chrome。不得让用户手动点击或检查 DevTools；不得以内置浏览器、API、日志或自动化测试替代可见 UI 证据。

### 10.1 新鲜 v1 原页正向 Evidence 链

通过正常 Agent Center/Workbench 生命周期准备新鲜、服务端注册 scope 的 v1：

1. F4 卡片显示 exact v1/fingerprint。
2. Preflight 原页完成。
3. Backtest 点击后立即显示 scoped running，旧按钮消失。
4. 页面在执行期间保持可读、可滚动、可聚焦。
5. 在 server-declared deadline + 5 秒内，不 reload、不重试，Backtest 原页 succeeded 并出现 Walk-Forward gate。
6. Walk-Forward 点击后立即显示 scoped running，旧按钮消失。
7. 在 server-declared deadline + 5 秒内，不 reload、不重试，原页显示：

```text
EVIDENCE READY
APPROVAL REQUIRED
```

8. lineage 显示 exact version、registered Graph/Dataset、Profile/Plan、Job/Evidence 摘要。
9. 不点击 Approval。

正向 fixture 如果只得到 deadline terminal，本项仍为 FAIL；timeout 只能证明安全失败合同，不能证明 Evidence 可用。

### 10.2 v1 reload recovery

v1 terminal 后直接 reload：

- 恢复同一 actor、conversation、Draft v1 和 terminal F4 card；
- Evidence/lineage 与 reload 前一致；
- 不残留 running，不回退 pending/locked/loading；
- 不重新创建 Draft、不重跑 action。

### 10.3 同 Draft immutable v2

通过正常 Workbench 修改“最大仓位调整为 5%”并 Apply：

1. 创建同一 Configuration Draft immutable v2，不是另一个 draft v1。
2. v2 显示 exact `parentVersionId + parentFingerprint`。
3. v1 内容、fingerprint、binding、jobs、Evidence 保持不变可读。
4. v1 显示 stale/read-only，不授权 v2。
5. v2 不继承 v1 binding、jobs、Evidence ready 或 running。
6. v2 原页独立完成 Preflight、Backtest、Walk-Forward。
7. v2 到达 `EVIDENCE READY / APPROVAL REQUIRED`，仍不点击 Approval。

只有 v1 原页成功 terminal 后才允许执行本节。

### 10.4 Web/API restart recovery

在 v1/v2 均完成后：

1. Agent 受控停止本轮拥有的 `dev:paper`，以当前 HEAD 启动唯一服务。
2. Chrome 保持同一受控 loopback actor。
3. 恢复同一 conversation、Draft v1/v2 和 parent lineage。
4. v1 stale Evidence 与 v2 terminal Evidence 不串版本/会话/actor。
5. 不残留 running，不自动重跑，不产生 Approval/Runtime/Simulation/交易事实。

### 10.5 中文、英文、响应式和 Console

- 中文 1440×900：running、terminal、lineage、v1/v2 无遮挡和横向滚动。
- 英文 820×760：`scrollWidth === clientWidth === 820`，长 fingerprint/错误文字不溢出。
- 键盘焦点可见；running/failed/timed-out/stale/ready 不只依赖颜色。
- Console 可用时清空后完成关键链；TradeBot warning/error 必须为 0。
- Chrome 扩展 channel-close 单列，不归因产品。
- Network 可用时只报告 `method/path/status`，禁止输出 header、Cookie、Bearer、body 或敏感值；不可用写 `TOOL_UNAVAILABLE`，不得人工替代。

---

## 11. F4 完成判定

只有以下全部 PASS 才可将 F4 标记为 `COMPLETE`：

- 当前 production Backtest/Walk-Forward 在声明窗口内明确 terminal；
- deadline 后底层 production work 有界停止；
- 网站/API 在 Evidence 运行期间保持响应；
- success/failure/deadline、lease/fencing、迟到结果和 restart 合同通过；
- 新鲜 v1 原页到达 `EVIDENCE READY / APPROVAL REQUIRED`；
- v1 reload 恢复且不重跑；
- 同 Draft immutable v2 parent/reference 正确；
- v1 stale/read-only Evidence 保留；
- v2 不继承 v1 Evidence，并独立到达 Evidence ready；
- Web/API restart 后两版本恢复且不串台；
- 中文 1440×900、英文 820×760、焦点和 Console 通过；
- 全量自动化自然结束通过；
- 无 Approval、Runtime、Simulation 或交易副作用。

若全部通过：

- 更新规划、路线图和交接，将 F4 标为 `COMPLETE`；
- 创建唯一编号 `LOOP-063`，进入 F5 Simulation V2；
- LOOP-063 必须明确浏览器要求，并由服务端强制最多三个 active Paper Deployment；
- 不得进入 M6 Live。

若任一项失败：

- F4 保持 `IN_PROGRESS`；
- 记录实际耗时、terminal 状态、最大不可中断段和资源是否停止；
- 创建唯一编号 `LOOP-063`，但只能继续 F4；
- 不得用 9 秒短观察、reload 后结果、人工等待或仍在后台运行写成通过。

---

## 12. 文档与 Git 交付

必须更新：

- `docs/product-optimization-plan-and-progress.md`
- `docs/product-roadmap-and-progress.md`
- `docs/project-status-and-handoff.md`
- `docs/next-loop-prompt.md`
- 本 Loop 结果及唯一编号 LOOP-063 Prompt。

同步修正权威摘要中残留的旧 LOOP 编号和旧测试基线，不改写历史审计记录。

所有代码、测试和文档修改必须：

1. `git diff --check` 通过；
2. 确认不包含 `data/local-paper-workspace*`、运行数据或敏感值；
3. commit 到 `main`；
4. push 到 `origin/main`；
5. 确认本地 HEAD 与 `origin/main` 一致；
6. 不创建 PR。

即使 F4 未完成，只要产生修改，也必须 commit 并 push。

---

## 13. 最终回复模板

```text
Loop ID：LOOP-062
验收模式：VERIFY_FIRST_DIAGNOSE_FIX_IF_NEEDED_AND_AGENT_CHROME_VERIFY
浏览器要求：Agent 已使用真实 Chrome / FAIL（说明）

Phase A 当前实现完整观察：PASS / FAIL
Backtest 实际 terminal 时间：
Walk-Forward 实际 terminal 时间：
Production checkpoint 根因：无需修复 / 具体函数与断点
Execution-context 内部传播：PASS / FAIL
最大不可中断段：
Deadline 后实际停止：PASS / FAIL
Lease/fencing：PASS / FAIL
服务响应性：PASS / FAIL
Success/failure/deadline terminal：PASS / FAIL

v1 原页 Evidence 链：PASS / FAIL
v1 reload recovery：PASS / FAIL
同 Draft immutable v2：PASS / FAIL
v1 stale/read-only：PASS / FAIL
v2 独立 Evidence：PASS / FAIL
Web/API restart recovery：PASS / FAIL

中文 1440×900：PASS / FAIL
英文 820×760：PASS / FAIL
Console：PASS / FAIL / TOOL_UNAVAILABLE
Network：PASS / FAIL / TOOL_UNAVAILABLE

Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
Approval/Runtime/Simulation/交易副作用：NONE
自动化：check；test:ts 最终 TAP；build:web；diff-check

F4：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-063（F5 / F4 continuation）
Git：commit；branch main；push PASS；PR 未创建
```
