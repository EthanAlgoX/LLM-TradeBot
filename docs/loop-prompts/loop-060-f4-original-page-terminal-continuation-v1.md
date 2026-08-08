# LOOP-060 — F4 原页 terminal 与 immutable v2 收尾

Loop ID：`LOOP-060`

里程碑：F4 Preflight / Backtest / Walk-Forward Evidence

验收模式：`DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY`

浏览器要求：**必需**。只能由 Agent 直接操作真实 Chrome；禁止用户人工验收、人工 DevTools 交接或以用户口述结果代替。

基线：`main` / `79e52a2`，`npm run test:ts` 自然 TAP `386/386 PASS`。

---

## 1. 当前事实

LOOP-058 已完成：

- F4 action 点击后立即显示按 `configurationVersionId + action` 隔离的临时 `running`；
- 旧按钮立即移除，不能重复提交；
- POST 返回后只允许 exact immutable version 的服务器 projection 替换 running；
- Backtest 与 Walk-Forward 曾在 Agent Chrome 中完成原页 `running → 后续 gate`；
- action→state→render 集成回归已存在。

LOOP-059 已修复 reload 显示 0 张 F4 卡片的确定性根因：

- `hydrateRealWorkbench()` 曾通过 `Promise.all` 等待所有 Draft 的 F4 GET；
- 任意一条未终结 F4 projection 会阻塞 `realWorkbenchTurns` 写入和整个 history render；
- 现在 history 先投影，F4 projection 按 `draftId + versionId + fingerprint` 独立合并；
- 同 actor reload 和受控 Web/API restart 已恢复已有 v1 partial Evidence、lineage 与无 running 的卡片；
- 中文 1440×900、英文 820×760、Console 和 386/386 自动化已通过。

F4 仍为 `IN_PROGRESS`。LOOP-059 的新鲜 v1 在 Walk-Forward 显示 scoped running 后，没有在原页取得 terminal projection，因此没有资格继续创建 v2。

本轮唯一顺序目标是：

1. 先确定 Walk-Forward 未在原页 terminal 的精确生命周期断点并修复；
2. 在不 reload 的原页使新鲜 v1 到达 `EVIDENCE READY / APPROVAL REQUIRED`；
3. 只有 v1 terminal 后，才能创建同 Draft immutable v2；
4. 完成 v1 stale/read-only、v2 独立 Evidence、reload/restart 与双尺寸收尾。

不得把 reload、restart、重新点击、换 Draft、延长人工等待或直接查询 API 当作“原页 terminal”通过。

---

## 2. 强制安全边界

本轮只允许修改：

- F4 Walk-Forward action/runner completion；
- exact-version action response、projection merge、running/error/terminal UI；
- Workbench F4 hydration/recovery；
- 与以上行为直接相关的合同、测试、Web UI 和文档。

本轮禁止：

- Human Approval 或任何 Approver 动作；
- Approved Paper Plan；
- Simulation Slot、Runtime Apply、Deployment、Run 或 Paper cycle；
- Account、Position、Order、Fill 或交易所写入；
- Live、Canary、Champion 自动替换、持仓迁移；
- 恢复 LOOP-025 / M6；
- 新建第二套 Draft、Evidence Job、Artifact、Conversation 或 F4 authority；
- 客户端伪造 succeeded、Evidence ready 或 approval required；
- 使用 localStorage/sessionStorage 保存 F4 authority；
- 自动 reload、自动重跑 action、固定 sleep、无限重试或无界 polling；
- 读取、打印、复制或暴露 Bearer、Cookie、Token、Secret 值；
- 修改或提交 `data/local-paper-workspace*`。

始终保持：

```text
runtimeApplied=false
Paper Only
exchangeWriteAllowed=false
```

F4 未 `COMPLETE` 前不得进入 F5。

---

## 3. 执行前检查

1. 完整阅读：
   - `docs/product-optimization-plan-and-progress.md`
   - `docs/product-roadmap-and-progress.md`
   - `docs/project-status-and-handoff.md`
   - `docs/next-loop-prompt.md`
   - LOOP-057～LOOP-059 Prompt 与 handoff。
2. 执行 `git status --short --branch`，保留用户既有修改，不回退、不覆盖无关文件。
3. 确认 `main` 包含 `79e52a2`，确认本地与 `origin/main` 关系。
4. 识别并只使用一个当前 HEAD 的 `npm run dev:paper` 链路，避免旧构建进程。
5. 只读检查 5174/8787 监听者；不得误杀不属于本轮的进程。
6. 不清空、不删除、不替换 workspace 数据；使用产品正常生命周期创建新鲜 actor-scoped v1。

---

## 4. 必须先取得的 Walk-Forward 生命周期证据

先复现一次新鲜 v1 的 Walk-Forward，针对同一次 action identity 建立从点击到可见 DOM 的有界非敏感 trace。必须判定以下每层是否发生及先后顺序：

### 4.1 浏览器 action 层

1. exact `draftId + versionId + fingerprint + action` 的 handler 是否只触发一次；
2. running state 是否在网络 Promise settle 前写入；
3. running render 是否完成，旧按钮是否移除；
4. POST 是否只发出一次，idempotency identity 是否稳定；
5. 页面、route、conversation 或 version 是否在等待期间发生切换；
6. action Promise 最终是 resolve、reject、abort，还是超过服务端合同期限仍 pending。

### 4.2 HTTP / 服务端 action 层

1. 请求是否通过身份、actor、version、fingerprint 和 next-action 校验；
2. Walk-Forward command 是否被接受一次；
3. durable binding/job 是否存在，是否复用已有幂等事实；
4. registered runner 是否 start；
5. runner 是否 terminal：`succeeded`、`failed`、`timed_out` 或仍 `running`；
6. terminal projection 是否已 append-only 持久化；
7. HTTP response 是否在 terminal 后成功返回，还是 server handler 未结束/连接中止；
8. 返回 projection 是否与 action 的 exact immutable version 一致。

### 4.3 客户端 authority / DOM 层

1. response 是否到达 action handler；
2. response 是否通过 exact-version identity guard；
3. running 是否只被服务器 projection、明确 error 或明确 timeout 替换；
4. merge 后 render state 是否为 terminal；
5. render 输出是否包含后续 gate；
6. DOM 是否显示 `EVIDENCE READY / APPROVAL REQUIRED`；
7. 是否有迟到 history/hydration/render 把 terminal 回滚。

必须把根因归入并证明以下一种或多种，而不能只写“没有 terminal”：

```text
A. Runner 在服务端合同时间内仍合法运行，页面只是仍在等待
B. Runner 已 terminal，但 HTTP handler/response 未结束或中止
C. HTTP 已返回 terminal，但客户端未 merge/render
D. 服务端只返回 in-progress，客户端缺少合同化的 completion 通知/读取路径
E. Runner 明确 failed/timed_out，但 UI 没有呈现稳定失败态
F. terminal 已渲染，随后被陈旧响应覆盖
```

若需要 DEV-only trace：

- 只记录事件名、单调序号、状态、耗时和 opaque identity 是否相等；
- 禁止记录 prompt、Cookie、Token、Secret、header 或完整 payload；
- 根因确定后删除，或确保 production build 完全禁用；
- trace 不能成为运行依赖。

不得用 Chrome 控制通道自身的短等待超时推断产品超时。应以现有 runner/HTTP 合同定义的终态或明确 deadline 为准；若合同没有 deadline，这本身是需要修复的产品缺口。

---

## 5. 修复原则

修复必须基于第 4 节证据，并满足：

1. 服务端 append-only Evidence Job/Artifact/F4 projection 是 terminal 唯一 authority。
2. running 仍是仅作用于 exact version/action 的临时 UI 状态，不得升级为客户端事实源。
3. 同步合同：若 POST 设计为 terminal 后返回，必须保证成功、失败和 timeout 都有有界、稳定返回。
4. 异步合同：只有证据证明现有 POST 本来就是 accepted/in-progress 才可完善 completion 路径；必须复用已有 durable job/projection，禁止创建第二 Job 或第二 Evidence authority。
5. 不得增加无界 polling。若现有异步合同确实需要状态读取，只允许 server-declared terminal 状态、总 deadline、有界退避和 exact job/version scope，并补齐 timeout/abort 测试。
6. POST 成功 terminal 后，原页必须立即用 exact-version projection 替换 running，不依赖 reload。
7. failed/timed_out 必须显示稳定、可读、可安全幂等重试的错误状态；不能恢复旧按钮并静默失败。
8. 重复点击、重复 idempotency key 和网络重试不能创建第二 Job/Artifact。
9. route/conversation/version 切换后，旧 action 结果不能写入新的可见 Draft。
10. reload/restart 恢复必须保留 LOOP-059 已修复的独立 card hydration，不能重新引入全局 `Promise.all` 阻塞。
11. 不改 F1/F2/F3 authority，不改变 M4/M5 Runtime、Shadow 或交易安全链。

如果现有 handler 难以测试，可以提取小型 F4 action coordinator/reducer；禁止引入新前端框架或重写 Workbench。

---

## 6. 自动化测试要求

至少补齐以下行为级测试：

1. action handler 只调用一次，running 在 Promise settle 前进入 render model。
2. terminal success：response → exact-version merge → running 清除 → 后续 gate render。
3. explicit failure：显示稳定错误，不伪造 terminal，不产生第二 Job。
4. timeout/abort：状态有界、可恢复、幂等，不无限 pending 或无限重试。
5. 如果存在 accepted/in-progress response：completion 只读取同一 durable job/exact version，deadline 后稳定失败。
6. action 期间切换 conversation/version：迟到结果不能污染当前页面。
7. action 与 history/F4 hydration 任意交错：terminal authority 不被旧 projection 覆盖。
8. reload：临时 running 不恢复，已有 partial/terminal projection 按 exact version 恢复。
9. 同 Draft immutable v1→v2：
   - v1 Evidence 保持不可变且可读；
   - v1 stale/read-only 不恢复 authorization；
   - v2 有精确 parent version/fingerprint；
   - v2 不继承 v1 binding/jobs/Evidence/running；
   - v2 可独立完成新的 Evidence 链。
10. actor 隔离、非法 ID、错误 method、损坏 payload、幂等冲突继续 fail closed。
11. Web/API restart 后恢复 Conversation、Draft v1/v2 与各自 F4 projection。
12. 无 Approval、Runtime、Simulation、Account/Order/Fill 或交易写入事实。

不得只测 helper。至少一条集成测试必须覆盖：

```text
用户 action
→ running render
→ runner/HTTP terminal
→ exact-version authority merge
→ terminal render output
```

---

## 7. 自动化门禁

必须全部执行并取得真实最终结果：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

要求：

- `test:ts` 必须自然结束；
- 报告最终 TAP 总数和 exit 0；
- 不得用 kill 把未自然结束写成 PASS；
- 若存在本轮拥有的 timer、runner、server 或 SQLite handle，测试结束时必须显式关闭。

---

## 8. Agent 真实 Chrome 验收

只能由 Agent 操作真实 Chrome。不得让用户手动点击、手动检查 DevTools 或回复验收模板；不得以内置浏览器、API、日志或自动化替代要求中的可见 UI 证据。

### 8.1 新鲜 v1 原页完整链

通过正常 Agent Center/Workbench 生命周期准备一个新鲜、可执行的 v1：

1. 显示 exact Configuration v1/fingerprint。
2. Preflight 原页完成。
3. Backtest 点击后立即显示 scoped running，旧按钮消失。
4. 不 reload、不重试，原页进入 Backtest terminal 和 Walk-Forward gate。
5. Walk-Forward 点击后立即显示 scoped running，旧按钮消失。
6. 在产品合同规定的有界期限内，不 reload、不重试，原页进入：

```text
EVIDENCE READY
APPROVAL REQUIRED
```

7. lineage 显示 exact version、registered Graph/Dataset、Profile/Plan、binding/job/evidence 摘要。
8. 不点击 Approval。

如果只在 reload/restart 后看见 terminal，本项 FAIL。

### 8.2 v1 reload recovery

v1 terminal 后直接 reload：

- 恢复同一 actor、conversation、Draft v1 和 terminal F4 card；
- Evidence/lineage 与 reload 前一致；
- 不残留 running，不回退 pending/locked/loading；
- 不重新创建 Draft，不重跑任何 action。

### 8.3 同 Draft immutable v2

通过正常 Workbench 修改，例如“最大仓位调整为 5%”，并 Apply：

1. 创建同一 Configuration Draft 的 immutable v2，不是新 draft v1。
2. v2 显示精确 `parentVersionId + parentFingerprint`。
3. v1 内容、fingerprint、binding、jobs、Evidence 保持不变可读。
4. v1 显示 stale/read-only，不能授权 v2。
5. v2 不继承 v1 binding、jobs、Evidence ready 或 running。
6. v2 在原页独立完成 Preflight、Backtest、Walk-Forward。
7. v2 到达 `EVIDENCE READY / APPROVAL REQUIRED`，仍不点击 Approval。

只有 v1 原页 terminal 后才允许执行本节；不得跳过 v1 失败直接制造 v2。

### 8.4 reload 与 Web/API restart

在 v1/v2 均完成后：

1. reload，确认同 actor 两版本、parent lineage、v1 stale 与 v2 terminal 全部恢复。
2. 由 Agent 受控停止本轮拥有的 `dev:paper`，再以当前 HEAD 启动唯一服务。
3. Chrome 恢复同一 loopback actor、conversation、Draft v1/v2。
4. v1/v2 Evidence 不串版本、不串会话、不串 actor。
5. 不自动重跑 action，不产生 Approval/Runtime/Simulation/交易事实。

### 8.5 中英文、响应式和可访问性

- 中文 1440×900：running、terminal、lineage、v1/v2 history 无遮挡、无横向滚动。
- 英文 820×760：`scrollWidth === clientWidth === 820`，按钮和长 fingerprint 不溢出。
- 键盘焦点可见。
- running、failed、timed out、stale、ready、approval required 不只依赖颜色表达。

### 8.6 Console / Network

- 若能力可用，清空 Console 后 reload 并完成关键流程；TradeBot warning/error 必须为 0。
- Chrome 扩展 channel-close 错误单独报告，不归因 TradeBot。
- Network 可用时只报告 `method/path/status`，确认无意外 401/5xx；禁止输出 header、Cookie、Bearer、body 或敏感值。
- 工具不可用时写 `TOOL_UNAVAILABLE`，禁止以 API、日志或人工替代。

---

## 9. F4 完成判定

只有以下全部 PASS 才可将 F4 标记为 `COMPLETE`：

- Walk-Forward 原页未 terminal 的确定性根因和生命周期证据完整；
- 新鲜 v1 原页完成 Preflight → Backtest → Walk-Forward；
- Backtest/Walk-Forward running、success/failure/timeout 合同稳定；
- v1 原页到达 `EVIDENCE READY / APPROVAL REQUIRED`；
- v1 reload 恢复，不重跑 action；
- 同 Draft immutable v2 parent/reference 正确；
- v1 stale/read-only Evidence 保留；
- v2 不继承 v1 Evidence，并独立到达 Evidence ready；
- reload 与 Web/API restart 后两版本恢复且不串台；
- 中文 1440×900、英文 820×760、焦点和 Console 通过；
- 全量自动化门禁自然结束并通过；
- 无 Approval、Runtime、Simulation 或交易副作用。

若全部通过：

- 更新规划、路线图和交接，将 F4 标为 `COMPLETE`；
- 创建唯一编号 `LOOP-061`，进入 F5 Simulation V2；
- LOOP-061 必须明确浏览器要求和服务端最多三个 active Paper Deployment；
- 不得进入 M6 Live。

若任一项失败：

- F4 保持 `IN_PROGRESS`；
- 如实记录第一个失败点和证据；
- 创建唯一编号 `LOOP-061`，但只能继续 F4；
- 不得以 reload、人工验收、延长无界等待或自动重跑写成通过。

---

## 10. 文档与 Git 交付

必须更新：

- `docs/product-optimization-plan-and-progress.md`
- `docs/product-roadmap-and-progress.md`
- `docs/project-status-and-handoff.md`
- `docs/next-loop-prompt.md`
- 本 Loop 结果及唯一编号 LOOP-061 Prompt。

同步清理权威摘要中残留的旧 LOOP 编号和旧测试基线，但不要改写历史审计记录。

所有本轮代码、测试和文档修改必须：

1. `git diff --check` 通过；
2. 确认不包含 `data/local-paper-workspace*`、运行数据或敏感值；
3. commit 到 `main`；
4. push 到 `origin/main`；
5. 确认本地 HEAD 与 `origin/main` 一致；
6. 不创建 PR。

即使 F4 未完成，只要产生修改，也必须 commit 并 push。

---

## 11. 最终回复模板

```text
Loop ID：LOOP-060
验收模式：DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
浏览器要求：Agent 已使用真实 Chrome / FAIL（说明）

Walk-Forward 原页根因：
Runner terminal：PASS / FAIL
HTTP terminal response：PASS / FAIL
Exact-version merge：PASS / FAIL
Terminal DOM render：PASS / FAIL
Failure/timeout contract：PASS / FAIL

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
下一 Loop：LOOP-061（F5 / F4 continuation）
Git：commit；branch main；push PASS；PR 未创建
```
