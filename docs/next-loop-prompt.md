# Next Loop Prompt Index

```text
当前状态：FUNCTIONALIZATION_PLANNED / READY_FOR_F1
最近完成：LOOP-029 — 四页产品功能化路线规划
下一任务：LOOP-030 — F1 Agent 中心版本化配置 V1
浏览器要求：LOOP-029 不需要；LOOP-030 实现后必需，由 Agent 直接操作真实 Chrome
```

执行：[`loop-030-f1-agent-center-versioned-configuration-v1.md`](loop-prompts/loop-030-f1-agent-center-versioned-configuration-v1.md)

用户已确认四页、动态 DAG 和 Agent 中心可配置 Data/Model/Prompt/Version 的方向。下一轮从 Agent 中心真实版本管理开始，不并行实现连接配置、LLM DAG、回测接入或模拟 Runtime 接入。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 在 LOOP-030 范围外创建真实 LLM 推荐、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
