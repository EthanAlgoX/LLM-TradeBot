# Next Loop Prompt Index

```text
当前状态：AWAITING_USER_PRODUCT_REVIEW
最近完成：LOOP-028 — R1 模拟与编排对话面细化
交付边界：PROTOTYPE_ONLY / PAGE_MEMORY_ONLY
```

LOOP-028 已在 Chrome 中打开：模拟交易底部有多轮子 Agent 对话，编排工作台以对话内动态拓扑取代固定右栏。等待用户确认这两个页面方向，以及 Agent 中心、连接配置的四页整体结构后，才为选中的真实功能接入创建新的唯一编号 Prompt。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建真实 LLM 推荐、Strategy App 后端、API、SQLite 或持久化；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
