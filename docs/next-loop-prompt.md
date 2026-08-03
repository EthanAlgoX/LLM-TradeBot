# Next Loop Prompt Index

```text
当前状态：F3 IN_PROGRESS
最近完成：LOOP-036 的部分实现
下一任务：LOOP-037 — F3 编排工作台 authority continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome
```

执行：[`loop-037-f3-workbench-authority-continuation-v1.md`](loop-prompts/loop-037-f3-workbench-authority-continuation-v1.md)

LOOP-036 已追加 Conversation Replay 与服务端 history hydration，但必须继续把 Apply 折入既有 Configuration/Pipeline Draft authority、复用完整 Graph Validator，并完成负向/重启自动化与 Chrome 闭环；不并行进入 F4～F5。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 执行 Preflight、Backtest、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
