# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 IN_PROGRESS
最近完成：LOOP-050 的新 Apply hydration 与真实 Chrome Preflight；Backtest 仍 locked
下一任务：LOOP-051 — F4 Backtest runner closeout
浏览器要求：必需，由 Agent 直接操作真实 Chrome；禁止人工验收
```

执行：[`LOOP-051`](loop-prompts/loop-051-f4-backtest-runner-closeout-v1.md)

LOOP-051 只完成现有 F4 顺序链中 Backtest locked 的剩余缺口，并完成 `Preflight → Backtest → Walk-Forward → EVIDENCE READY / APPROVAL REQUIRED`、v1/v2 stale、reload/restart、中文 1440×900、英文 820×760 与最终 Console。不得创建第二套 validator/runner/evidence/approval/runtime authority；不得调用 Approval、创建 Approved Paper Plan、申请 Simulation Slot、执行 Runtime Apply 或产生交易写入。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
