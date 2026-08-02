# Next Loop Prompt Index

```text
当前状态：AWAITING_USER_PRODUCT_REVIEW
最近完成：LOOP-026 — R0 Strategy App 产品预览框架
交付边界：PROTOTYPE_ONLY / PAGE_MEMORY_ONLY
```

LOOP-026 的可点击产品框架已经可供评审。等待用户确认页面命名、信息架构和主路径后，才可创建一个新的唯一编号 Prompt。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建详细 Strategy App 后端、LLM 推荐、Blueprint 匹配、API、SQLite 或持久化；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
