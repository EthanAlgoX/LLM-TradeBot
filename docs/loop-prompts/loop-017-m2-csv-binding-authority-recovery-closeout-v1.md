# LOOP-017 — M2 CSV Binding Authority 恢复收尾

```text
Loop ID：LOOP-017
里程碑：M2 数据中心 V1
状态：READY
前置 Loop：LOOP-016（共享 Binding Schema 与有界 key 已修复；Chrome Binding 后 Authority 恢复错误）
验收模式：AGENT_CHROME_AUTHORITY_RECOVERY
```

## 唯一目标

在真实 Google Chrome 中修复并验证 CSV Binding 成功后 `refreshHistory()` / replay 恢复不得把同一会话的 `currentDraft` 切换为非 CSV Draft。保持 LOOP-016 的共享严格 `DatasetBindingRequestSchema`、`binding.<uuid>` 有界 key、actor/conversation isolation 与 append-only 约束。

## 必须完成

1. 只读比较 Binding append 的 replay turn、`listTurns()` 排序和 Web `refreshHistory()` 的 latest Draft 选择；不得读取或报告 token、cookie、storage value、完整请求/响应正文。
2. 修复实际 Authority 根因并补充正式 handler/replay/Web 状态回归：Binding 后、刷新后、服务重启后及会话往返均保留 CSV Draft/version/fingerprint/binding；Composer 将 `confidenceThreshold` 改为 0.72 后保持 CSV recipe/Graph/exact source set。
3. 使用当前 `npm run dev:paper` 直接控制真实 Chrome：中文 1440×900 与英文 820×760，完成 CSV 资产→Draft→Binding→刷新/重启→Composer→刷新/会话切换；检查无横向滚动、产品 Console error 为 0。Network 无能力时记录 `TOOL_UNAVAILABLE`，不得替代。
4. 只接受 `runtimeApplied=false`、Paper Only、exchangeWriteAllowed=false；不得 Apply、Paper Run 或交易所写入。
5. 运行 `npm run check`、`npm run test:ts`、`npm run build:web`、`git diff --check`，提交并 push。成功才将 M2 COMPLETE；失败继续 M2 并创建唯一后续 Loop。
