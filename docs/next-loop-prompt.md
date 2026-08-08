# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 IN_PROGRESS
最近完成：LOOP-058 使 version/action-scoped running 呈现替换同步 POST 期间的旧 F4 控件；Agent Chrome 已验证 Backtest/Walk-Forward 原页 running→exact-version projection。
下一任务：LOOP-059 — F4 recovery and immutable-v2 continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome；禁止人工验收
```

执行：[`LOOP-059`](loop-prompts/loop-059-f4-recovery-and-v2-continuation-v1.md)

LOOP-059 只关闭 F4 reload/受控重启 recovery 与同 Draft immutable v2 的 Chrome 验收缺口；保持服务端 projection 唯一 authority，禁止以 reload、轮询或新的客户端 authority 掩盖问题。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
