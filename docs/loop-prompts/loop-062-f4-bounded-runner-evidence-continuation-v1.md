# LOOP-062 — F4 bounded runner Evidence continuation

Loop ID：`LOOP-062`

验收模式：`DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY`

浏览器要求：**必需**。只能由 Agent 直接操作真实 Chrome。

基线：LOOP-061，`npm run test:ts` 自然 TAP `387/387 PASS`。

## 当前事实

- Graph Evidence 已有 server-owned work budget（本地注册 scope：5 folds、1 candidate、10 backtests、150 cycles；上限 300 cycles）。
- execution deadline 为 45 秒，早于 60 秒 lease；deadline 在 fold/candidate/cycle checkpoint 传播，持久化为 `failed/GRAPH_JOB_EXECUTION_DEADLINE_EXCEEDED`，无 Artifact。
- complete/fail 必须匹配未过期 owner lease；expired/late owner 不可写 terminal，restart expired running 变 orphaned。
- Agent Chrome 新 v1 已在原页完成 Preflight，Backtest 立即显示 scoped running/移除旧按钮；9 秒观察窗还未 terminal。F4 未完成，v2/reload/restart 未开始。

## 唯一目标

先在当前 HEAD 用真实 Chrome 完成新鲜 v1 的 Backtest 与 Walk-Forward 原页 terminal。若合法注册工作量无法在 deadline 内成功，测量每个 cycle 并优化/隔离实际工作，不能静默缩小范围。只有 v1 显示 `EVIDENCE READY / APPROVAL REQUIRED` 后，才创建同 Draft immutable v2，验证 v1 stale/read-only、v2 独立 Evidence、reload/restart、双尺寸和 Console。

禁止 Approval、Runtime、Simulation、交易写入、M6、客户端 authority、Promise.race-only timeout、reload/重跑伪造。始终保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

执行所有门禁：`npm run check`、`npm run test:ts`、`npm run build:web`、`git diff --check`；如有修改，commit/push main，不建 PR。
