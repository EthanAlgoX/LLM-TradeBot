# LOOP-061 — F4 Runner 有界执行与 terminal contract 收尾

Loop ID：`LOOP-061`

里程碑：F4 Preflight / Backtest / Walk-Forward Evidence

验收模式：`DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY`

浏览器要求：**必需**。只能由 Agent 直接操作真实 Chrome；禁止用户人工验收、人工 DevTools 交接或以用户口述结果代替。

基线：`main` / `c45833e`，`npm run test:ts` 自然 TAP `386/386 PASS`。

---

## 1. 当前确定事实

LOOP-060 已取得真实 Chrome 生命周期证据：

- exact-version Walk-Forward 点击后正确进入 scoped `running`；
- 旧 action 按钮已移除，没有重复点击；
- 请求链为：

```text
StrategyWorkbenchHttpHandler
→ StrategyWorkbenchService.f4
→ StrategyEvidenceApprovalService.runWalkForward
→ DurableGraphEvidenceJobService.run
→ GraphWalkForwardRunner.run
→ 多 fold / candidate / backtest execution
```

- `DurableGraphEvidenceJobService.run()` 同步 `await` CPU-active runner；
- 执行没有 server-declared deadline；
- Walk-Forward POST 超过两分钟仍没有 runner terminal、HTTP response、exact-version merge 或 terminal DOM；
- 这不是 hydration 覆盖，也不是客户端 running/render 缺陷；
- 没有 Approval、Runtime、Simulation 或交易副作用；
- `check`、自然 TAP 386/386、`build:web`、`diff-check` 均通过。

当前代码还存在以下必须一起处理的合同事实：

- `GraphEvidenceJobStatus` 目前只有 `queued | running | succeeded | failed | orphaned`；
- Repository lease 默认 `60_000ms`；
- 当前 Walk-Forward 实际执行已超过 lease 时长；
- runner catch 只有在执行返回或抛错后才会调用 `repository.fail()`；
- 单纯在外层加 `Promise.race(setTimeout)` 不能保证停止 Node 主线程上的 CPU 工作，也不能阻止迟到结果写入。

F4 保持 `IN_PROGRESS`。本轮必须先建立真实、可停止、可恢复、与 lease/fencing 一致的 runner terminal contract；只有 positive Walk-Forward 在原页真正 terminal 后，才能继续 v1→v2 收尾。

---

## 2. 本轮目标顺序

严格按以下顺序执行：

1. 测量并记录当前注册 Walk-Forward 工作量与事件循环行为。
2. 设计并实现有界 execution deadline / work budget。
3. 确保超时或取消后计算实际停止，不继续后台占用 CPU。
4. 确保 durable Job 只有一个合法 terminal outcome，迟到结果不可覆盖。
5. 确保 HTTP 和 F4 UI 能稳定表达 success、failure、deadline exceeded。
6. 用自动化证明成功、失败、超时、幂等、lease/restart 和无迟到写入。
7. 用 Agent Chrome 完成新鲜 v1 原页 Evidence 链。
8. 仅在 v1 terminal 后创建同 Draft immutable v2，完成 stale/recovery 收尾。

不得先跳到 v2，也不得用 reload/restart 后读到结果替代原页 terminal。

---

## 3. 强制安全与范围边界

本轮只允许修改：

- Graph Evidence Job terminal/deadline/lease/fencing 合同；
- Graph Walk-Forward / Backtest runner 的有界、可取消执行；
- 已有 registered Historical/Graph runner 的 deadline 传播；
- Strategy Evidence / Workbench F4 的稳定 terminal projection；
- running/failed/deadline-exceeded/terminal UI；
- 与以上行为直接相关的合同、Repository migration、测试和文档。

本轮禁止：

- Human Approval、Approver 操作或 Approved Paper Plan；
- Simulation Slot、Runtime Apply、Deployment、Run 或 Paper cycle；
- Account、Position、Order、Fill 或交易所写入；
- Live、Canary、Champion 自动替换、持仓迁移；
- 恢复 LOOP-025 / M6；
- 新建第二套 Evidence Job、Artifact、Draft、Conversation 或 F4 authority；
- 只靠客户端 timeout 把服务器仍在运行的任务标成 failed；
- 只使用 `Promise.race`/`setTimeout` 而不停止底层工作；
- timeout 后让旧 runner 继续占用 CPU 或写入迟到 success；
- 为通过 Chrome 而静默缩小 Dataset、fold、candidate 或历史范围；
- 自动 reload、自动重跑 action、无限 polling 或无界重试；
- 客户端伪造 Evidence ready / approval required；
- 使用 localStorage/sessionStorage 作为 Job/Evidence authority；
- 读取、打印、复制或暴露 Cookie、Bearer、Token、Secret；
- 修改或提交 `data/local-paper-workspace*`。

必须始终保持：

```text
runtimeApplied=false
Paper Only
exchangeWriteAllowed=false
```

F4 未 `COMPLETE` 前不得进入 F5。

---

## 4. 执行前检查与测量

1. 完整阅读：
   - `docs/product-optimization-plan-and-progress.md`
   - `docs/product-roadmap-and-progress.md`
   - `docs/project-status-and-handoff.md`
   - `docs/next-loop-prompt.md`
   - LOOP-058～LOOP-060 Prompt 与 handoff。
2. 阅读并追踪真实实现：
   - `packages/runtime/src/sqlite-graph-evidence-jobs.ts`
   - `packages/runtime/src/registered-strategy-graph-evidence-job-port.ts`
   - `packages/core/src/graph-backtest-evidence.ts`
   - `packages/core/src/strategy-evidence-approval-service.ts`
   - 当前 production runner composition 和相关测试。
3. 执行 `git status --short --branch`，保留用户既有修改，不覆盖无关文件。
4. 确认 `main` 包含 `c45833e`，确认本地与 `origin/main` 关系。
5. 只使用一个当前 HEAD 的 `npm run dev:paper` 链路；识别 5174/8787 监听者，不误杀无关进程。
6. 不清空 workspace 数据；通过正常产品生命周期创建新鲜 actor-scoped Draft。

在设计修复前，必须用无敏感 trace 或聚焦测试记录：

- registered Dataset schedule 长度；
- fold 数；
- candidate/profile 数；
- 每 fold 的 training/validation cycle 数；
- 预估和实际 backtest invocation 数；
- 每个 fold/candidate 的耗时分布；
- 事件循环在 runner 期间是否仍能调度 timer/轻量 API；
- 当前 lease 何时到期；
- runner 在 lease 到期后是否仍执行；
- 是否可能由另一 owner 重获已过期 Job；
- 当前进程停止后 Job 如何恢复为 orphaned/failed。

只记录数量、耗时和 opaque identity 是否相等；禁止记录 Cookie、Token、Secret、prompt 或完整业务 payload。

---

## 5. 必须明确的 terminal contract

实现前先在代码和测试中明确以下合同。

### 5.1 成功

- runner 在工作预算和 deadline 内完成；
- owner/fencing 仍有效；
- Evidence Artifact 完整写入；
- Job 原子进入 `succeeded`；
- HTTP 返回 exact-version terminal projection；
- 原页从 running 进入后续 gate。

### 5.2 显式失败

- runner 抛出稳定、已分类错误；
- 不写部分 Evidence Artifact；
- Job 原子进入 terminal failure；
- lease/owner 清理；
- HTTP 返回稳定错误/projection；
- UI 显示失败原因摘要与安全幂等重试能力。

### 5.3 Deadline exceeded

选择一种完整、一致的持久化合同，不能半混用：

推荐最小方案：

```text
status = failed
failureCode = GRAPH_JOB_EXECUTION_DEADLINE_EXCEEDED
```

UI 可显示为 `TIMED OUT`，但服务端事实仍是现有 schema 中的 terminal `failed`。

如果选择新增一等 `timed_out` status，则必须同步完成：

- Zod contract；
- SQLite CHECK constraint 的无损 migration；
- row/parser；
- terminal/fencing 判断；
- immutable trigger；
- API/error mapping；
- F4 projection/UI；
- 旧数据库 restart recovery；
- 全部现有消费者测试。

不得只改 TypeScript enum 而不迁移 SQLite，也不得 UI 写 timed_out、Repository 仍长期 running。

### 5.4 取消与迟到结果

- deadline 到达时必须向实际 work loop 传播 abort/deadline；
- runner 必须在有界 checkpoint 停止；
- 若单个不可中断 CPU 段可能超过 deadline，必须把该段改为协作式分块，或放入可终止 worker/process；
- timeout terminal 写入前，应确认 owner 的 work 已停止或被可靠 fencing；
- timeout 后的迟到 result 不得写 Artifact，不得从 failed/timed_out 变为 succeeded；
- client disconnect 不得自动等同业务失败，必须由 server-owned deadline/owner contract 决定；
- duplicate/retry 复用同一 idempotent Job，不创建第二 Job/Artifact。

### 5.5 Lease / deadline / fencing

当前 `leaseMs=60_000` 与两分钟以上执行不一致，必须修复：

- execution deadline 必须小于 lease 并留出持久化余量；或
- 长任务必须使用已有风格的 heartbeat/lease renewal/fencing；
- 任一时刻只有有效 owner 能 complete/fail；
- 失去 lease 的 owner 必须停止或被 fencing，不能继续写结果；
- restart 后 expired running Job 进入明确 orphaned/recoverable terminal 路径；
- 不允许两个 owner 同时执行同一 Job。

不要仅把 lease 数值调大。必须有 deadline、停止机制和重启行为测试。

---

## 6. 有界执行实现原则

优先选择当前架构下最小但真实安全的方案。

### 6.1 协作式 deadline（优先评估）

如果当前 `GraphWalkForwardRunner → GraphBacktestRunner → session.execute` 在 fold/candidate/cycle 之间能让出事件循环，则：

- 创建 server-owned execution context，例如 `deadlineAt + AbortSignal + checkpoint()`；
- 通过类型化接口向实际 runner 传播，而不是全局变量；
- 在每个 fold、candidate、training/validation run 前后检查；
- 在 backtest 的每个有界 cycle/批次检查；
- 每次 await 返回后再次检查 owner/deadline；
- 预算超限抛出稳定 domain error；
- checkpoint 粒度必须保证停止延迟有明确上限。

### 6.2 Worker 隔离（仅在必要时）

如果测量证明单个 CPU 段会阻塞事件循环超过 deadline，协作式外层检查无法停止，则可以使用可终止 worker/process，但必须：

- worker 输入仅为服务端注册、可序列化的 plan/ref；
- 不向 worker 传 Cookie、Token、Secret 或任意客户端代码；
- deadline 时真实 terminate；
- parent 仍掌握 Job lease/fencing 和 Artifact commit；
- worker 不能直接绕过 Repository 写 Evidence authority；
- worker crash/exit 映射为稳定 failure；
- 不留下子进程、线程或临时文件。

### 6.3 预执行 work budget

在执行前根据服务端注册事实计算上限：

```text
folds × candidates × training work + folds × validation work
```

- 超出平台注册上限时应在开始重计算前 fail closed；
- 上限必须是 server-owned 配置，不接受客户端覆盖；
- 不得通过静默裁剪 fold/candidate/cycle 产生不完整但标记成功的 Evidence；
- 若 workload 合法但不适合同步 HTTP，采用已有 durable Job 的明确 accepted/running/terminal 合同，而不是让请求无限等待。

### 6.4 服务可用性

Walk-Forward 运行期间 Web/API 不得整体卡死：

- 轻量 session/catalog/health 请求仍应在有界时间响应；
- 页面 running 状态保持可渲染；
- 不产生高频 polling；
- 不调用 LLM，不消耗模型 token；
- 不触发 Runtime 或交易链。

---

## 7. 自动化测试要求

至少补齐以下行为级测试。

### 7.1 Job/Repository 合同

1. success：唯一 owner 在 deadline 内完成，写一个 immutable Artifact/terminal Job。
2. explicit failure：Job terminal failed，稳定 failureCode，无 Artifact。
3. deadline exceeded：实际 runner 停止，Job terminal，lease 清理，无 Artifact。
4. timeout 后迟到 resolve：不能覆盖 terminal，不能写 Artifact。
5. timeout 后迟到 reject：不能二次终结或破坏原 failure。
6. duplicate idempotency：相同 payload 复用同一 Job；不同 payload 冲突。
7. lease held：第二 owner 不得并发执行。
8. lease expiry/fencing：旧 owner 不得 complete；restart recovery 结果稳定。
9. 旧数据库与新合同兼容；若有 schema migration，验证数据保留和触发器有效。

### 7.2 Runner 有界执行

1. work-budget 计算由注册 plan/dataset/candidate set 决定，客户端不可覆盖。
2. fold/candidate/cycle checkpoint 能在 deadline 后停止。
3. 单个不协作 runner 不得被普通 `Promise.race` 误判为已停止。
4. worker 方案（若采用）验证 terminate、crash、无泄漏。
5. 合法小型 workload 在 deadline 内成功，结果 fingerprint 稳定。
6. 超预算 workload fail closed，不生成 partial Evidence。
7. 运行期间事件循环/轻量 API 仍可响应。

### 7.3 Strategy Evidence / Workbench

1. action 立即显示 exact-version running。
2. success response → exact-version merge → terminal render。
3. deadline/failure response → running 清除 → 稳定失败 UI。
4. retry 复用相同 Job，不重复 Artifact。
5. conversation/version 切换后迟到结果不污染当前页面。
6. history/action 任意交错不覆盖 terminal authority。
7. reload 不恢复临时 running，只恢复服务端 Job projection。
8. 同 Draft v1→v2：v1 stale/read-only、v2 不继承 Evidence、两版本独立恢复。
9. actor/ID/method/payload/restart 继续 fail closed。
10. 不产生 Approval、Runtime、Simulation 或交易事实。

至少一条集成测试必须覆盖：

```text
Workbench action
→ running render
→ bounded runner
→ durable terminal Job
→ HTTP exact-version projection
→ terminal DOM render
```

测试不能只等待真实两分钟；使用可控时钟、受控 cooperative runner 或 worker fixture，保持快速、确定、自然结束。

---

## 8. 自动化门禁

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
- 若引入 worker/process，增加无遗留进程/线程的测试或可验证清理。

---

## 9. Agent 真实 Chrome 验收

只能由 Agent 操作真实 Chrome。不得让用户手动点击或检查 DevTools；不得以内置浏览器、直接 API、服务端日志或自动化测试替代要求中的可见 UI 证据。

### 9.1 新鲜 v1 正向链

通过正常产品生命周期创建并 Apply 一个新鲜、服务端注册 scope 的 v1：

1. F4 卡片显示 exact v1/fingerprint。
2. Preflight 原页完成。
3. Backtest 点击后立即显示 scoped running，旧按钮消失。
4. 不 reload、不重试，原页显示 Backtest terminal 和 Walk-Forward gate。
5. Walk-Forward 点击后立即显示 scoped running，页面保持响应。
6. 在 server-declared deadline 内，不 reload、不重试，原页显示：

```text
EVIDENCE READY
APPROVAL REQUIRED
```

7. lineage 显示 exact version、registered Graph/Dataset、Profile/Plan、Job/Evidence 摘要。
8. 不点击 Approval。

如果 runner 合法工作量在新 deadline 内只能稳定 timeout，则正向链 FAIL；不得把 timeout 当 F4 完成。必须进一步优化/隔离执行或采用正确 durable async completion，直到注册正向 fixture 能真实成功。

### 9.2 可见失败/timeout 边界

只在产品已有安全、服务端注册的失败 fixture 可通过正常 UI 到达时验证；不得向 UI 暴露任意 deadline/runner 参数：

- running 最终进入明确 failed/timed-out 展示；
- 不显示 Evidence ready；
- 页面可安全幂等重试；
- 不产生第二 Job/Artifact；
- reload 后恢复同一 terminal failure，不恢复无限 running。

若没有正常产品失败 fixture，本项以自动化为主，不得临时在生产 UI 增加测试开关。

### 9.3 v1 reload 与 immutable v2

只有 v1 正向 terminal 后继续：

1. reload 恢复同一 actor/conversation/v1 terminal Evidence，不重跑 action。
2. 正常修改“最大仓位调整为 5%”并 Apply。
3. 创建同 Draft immutable v2，显示 exact parent version/fingerprint。
4. v1 Evidence 保持不变、可读并标为 stale/read-only。
5. v2 不继承 v1 binding、jobs、Evidence 或 running。
6. v2 原页独立完成 Preflight、Backtest、Walk-Forward。
7. v2 到达 `EVIDENCE READY / APPROVAL REQUIRED`，仍不点击 Approval。

### 9.4 Web/API restart recovery

在 v1/v2 均完成后：

1. Agent 受控停止本轮拥有的 `dev:paper`，以当前 HEAD 启动唯一服务。
2. Chrome 保持同一受控 loopback actor。
3. 恢复同一 conversation、Draft v1/v2、parent lineage。
4. v1 stale Evidence 与 v2 terminal Evidence 不串版本/会话/actor。
5. 无 running 残留、自动重跑、Approval、Runtime、Simulation 或交易事实。

### 9.5 性能、双尺寸与 Console

- Walk-Forward running 期间页面可以滚动、切换卡片或读取安全状态，不出现整站冻结。
- 中文 1440×900：running/terminal/lineage/v1-v2 无遮挡和横向滚动。
- 英文 820×760：`scrollWidth === clientWidth === 820`，长 fingerprint 和错误文字不溢出。
- 键盘焦点可见；running/failed/timed-out/stale/ready 不只依赖颜色。
- Console 可用时清空后完成关键链；TradeBot warning/error 为 0。
- Chrome 扩展 channel-close 单独报告，不归因产品。
- Network 可用时只报告 `method/path/status`，禁止输出 header、Cookie、Bearer、body 或敏感值；不可用写 `TOOL_UNAVAILABLE`，不得人工替代。

---

## 10. F4 完成判定

只有以下全部 PASS 才可将 F4 标记为 `COMPLETE`：

- server-owned work budget 与 finite deadline 已建立；
- timeout/abort 后底层计算实际停止；
- deadline、lease、owner、fencing 和 restart 合同一致；
- success/failure/deadline terminal 均持久、幂等、不可被迟到结果覆盖；
- Walk-Forward 期间 Web/API 不整体卡死；
- 新鲜 v1 原页到达 `EVIDENCE READY / APPROVAL REQUIRED`；
- v1 reload 恢复且不重跑；
- 同 Draft immutable v2 parent/reference 正确；
- v1 stale/read-only Evidence 保留；
- v2 不继承 v1 Evidence，并独立到达 Evidence ready；
- Web/API restart 后两版本和 Evidence 恢复；
- 中文 1440×900、英文 820×760、焦点和 Console 通过；
- 全量自动化自然结束通过；
- 无 Approval、Runtime、Simulation 或交易副作用。

若全部通过：

- 更新规划、路线图和交接，将 F4 标为 `COMPLETE`；
- 创建唯一编号 `LOOP-062`，进入 F5 Simulation V2；
- LOOP-062 必须明确浏览器要求，并由服务端强制最多三个 active Paper Deployment；
- 不得进入 M6 Live。

若任一项失败：

- F4 保持 `IN_PROGRESS`；
- 如实记录第一个失败点、terminal/lease 状态与资源是否停止；
- 创建唯一编号 `LOOP-062`，但只能继续 F4；
- 不得把 HTTP timeout、reload 后结果、人工等待或仍在后台执行写成通过。

---

## 11. 文档与 Git 交付

必须更新：

- `docs/product-optimization-plan-and-progress.md`
- `docs/product-roadmap-and-progress.md`
- `docs/project-status-and-handoff.md`
- `docs/next-loop-prompt.md`
- 本 Loop 结果及唯一编号 LOOP-062 Prompt。

同步修正权威摘要中的旧 LOOP 编号和旧测试基线，不改写历史审计记录。

所有代码、测试和文档修改必须：

1. `git diff --check` 通过；
2. 确认不包含 `data/local-paper-workspace*`、运行数据或敏感值；
3. commit 到 `main`；
4. push 到 `origin/main`；
5. 确认本地 HEAD 与 `origin/main` 一致；
6. 不创建 PR。

即使 F4 未完成，只要产生修改，也必须 commit 并 push。

---

## 12. 最终回复模板

```text
Loop ID：LOOP-061
验收模式：DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
浏览器要求：Agent 已使用真实 Chrome / FAIL（说明）

注册 workload：folds / candidates / cycles / backtest invocations
执行模型：cooperative deadline / worker isolation
Work budget：PASS / FAIL
Runner deadline：PASS / FAIL
底层计算实际停止：PASS / FAIL
Lease/fencing：PASS / FAIL
Success terminal：PASS / FAIL
Failure terminal：PASS / FAIL
Deadline terminal：PASS / FAIL
迟到结果拒绝：PASS / FAIL
服务响应性：PASS / FAIL

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
下一 Loop：LOOP-062（F5 / F4 continuation）
Git：commit；branch main；push PASS；PR 未创建
```
