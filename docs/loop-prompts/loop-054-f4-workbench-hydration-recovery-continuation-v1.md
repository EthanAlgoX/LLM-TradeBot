# LOOP-054 — F4 Workbench hydration, action response, and recovery closeout

```text
Loop ID: LOOP-054
Milestone: F4 Preflight / Backtest / Walk-Forward V1 final closeout
Mode: DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
Browser requirement: REQUIRED; Agent-operated real Chrome only; manual/user-assisted verification is forbidden
Safety: validation/evidence only; no Human Approval, Approved Paper Plan, Runtime Apply, Simulation Slot, account/order/fill or exchange write
Git: commit and push main for every code/document change; no PR
```

## 目标

LOOP-053 已补齐服务端 stale v1 的只读 Evidence 投影和 v2 parent version/fingerprint 展示，自动化为 380/380；但真实 Chrome 中 F4 action 完成后没有立即显示最新投影，reload 又没有稳定恢复同一 actor 的 Workbench history，导致新鲜 v1→v2 验收中断。

本轮先准确修复同一 actor 的 action-response/hydration/reload/restart 恢复，再完整重做：

```text
fresh immutable v1
→ Preflight
→ Backtest
→ Walk-Forward
→ EVIDENCE READY / APPROVAL REQUIRED
→ same-conversation modification
→ same Configuration Draft immutable v2
→ v1 stale/readable + v2 fresh/pending
→ reload and Web/API restart recovery
```

优先验证现有机制；只有确认真实缺陷时才增加测试和做最小修复。不得进入 F5。

## 已知基线

- F3 `COMPLETE`，F4 `IN_PROGRESS`。
- 当前测试基线为 `380/380 PASS`。
- `findReadableForConfiguration` 只读返回 stale v1 binding/jobs/artifacts，不恢复授权。
- fresh v2 不投影 v1 binding/jobs/ready，唯一下一动作应为 Preflight。
- UI 已显示 Configuration version/fingerprint 与 parent version/fingerprint。
- LOOP-053 的 Backtest 事实已持久化，受控 Web/API restart 后能恢复为 partial evidence，说明 runner/persistence 并非主要阻塞。
- 当前缺口是浏览器 action 后即时 authority 更新，以及 reload 后同一 actor Conversation/Draft/F4 history 的稳定恢复。

## 强制边界

1. 只复用现有 loopback HttpOnly identity、Conversation/Recommendation/Apply、Configuration Draft、F4 projection、Evidence service 和 SQLite authority。
2. 不创建第二套 actor/session、Conversation cache、Draft/version、Evidence/stale、approval、runtime 或浏览器 authority。
3. 不使用 localStorage/sessionStorage 保存 actor、Conversation facts、Draft 或 F4 Evidence；浏览器状态不是事实源。
4. 不使用 Mock、Sample、直接 API 创建、SQLite 修改、DOM 注入或静态成功状态替代真实 Workbench UI。
5. API、日志和 SQLite 仅可只读诊断；正向 PASS 必须由 Agent 直接操作真实 Chrome获得。
6. 禁止用户手工验收；Chrome 不可用时如实报告 `NOT VERIFIED`。
7. 不读取、复制、打印或暴露 token、cookie value、secret、Authorization header 或敏感 body。
8. 不修改、删除或提交 `data/local-paper-workspace*` 与本地运行数据。
9. 始终保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

## A. 先诊断，不要凭猜测修改

使用一个本轮新鲜 Workbench turn，记录非敏感 ID/fingerprint，并把恢复链拆成以下边界：

### 1. local actor identity

- reload 前后、Web restart 前后必须解析为同一服务端 actor；
- `/api/orchestration/local-identity` 必须先成功建立现有 HttpOnly loopback identity，再请求 history；
- 不读取 cookie 值，只验证同一 actor 所属的已知非敏感 Conversation/Draft facts 能否恢复；
- 排除 `127.0.0.1`/`localhost` 混用、旧 cookie 名、重复服务进程、错误端口或不同 SQLite workspace；
- 不通过放宽 actor isolation 修复恢复问题。

### 2. Conversation history authority

- reload 后 GET history 必须由当前 actor 返回同一 `workbench.default` 的完整有序 turns；
- 一个 legacy/malformed/stale recommendation 或 Draft 不能让整段 history 失败；
- v1、修改 Recommendation 和 v2 Draft reference 必须各自关联正确 recommendation/intent；
- history 为空、非 2xx、parse 失败或部分记录失败时，UI 必须进入明确 error/empty 状态，不能静默清空或永久 loading；
- 服务端查询与映射必须保持 actor isolation、稳定排序和 append-only 事实。

### 3. hydration sequencing and stale response isolation

- initial identity、直达 `#orchestration`、in-app navigation、Apply 后、F4 action 后、reload 后应走一个明确的 server-authoritative hydration/merge 路径；
- 检查 `realWorkbenchHydrationEpoch`、view 切换、render/rebind、并发 history/F4 requests；
- 旧 epoch、旧 Draft Version 或较早 gate 响应不得覆盖较新的 action result；
- hydration 不应依靠数组 index 把 F4 projection 重新配回错误 turn；优先使用稳定 version/recommendation identity；
- 快速切换页面或语言后返回 Workbench，事实仍可恢复。

### 4. F4 action response

- Preflight/Backtest/Walk-Forward POST 使用 exact Draft `versionId`；
- action 成功后 UI 立即显示响应中的最新 binding/gates/nextAction，不需要重启服务；
- 如果 action response 只是中间态，应在现有 authority 上做有界的重新读取，而不是伪造 succeeded；
- action update 和后台 hydration 必须按 version identity 合并，不能因按钮重渲染、空 dataset 或旧闭包丢失；
- reload 后读取结果必须与 action 后最终可见结果一致。

### 5. controlled restart

- 排除加载旧 build 的残留进程，确认唯一 `npm run dev:paper` 使用当前 HEAD；
- restart 前后使用同一 workspace/SQLite 路径和同一 local operator identity；
- 不删除或重建 workspace 来获得 PASS。

## B. 必需自动化

针对确认的根因补充聚焦测试，至少覆盖：

- identity handoff 后 history hydration 的正常、empty、non-2xx 和单记录错误隔离；
- F4 action result 立即合并到 exact Draft Version；
- 较旧 hydration 响应不能覆盖较新的 action result；
- history/recovery 使用稳定 recommendation/version identity，而不是脆弱数组位置；
- reload 等价的重新 hydration 后恢复同一 turns、v1/v2 references 和 F4 states；
- SQLite/service restart 后 v1 stale lineage 与 v2 fresh state 不串线；
- actor 变化时正确隔离为空，绝不能借此回退为共享历史；
- 所有错误路径 fail closed，且无 Approval/Runtime/交易副作用。

测试应覆盖真实回归根因，不只测试纯展示字符串。

## C. Agent Chrome 完整复验

修复和自动化通过后，受控启动唯一当前 HEAD 服务，由 Agent 直接操作真实 Chrome：

### 1. 新鲜 v1 Evidence

1. 在正常 Workbench 对话中生成并 Apply 一个新 v1；
2. 依次执行 Preflight、Backtest、Walk-Forward；
3. 每次 action 后无需 restart 即立即看到正确 gate 和唯一下一动作；
4. v1 最终显示 `EVIDENCE READY / APPROVAL REQUIRED` 和完整只读 lineage；
5. 不点击或调用 Approval。

### 2. 同 Draft immutable v2

1. 在同一 Conversation 中输入有效修改：“将最大仓位调整为 5%”；
2. Apply 修改 Recommendation；
3. 确认 v2 与 v1 使用同一 Configuration Draft ID；
4. v2 使用新的 version/fingerprint，并精确引用 v1 parent version/fingerprint；
5. v1 immutable Evidence lineage 继续可读，但按最新版本 drift 显示 stale；
6. v2 不继承 v1 binding/jobs/evidence-ready，唯一下一动作回到 Preflight。

### 3. reload/restart/rapid-switch

- v1 ready 后 reload 一次，确认 history 和 F4 完整恢复；
- v2 Apply 后 reload 一次，确认 v1/v2/stale/parent 不串线；
- 受控重启 Web/API 后再次确认；
- 快速切换其他一级页面再返回 Workbench，当前事实不丢失；
- 切换中文/英文后事实不丢失；
- legacy error/`PROVENANCE_UNAVAILABLE` turn 不阻塞当前链。

## D. 最终页面与安全验收

### 中文 1440×900

- v1/v2、parent、stale、Evidence lineage、唯一下一动作清晰可读；
- 无横向滚动、无遮挡，键盘焦点可见。

### English 820×760

- 状态和版本标签为可理解英文；
- `scrollWidth === clientWidth === 820`；
- 长 fingerprint/lineage 不撑破布局，焦点可见。

### Console / Network

- 最终清空 Console 后 reload，TradeBot 页面 warning/error 为 0；扩展 channel-close 错误单独标注；
- Network 若工具不可读取，报告 `TOOL_UNAVAILABLE`，不得用人工 DevTools、直接 API 或日志替代；
- 若可读取，只报告 method/path/status，不输出 headers、cookie、token 或敏感 body。

### Runtime safety

确认：

- `runtimeApplied=false`；
- Paper Only；
- `exchangeWriteAllowed=false`；
- 没有 Human Approval、Approved Paper Plan、Simulation Slot、Deployment、Run、Account、Order、Fill 或 Exchange Write 事实。

## 自动化门禁

必须执行并获得真实终态：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

`npm run test:ts` 必须自然退出，报告最终 TAP 汇总与 exit 0。

## F4 完成条件

只有以下全部通过，才把 F4 标记为 `COMPLETE`：

- action 后即时显示最新 server authority；
- 同 actor reload 与 Web/API restart history 稳定恢复；
- 新鲜 v1 Evidence-ready；
- 同 Draft immutable v2 + exact parent；
- v1 stale/readable，v2 fresh/no inherited Evidence；
- 快速切换、双尺寸、Console 和全量自动化；
- 无 Approval、Runtime、Simulation 或交易副作用。

完成后创建唯一递增编号 `LOOP-055` 进入 F5 Simulation V2。若任一必需项失败，F4 保持 `IN_PROGRESS`，`LOOP-055` 只能处理明确剩余的 F4 缺口。

## 文档与 Git

- 更新：
  - `docs/product-optimization-plan-and-progress.md`
  - `docs/product-roadmap-and-progress.md`
  - `docs/project-status-and-handoff.md`
  - `docs/next-loop-prompt.md`
- 所有代码与文档修改必须 commit 并 push `main`；确认本地 HEAD 与 `origin/main` 一致；不创建 PR。

## 最终报告模板

```text
Loop ID：LOOP-054
验收模式：DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
浏览器要求：必需；Agent 已使用真实 Chrome / 未完成（原因）

Hydration/recovery 根因：
同 actor identity recovery：PASS / FAIL / NOT VERIFIED
Conversation history hydration：PASS / FAIL / NOT VERIFIED
F4 action 即时 authority 更新：PASS / FAIL / NOT VERIFIED
陈旧响应隔离：PASS / FAIL
v1 Evidence ready：PASS / FAIL / NOT VERIFIED
同 Draft immutable v2：PASS / FAIL / NOT VERIFIED
v2 parent version/fingerprint：PASS / FAIL / NOT VERIFIED
v1 stale + immutable Evidence：PASS / FAIL / NOT VERIFIED
v2 不继承 binding/jobs/ready：PASS / FAIL / NOT VERIFIED
reload recovery：PASS / FAIL / NOT VERIFIED
Web/API restart recovery：PASS / FAIL / NOT VERIFIED
快速页面/语言切换：PASS / FAIL / NOT VERIFIED
中文 1440×900：PASS / FAIL / NOT VERIFIED
英文 820×760：PASS / FAIL / NOT VERIFIED
Console：PASS / FAIL / TOOL_UNAVAILABLE
Network：PASS / FAIL / TOOL_UNAVAILABLE
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
Approval/Runtime/交易副作用：NONE / FAIL（说明）
自动化：check；test:ts 最终 TAP；build:web；diff-check
F4：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-055（F5 / F4 continuation）
Git：commit；branch main；push PASS/FAIL；PR 未创建
```
