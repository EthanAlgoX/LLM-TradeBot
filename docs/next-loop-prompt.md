# Next Loop Prompt Index

```text
当前状态：F3 IN_PROGRESS
最近完成：LOOP-043 的部分修复与验收
下一任务：LOOP-044 — F3 Published Catalog recovery and test closeout
浏览器要求：必需，由 Agent 直接操作真实 Chrome
```

执行：[`loop-044-f3-catalog-recovery-and-test-closeout-v1.md`](loop-prompts/loop-044-f3-catalog-recovery-and-test-closeout-v1.md)

LOOP-043 已确认同一 local Paper actor 的 Workbench/Draft 可在 reload/restart 后恢复，且 legacy no-provenance Recommendation 只读不可 Apply；聚焦 Copilot 测试也已自然完成 21/21。最新 Chrome 证据同时表明重启后只有 Input Agent 恢复，Analysis/Decision/Reflection Published Catalog 缺失；全量测试虽有 243 个通过子测试，但仍未自然输出最终 TAP 汇总。LOOP-044 必须修复这两个真实阻塞并完成全链 Chrome 验收，不能并行进入 F4～F5。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 执行 Preflight、Backtest、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
