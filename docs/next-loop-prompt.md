# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 IN_PROGRESS
最近完成：LOOP-053 的 stale 只读投影、parent UI 和 380/380 自动化；Chrome reload/action-response recovery 未关闭
下一任务：LOOP-054 — F4 Workbench hydration and recovery continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome；禁止人工验收
```

执行：[`LOOP-054`](loop-prompts/loop-054-f4-workbench-hydration-recovery-continuation-v1.md)

LOOP-054 只处理 LOOP-053 遗留的精确 F4 缺口：修复/验证同一 Chrome actor 的 Workbench action-response 与 reload/Web/API restart hydration，使已持久化的 current/stale v1/v2 F4 projection 不丢失、不串线；随后重新执行新鲜 v1 Evidence-ready → 同 Draft immutable v2 stale 隔离的完整 Chrome 验收。不得创建第二套 Draft/version/evidence/stale/approval/runtime authority；不得调用 Approval、创建 Approved Paper Plan、申请 Simulation Slot、执行 Runtime Apply 或产生交易写入。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
