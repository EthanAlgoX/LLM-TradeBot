# Next Loop Prompt Index

```text
当前状态：F3 COMPLETE / F4 IN_PROGRESS
最近完成：LOOP-048 的 registered CSV graph 对齐、F4 durable idempotency 与受控 Chrome restart
下一任务：LOOP-049 — F4 UI hydration diagnosis and fixture completion
浏览器要求：必需，由 Agent 直接操作真实 Chrome
```

执行：[`LOOP-049`](loop-prompts/loop-049-f4-ui-hydration-diagnosis-v1.md)

LOOP-047 已开始 F4：当前真实 Workbench Draft 的 F4 endpoint 已以 actor-scoped projection 复用 Configuration/Pipeline validator 与 Strategy Evidence authority，且 UI 显示唯一下一步。继续完成和修正完整 registered historical fixture 的 F4 端到端链路、v1/v2 stale/recovery、Chrome 中文 1440×900 与英文 820×760 验收、`npm run check`、`npm run build:web` 和 `git diff --check`。不得创建第二套 validator/runner/evidence/approval/runtime authority；不得执行 Approval、Paper Plan、Runtime 或交易写入。

在此之前不得：

- 恢复或执行 LOOP-025 / M6；
- 创建 Human Approval、Approved Paper Plan、Strategy Runtime Apply 或模拟启动；
- 实现 Live、Canary、Runtime Apply、交易所写入、Champion 替换或持仓迁移。

始终保持 `runtimeApplied=false`、Paper Only 和 `exchangeWriteAllowed=false`。
