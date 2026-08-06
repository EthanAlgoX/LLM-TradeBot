# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 IN_PROGRESS
最近完成：LOOP-055 的 exact-version POST reread 和 383/383 自动化；Chrome action-response DOM 未关闭
下一任务：LOOP-056 — F4 action-response DOM continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome；禁止人工验收
```

执行：[`LOOP-056`](loop-prompts/loop-056-f4-action-response-dom-continuation-v1.md)

LOOP-056 只诊断并关闭 LOOP-055 已复现的客户端 DOM 更新缺口：服务端 POST/replay 与 exact-version reread 已是最新 authority，但当前卡片仍停在前一 gate，reload 才恢复。不得创建第二 authority；不得调用 Approval、创建 Approved Paper Plan、申请 Simulation Slot、执行 Runtime Apply 或产生交易写入。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
