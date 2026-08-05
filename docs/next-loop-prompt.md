# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 IN_PROGRESS
最近完成：LOOP-051 已以当前 HEAD 的受控 Paper 服务完成一条真实 Workbench v1 的 Preflight、Backtest、Walk-Forward 与 approval_required；未调用 Approval
下一任务：LOOP-052 — F4 remaining closeout
浏览器要求：必需，由 Agent 直接操作真实 Chrome；禁止人工验收
```

执行：LOOP-052（F4 continuation；先创建唯一递增 Prompt）

LOOP-052 只关闭 F4 剩余缺口：以同一 Configuration Draft 的 v1/v2 做 stale 与恢复验收，补齐可读 lineage、集中回归测试、中文 1440×900、英文 820×760、最终 Console 和自然结束的全量 TAP。不得创建第二套 validator/runner/evidence/approval/runtime authority；不得调用 Approval、创建 Approved Paper Plan、申请 Simulation Slot、执行 Runtime Apply 或产生交易写入。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
