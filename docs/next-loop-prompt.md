# Next Loop Prompt Index

```text
当前状态：F3 IN_PROGRESS
最近完成：LOOP-037 的部分实现
下一任务：LOOP-038 — F3 编排工作台 final continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome
```

执行：[`loop-038-f3-workbench-final-continuation-v1.md`](loop-prompts/loop-038-f3-workbench-final-continuation-v1.md)

LOOP-037 已将 Apply 折入既有 Configuration/Pipeline Draft authority，并在 Chrome 验证中文澄清、推荐和应用。还须完成精确 provenance、cursor/重启/actor 负向自动化及中文修改/重启、英文窄屏 Chrome 闭环；不并行进入 F4～F5。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 执行 Preflight、Backtest、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
