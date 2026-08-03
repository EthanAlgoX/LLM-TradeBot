# Next Loop Prompt Index

```text
当前状态：F3 IN_PROGRESS
最近完成：LOOP-042 的部分实现
下一任务：LOOP-043 — F3 Workbench recovery verification continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome
```

执行：[`loop-043-f3-workbench-recovery-verification-continuation-v1.md`](loop-prompts/loop-043-f3-workbench-recovery-verification-continuation-v1.md)

LOOP-042 已在 Chrome 证明同一 local Paper actor 在 Web/API restart 后恢复 Workbench、Draft 与四类 Published Catalog。仍需取得干净的全量 TAP 总结及新鲜 Console/Network 验收，才可关闭 F3；不并行进入 F4～F5。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 执行 Preflight、Backtest、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
