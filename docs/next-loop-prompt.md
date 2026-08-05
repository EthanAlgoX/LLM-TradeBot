# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 IN_PROGRESS
最近完成：LOOP-052 已完成真实 v1 Evidence、只读 lineage、双尺寸、reload 与全量自动化；未调用 Approval
下一任务：LOOP-052 — F4 remaining closeout（仅 v1→v2 stale/recovery）
浏览器要求：必需，由 Agent 直接操作真实 Chrome；禁止人工验收
```

执行：LOOP-052（F4 continuation；不进入 F5）

LOOP-052 只关闭 F4 剩余缺口：以本轮新鲜同一 Configuration Draft 的 v1/v2 完成 stale 与 Web/API restart recovery 验收；v1 Evidence 必须保持可读，v2 不得继承 ready gate，legacy error 不得阻塞当前 Draft。不得创建第二套 validator/runner/evidence/approval/runtime authority；不得调用 Approval、创建 Approved Paper Plan、申请 Simulation Slot、执行 Runtime Apply 或产生交易写入。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
