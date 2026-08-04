# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 IN_PROGRESS
最近完成：LOOP-049 的 Workbench F4 初始 hydration、version-targeted binding 与 legacy error 隔离
下一任务：LOOP-050 — F4 Evidence chain and Chrome closeout
浏览器要求：必需，由 Agent 直接操作真实 Chrome；禁止人工验收
```

执行：[`LOOP-050`](loop-prompts/loop-050-f4-evidence-chain-chrome-closeout-v1.md)

LOOP-050 只完成现有 F4 顺序链：`Preflight → Backtest → Walk-Forward → EVIDENCE READY / APPROVAL REQUIRED`，并验证 v1/v2 immutable + stale、reload/restart、中文 1440×900、英文 820×760 和最终 Console。不得创建第二套 validator/runner/evidence/approval/runtime authority；不得调用 Approval、创建 Approved Paper Plan、申请 Simulation Slot、执行 Runtime Apply 或产生交易写入。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
