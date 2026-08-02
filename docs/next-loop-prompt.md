# Next Loop Prompt Index

```text
当前状态：AWAITING_USER_PRODUCT_REVIEW
最近完成：LOOP-027 — R1 四页简化产品预览
交付边界：PROTOTYPE_ONLY / PAGE_MEMORY_ONLY
```

LOOP-027 的可点击四页框架已经在 Chrome 中打开。等待用户确认模拟交易、编排工作台、Agent 中心、连接配置后，才为选中的单页细化创建新的唯一编号 Prompt。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建真实 LLM 推荐、Strategy App 后端、API、SQLite 或持久化；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
