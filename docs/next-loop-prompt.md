# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 IN_PROGRESS
最近完成：LOOP-052 的真实 v1 Evidence、只读 lineage、reload、双尺寸和 379/379 自动化
下一任务：LOOP-053 — F4 immutable v1→v2 stale and recovery closeout
浏览器要求：必需，由 Agent 直接操作真实 Chrome；禁止人工验收
```

执行：[`LOOP-053`](loop-prompts/loop-053-f4-v1-v2-stale-recovery-closeout-v1.md)

LOOP-053 只关闭 F4 最后缺口：从本轮新鲜 Evidence-ready v1 通过正常 Workbench modification/Apply 创建同一 Configuration Draft 的 immutable v2，验证 v1 历史 Evidence 继续可读且 stale、v2 不继承 ready/binding/jobs，以及 reload/Web/API restart 后没有版本串线。不得创建第二套 Draft/version/evidence/stale/approval/runtime authority；不得调用 Approval、创建 Approved Paper Plan、申请 Simulation Slot、执行 Runtime Apply 或产生交易写入。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
