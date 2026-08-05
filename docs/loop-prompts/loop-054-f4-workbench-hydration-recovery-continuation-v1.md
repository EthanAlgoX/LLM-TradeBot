# LOOP-054 — F4 Workbench hydration and recovery continuation

```text
Loop ID: LOOP-054
Milestone: F4 Preflight / Backtest / Walk-Forward V1 final closeout
Mode: DIAGNOSE_FIX_IF_NEEDED_AND_AGENT_CHROME_VERIFY
Browser requirement: REQUIRED; Agent-operated real Chrome only
Safety: validation/evidence only; no Approval, Runtime Apply, Simulation Slot, account/order/fill or exchange write
Git: commit and push main for every code/document change; no PR
```

## 精确遗留缺口

LOOP-053 已确认服务端 immutable stale projection 与 parent UI 覆盖，但真实 Chrome 中本轮新 v1 的 Backtest action 持久结果没有立即重新投影，只有受控 Web/API 重启后显示 partial evidence；其后 reload 又未稳定恢复同 actor 的 Workbench history。不得把 API、日志、SQLite 或人工操作作为正向 PASS。

## 目标

1. 只读诊断 Workbench action response、hydration epoch/cancel、HttpOnly local actor 与 reload/restart recovery；修复真实根因时只做最小修复，不创建新 authority。
2. Agent Chrome 从本轮新鲜 v1 完成 Preflight → Backtest → Walk-Forward → `EVIDENCE READY / APPROVAL REQUIRED`，随后同 Conversation 修改“将最大仓位调整为 5%”并 Apply 为同 Draft immutable v2。
3. 确认 v1 historical lineage 可读且 stale，v2 精确 parent 指向 v1、无 binding/jobs/ready、唯一下一动作 Preflight；reload、受控 `npm run dev:paper` restart 和快速切换均不串线。
4. 完成中文 1440×900、英文 820×760、Console/Network、`npm run check`、自然结束 `npm run test:ts`、`npm run build:web`、`git diff --check`。

## 不可突破的边界

- 复用现有 Conversation/Recommendation/Apply、Configuration Draft、F4 projection 与 `StrategyEvidenceApprovalService`；不新增 Draft/version/evidence/stale/browser authority。
- 禁止 Approval、Approved Paper Plan、Runtime Apply、Simulation、Deployment、Run、Account、Order、Fill、Exchange Write；始终 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。
- 正向验收只能由 Agent 直接操作真实 Chrome；Network 不可读时报告 `TOOL_UNAVAILABLE`；不得输出 cookie、token、headers 或敏感 body。
- 不修改、删除或提交 `data/local-paper-workspace*` 与本地运行数据。

## 完成条件

所有 LOOP-053 的 F4 完成条件均通过后，F4 才可标记 `COMPLETE`，之后创建唯一递增 LOOP-055 进入 F5；否则 F4 保持 `IN_PROGRESS` 并仅记录精确未关闭缺口。
