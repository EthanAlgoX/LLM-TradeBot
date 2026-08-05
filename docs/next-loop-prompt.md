# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 IN_PROGRESS
最近完成：LOOP-054 的 version identity hydration/merge 和 382/382 自动化；Chrome action-response 未关闭
下一任务：LOOP-055 — F4 action response and recovery continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome；禁止人工验收
```

执行：[`LOOP-055`](loop-prompts/loop-055-f4-action-response-recovery-continuation-v1.md)

LOOP-055 只关闭 LOOP-054 未完成的 F4 缺口：在真实 Chrome 中确保 exact Draft Version 的 action response 在无需 reload 时立即显示最新 authority，并验证同 actor reload/Web/API restart 与新鲜 v1→同 Draft v2 stale 隔离。不得创建第二 authority；不得调用 Approval、创建 Approved Paper Plan、申请 Simulation Slot、执行 Runtime Apply 或产生交易写入。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
