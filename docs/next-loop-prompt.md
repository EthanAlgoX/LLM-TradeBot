# Next Loop Prompt Index

```text
当前状态：F2 COMPLETE
最近完成：LOOP-034 — F2 Connections Chrome Closeout V1
下一任务：F3 Workbench V2 — 已发布 Agent Version 的受控动态 DAG
浏览器要求：F3 实现完成后必需，由 Agent 直接操作真实 Chrome
```

依据：[`product-roadmap-and-progress.md`](product-roadmap-and-progress.md) 的 F3 Workbench V2 范围。

LOOP-034 已关闭 F2：受控 actor 的连接登记、不可变 fingerprint、刷新和 Web/API restart 验收均已完成。下一轮只实现 F3 Workbench V2，不并行进入 F4～F5。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建真实 LLM 推荐、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
