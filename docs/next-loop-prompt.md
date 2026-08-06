# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 IN_PROGRESS
最近完成：LOOP-056 的有界 exact-version reconciliation 和 384/384 自动化；Chrome action-response DOM 未关闭
下一任务：LOOP-057 — F4 action-response DOM continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome；禁止人工验收
```

执行：[`LOOP-057`](loop-prompts/loop-057-f4-action-response-dom-continuation-v1.md)

LOOP-057 只诊断并关闭 LOOP-056 仍复现的客户端 DOM 更新缺口：Preflight 可即时推进，Backtest 与 Walk-Forward POST 后当前卡片仍可停在前一 gate。保留 exact-version authority 与有界 reconciliation，找出为什么 action merge/render 未落到当前 DOM；不得创建第二 authority；不得调用 Approval、创建 Approved Paper Plan、申请 Simulation Slot、执行 Runtime Apply 或产生交易写入。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
