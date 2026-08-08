# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 IN_PROGRESS
最近完成：LOOP-057 以 Agent Chrome trace 证明 Backtest POST 在旧 gate 可见期间仍在同步执行；未收到 POST projection 前不存在 authority merge 或后续 render。
下一任务：LOOP-058 — F4 action-running and DOM continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome；禁止人工验收
```

执行：[`LOOP-058`](loop-prompts/loop-058-f4-action-running-dom-continuation-v1.md)

LOOP-058 只关闭 F4 的 action-running 可见状态与后续 exact-version authority render：保持服务端 projection 唯一 authority，明确显示 running，完成后在原页推进 gate，并补足交错 hydration/DOM 回归测试与完整 Chrome 验收。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
