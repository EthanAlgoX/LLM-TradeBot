# LOOP-053 — F4 immutable v1→v2 stale and recovery closeout

```text
Loop ID: LOOP-053
Milestone: F4 Preflight / Backtest / Walk-Forward V1 final closeout
Mode: VERIFY_FIRST_FIX_IF_NEEDED_AND_AGENT_CHROME_VERIFY
Browser requirement: REQUIRED; Agent-operated real Chrome only; manual/user-assisted verification is forbidden
Safety: validation/evidence only; no Human Approval, Approved Paper Plan, Runtime Apply, Simulation Slot, account/order/fill or exchange write
Git: commit and push main for every code/document change; no PR
```

## 目标

F4 的真实 v1 Evidence 链、只读 lineage、reload、双尺寸和 379/379 自动化已经通过。本轮只关闭最后一个缺口：使用正常 Workbench 对话和 Apply 生命周期，把一个本轮新鲜、Evidence-ready 的 immutable v1 修改为同一 Configuration Draft 的 immutable v2，验证旧 Evidence stale、版本事实不变、v2 不继承 ready，以及 reload/Web/API restart 后不发生版本或 Evidence 串线。

不要重做 F4 架构，不要提前进入 F5。优先验证现有能力；只有发现真实缺陷时才增加聚焦测试并做最小修复。

## 已知基线

- F3 `COMPLETE`，F4 `IN_PROGRESS`。
- 当前自动化基线为 `379/379 PASS`。
- Agent Chrome 已验证一个新 v1 可完成：

```text
Preflight passed
→ Backtest succeeded
→ Walk-Forward succeeded
→ EVIDENCE READY / APPROVAL REQUIRED
```

- Workbench 已展示 Configuration、Graph、Dataset、Profile、Candidate Set、Plan、binding version/fingerprint 和 Backtest/Walk-Forward job/evidence lineage。
- F3 已支持在同一 Conversation 中以正常修改请求（例如将最大仓位调整为 5%）创建同一 Configuration Draft 的 immutable v2，并保留精确 parent version/fingerprint。
- 本轮不得调用 Approval；Evidence-ready 不等于 Approved、Deployed 或 Running。

## 版本与 stale 的正确语义

必须按以下语义验收，不得把状态混淆：

1. **v1 immutable facts**
   - v1 的 `versionId`、fingerprint、parent、Graph/Data/Profile references 和既有 Evidence job/artifact lineage不能被覆盖或删除；
   - v2 成为同一 Draft 的最新版本后，v1 的 gate/binding 可以按现有 authority 显示 `stale`，但历史 Evidence 事实必须继续只读可见。
2. **v2 new authority**
   - v2 使用新的 `versionId + fingerprint`，并精确引用 v1 的 `parentVersionId + parentFingerprint`；
   - v2 不得复制或继承 v1 的 `backtestJob`、`walkForwardJob`、binding fingerprint 或 `EVIDENCE READY`；
   - v2 的合法初始状态应是需要重新 Preflight/Evidence 的 pending/required 状态。
3. **no cross-version projection**
   - v1 卡片只能显示 v1 authority；v2 卡片只能显示 v2 authority；
   - 陈旧 hydration、action response、Conversation order 或 reload 不得把 v1 Evidence 投影到 v2；
   - 不要为了本轮验收再次跑完 v2 Evidence，除非修复缺陷所必需。本轮重点是 stale 与隔离。

## 强制边界

1. 只复用现有 Conversation/Recommendation/Apply、Configuration Draft version authority、F4 projection、`StrategyEvidenceApprovalService` 和 stale 规则。
2. 不创建第二套 Draft、version、Evidence、stale、approval、runtime 或浏览器状态 authority。
3. 不使用 Mock、Sample、直接 API 创建、SQLite 修改、DOM 注入或静态文案替代正常 Workbench UI 生命周期。
4. API/日志/SQLite 仅可只读诊断；正向 PASS 必须由 Agent 直接操作真实 Chrome 完成。
5. 禁止用户手工验收；Chrome 控制失败时如实报告 `NOT VERIFIED`。
6. 不读取、复制或输出 token、cookie value、secret 或请求敏感内容。
7. 不修改、删除或提交 `data/local-paper-workspace*` 与本地运行数据。
8. 始终保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

## A. 聚焦自动化

先检查现有测试是否完整覆盖以下链路；缺失时增加最小集成测试：

- 正常 Workbench v1 Apply → Preflight → Backtest → Walk-Forward → evidence ready；
- 同一 Conversation 的有效修改 Apply 创建同一 `configurationDraftId` 的 immutable v2；
- v2 的 parent 精确等于 v1 version/fingerprint，v1 JSON/fingerprint 不变；
- v1 既有 Evidence lineage 仍可读取，但 latest-version drift 按 authority 投影 stale；
- v2 初始没有 v1 的 binding/jobs/evidence-ready 状态，唯一下一步回到 Preflight；
- SQLite/service restart 后 v1/v2、parent lineage、stale 与 Evidence 隔离保持一致；
- 旧响应不能覆盖当前 Draft Version；
- 跨 actor、错误 version/fingerprint、错误 parent、重复/冲突 idempotency key 均 fail closed；
- 所有路径均不创建 Approval、Approved Paper Plan、Runtime、Simulation 或交易事实。

若测试暴露根因，只在已有 authority 边界内最小修复。不要为通过测试改变 stale 的业务含义。

## B. Agent Chrome 正向验收

排除旧 Vite/API 进程和端口占用，确认唯一 `npm run dev:paper` 使用当前 HEAD。由 Agent 直接操作真实 Chrome：

1. 在正常 Workbench 中创建本轮新鲜 Recommendation 并 Apply 为 v1；
2. 在 UI 中把 v1 完成到 `EVIDENCE READY / APPROVAL REQUIRED`，不调用 Approval；
3. 记录页面可见的非敏感 v1 version/fingerprint、binding/job/evidence lineage；
4. 在同一 Conversation 中用自然语言提交有效修改，例如“将最大仓位调整为 5%”；
5. Apply 修改后的 Recommendation，确认产生同一 Configuration Draft 的 immutable v2，而不是另一个无关 Draft v1；
6. 同时检查 v1 和 v2：
   - v1 immutable lineage 保持可读，未被改写；
   - v1 的旧 Evidence 对最新版本显示 stale/历史状态；
   - v2 parent 指向 v1；
   - v2 没有继承 v1 的 ready gate、binding 或 jobs；
   - v2 唯一下一动作是 Preflight/重新验证。

如果正常 UI 无法同时选择或辨认 v1/v2，可在不增加新 authority 的前提下做最小版本选择/标签改进，并增加聚焦 UI 测试。

## C. reload 与受控重启恢复

在同一 Chrome actor 下验证：

- reload 后 v1/v2 的 Draft ID、version/fingerprint、parent、stale、lineage 和下一动作不变；
- 受控停止并重启唯一 Web/API `dev:paper` 后再次恢复；
- 快速切换 v1/v2 或 Conversation 时，epoch/cancel 机制阻止陈旧响应覆盖；
- legacy error/`PROVENANCE_UNAVAILABLE` Draft 不阻塞当前 v1/v2 hydration；
- v2 仍未被误标为 Evidence ready。

## D. 最终页面与安全复核

### 中文 1440×900

- v1/v2、parent、stale、lineage 和唯一下一动作清晰可读；
- 无横向滚动、无遮挡，键盘焦点可见。

### English 820×760

- 版本、stale 和 Evidence 标签为可理解英文；
- `scrollWidth === clientWidth === 820`；
- 长 fingerprint/lineage 不撑破布局，键盘焦点可见。

### Console / Network

- 最终清空 Console 后 reload，TradeBot 页面 warning/error 为 0；Chrome 扩展 channel-close 错误单独标注；
- Network 若不可读取，报告 `TOOL_UNAVAILABLE`，不得使用人工 DevTools、直接 API 或日志替代；
- 若可读取，只报告 method/path/status，不输出 headers、cookie、token 或敏感 body。

### Runtime safety

确认：

- `runtimeApplied=false`；
- Paper Only；
- `exchangeWriteAllowed=false`；
- 没有 Human Approval、Approved Paper Plan、Simulation Slot、Deployment、Run、Account、Order、Fill 或 Exchange Write 事实。

## 自动化门禁

必须执行并取得真实终态：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

`npm run test:ts` 必须自然结束，报告最终 TAP 汇总和 exit 0。

## F4 完成条件

仅当以下全部通过，才将 F4 标记为 `COMPLETE`：

- v1 Evidence 全链和只读 lineage；
- 同 Draft immutable v1→v2 parent lineage；
- v1 历史 Evidence 可读且 stale 语义正确；
- v2 不继承 Evidence-ready，并回到重新验证门禁；
- reload 与 Web/API restart 恢复；
- 中文/英文双尺寸、Console 和全量自动化；
- 无 Approval、Runtime、Simulation 或交易副作用。

F4 完成后创建唯一递增编号 `LOOP-054`，进入 F5 Simulation V2 的规划/实现。若任一必需项失败，F4 保持 `IN_PROGRESS`，`LOOP-054` 只能处理精确剩余的 F4 缺口。

## 文档与 Git

- 更新：
  - `docs/product-optimization-plan-and-progress.md`
  - `docs/product-roadmap-and-progress.md`
  - `docs/project-status-and-handoff.md`
  - `docs/next-loop-prompt.md`
- 所有代码与文档修改必须 commit 并 push `main`；确认本地 HEAD 与 `origin/main` 一致；不创建 PR。

## 最终报告模板

```text
Loop ID：LOOP-053
验收模式：VERIFY_FIRST_FIX_IF_NEEDED_AND_AGENT_CHROME_VERIFY
浏览器要求：必需；Agent 已使用真实 Chrome / 未完成（原因）

v1 Evidence ready：PASS / FAIL / NOT VERIFIED
同 Draft immutable v2：PASS / FAIL / NOT VERIFIED
v2 parent version/fingerprint：PASS / FAIL / NOT VERIFIED
v1 immutable Evidence lineage：PASS / FAIL / NOT VERIFIED
v1 stale projection：PASS / FAIL / NOT VERIFIED
v2 不继承 ready/binding/jobs：PASS / FAIL / NOT VERIFIED
v2 唯一下一动作：PASS / FAIL / NOT VERIFIED
reload recovery：PASS / FAIL / NOT VERIFIED
Web/API restart recovery：PASS / FAIL / NOT VERIFIED
actor/parent/idempotency fail-closed：PASS / FAIL
中文 1440×900：PASS / FAIL / NOT VERIFIED
英文 820×760：PASS / FAIL / NOT VERIFIED
Console：PASS / FAIL / TOOL_UNAVAILABLE
Network：PASS / FAIL / TOOL_UNAVAILABLE
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
Approval/Runtime/交易副作用：NONE / FAIL（说明）
自动化：check；test:ts 最终 TAP；build:web；diff-check
F4：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-054（F5 / F4 continuation）
Git：commit；branch main；push PASS/FAIL；PR 未创建
```
