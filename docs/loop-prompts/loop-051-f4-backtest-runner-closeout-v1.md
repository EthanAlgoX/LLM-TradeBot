# LOOP-051 — F4 Backtest runner and Evidence chain closeout

```text
Loop ID: LOOP-051
Milestone: F4 Preflight / Backtest / Walk-Forward V1 closeout
Mode: DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
Browser requirement: REQUIRED; Agent-operated real Chrome only; manual/user-assisted verification is forbidden
Safety: validation/evidence only; stop at APPROVAL REQUIRED; no Human Approval, Approved Paper Plan, Runtime Apply, Simulation Slot, account/order/fill or exchange write
Git: commit and push main for every code/document change; no PR
```

## 目标

LOOP-050 已在真实 Chrome 中验证新 Workbench Draft 的 F4 hydration 和 Preflight passed，但点击 Backtest 后卡片仍显示 `backtest: locked`。本轮先取得证据定位 Backtest 请求、runner、authority projection 或 UI 更新中的准确断点，再做最小修复，并完成：

```text
immutable Strategy Draft Version
→ Preflight passed
→ Backtest succeeded
→ Walk-Forward succeeded
→ EVIDENCE READY / APPROVAL REQUIRED
```

不得跳过 Backtest，不得直接写成功状态，不得调用 Approval。只有完整自动化和 Agent Chrome 验收都通过，才能将 F4 标记为 `COMPLETE`。

## 已知基线

- F3 `COMPLETE`，F4 `IN_PROGRESS`。
- F4 projection 已按 actor + exact Draft `versionId` 查询。
- 初始 identity、Apply 后和 reload hydration 已恢复，不再永久显示 `F4 loading…`。
- Preflight 在真实 Chrome 中已显示 passed，下一动作能够显示 Backtest。
- Workbench Evidence 不要求 Executable Runtime materialization；只允许使用注册 CSV Historical authority。
- `StrategyEvidenceApprovalService.runBacktest()` 应提交/运行现有 Graph Evidence Job，再以 append-only binding version 记录 `backtestJob`。
- LOOP-050 尚未完成全量 `npm run test:ts`，本轮必须取得自然最终 TAP 汇总。

## 强制边界

1. 只复用现有 Configuration/Pipeline validator、registered CSV graph/plan/runner、Graph Evidence Jobs、`StrategyEvidenceApprovalService`、Artifact verification 和 stale authority。
2. 不创建第二套 validator、runner、job store、artifact、evidence binding、approval、runtime、Draft、identity 或浏览器状态源。
3. 不通过 Mock、Sample、固定 UI 文案、直接 SQLite 修改、DOM 注入或伪造 API response 让 gate 变绿。
4. API/日志/SQLite 只可用于只读诊断；正向 PASS 必须由 Agent 从真实 Workbench UI 发起并看到服务端权威结果。
5. 禁止用户手工验收。Chrome 控制不可用时如实报告 `NOT VERIFIED`。
6. 不读取、复制或输出 token、cookie value、secret 或请求敏感内容。
7. 不修改、删除或提交 `data/local-paper-workspace*` 与本地运行数据。
8. 始终保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

## A. 精确诊断 Backtest locked

不要先猜测修改。使用一个全新的、当前 actor 所属、CSV-backed immutable Draft Version，在真实 UI 中完成 Preflight 后点击 Backtest，并区分以下阶段：

1. **UI dispatch**
   - 按钮携带的是 exact `versionId` 和 action `backtest`；
   - 点击只发送一次受控 POST，idempotency key 符合合同且作用域稳定；
   - loading/disabled 状态不会吞掉响应或触发重复请求。
2. **HTTP/Workbench service**
   - 路由命中 exact Draft Version；
   - Preflight authority 为 passed；
   - 失败返回稳定安全 code，不得被包装成模糊 `WORKBENCH_REQUEST_FAILED`；
   - 不应由于缺少 Executable Runtime materialization 而拒绝 Historical Evidence。
3. **Evidence binding**
   - 查找或创建的 binding 精确绑定 Configuration Version、Pipeline fingerprint、Dataset、Backtest Profile、时间范围和 actor；
   - 已有 stale/其他版本 binding 不得被误当作当前 binding；
   - append-only binding version/replay 不能返回动作前的旧 snapshot。
4. **Registered runner/job**
   - `submitBacktest` 使用注册 plan/dataset/profile 和服务端时间范围；
   - job 若未完成，应由现有 runner 执行；成功后必须有可验证 `graph_backtest` Artifact；
   - job replay 必须返回相同成功事实，payload 冲突必须 fail closed。
5. **Projection/UI update**
   - POST 成功结果或随后 GET 必须投影最新 binding version 的 `backtestJob`；
   - UI 只更新相同 exact Draft Version；
   - 陈旧 hydration/action 响应不能覆盖较新的 succeeded projection；
   - `backtest: succeeded` 后唯一下一动作必须为 `walk-forward`，不能仍为 locked。

为确认的根因增加聚焦自动化测试。测试至少覆盖“Preflight passed → Backtest action → returned/current projection has succeeded `backtestJob` and nextAction `walk-forward`”，并验证 reload/repository reread 不退回 locked。

## B. 完成真实 Evidence 链

修复后，从正常 Workbench UI 执行：

1. 新真实 Recommendation → Apply immutable Draft；
2. Preflight passed；
3. Backtest succeeded，并显示真实 binding/job/artifact lineage；
4. Walk-Forward succeeded，并显示真实窗口、job/artifact lineage；
5. 终态显示 `EVIDENCE READY / APPROVAL REQUIRED`，且没有 Approve 动作被自动调用。

UI 至少应可读地展示：

- Draft `versionId + fingerprint`；
- Pipeline/Graph fingerprint；
- Dataset version/fingerprint；
- Backtest Profile 与 Walk-Forward Candidate Set/Plan reference；
- Binding version/fingerprint；
- Backtest/Walk-Forward job status 与 Evidence reference/fingerprint；
- 当前 gate、唯一下一动作和 stale 状态。

若现有投影已经返回这些事实但 UI 没有展示，可做最小展示补充；禁止引入新的详情 authority。

## C. immutable v1/v2、stale 与恢复

- v1 完成双 Evidence 后，通过正常 Workbench 修改创建同一 Configuration Draft 的 immutable v2；
- v1 及其 Evidence 保持不变、可读；
- v2 绑定新的 exact version/fingerprint，不能继承 v1 的 ready gate；
- 旧 Evidence 对 v2 明确 stale/不适用，v2 必须重新 Preflight/Backtest/Walk-Forward；
- 切换 v1/v2、切换 Conversation、reload 和重启时不交叉覆盖；
- legacy error/`PROVENANCE_UNAVAILABLE` Draft 只读且不阻塞当前 Draft。

## D. fail-closed 与幂等

自动化验证：

- 同 actor + 同 key + 同 Draft/action/payload 返回 exact replay；
- 同 key 换 Draft Version、action 或 payload 返回 `IDEMPOTENCY_CONFLICT`；
- 跨 actor、未知 version、畸形 ID、未知字段、错误 method fail closed；
- Preflight 未通过时拒绝 Backtest；Backtest 未通过时拒绝 Walk-Forward；
- runner failure/tampered Artifact/lineage drift 显示稳定错误或 stale，不能显示 succeeded；
- 所有负向路径都不产生 Approval、Paper Plan、Runtime 或交易事实。

## Agent Chrome 验收

实现和自动化通过后，排除旧 Vite/API 进程与端口占用，受控启动唯一 `npm run dev:paper`，确认服务使用当前 HEAD。只能由 Agent 操作真实 Chrome。

### 中文 1440×900

- 新 Draft 完整完成 Preflight → Backtest → Walk-Forward；
- Backtest 不再 locked，并展示真实 Evidence lineage；
- 终态明确为 `EVIDENCE READY / APPROVAL REQUIRED`；
- v1/v2 stale 和 immutable history 可辨认；
- reload 与受控 Web/API restart 后恢复；
- legacy error 不影响当前 Draft；
- 无横向滚动、无遮挡，键盘焦点可见。

### English 820×760

- gate、action、lineage、stale 和 approval-required 状态为可理解英文；
- `scrollWidth === clientWidth === 820`；
- 内容和按钮不被裁切，键盘焦点可见。

### Console / Network

- 最终清空 Console 后 reload，TradeBot 页面 warning/error 为 0；Chrome 扩展 channel error 单独记录；
- Network 若不可读取，报告 `TOOL_UNAVAILABLE`，不得用人工 DevTools、API 或日志替代；
- 若可读取，只报告 method/path/status，不输出 headers、cookies、tokens 或敏感 body。

### Runtime safety

确认：

- `runtimeApplied=false`；
- Paper Only；
- `exchangeWriteAllowed=false`；
- 本轮没有 Human Approval、Approved Paper Plan、Simulation Slot、Deployment、Run、Account、Order、Fill 或 Exchange Write 事实。

## 自动化门禁

必须执行并取得真实终态：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

`npm run test:ts` 必须自然退出，输出最终 TAP 汇总和 exit 0。只看到若干子测试通过不能记为 PASS。

## 文档与 Git

- 全部必需项通过后才将 F4 标记为 `COMPLETE`，并创建唯一递增编号 `LOOP-052` 进入 F5 Simulation V2。
- 任一必需项未通过则 F4 保持 `IN_PROGRESS`，`LOOP-052` 只能针对剩余 F4 缺口。
- 更新：
  - `docs/product-optimization-plan-and-progress.md`
  - `docs/product-roadmap-and-progress.md`
  - `docs/project-status-and-handoff.md`
  - `docs/next-loop-prompt.md`
- 所有代码与文档修改必须 commit 并 push `main`，确认本地 HEAD 与 `origin/main` 一致；不创建 PR。

## 最终报告模板

```text
Loop ID：LOOP-051
验收模式：DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
浏览器要求：必需；Agent 已使用真实 Chrome / 未完成（原因）

Backtest locked 根因：
Backtest runner/job：PASS / FAIL / NOT VERIFIED
Backtest 最新 authority projection：PASS / FAIL / NOT VERIFIED
Workbench UI 更新：PASS / FAIL / NOT VERIFIED
Preflight：PASS / FAIL / NOT VERIFIED
Backtest Evidence：PASS / FAIL / NOT VERIFIED
Walk-Forward Evidence：PASS / FAIL / NOT VERIFIED
EVIDENCE READY / APPROVAL REQUIRED：PASS / FAIL / NOT VERIFIED
v1/v2 immutable + stale：PASS / FAIL / NOT VERIFIED
幂等与顺序门禁：PASS / FAIL
actor/ID/method/artifact fail-closed：PASS / FAIL
reload / Web/API restart recovery：PASS / FAIL / NOT VERIFIED
中文 1440×900：PASS / FAIL / NOT VERIFIED
英文 820×760：PASS / FAIL / NOT VERIFIED
Console：PASS / FAIL / TOOL_UNAVAILABLE
Network：PASS / FAIL / TOOL_UNAVAILABLE
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
Approval/Runtime/交易副作用：NONE / FAIL（说明）
自动化：check；test:ts 最终 TAP；build:web；diff-check
F4：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-052（F5 / F4 continuation）
Git：commit；branch main；push PASS/FAIL；PR 未创建
```
