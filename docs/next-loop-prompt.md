# Next Loop Prompt Index

```text
当前状态：F2 IN_PROGRESS
最近完成：LOOP-033 — F2 服务端连接定义、SQLite、Bearer API 与安全 Web 基础
下一任务：LOOP-034 — F2 Connections Chrome Closeout V1
浏览器要求：LOOP-034 必需，由 Agent 直接操作真实 Chrome
```

执行：[`loop-034-f2-connections-chrome-closeout-v1.md`](loop-prompts/loop-034-f2-connections-chrome-closeout-v1.md)

LOOP-033 已完成 F2 基础实现；下一轮只关闭受控 actor 的 Chrome 与 Web/API restart 验收，不并行实现 F3～F5。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建真实 LLM 推荐、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
