# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 IN_PROGRESS
最近完成：LOOP-059 修复 history `Promise.all` 被单条 in-flight F4 projection 阻塞而导致 reload render 0 卡片；同 actor reload/restart 恢复 exact-version cards。
下一任务：LOOP-060 — F4 original-page terminal and immutable-v2 continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome；禁止人工验收
```

执行：[`LOOP-060`](loop-prompts/loop-060-f4-original-page-terminal-continuation-v1.md)

LOOP-060 只关闭新鲜 v1 Walk-Forward 原页 terminal、同 Draft immutable v2/stale/独立 Evidence 及两版本 recovery 的 Chrome 验收缺口；保持服务端 projection 唯一 authority，禁止以 reload、轮询或新的客户端 authority 掩盖问题。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
