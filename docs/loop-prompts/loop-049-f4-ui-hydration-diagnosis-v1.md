# LOOP-049 — F4 UI hydration diagnosis and Evidence chain closeout

```text
Loop ID: LOOP-049
Milestone: F4 Preflight / Backtest / Walk-Forward V1
Mode: DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
Browser requirement: REQUIRED; Agent-operated real Chrome only; manual/user-assisted verification is forbidden
Safety: validation/evidence only; no Human Approval, Approved Paper Plan, Runtime Apply, Simulation Slot, account/order/fill or exchange write
Git: commit and push main for every code/document change; no PR
```

## 目标

先诊断真实 Chrome 中 Workbench 长时间显示 `F4 loading…`、没有展示最新 F4 控件的根因，再以最小改动修复。随后针对一个真实、当前 actor 所属、绑定已注册 CSV Historical graph 的 F3 immutable Strategy Draft，完成并验收以下唯一顺序链：

```text
Draft
→ Preflight passed
→ Backtest succeeded
→ Walk-Forward succeeded
→ EVIDENCE READY / APPROVAL REQUIRED
```

本轮终点只能是 `APPROVAL REQUIRED`。不得调用 Approval，不得创建 Approved Paper Plan，不得启动 Simulation 或 Runtime。

## 已知基线

- F3 已 `COMPLETE`，Workbench 使用服务端权威 Conversation、Recommendation、Pipeline Draft 与 Configuration Draft。
- LOOP-047 已提供 actor-scoped F4 projection、顺序门禁 API/UI，并复用既有 Configuration/Pipeline validator 与 Strategy Evidence authority。
- LOOP-048 已使新 F3 Draft 对齐既有注册 CSV Historical graph，并补齐 actor-scoped durable idempotency replay/conflict。
- 遗留 Draft 的 F4 错误已隔离，不应阻塞其他 Draft hydration。
- 服务端直接读取新 Draft 的 F4 状态可得到 `preflight: pending` 与 `nextAction: preflight`，但真实 Chrome 页面仍未显示最新 F4 控件。
- 自动化基线为 `376/376 PASS`。

## 强制边界

1. 只复用现有 authority：
   - Configuration/Pipeline validator；
   - registered Historical graph/plan/runner；
   - `StrategyEvidenceApprovalService`、既有 Backtest/Walk-Forward Artifact 与 stale 规则；
   - 现有 actor identity、Conversation、Draft 与 SQLite persistence。
2. 不创建第二套 validator、runner、evidence store、artifact schema、approval model、runtime authority 或浏览器事实源。
3. 不用 Mock、Sample、静态成功状态、DOM 注入、直接数据库修改或直接 API 调用替代正向 UI 验收。
4. API/日志可以用于诊断，但最终可见流程必须由 Agent 直接操作真实 Chrome 完成。
5. 禁止人工或用户辅助验收；Chrome 控制失效时如实记录 `NOT VERIFIED`，不得换成人工步骤。
6. 不读取、复制或输出 token、cookie value、secret 或其他敏感值。
7. 不修改、删除或提交 `data/local-paper-workspace*` 及本地运行数据。
8. 始终保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

## 实施任务

### A. 诊断 F4 UI hydration

从真实服务端响应到可见卡片逐层定位，不凭猜测修改：

- 确认运行中的 Web/API 进程确实加载当前 `main` HEAD，排除旧 Vite/API 进程、端口占用和缓存资产；
- 检查当前 Draft 选择、conversation hydration、异步请求 epoch/cancel、actor/session、response schema、render 分支和错误隔离；
- 确认混合遗留历史中，单个 legacy Draft 的 `PROVENANCE_UNAVAILABLE` 或 F4 错误不会让当前 Draft 永久停在 loading；
- loading 必须最终进入明确的 ready、empty、stale 或 error 状态，不能无限等待；
- 切换会话、Draft 或语言时，陈旧响应不得覆盖当前选择；
- 若发现根因，增加能复现该根因的聚焦回归测试，再做最小修复。

### B. 完成真实 Evidence 顺序链

使用正常产品生命周期创建或选择一个可执行的真实 CSV-backed Draft，并从 Workbench 可见控件依次执行：

1. Preflight：展示状态、稳定 issue code、问题节点与修复建议；通过前不得出现可执行 Backtest。
2. Backtest：只在 Preflight passed 后可执行；展示真实 Artifact/Evidence lineage、绑定的 Draft/Graph/Dataset/Profile/Execution fingerprints。
3. Walk-Forward：只在 Backtest succeeded 后可执行；展示真实窗口/结果与 lineage。
4. 终态：展示 `EVIDENCE READY / APPROVAL REQUIRED`，但不存在自动批准或运行副作用。

每一步必须满足：

- actor-scoped；
- exact Draft version/fingerprint binding；
- append-only、可重放、刷新与重启可恢复；
- 同一 idempotency key + 同一 payload 返回稳定 replay；
- 同一 key + 不同 Draft/action/payload fail closed；
- 请求乱序或重复点击不会越过顺序门禁。

### C. 版本与负向验证

- v1 完成 Evidence 后，创建同一 Draft 的 immutable v2 修改；v1 仍可读且不变，v2 必须重新验证，旧 Evidence 对 v2 显示 stale/不适用；
- 跨 actor、跨 Draft、跨 action、错误 cursor、畸形 ID、未知字段和不允许的 HTTP method 均 fail closed；
- 未通过 Preflight 时拒绝 Backtest；未通过 Backtest 时拒绝 Walk-Forward；
- 遗留无 provenance Draft 只读且不可误用为当前 Evidence；
- 任一失败不得产生 Approval、Paper Plan、Deployment、Run、Account、Order、Fill 或 Exchange Write 事实。

## Agent Chrome 验收

实现与自动化通过后，干净受控重启唯一 `npm run dev:paper` 链路，再由 Agent 直接操作真实 Chrome。不得要求用户手工检查。

### 中文 1440×900

- Workbench 当前真实 Draft 不再停在 `F4 loading…`；
- 完成 Preflight → Backtest → Walk-Forward；
- 状态、唯一下一动作、Evidence lineage、fingerprints、stale 与 `APPROVAL REQUIRED` 可读；
- reload 后状态恢复；
- 受控 Web/API 重启后，同一 actor、Conversation、Draft 与 Evidence 恢复；
- 页面无横向滚动、无遮挡，键盘焦点可见。

### English 820×760

- 状态与动作标签为英文且可理解；
- `scrollWidth === clientWidth === 820`；
- 无卡片、按钮或 lineage 内容被截断；
- 键盘焦点可见。

### Console / Network

- 清空 Console 后 reload，TradeBot 页面 error 为 0；浏览器扩展自身错误必须单独标注，不能归因于产品；
- 如 Chrome 工具确实不能读取 Network，报告 `TOOL_UNAVAILABLE`，不要用 API、日志或人工面板替代；
- 若可读取，只报告 method/path/status，不输出 header、token、cookie 或响应敏感内容。

### Runtime safety

在 UI 和服务端事实中确认：

- `runtimeApplied=false`；
- Paper Only；
- `exchangeWriteAllowed=false`；
- 没有 Human Approval、Approved Paper Plan、Simulation Slot、Deployment、Run 或交易事实被本轮创建。

## 自动化门禁

必须执行并获得真实结果：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

`npm run test:ts` 必须自然退出并给出最终 TAP 汇总与 exit 0。不要只报告已出现的子测试数量。

## 文档与 Git

- 只有自动化和要求的真实 Chrome 全链均通过，才把 F4 标记为 `COMPLETE`；否则保持 `IN_PROGRESS` 并精确记录未验证项。
- 更新：
  - `docs/product-optimization-plan-and-progress.md`
  - `docs/product-roadmap-and-progress.md`
  - `docs/project-status-and-handoff.md`
  - `docs/next-loop-prompt.md`
- 若 F4 完成，创建唯一递增编号 `LOOP-050`，下一阶段进入 F5 Simulation V2；若未完成，`LOOP-050` 只能针对剩余 F4 缺口，不得提前进入 F5。
- 所有代码与文档修改必须提交并推送到 `main`；确认 `origin/main` 与本地 HEAD 一致；不创建 PR。

## 最终报告模板

```text
Loop ID：LOOP-049
验收模式：DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
浏览器要求：必需；Agent 已使用真实 Chrome / 未完成（原因）

F4 UI hydration 根因：
F4 UI hydration 修复：PASS / FAIL
Preflight：PASS / FAIL / NOT VERIFIED
Backtest Evidence：PASS / FAIL / NOT VERIFIED
Walk-Forward Evidence：PASS / FAIL / NOT VERIFIED
EVIDENCE READY / APPROVAL REQUIRED：PASS / FAIL / NOT VERIFIED
v1/v2 stale 与 immutable history：PASS / FAIL / NOT VERIFIED
幂等 replay/conflict：PASS / FAIL
actor/ID/method fail-closed：PASS / FAIL
reload / Web/API restart recovery：PASS / FAIL / NOT VERIFIED
中文 1440×900：PASS / FAIL / NOT VERIFIED
英文 820×760：PASS / FAIL / NOT VERIFIED
Console：PASS / FAIL / TOOL_UNAVAILABLE
Network：PASS / FAIL / TOOL_UNAVAILABLE
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
Approval/Runtime/交易副作用：NONE / FAIL（说明）
自动化：check；test:ts 最终汇总；build:web；diff-check
F4：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-050（F5 / F4 continuation）
Git：commit；branch main；push PASS/FAIL；PR 未创建
```
