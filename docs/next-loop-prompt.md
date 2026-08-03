# Next Loop Prompt Index

```text
当前状态：F3 IN_PROGRESS
最近完成：LOOP-045 的 Chrome lifecycle / recovery / narrow-screen 验证
下一任务：LOOP-046 — F3 Draft revision lineage continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome
```

执行：[`loop-046-f3-draft-revision-lineage-continuation-v1.md`](loop-prompts/loop-046-f3-draft-revision-lineage-continuation-v1.md)

LOOP-045 已完成 Catalog、Turns、Draft references 和 legacy history 的 Chrome reload/受控重启恢复，并通过英文窄屏 overflow/focus。唯一未通过项是完整有效修改在 Apply 后创建新的 `configuration-draft:*:version:1`，未形成同一 Draft 的 immutable `version:2` parent/reference；LOOP-046 只收敛该 authority/lineage 缺陷并重做受影响验证，不能进入 F4～F5。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 执行 Preflight、Backtest、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
