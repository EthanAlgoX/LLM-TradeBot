# LOOP-017 — M2 CSV Binding Authority 恢复与 Agent Chrome 最终收尾

```text
Loop ID：LOOP-017
里程碑：M2 数据中心 V1
状态：COMPLETE
前置 Loop：LOOP-016（PARTIAL，Binding 合同已修复；历史恢复会切换到非 CSV Draft）
执行环境：本地仓库 + 实现后由 Agent 直接控制真实 Google Chrome
浏览器要求：实现后必需；禁止用户手工验收或 DevTools 交接
验收模式：AUTHORITY_RECOVERY_AND_AGENT_CHROME_VERIFIED
```

## 执行结果（2026-08-02）

- Authority 根因仅在 Web：Binding POST 与 append-only replay 写入同一 conversation 正确，SQLite `createdAt DESC, idempotencyKey DESC` 的 latest 与 summary 一致；但 `refreshHistory()` 会从全局列表/localStorage 再猜选中会话，且未受保护的旧 `loadConversation()` 响应可覆盖 `currentDraft`。
- Binding 成功现捕获其 conversation、parent Draft 与 Dataset identity，对精确 conversation 做 read-after-write，并校验服务端 newest Draft/version/fingerprint 与 binding 后才写入 UI；列表刷新只更新 summary。
- Web 将 newest-first 服务端页显式转换成 oldest-to-newest 展示，Authority 固定取 newest item；conversation/binding epoch 阻止陈旧 A/B 响应、pending/result 和新会话状态串扰。
- 自动化：`check` PASS；`test:ts` 336/336 PASS；`build:web` PASS；`diff-check` PASS。
- Agent Chrome：中文 1440×900 与英文 820×760 通过；UI 完成 CSV Draft → Binding → 刷新/本项目服务重启 → `confidenceThreshold=0.72` → 刷新 → A/B 往返，CSV binding、CSV preset/source、Draft v3 与 `runtimeApplied=false` 保留。无 Draft 会话的 Confirm Binding 为 disabled。产品 Console 在修复后无新 error；扩展异步消息错误单独隔离。Network：`TOOL_UNAVAILABLE`。

## 目标

修复 CSV Dataset Binding 成功后，Web 历史恢复把当前会话的 `currentDraft` 切换为非 CSV Draft 的 Authority 错误。完成以下可见闭环：

`CSV-compatible Draft → Binding → 同会话定向恢复 → 刷新/服务重启 → Composer 修改 → 最新 CSV Draft → 会话往返恢复`

LOOP-016 的共享严格 `DatasetBindingRequestSchema` 与短、opaque、稳定的 `binding.<uuid>` 幂等键必须保留。不得通过隐藏历史、清空 workspace、关闭恢复逻辑或在客户端强行保留旧对象来掩盖错误。

## 已确认基线

- 当前基线提交：`c68aad5819accbe99db6a3ab17b2b9c300cb6ea6`，已推送 `origin/main`。
- Binding 合同根因已修复：旧 ``ui.${versionId}.${fingerprint}`` 超过服务端 160 字符；共享 Schema、正式 handler、短幂等 key 与负向 fail-closed 已通过。
- 自动化基线：334/334 PASS。
- Agent Chrome 中 `REQUEST_CONTRACT_INVALID` 已消失，请求能够进入 Binding；中文 1440×900 无横向滚动，Console 产品 error 为 0。
- 当前真实缺陷：Binding 后执行历史恢复时，页面可能选择同一或其他历史中的非 CSV Draft 上下文，因此正向 Binding、Composer、binding 保留与 Authority 恢复均不能判定为通过。
- Network 为 `TOOL_UNAVAILABLE`，不要求人工补验。
- Runtime 安全基线：`runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

## 强制边界

- 禁止要求用户点击、截图、打开 DevTools、查看 Network/Storage 或口头报告结果；必须由 Agent 直接控制真实 Google Chrome。
- API、SQL 只读检查、服务日志与自动化仅可用于定位，不得替代 Chrome UI 功能验收。
- 不得读取、复制或报告 Authorization、Token、Cookie/Storage value、完整请求体或响应正文。
- 禁止直接编辑、删除或清空 `data/local-paper-workspace*`、SQLite 或浏览器资料制造干净状态。
- 保持服务端 Turn 为唯一会话事实源、完整 `draftId + versionId + fingerprint` Authority、actor/conversation isolation、append-only、严格 cursor 与 fail-closed。
- 禁止按“最近任意会话”“最新任意 Draft”或客户端缓存猜测 Authority；Dataset intent、Binding 和后续 Composer 必须始终归属于明确 actor/conversation。
- 不得 Apply Runtime、启动 Paper Run、下单或增加交易所写能力。
- 保留用户既有修改；禁止 `reset`、`checkout`、`clean` 或回退无关改动。

## 第一阶段：确定 Authority 被替换的位置

1. 只读确认 Git/远端状态，完整阅读 LOOP-014～016 的执行事实及 `c68aad5` diff。
2. 使用有多个会话、至少一个 CSV Draft 和一个非 CSV Draft 的正式测试场景，逐层记录非敏感 ID/版本，比较：
   - Binding POST 请求中的 `conversationId` 与 parent Draft Reference；
   - Binding POST 返回的新 Draft Reference；
   - `appendDraftReference()` 写入的 actor/conversation、`createdAt`、idempotency key 和 selected context；
   - `getLatestTurn()`、`listTurns()` 第一项与 `listConversations()` summary；
   - Web `confirmBinding()`、`refreshHistory()`、`loadConversation()` 结束后选中的 conversationId/currentDraft。
3. 必须判定属于哪一层，不得笼统写“历史恢复问题”：
   - 服务端 Binding Turn 写入了错误 conversation 或错误 parent；
   - SQL `createdAt + idempotencyKey` 排序/分页把旧 Turn 当成 latest；
   - `responseFromTurn()`/read model 丢失或替换 selected Draft/binding；
   - `refreshHistory()` 根据 localStorage 或列表重新选择了错误会话；
   - 并发 `loadConversation()` 响应乱序，旧请求覆盖新选择；
   - 翻页 merge/reverse/dedupe 后 `operations.at(-1)` 不再是权威最新 Turn；
   - Strategy Workspace 重挂载、语言/路由切换或一次性 intent 造成跨会话状态残留。
4. 在修改前给出一句明确根因，并确认错误是否仅为投影/选择错误，还是已经写入错误 Draft/Turn。若存在错误持久化，必须补充 fail-closed 和隔离修复。

## 第二阶段：Authority 恢复设计要求

### 1. Binding 后定向 read-after-write

- `confirmBinding()` 必须捕获动作开始时的 actor-owned `conversationId`、pending intent identity 和 parent Draft Reference。
- POST 成功后，对该确切 conversation 做定向 `loadConversation(boundConversationId)` 或等价的服务端 read-after-write；不得通过全局 `refreshHistory()` 重新猜测当前会话。
- 定向读取必须确认服务端 latest Draft Reference 与 POST 返回的完整 reference 一致，Dataset binding version/fingerprint 一致；不一致时显示稳定错误并 fail closed，不能静默采用另一 Draft。
- 会话列表可以随后刷新 summary，但刷新列表不得改变已经明确选择的 active conversation。

### 2. 防止异步响应覆盖

- 为 conversation load/refresh 引入有界 request epoch、AbortController 或等价 identity guard；响应只有在 request conversationId 与当前 active selection/epoch 一致时才能写入 `operations/currentDraft/turnsCursor/errorCode`。
- 切换会话、新建会话、Binding、路由重挂载和 reconnect 必须使旧请求失效。
- 旧请求可以完成网络读取，但不得覆盖新会话 UI，也不得触发 Draft/Binding/Runtime 副作用。
- 不要用全局布尔 busy 把所有读取永久串行化；保持实现最小且可测试。

### 3. Turn 排序、分页与投影

- 服务端继续以 `createdAt DESC, idempotencyKey DESC` 和版本化 cursor 提供有界分页；同毫秒追加规则必须有确定性且重启后不变。
- Web 必须将服务端 newest-first page 明确转换为 oldest-to-newest 展示，并从服务端 newest item 或显式 helper 取得 Authority；不得依赖多次 `reverse()` 的隐式副作用。
- append pagination 时，新旧页去重后显示顺序稳定，加载更早 Turn 不得降低 `currentDraft`。
- Binding synthetic Turn 必须携带同一 CSV selected context、最新 Draft Reference 与 Dataset binding；不能从其他会话或全局 latest 继承。

### 4. 状态清理与隔离

- pending Binding intent、binding result 和幂等 key 绑定到明确 conversation/draft/dataset identity。
- 切换到另一会话时不得显示前一会话的 pending/result；返回原会话时从服务端恢复已绑定事实，而不是恢复旧 pending action。
- 新建会话没有权威 Draft 时必须为空，不能继承上一会话 `currentDraft`。

## 第三阶段：行为级自动化

至少覆盖以下测试，验证事实而非文案：

1. 会话 A 创建 CSV Draft 并 Binding，会话 B 保持 Binance/non-CSV；Binding 后定向恢复 A，Authority 必须是 A 的最新 CSV bound Version。
2. 并发发起 A/B 两个 load，让旧请求后返回；当前选中 B 时 A 响应不得覆盖 B，反向场景同样成立。
3. Binding POST 成功后会话列表刷新顺序变化，不得改变 active conversation/currentDraft。
4. Turn 超过一页后加载更早页，展示顺序、去重与 cursor 稳定，Authority 不从最新 CSV Draft 降级到旧 non-CSV Draft。
5. 同毫秒 Turn、相同时间 tie-break、SQLite 重启后，`getLatestTurn/listTurns/listConversations` 对 latest 的判断一致。
6. Binding 后刷新及服务重启，再提交 `confidenceThreshold=0.72`；新不可变版本保留 CSV Dataset binding、CSV recipe/preset/Graph 和 exact source set。
7. 两 actor、两 conversation、陈旧响应、损坏 replay、错误 parent/capability/fingerprint 和未认证请求 fail closed，不串状态且无副作用。
8. 重复 Binding/重挂载/重试保持幂等；无 render/load loop、请求风暴、Runtime Apply、Paper Run、订单或 exchange write。

如 Web 状态逻辑难以行为测试，应提取最小纯 helper（例如 active conversation guard、Turn merge/latest selection），不要引入第二套状态管理框架。

最终运行：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

## 第四阶段：Agent Chrome 完整验收

使用加载当前代码的单一 `npm run dev:paper` 链路。端口占用时先只读识别，只处理本项目陈旧进程；不得误杀无关进程或删除 workspace 数据。

### A. 中文 1440×900 正向闭环

1. Agent 用真实 Chrome 打开 `http://127.0.0.1:5174/#data-center`，中文、1440×900；确认页面稳定、无横向滚动、无遮挡。
2. 通过可见 UI 新建或选择会话 A，送入 CSV Historical，创建/复用 CSV-compatible Agent Draft 并确认 Binding。
3. 必须看到 Binding 成功态、新不可变 Draft Version、Dataset version/截断 fingerprint、Validation 与 `runtimeApplied=false`。
4. 通过 UI 新建或选择会话 B，使其保持非 CSV Draft；在 A/B 间往返，确认每个会话的 Draft/source/binding 不串。
5. 返回 A 并刷新；必要时重启本项目 Web/API 后再次刷新。确认仍为 A 的最新 CSV bound Draft，版本/fingerprint 稳定且没有重复 Version。
6. 在 A 的可见 Composer 提交：`修改 Analysis Agent 的 confidenceThreshold，设置为 0.72。`
7. 必须看到新的不可变 Draft Version、字段 Diff、CSV Dataset binding 保留、CSV recipe/Graph 一致，无 `REQUEST_CONTRACT_INVALID`、`INTERNAL_ORCHESTRATION_ERROR` 或 Authority conflict。
8. 再刷新、加载更多 Turn（若可见）并做一次 A/B 往返，确认最新 Authority 不降级。

全部前置状态只能通过产品 UI 创建或恢复；禁止 Console、地址栏脚本、直接 API、数据库写入或清空 workspace。

### B. 英文 820×760、负向与性能

- 切换 English、820×760，确认无横向滚动、无遮挡；CSV binding、Draft Diff、会话选中状态、安全提示和错误状态可读。
- 快速 A/B 往返或在加载中切换一次会话，确认最终页面与最后选中的会话一致，不被旧响应反向覆盖。
- 通过可见 UI 验证至少一个负向状态，例如无 Draft 会话不能确认 Binding、不允许字段被稳定拒绝或重复确认不增加 Version。
- 页面切换、刷新、语言和尺寸变化不得触发重复 Binding/Draft、请求风暴或高 CPU/内存回归。
- 全程保持 `runtimeApplied=false`、Paper Only、Exchange writes OFF。

### C. Console 与 Network

- 清空 Agent Chrome Console 后完成整条链路并刷新；TradeBot 页面 error 为 0。浏览器扩展异步消息错误单独标注，不作为产品错误。
- 若 Agent Chrome 提供 Network 能力，仅记录非敏感 `method path status`；确认 Binding、Conversation/Turn 与 Composer 无意外 401/4xx/5xx，请求数量有界。
- 若 Agent Chrome 仍不提供 Network，报告 `Network：TOOL_UNAVAILABLE`；禁止人工、Playwright、内置浏览器、curl、日志或数据库替代，不得写 `PASS`。
- 当 Chrome 可见功能、Console、自动化、正式 HTTP 测试与 Runtime safety 全部通过时，`TOOL_UNAVAILABLE` 不单独阻止 M2 关闭；Chrome 页面控制失败仍记 `NOT VERIFIED` 并阻止关闭。

## M2 关闭与下一 Loop

只有以下全部通过时关闭 M2：

- CSV Binding 后定向恢复始终保留同会话最新 Authority；
- 刷新、服务重启、分页及 A/B 会话往返不降级、不串状态；
- Composer 修改成功并保留 CSV binding/recipe/Graph；
- 中英文双尺寸、负向、Console、性能及 Runtime safety 通过；
- 自动化全部通过；Network 为 `PASS` 或明确 `TOOL_UNAVAILABLE`。

关闭时：

1. 将 LOOP-016 标为 `PARTIAL`，LOOP-017 与 M2 标为 `COMPLETE`，保留 LOOP-005～016 历史事实。
2. 更新 `product-optimization-plan-and-progress.md`、`product-roadmap-and-progress.md`、`project-status-and-handoff.md`。
3. 创建唯一编号 `LOOP-018`，进入 M3 实验场 V1，并明确浏览器要求。
4. 更新 `docs/next-loop-prompt.md` 指向 LOOP-018。

如任一产品、自动化或 Chrome 可见功能项失败：LOOP-017 与 M2 保持 `IN_PROGRESS`，创建唯一编号 LOOP-018 继续 M2；不得覆盖本文件或要求人工验收。

## Git 要求

- 任何代码或文档修改都必须创建范围明确的 commit 并 push 当前分支到 `origin`，即使 M2 未关闭。
- 提交前检查 staged diff；禁止提交 `data/local-paper-workspace*`、SQLite、Token、Secret、环境凭据或浏览器产物。
- push 后验证远端 branch ref 与本地 HEAD 一致。
- 不创建 PR，除非用户明确要求。

## 最终报告格式

```text
Loop ID：LOOP-017
验收模式：AUTHORITY_RECOVERY_AND_AGENT_CHROME_VERIFIED / IN_PROGRESS
浏览器要求：实现后必需；Agent 已使用真实 Chrome / Chrome 控制未完成
Authority 根因：<服务端排序 / Web 选择 / 异步覆盖 / 状态残留的明确结论>
Binding 后定向恢复：PASS / FAIL
异步会话隔离：PASS / FAIL
CSV 正向 UI Binding：PASS / NOT VERIFIED
绑定后 Composer：PASS / NOT VERIFIED
CSV binding/recipe/Graph 保留：PASS / NOT VERIFIED
Draft Authority 与刷新/重启恢复：PASS / NOT VERIFIED
会话往返与分页：PASS / NOT VERIFIED
中文 1440×900：PASS / NOT VERIFIED
英文 820×760：PASS / NOT VERIFIED
负向 fail-closed：PASS / FAIL
Console：PASS / NOT VERIFIED（区分产品与扩展错误）
Network：PASS / TOOL_UNAVAILABLE / NOT VERIFIED（PASS 时仅 method/path/status）
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false / NOT VERIFIED
自动化：check；test:ts x/x；build:web；diff-check
M2：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-018（M3 / M2）
Git：commit <hash>；branch <name>；push PASS / FAIL；未创建 PR
```
