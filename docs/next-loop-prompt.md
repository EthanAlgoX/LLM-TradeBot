# Next Loop Prompt Index

```text
当前状态：F3 IN_PROGRESS
最近完成：LOOP-041 的部分实现
下一任务：LOOP-042 — F3 Workbench browser recovery diagnosis
浏览器要求：必需，由 Agent 直接操作真实 Chrome
```

执行：[`loop-042-f3-workbench-browser-recovery-diagnosis-v1.md`](loop-prompts/loop-042-f3-workbench-browser-recovery-diagnosis-v1.md)

LOOP-041 已在 Chrome 复现：本地 SQLite 的 `local:operator` Agent 与 Workbench 事实仍存在，但 reload/Web/API restart 后页面只显示既有 Input Agent 与空 Workbench。v2 HttpOnly Cookie 名迁移及回归测试没有闭合真实浏览器恢复。LOOP-042 只能诊断并修复既有 browser-to-loopback 身份/水合链，不并行进入 F4～F5。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 执行 Preflight、Backtest、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
