# Next Loop Prompt Index

```text
当前状态：F1 IN_PROGRESS
最近完成：LOOP-031 — Agent Version v1→v2、版本历史、持久幂等与重启恢复
下一任务：LOOP-032 — F1 Agent 中心治理、测试台与收尾 V1
浏览器要求：本次 Prompt 文档生成不需要；LOOP-032 实现后必需，由 Agent 直接操作真实 Chrome
```

执行：[`loop-032-f1-agent-center-governance-testbench-closeout-v1.md`](loop-prompts/loop-032-f1-agent-center-governance-testbench-closeout-v1.md)

LOOP-030/031 已建立真实 Agent Definition/immutable Version 与服务端 authority。下一轮只收尾 F1：版本 Diff、校验/发布/克隆/归档治理、真实受限测试台、四类 Agent 边界和测试 SQLite 资源释放；不并行实现 F2～F5。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建真实 LLM 推荐、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
