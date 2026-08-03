# Next Loop Prompt Index

```text
当前状态：F2 COMPLETE
最近完成：LOOP-034 — F2 Connections Chrome Closeout V1
下一任务：LOOP-035 — F3 编排工作台结构化动态 DAG V1
浏览器要求：本次 Prompt 文档生成不需要；LOOP-035 实现完成后必需，由 Agent 直接操作真实 Chrome
```

执行：[`loop-035-f3-workbench-structured-dag-v1.md`](loop-prompts/loop-035-f3-workbench-structured-dag-v1.md)

LOOP-034 已关闭 F2。下一轮只实现自然语言 Strategy Intent、澄清、已发布 Agent Version 的结构化推荐、服务端动态 DAG 校验，以及 Apply 创建 immutable Strategy Draft；不并行进入 F4～F5。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 执行 Preflight、Backtest、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
