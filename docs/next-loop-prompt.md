# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 IN_PROGRESS
最近完成：LOOP-062 将 execution context 传播至生产历史节点并复用注册 CSV snapshot；Chrome Backtest 已稳定 deadline terminal，但正向 Evidence 仍失败。
下一任务：LOOP-063 — F4 positive production evidence continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome；禁止人工验收
```

执行：[`LOOP-063`](loop-prompts/loop-063-f4-positive-production-evidence-continuation-v1.md)

LOOP-063 只诊断为何已正确停止的 production Backtest 不能在 45 秒 deadline 内正向完成；必须保留同一 durable Job/Artifact authority、deadline、lease fencing 和 registered workload，不得缩小数据、范围或预算以伪造成功。只有正向 v1 后才继续 v2/recovery Chrome 矩阵。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
