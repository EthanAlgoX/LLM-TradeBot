# Next Loop Prompt Index

```text
当前状态：F3 IN_PROGRESS
最近完成：LOOP-044 的 Catalog hydration 与自然测试退出修复
下一任务：LOOP-045 — F3 final Chrome lifecycle continuation
浏览器要求：必需，由 Agent 直接操作真实 Chrome
```

执行：[`loop-045-f3-final-chrome-continuation-v1.md`](loop-prompts/loop-045-f3-final-chrome-continuation-v1.md)

LOOP-044 已修复分类切换未 hydration 的 Catalog 缺陷，并关闭测试 runtime 所有资源；同 actor 的四类 Published Catalog 已跨受控重启恢复，`npm run test:ts` 自然完成 376/376。LOOP-045 只完成剩余真实 Chrome 生命周期和窄屏验收，不能进入 F4～F5。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 执行 Preflight、Backtest、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
