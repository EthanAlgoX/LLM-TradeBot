# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 PLANNED NEXT
最近完成：LOOP-046 的同一 Draft v1→v2 revision lineage、重启恢复与 Chrome 双尺寸验收
下一任务：LOOP-047 — F4 Preflight and historical evidence V1
浏览器要求：必需，由 Agent 直接操作真实 Chrome
```

执行：[`loop-047-f4-preflight-historical-evidence-v1.md`](loop-prompts/loop-047-f4-preflight-historical-evidence-v1.md)

LOOP-046 已完成 F3：完整有效修改会在同一 Configuration Draft 下追加 immutable v2，并保留精确 parent/reference 和不变可读的 v1。LOOP-047 将当前真实 Draft 接入既有 Preflight、Backtest、Walk-Forward 与 Evidence stale authority，只完成验证门禁，不启动模拟或 Runtime。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
