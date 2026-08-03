# Next Loop Prompt Index

```text
当前状态：F1 COMPLETE
最近完成：LOOP-032 — F1 Agent Center 治理、Diff、Catalog、受限测试台与 Chrome 收尾
下一任务：LOOP-033 — F2 连接配置 V1
浏览器要求：LOOP-033 实现后必需，由 Agent 直接操作真实 Chrome
```

执行：[`loop-033-f2-connections-v1.md`](loop-prompts/loop-033-f2-connections-v1.md)

LOOP-032 已关闭 F1。下一轮只进入 F2 的服务端连接能力、健康、影响范围和后端 Secret reference，不并行实现 F3～F5。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建真实 LLM 推荐、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
