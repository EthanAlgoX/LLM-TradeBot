# LOOP-063 — F4 正向 Production Evidence 收尾

Loop ID：`LOOP-063`

验收模式：`VERIFY_FIRST_DIAGNOSE_FIX_IF_NEEDED_AND_AGENT_CHROME_VERIFY`

浏览器要求：必需；只能由 Agent 操作真实 Chrome。

## 已知事实

- LOOP-062 已确认旧 production Backtest 在 50 秒后仍 running；根因是 execution context 在 `GraphBacktestSession.execute()` 前丢失，且 session 同步重解析已注册 CSV。
- 当前 HEAD 已把 context 传播到历史 executor/node 边界，并复用注册时解析且 fingerprinted 的 immutable CSV snapshot。
- 修复后 Chrome 新鲜 v1 Backtest 于 48.3 秒 durable `failed`，没有 Artifact；停止合同通过，但正向 Evidence 未通过。

## 目标

1. 不改代码先在当前 HEAD 以真实 Chrome 新鲜 v1 完整观察 Backtest，记录 terminal、failure code、最大 node/cycle wall-clock 与 API 响应性。
2. 若仍为 deadline terminal，使用仅含事件名、相对时间和数量的 DEV trace 定位最长注册 node/CPU 段；不得记录 payload、token、cookie 或 secret。
3. 仅用最小的协作式分块、缓存或已注册 snapshot 优化，使合法 registered Backtest 和 Walk-Forward 在 server 45 秒 deadline + 最多 5 秒投影余量内正向 succeeded。不得缩小 Dataset、fold、candidate、cycle 或日期范围，也不得引入第二 Job/Artifact authority。
4. 若同步段无法安全分块，才使用可终止 worker；parent 保留 lease/fencing 与 Artifact commit authority。
5. 只有 v1 原页 `EVIDENCE READY / APPROVAL REQUIRED` 后，完成同 Draft v2、v1 stale、reload/restart、双尺寸与 Console；不点击 Approval。

## 不变量

始终保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。禁止 Approval、Runtime Apply、Simulation、Deployment、Order、Fill、交易所写入、F5/M6、静默 workload 缩减、无限 polling、历史 terminal 替代原页 terminal。

## 必须门禁

执行 `npm run check`、`npm run test:ts`（自然结束）、`npm run build:web`、`git diff --check`。若有修改，更新三份进度/交接文档与 next-loop-prompt，提交至 `main`、push `origin/main`，不创建 PR。
