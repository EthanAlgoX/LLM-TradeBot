# LOOP-050 — F4 Evidence chain and Chrome closeout

```text
Loop ID: LOOP-050
Milestone: F4 Preflight / Backtest / Walk-Forward V1 closeout
Mode: COMPLETE_EXISTING_CHAIN_AND_AGENT_CHROME_VERIFY
Browser requirement: REQUIRED; Agent-operated real Chrome only; manual/user-assisted verification is forbidden
Safety: validation/evidence only; stop at APPROVAL REQUIRED; no Human Approval, Approved Paper Plan, Runtime Apply, Simulation Slot, account/order/fill or exchange write
Git: commit and push main for every code/document change; no PR
```

## 目标

LOOP-049 已修复 Workbench 初始身份路径没有加载 F4 projection、错误 projection 在 `gates.map` 触发渲染异常，以及 F4 action 未绑定精确 Draft Version 的问题。本轮不要重写 hydration 或创建新 authority；在该修复上完成真实 UI 链和剩余验收：

```text
immutable Strategy Draft Version
→ Preflight passed
→ Backtest succeeded
→ Walk-Forward succeeded
→ EVIDENCE READY / APPROVAL REQUIRED
```

F4 只有在真实 Chrome 全链、版本 stale、恢复、安全边界和自动化全部通过后才能标记 `COMPLETE`。本轮终点只能是 `APPROVAL REQUIRED`。

## 已知基线

- F3 `COMPLETE`；F4 `IN_PROGRESS`。
- Workbench 初始 identity hydration 现会请求每个 Draft Version 的 F4 projection，并以 epoch 隔离陈旧响应。
- 单个 legacy/error projection 已独立显示错误，不再阻塞其他 Draft。
- F4 服务端按 actor + exact `versionId` 查找 Draft reference；UI action 也提交该精确版本。
- actor-scoped durable idempotency replay/conflict、非法 actor/ID/method 的自动化已通过。
- reload 与受控 `dev:paper` restart 后 `F4 loading…` 已消失。
- 自动化基线：`377/377 PASS`。

## 强制边界

1. 只复用现有 Configuration/Pipeline validator、registered CSV Historical graph/runner、`StrategyEvidenceApprovalService`、Backtest/Walk-Forward Artifact 与 stale authority。
2. 不创建第二套 validator、runner、artifact、evidence、approval、runtime、identity、Draft 或浏览器事实源。
3. 正向验收必须从真实 Workbench UI 操作；禁止用直接 API、SQLite、日志、Mock、Sample 或 DOM 注入替代。
4. API 与日志只能辅助诊断失败，不得作为 Chrome UI PASS 证据。
5. 禁止用户手工验收。Chrome 控制失败时如实报告 `NOT VERIFIED`。
6. 不读取、复制或输出 token、cookie value、secret 等敏感值。
7. 不修改、删除或提交 `data/local-paper-workspace*`。
8. 始终保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

## 执行步骤

### 1. 建立干净运行基线

- 检查 `git status`，保留并审查 LOOP-049 的现有修改，不得回退用户改动；
- 排除旧 Vite/API 进程与端口冲突，受控启动唯一 `npm run dev:paper`；
- 确认 Web/API 使用当前 HEAD，WorkBench 当前 Draft 显示真实 F4 gate，而不是 `F4 loading…`；
- 若仍异常，先增加聚焦测试并作最小修复，不扩大产品范围。

### 2. 真实 UI 顺序门禁

通过正常产品生命周期创建或选择一个当前 actor 的真实 CSV-backed immutable Draft Version，在 UI 中逐步执行：

1. **Preflight**
   - 初始唯一动作是 Preflight；
   - 显示真实 validation 状态、issue code、节点与修复建议；
   - 通过前 Backtest 不可执行。
2. **Backtest**
   - 仅在 Preflight passed 后出现；
   - 显示真实 Evidence/Artifact lineage 和精确 Draft/Graph/Dataset/Profile fingerprints；
   - 完成前 Walk-Forward 不可执行。
3. **Walk-Forward**
   - 仅在 Backtest succeeded 后出现；
   - 显示真实窗口、结果与 lineage。
4. **终态**
   - 页面显示 `EVIDENCE READY / APPROVAL REQUIRED`；
   - 页面不得自动调用 approve，也不得出现已批准、已部署或已运行的虚假状态。

每一步都必须验证重复点击/刷新不会越过门禁，且页面只展示服务端权威结果。

### 3. immutable v1/v2 与 stale

- 在 v1 Evidence 完成后，通过正常 Workbench 修改流程创建同一 Configuration Draft 的 immutable v2；
- v1 必须保持不变、可读并保留原 Evidence lineage；
- v2 绑定新的 exact `versionId + fingerprint`，不能继承 v1 的 ready 状态；
- v2 在重新验证前显示 pending/stale/required，而不是已通过；
- 旧 Evidence 对新版本明确 stale/不适用；
- 切回 v1/v2、reload 和重启时不得发生交叉覆盖。

### 4. 恢复与负向

- reload 后恢复同一 actor、Conversation、Draft Version、F4 gate 和 Evidence；
- 受控重启 Web/API 后再次恢复；
- legacy `PROVENANCE_UNAVAILABLE`/error Draft 只读，且不阻塞当前 Draft；
- actor 隔离、错误 version、畸形 ID、未知字段、错误 method、乱序 action 和 idempotency conflict 均 fail closed；
- 负向请求不得产生 Evidence 越级或任何 Approval/Runtime/交易事实。

## Agent Chrome 验收

### 中文 1440×900

- 完成完整 Preflight → Backtest → Walk-Forward UI 链；
- 可见 gate、唯一下一动作、Evidence lineage、fingerprints、stale 和 `APPROVAL REQUIRED`；
- reload 与受控 Web/API restart 后恢复；
- legacy error 卡不影响当前 Draft；
- 无横向滚动、无遮挡，键盘焦点可见。

### English 820×760

- 标签和状态为可理解的英文；
- `scrollWidth === clientWidth === 820`；
- gate、按钮、fingerprint/lineage 不被裁切；
- 键盘焦点可见。

### Console / Network

- 最终清空 Console 后 reload，TradeBot 页面 warning/error 为 0；Chrome 扩展自身 channel error 单独记录，不得归因于产品；
- Network 若不可读取，报告 `TOOL_UNAVAILABLE`，不得改用人工 DevTools、直接 API 或日志替代；
- 若可读取，只报告 method/path/status，不输出敏感 header、cookie 或 body。

### Runtime safety

必须确认：

- `runtimeApplied=false`；
- Paper Only；
- `exchangeWriteAllowed=false`；
- 没有 Human Approval、Approved Paper Plan、Simulation Slot、Deployment、Run、Account、Order、Fill 或 Exchange Write 事实。

## 自动化门禁

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

`npm run test:ts` 必须自然退出，报告最终 TAP 汇总和 exit 0。

## 文档与 Git

- 若所有必需项通过：将 F4 标为 `COMPLETE`，创建唯一递增编号 `LOOP-051` 进入 F5 Simulation V2。
- 若任一必需项未通过：F4 保持 `IN_PROGRESS`，`LOOP-051` 只能处理明确剩余的 F4 缺口。
- 更新 `docs/product-optimization-plan-and-progress.md`、`docs/product-roadmap-and-progress.md`、`docs/project-status-and-handoff.md` 和 `docs/next-loop-prompt.md`。
- 所有代码和文档修改必须提交并推送 `main`，确认本地 HEAD 与 `origin/main` 一致；不创建 PR。

## 最终报告模板

```text
Loop ID：LOOP-050
验收模式：COMPLETE_EXISTING_CHAIN_AND_AGENT_CHROME_VERIFY
浏览器要求：必需；Agent 已使用真实 Chrome / 未完成（原因）

F4 UI hydration：PASS / FAIL
Preflight：PASS / FAIL / NOT VERIFIED
Backtest Evidence：PASS / FAIL / NOT VERIFIED
Walk-Forward Evidence：PASS / FAIL / NOT VERIFIED
EVIDENCE READY / APPROVAL REQUIRED：PASS / FAIL / NOT VERIFIED
v1/v2 immutable + stale：PASS / FAIL / NOT VERIFIED
幂等与顺序门禁：PASS / FAIL
actor/ID/method fail-closed：PASS / FAIL
reload / Web/API restart recovery：PASS / FAIL / NOT VERIFIED
中文 1440×900：PASS / FAIL / NOT VERIFIED
英文 820×760：PASS / FAIL / NOT VERIFIED
Console：PASS / FAIL / TOOL_UNAVAILABLE
Network：PASS / FAIL / TOOL_UNAVAILABLE
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
Approval/Runtime/交易副作用：NONE / FAIL（说明）
自动化：check；test:ts 最终 TAP；build:web；diff-check
F4：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-051（F5 / F4 continuation）
Git：commit；branch main；push PASS/FAIL；PR 未创建
```
