# LOOP-012 — M2 CSV Binding UI 闭环与 Agent Chrome 收尾

```text
Loop ID：LOOP-012
里程碑：M2 数据中心 V1
状态：READY
前置 Loop：LOOP-011（PARTIAL，发现 CSV Binding UI 消费路径缺失）
执行环境：本地仓库 + Agent 直接控制真实 Google Chrome
浏览器要求：实现后必需；只接受 Agent Chrome 验证，禁止用户手工验收
验收模式：IMPLEMENTATION_AND_AGENT_CHROME_VERIFIED
```

## 目标

补齐“数据中心选择 CSV Historical → 编排工作台确认绑定 → 生成新的不可变 Configuration Draft Version → 刷新后恢复相同 Dataset version/fingerprint”的真实可见闭环。不得仅补事件监听或临时前端状态；必须保证服务端事实、Conversation Draft Authority 与刷新恢复一致。完成实现、自动化和真实 Agent Chrome 验收后关闭 M2，并生成唯一编号 LOOP-013（M3 实验场 V1）。

## 已确认根因

- `apps/web/src/data-center-api.ts` 会派发 `tradebot:data-center-send`。
- `apps/web/src/main.ts` 只切换到 `#orchestration`，随后派发 `tradebot:orchestration-data-intent`。
- 当前没有模块消费 `tradebot:orchestration-data-intent`，所以用户只看到页面跳转。
- 服务端 `POST /api/orchestration/data-center/bindings` 已能校验 actor、Draft kind、parent fingerprint、Dataset version/fingerprint/capability，并创建不可变 Configuration Draft Version。
- 仅把新版本写入前端 `currentDraft` 不足以完成闭环：刷新可能从 Conversation Replay 恢复旧 Draft Reference，后续 Copilot 请求可能与 Draft Authority 冲突。

## 强制边界

- 保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。
- Dataset Binding 只能创建 Configuration Draft Version；不得 Apply Runtime、启动 Paper Run、创建订单或调用交易所写接口。
- 正向绑定必须来自可见 UI，不得以直接 POST、脚本或服务端日志冒充 UI 验收。
- 禁止把 Token、Authorization、Cookie/Storage value、请求载荷或响应正文写入日志、DOM、测试快照或最终报告。
- 禁止要求用户点击、截图、打开 DevTools 或口头确认；Chrome 不可控时保持本 Loop `IN_PROGRESS`。
- 保留用户既有修改；禁止 reset、checkout、clean。不得修改或提交 `data/local-paper-workspace*`、数据库、浏览器资料或凭据。

## 第一阶段：设计并实现最小完整闭环

### 1. 可测试的 Data Intent 合同

- 为 Data Center → Orchestration 定义最小、严格、可测试的前端 intent 类型，只包含绑定所需的非敏感服务端引用：`assetId`、`datasetId`、`version`、`fingerprint`、`capabilityId`、显示名称和模式。
- 不要让多个文件各自维护不一致的匿名 CustomEvent 类型。
- 未登记 Dataset 的资产不得产生 intent；畸形 detail 必须 fail closed。

### 2. 编排工作台中的可见消费者

- 在 Strategy Workspace/编排工作台消费 `tradebot:orchestration-data-intent`。
- 展示明确的“待绑定数据资产”卡片，而不是自动静默写入。至少显示资产名、Dataset version、截断 fingerprint、绑定模式、目标 Draft 和安全提示。
- 允许用户通过可见按钮确认绑定或取消。
- 没有当前 Draft、Draft 不是 `market`/`agent`、Draft 未包含对应 `dataSourceId`、连接只读或请求进行中时，按钮必须禁用并显示可理解原因；不得猜测或自动创建不受控 Draft。
- 重复点击、重复事件和请求重试必须有界；使用稳定 idempotency key，不能意外创建多个版本。

### 3. 真实服务端 Binding

- 确认操作通过现有受认证 API `POST /api/orchestration/data-center/bindings` 完成。
- 请求必须绑定当前 actor 的完整 `draftId + versionId + parent fingerprint`，并携带服务端资产目录给出的 Dataset/capability 引用。
- 成功后显示新的不可变 Draft version、Dataset version、截断 fingerprint、Validation 结果和 `runtimeApplied=false`。
- 409/403/400、过期 parent、跨 actor、能力不匹配与网络失败均不得乐观显示成功；错误后允许安全重试或重新选择最新 Draft。

### 4. Draft Authority 与刷新恢复

- 设计并实现服务端事实源的恢复路径，不能依赖一次性事件或只存在内存中的成功状态。
- 绑定成功后，当前 Conversation 的权威 Draft Reference 必须与新 Configuration Draft Version 保持一致；刷新、切换会话再返回、继续发送 Copilot 消息时不得恢复旧版本或触发 `COPILOT_CONVERSATION_DRAFT_REFERENCE_CONFLICT`。
- 如果现有 Conversation Replay 合同不能安全更新引用，应增加最小 append-only 领域动作/Turn 或 actor-scoped read model；禁止直接覆盖历史 Turn、放宽 Draft Authority 或接受客户端自称“最新版本”。
- 所有读取都必须 actor-scoped、严格解析 ID，跨 actor 与损坏引用 fail closed。
- 刷新后 UI 从服务端读取并显示同一个 Dataset version/fingerprint，不重复创建 Draft Version。

### 5. UI 状态与可访问性

- 提供 loading、success、conflict、validation failure、readonly 和 empty 状态。
- 中英文文案完整；窄屏无溢出；按钮有明确标签，键盘焦点可见，成功/错误状态可被辅助技术读取。
- 避免重新引入 MutationObserver render/load 自循环；同一 host 内部渲染不能触发重复加载或请求风暴。

## 第二阶段：自动化验证

至少增加或扩展以下行为级测试：

1. 合法 CSV intent 被接收并构造严格 Binding 请求；畸形/无 Dataset intent 被拒绝。
2. 成功绑定产生且仅产生一个新不可变 Draft Version，并返回 `runtimeApplied=false`。
3. 重复确认/idempotent retry 不产生重复版本。
4. 刷新恢复、会话切换和继续 Copilot 后仍使用绑定后的权威 Draft Reference。
5. parent fingerprint 冲突、跨 actor、unsupported kind、data source/capability mismatch、未认证请求均 fail closed，且无 Draft/Tool/Runtime 副作用。
6. 绑定过程中切换页面或 host 重挂载不会发生无限 render/load、重复 POST 或陈旧响应覆盖新状态。

不得为了通过测试而削弱现有 Draft Authority、actor isolation、append-only 或 Runtime 安全约束。

## 第三阶段：Agent Chrome 验收（实现后必需）

只能使用 Agent 直接控制真实 Google Chrome；禁止人工代验。使用正确的单一 `npm run dev:paper` 链路，已有正确进程占用 5174/8787 时不要终止。

### A. 中文 1440×900

- 打开 `http://127.0.0.1:5174/#data-center`，确认无横向滚动、无遮挡、页面响应稳定。
- Binance Public 仍为 public capability、无实时 Snapshot、`unavailable`。
- CSV Historical 的 Snapshot、Schema、Quality、Lineage、version/fingerprint 可见。
- 点击“送入编排”，确认进入编排页并出现可见“待绑定数据资产”卡片。
- 选择已有合格 Market/Agent Draft；若当前没有，使用现有可见 Copilot UI 创建一个包含 CSV data source 的 Draft，禁止直接 API 创建。
- 通过可见按钮确认绑定，确认新 Draft Version、Dataset version/fingerprint、Validation 与 `runtimeApplied=false` 可见。

### B. 恢复与继续对话

- 记录非敏感的 Draft version 标识和截断 fingerprint 是否存在。
- 刷新后确认绑定仍存在，version/fingerprint 稳定，没有多创建版本。
- 切换到另一历史会话再返回，绑定状态仍正确。
- 使用可见 Composer 发送一次无 Runtime 副作用的修改，确认没有 Draft Reference conflict，且新 Turn 继续基于绑定后的 Draft。

### C. 英文 820×760 与安全状态

- 切换 English 和 820×760，确认无横向滚动、无遮挡、绑定详情及操作状态可读。
- 全程确认没有启动 Paper Run；页面保持 `runtimeApplied=false`、Paper Only、Exchange writes OFF。

### D. Console 与 Network

- 清空 Chrome Console 后刷新并完成一次绑定，确认没有 TradeBot 页面 error；浏览器扩展自身错误必须与产品错误区分。
- 在真实 Chrome Network 能力可用时，确认资产 GET、Draft read/recovery、Binding POST 和后续 Copilot POST 无意外 401/5xx；最终只记录非敏感 `method path status`。
- 确认 Data Assets GET 与 Binding POST 数量有界，不因 DOM mutation 重复增长。
- 若当前 Agent Chrome 控制能力确实无法读取 Network，不得用 API、日志或其他浏览器替代，也不得报告 PASS；保留已完成证据并将本 Loop 维持 `IN_PROGRESS`。

## 文档收敛与里程碑推进

仅当实现、自动化和 Agent Chrome 必验项全部通过：

1. 将 LOOP-012、M2 标为 `COMPLETE`，记录真实测试数量和浏览器证据。
2. 收敛 `product-optimization-plan-and-progress.md`、`product-roadmap-and-progress.md`、`project-status-and-handoff.md` 中已过期的 M2 当前态，同时保留 LOOP-005～011 的历史 PARTIAL 事实。
3. 创建唯一编号 `LOOP-013`（M3 实验场 V1），明确“浏览器要求：实现后必需；只接受 Agent 浏览器验证”。
4. 更新 `docs/next-loop-prompt.md` 指向 LOOP-013。

如果实现已完成但 Chrome/Network 未全部取得证据：准确记录 `IN_PROGRESS`，不要进入 M3；下一轮仍使用新的唯一编号，不得覆盖本文件。

## 自动化与 Git

- 最终运行：`npm run check`、`npm run test:ts`、`npm run build:web`、`git diff --check`。
- 任何代码或文档修改均必须创建范围明确的 commit 并 push 当前分支到 `origin`，即使本 Loop 仍为 `IN_PROGRESS`。
- 提交前检查 staged diff；不得包含运行时数据、数据库、Token、Secret、环境凭据或浏览器产物。
- push 后验证远端 branch ref 等于本地 HEAD。
- 不创建 PR，除非用户明确要求。

## 最终报告格式

```text
Loop ID：LOOP-012
验收模式：IMPLEMENTATION_AND_AGENT_CHROME_VERIFIED / IN_PROGRESS
浏览器要求：实现后必需；Agent 已使用真实 Chrome / Chrome 控制未完成
CSV intent 消费者：PASS / FAIL
Binding UI：PASS / FAIL
Draft Authority 与刷新恢复：PASS / FAIL
中文 1440×900：PASS / NOT VERIFIED
英文 820×760：PASS / NOT VERIFIED
CSV 正向 UI 绑定：PASS / NOT VERIFIED
继续对话无冲突：PASS / NOT VERIFIED
负向 fail-closed：PASS / FAIL
Console / Network：PASS / NOT VERIFIED
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false / NOT VERIFIED
自动化：check；test:ts x/x；build:web；diff-check
M2：COMPLETE / IN_PROGRESS
下一 Loop：唯一编号及所属里程碑 / 未生成
Git：commit <hash>；branch <name>；push PASS / FAIL；未创建 PR
```
