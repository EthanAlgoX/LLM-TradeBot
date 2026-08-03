# Next Loop Prompt Index

```text
当前状态：F3 IN_PROGRESS
最近完成：LOOP-038 的部分实现
下一任务：LOOP-039 — F3 编排工作台 restart identity continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome
```

执行：[`loop-039-f3-workbench-restart-identity-continuation-v1.md`](loop-prompts/loop-039-f3-workbench-restart-identity-continuation-v1.md)

LOOP-038 已补齐 provenance、cursor 与自动化负向链，但本地 Web/API restart 换发 Bearer actor，因 actor 隔离无法恢复之前的真实 Workbench history。先安全复用既有本地 operator identity 并完成同 actor restart/Chrome 全链；不并行进入 F4～F5。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 执行 Preflight、Backtest、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
