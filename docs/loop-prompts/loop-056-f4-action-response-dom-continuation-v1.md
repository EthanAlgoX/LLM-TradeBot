# LOOP-056 — F4 Action Response 与原页 DOM 即时更新收尾

```text
Loop ID：LOOP-056
里程碑：F4 预上线检查与历史验证
验收模式：DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
浏览器要求：必需；只能由 Agent 操作真实 Chrome，禁止人工或用户协助验收
当前基线：main / caeb712；自动化 383/383 PASS
目标状态：修复后完成 F4，或如实保持 F4 IN_PROGRESS
Git：所有本轮修改必须 commit 并 push 到 main；不创建 PR
```

## 一、任务背景

LOOP-055 已证明以下事实：

- Preflight 在原页可即时推进；
- Backtest、Walk-Forward 的服务端动作成功，结果已持久化；
- exact immutable Strategy Draft Version 的权威 GET 可以读到新 gate；
- reload 后页面能恢复新状态；
- 但无需 reload 的当前 Chrome 页面仍停留在旧 gate。

因此本轮只处理客户端的 `action → authority merge → render → event rebind → visible DOM` 链路。不要创建第二份 F4 状态、第二套 Evidence authority 或轮询式影子状态。

## 二、强制安全边界

本轮只允许 Preflight、Backtest、Walk-Forward Evidence 与只读恢复验证。

严禁：

- 调用 Human Approval；
- 创建 Approved Paper Plan；
- 申请或启动 Simulation Slot；
- Runtime Apply、Deployment、账户、订单、成交或交易所写入；
- 进入 F5、恢复 LOOP-025/M6、实现 Live/Canary；
- 修改或提交 `data/local-paper-workspace*`；
- 使用人工点击、人工 DevTools 或让用户补充浏览器证据。

全程保持并验证：

```text
runtimeApplied=false
Paper Only
exchangeWriteAllowed=false
```

## 三、执行前检查

1. 阅读：
   - `docs/product-optimization-plan-and-progress.md`
   - `docs/product-roadmap-and-progress.md`
   - `docs/project-status-and-handoff.md`
   - `docs/next-loop-prompt.md`
   - LOOP-054、LOOP-055 Prompt 与相关提交
2. 检查 `git status --short`、当前分支、`HEAD` 与 `origin/main`。
3. 保留用户已有修改；若存在与本任务无关的脏文件，不得回退或覆盖。
4. 确认当前服务确实运行当前 HEAD 的构建产物。停止时只能停止本轮明确启动的进程，不得清理不明进程。

## 四、先诊断，不得用 reload 掩盖问题

使用最小、可删除或仅 DEV 生效的诊断证据，逐段确认以下链路：

1. 点击的按钮是否携带正确的 `versionId`、`nextAction`，且 handler 只执行一次；
2. POST 返回后，exact-version merge 是否真正替换 `state.realWorkbenchTurns` 中对应版本；
3. POST 后的权威 GET 是否返回更新后的 gate、binding revision 与 `nextAction`；
4. GET 合并后，目标 Turn 的对象和 F4 projection 是否已经变化；
5. `render()` 是否在最终 authority merge 后执行；
6. render 后生成的 HTML 是否包含新 gate 和新按钮；
7. DOM 是否被后续旧闭包、旧 hydration、旧 epoch、重复 listener 或旧 render 覆盖；
8. action 期间页面导航、locale/category 切换或 history hydration 是否错误增加 epoch，使合法结果被丢弃；
9. 是否存在“状态已更新但 render 读取旧数组/旧 Turn”或“render 正确但事件重绑后被旧请求覆盖”；
10. Backtest 与 Walk-Forward 是否存在与 Preflight 不同的异步终态语义，导致只读一次时仍读到中间态。

必须给出一个可复现且有代码证据的根因。不能只写“浏览器缓存”“时序问题”或通过增加无界延迟解决。

## 五、修复要求

修复应满足：

- 继续以服务端 exact-version F4 projection 为唯一 authority；
- POST response 可以即时投影，但最终必须由同一 immutable `versionId` 的权威状态校正；
- 如果 runner 是异步完成，使用有界、可终止、只针对同一版本的 reconciliation；不得无限轮询；
- 明确区分 terminal、仍运行、失败和超时；错误必须在当前 Draft 卡片可见，不能静默；
- 旧 epoch、旧 GET、旧 POST 或其他 Draft 的响应不能覆盖较新的 binding revision/gate；
- merge 必须按 immutable `versionId`，不得按数组下标、Draft 列表位置或当前选中卡片猜测；
- 每次最终状态变化后只触发必要 render，并正确重绑新按钮；不得形成 render/fetch 自循环；
- 双击或重复事件不得创建第二 job/evidence；继续沿用既有幂等 authority；
- 不允许用 `location.reload()`、强制页面跳转、定时整页刷新或本地硬编码 gate 作为修复；
- 不改变 F4 以外的产品流程和安全链。

如加入诊断日志，提交前必须删除，或严格限制在 DEV 且不包含 token、cookie、secret、完整 prompt 或敏感数据。

## 六、必须补充的自动化测试

至少覆盖以下行为，优先在现有 hydration/view 测试边界内扩展，避免测试私有实现：

1. Backtest POST/权威投影完成后，当前 exact version 立即显示 `backtest: succeeded` 和 `nextAction: walk-forward`；
2. Walk-Forward 完成后立即显示 `walk_forward: succeeded` 与 `EVIDENCE READY / APPROVAL REQUIRED`；
3. 旧 hydration 或乱序 GET 不可覆盖更高 binding revision/更晚 gate；
4. v1 action 结果不可写入同 Draft v2，也不可写入其他 Draft；
5. reconciliation 有明确次数/时间上限，并正确处理 terminal、running、failure 与 timeout；
6. rerender 后的新 action button 可被绑定一次，不能重复提交；
7. action/reload/restart 后使用同一 actor、同一 immutable version 恢复相同 authority；
8. legacy `PROVENANCE_UNAVAILABLE` 仍只读隔离，不阻塞其他 Draft；
9. 不产生 Approval、Runtime、Simulation、account/order/fill 副作用。

如果现有单元边界不能证明 DOM 更新，应提取一个小型、可测试的 action controller/render-state coordinator；不要引入新的全局状态框架。

## 七、自动化门禁

依次执行并记录真实结果：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

`npm run test:ts` 必须自然退出并给出最终 TAP 汇总。不得只报告中途通过数量。

## 八、Agent 真实 Chrome 验收

浏览器为必需项，只能由 Agent 操作真实 Chrome。禁止改成人工验收，也禁止用 API、日志或内置浏览器替代以下 UI 证据。

先以当前 HEAD 受控重启 `npm run dev:paper`，打开真实 Workbench。使用正常产品生命周期创建一条新鲜测试链，不直接修改 SQLite 或伪造页面状态。

### A. 原页即时更新——不得 reload

在同一个页面、同一个 v1 卡片上连续验证：

1. 点击 Preflight，原页立即变为 passed，并出现 Backtest；
2. 点击 Backtest，等待产品定义的有界完成过程，原页自动显示 succeeded，并出现 Walk-Forward；
3. 点击 Walk-Forward，原页自动显示 succeeded；
4. 终态显示 `EVIDENCE READY / APPROVAL REQUIRED`；
5. 三步之间不得 reload、切换页面或重新进入 Workbench；
6. 不点击 Approval。

如果任一步必须 reload 才出现新状态，则本项 FAIL，F4 不得完成。

### B. immutable v1 → v2 stale/recovery

1. 通过正常 Workbench 修改并 Apply，例如把最大仓位修改为 5%；
2. 必须生成同一 Configuration Draft 的 immutable v2，且 parent version/fingerprint 精确指向 v1；
3. v1 保留原 Evidence lineage，标记 stale/read-only，不恢复 authorization；
4. v2 初始为 fresh pending，不继承 v1 的 binding、jobs、ready 状态；
5. v2 可独立从 Preflight 运行到 Evidence ready，原页每一步都即时更新；
6. v1/v2 不得交叉显示 gate、binding revision、job 或 Evidence。

### C. 恢复与布局

1. reload 后 v1/v2、stale、lineage 和终态一致；
2. 受控重启 Web/API 后，同 actor 恢复相同事实；
3. 中文 1440×900：无横向滚动、无遮挡，状态与按钮清楚；
4. 英文 820×760：无横向滚动、无遮挡，键盘焦点可见；
5. Console 清空后刷新：TradeBot 页面 warning/error 为 0；Chrome 扩展自身 channel-close 错误单独记录，不冒充产品错误；
6. Network 若工具确实不可用，记录 `TOOL_UNAVAILABLE`，不得伪造；它不替代 DOM、Console 和恢复验收；
7. 始终可见 Paper Only、`runtimeApplied=false`、`exchangeWriteAllowed=false`。

## 九、完成条件与下一轮

只有同时满足以下条件才能将 F4 标记为 `COMPLETE`：

- Backtest 与 Walk-Forward 在原页无需 reload 即时推进；
- v1→v2 immutable/stale/不继承/独立 Evidence 链全部通过；
- reload 与 Web/API restart 恢复通过；
- 中英文双尺寸、Console 与全部自动化门禁通过；
- 无 Approval、Runtime、Simulation 或交易副作用。

若 F4 完成：

- 更新规划、路线图和交接文档；
- 创建唯一编号的 `LOOP-057`，进入 F5 Simulation V2；
- 更新 `docs/next-loop-prompt.md` 指向 LOOP-057。

若任何条件失败：

- F4 保持 `IN_PROGRESS`；
- 记录最小根因与未完成证据；
- 创建唯一编号的 `LOOP-057`，但它只能是 F4 continuation，不得进入 F5。

## 十、Git 要求

本轮所有代码、测试和文档修改必须：

1. `git diff --check` 通过；
2. 检查提交范围，不包含 `data/local-paper-workspace*` 或无关文件；
3. 提交到 `main`；
4. push 到 `origin/main`；
5. 核对本地 HEAD 与远端一致；
6. 不创建 PR。

即使 F4 未完成，只要本轮产生了有效修改或交接文档，也必须 commit 并 push，确保可回溯。

## 十一、最终回复模板

```text
Loop ID：LOOP-056
验收模式：DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
浏览器要求：Agent 已使用真实 Chrome / FAIL（原因）

DOM 即时更新根因：
Backtest 原页即时推进：PASS / FAIL
Walk-Forward 原页即时推进：PASS / FAIL
EVIDENCE READY / APPROVAL REQUIRED：PASS / FAIL
同 Draft immutable v2：PASS / FAIL
v1 stale/read-only lineage：PASS / FAIL
v2 不继承 v1 Evidence：PASS / FAIL
v2 独立 Evidence 链：PASS / FAIL
reload recovery：PASS / FAIL
Web/API restart recovery：PASS / FAIL
中文 1440×900：PASS / FAIL
英文 820×760：PASS / FAIL
Console：PASS / FAIL / TOOL_UNAVAILABLE
Network：PASS / FAIL / TOOL_UNAVAILABLE
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
Approval/Runtime/Simulation/交易副作用：NONE / FAIL（说明）
自动化：check；test:ts 最终 TAP；build:web；diff-check
F4：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-057（F5 / F4 continuation）
Git：commit；branch main；push PASS/FAIL；PR 未创建
```
