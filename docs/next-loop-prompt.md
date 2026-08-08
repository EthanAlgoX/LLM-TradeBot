# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 IN_PROGRESS
最近完成：LOOP-060 确认 Walk-Forward 原页停在 running 的首个断点：同步 durable runner 无执行 deadline，HTTP POST 一直 await runner，尚未发生 terminal response/merge/render。
下一任务：LOOP-061 — F4 runner terminal-contract continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome；禁止人工验收
```

执行：[`LOOP-061`](loop-prompts/loop-061-f4-runner-terminal-contract-continuation-v1.md)

LOOP-061 先关闭 CPU-active Walk-Forward runner 的 work budget、deadline、实际停止、lease/fencing 与 durable terminal contract，再完成新鲜 v1 原页 terminal、同 Draft immutable v2/stale/独立 Evidence 及两版本 recovery；禁止用 `Promise.race`、HTTP timeout、reload 或仍在后台运行的任务伪造通过。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
