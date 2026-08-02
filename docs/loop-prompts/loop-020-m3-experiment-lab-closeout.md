# LOOP-020 — M3 实验场验证与关闭续办

```text
Loop ID：LOOP-020
里程碑：M3 实验场 V1
状态：READY
前置 Loop：LOOP-019（IN_PROGRESS）
浏览器要求：必需；仅 Agent 直接操作真实 Google Chrome
验收模式：M3_EXPERIMENT_AUTOMATION_AND_CHROME_CLOSEOUT
```

## 已完成修复

- 实验工作台已移除自触发 `MutationObserver → render → innerHTML` 循环，改为单 host identity、mount/unmount、AbortController 与 stale-response epoch。
- Experiment 合同已改用严格 Evidence/Scorecard/Replay/Candidate 投影；Repository 使用版本化 kind-bound cursor；Replay 不再是 GET 别名；Candidate 按 objective/constraints 和明确 participant 判定。
- `npm run check`、`npm run test:ts`（336/336）、`npm run build:web`、`git diff --check` 已通过；测试数量尚未增加，不能关闭 M3。
- Agent Chrome 已直接打开 `#experiment`，确认真实 catalog、无 Atlas/8.7%/4.6% Mock、无 Experiment 发布动作及 `runtimeApplied=false · Paper Only · exchangeWriteAllowed=false`。创建动作未进入结果视图；Chrome Console 仅见扩展异步消息错误，尚不能作为产品通过。

## 必须完成

1. 新增覆盖 Experiment 的 repository、HTTP、strict contracts、2–5 participants、comparability、partial evidence、artifact tamper、replay、candidate constraints、UI lifecycle/epoch 的行为测试；测试总数必须高于 336。
2. 诊断并修复真实 UI 创建动作未显示 result 的原因，不能用 API/数据库/DevTools 代替 UI 验收。
3. 在真实 Chrome 完成中文 1440×900 与英文 820×760：创建、Backtest、Walk-Forward、Diff、lineage、Replay、eligible Candidate、刷新/重启恢复、Open Class、实验隔离、Console/Network 与 Runtime safety。
4. 全部通过后才可将 LOOP-018、LOOP-019、LOOP-020 和 M3 标为 COMPLETE，并新建唯一 M4 prompt；否则继续 M3，不进入 M4。
5. 修改必须 commit 并 push；禁止人工验收、Approval/Deploy/Paper Run/Runtime Apply/order/exchange write。
