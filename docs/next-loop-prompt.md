# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 IN_PROGRESS
最近完成：LOOP-061 建立协作式 deadline、budget、lease fencing 与 deadline terminal；Chrome 新 v1 Backtest 仍未在观察窗 terminal。
下一任务：LOOP-062 — F4 bounded-runner evidence continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome；禁止人工验收
```

执行：[`LOOP-062`](loop-prompts/loop-062-f4-bounded-runner-evidence-continuation-v1.md)

LOOP-062 只完成新的 v1 原页 Backtest/Walk-Forward terminal、failure UI、同 Draft v2/stale/reload/restart 和双尺寸 Chrome 验收；禁止用 HTTP timeout、reload 或仍在后台运行的任务伪造通过。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
