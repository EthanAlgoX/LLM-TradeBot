# Next Loop Prompt Index

```text
当前状态：F3 IN_PROGRESS
最近完成：LOOP-035 的部分实现
下一任务：LOOP-036 — F3 编排工作台结构化动态 DAG continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome
```

执行：[`loop-036-f3-workbench-continuation-v1.md`](loop-prompts/loop-036-f3-workbench-continuation-v1.md)

LOOP-035 已开始 F3，但必须先将新结构化推荐路径与既有 Conversation、Draft 与 Graph Validator authority 融合并完成 Chrome 闭环；不并行进入 F4～F5。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 执行 Preflight、Backtest、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
