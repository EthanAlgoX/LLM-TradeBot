# LOOP-014 — M2 CSV Binding Authority 与 Agent Chrome 最终收尾

```text
Loop ID：LOOP-014
里程碑：M2 数据中心 V1
状态：READY
前置 Loop：LOOP-013（PARTIAL，CSV-compatible Draft 与可见创建入口已完成，绑定成功态及恢复尚未验证）
执行环境：本地仓库 + Agent 直接控制真实 Google Chrome
浏览器要求：必需；禁止任何用户手工验收或 DevTools 交接
验收模式：DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFIED
```

## 目标

基于 LOOP-013 已提交的真实 CSV Historical Preset/Graph、严格 source-set 校验和可见 Draft 创建入口，完成唯一剩余闭环：

`送入编排 → 创建/复用 CSV-compatible Agent Draft → 确认 Dataset Binding → 新不可变 Draft Version → 服务端权威引用 → 刷新/会话切换恢复 → 继续对话`

不要重新设计数据中心，也不要重复实现已通过的 CSV Draft 能力。先确定 LOOP-013 中点击“确认启用”后为何没有取得可恢复成功态；若存在产品缺陷，做最小行为级修复并补测试。随后必须由 Agent 直接操作真实 Chrome 完成中英文、双尺寸、Console/Network 与 Runtime safety 收尾。全部通过后才能关闭 M2。

## 已确认基线

- `b7d9fa65a5a9a3220685a5003592a3940c5797ad` 已推送到 `origin/main`。
- CSV Historical 已有独立、服务端注册的 Preset/Graph；Binance Graph 与 CSV Graph 保持 exact-set 隔离。
- 待绑定卡片已有可见 CSV-compatible Draft 创建入口，真实 Chrome 已确认能创建真实 Draft，并使确认绑定动作可用。
- 自动化基线为 331/331 PASS；负向 fail-closed 已通过。
- LOOP-013 尚未证明：Binding 成功响应、Conversation 权威 Draft Reference 更新、刷新/会话往返恢复、继续对话、英文 820×760、产品 Console 和可读取的 Network 证据。
- 安全基线必须始终为 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

## 强制边界

- 禁止要求用户点击、截图、打开 DevTools、读取 Storage 或口头报告 PASS/FAIL。验收只能由 Agent 直接控制真实 Google Chrome。
- 禁止以 Playwright、内置浏览器、curl/API、服务日志、数据库查询或自动化测试替代 Chrome UI 证据。它们可以用于定位根因，但不能据此把浏览器项标为 PASS。
- 不得读取、复制或报告 Authorization、Token、Cookie/Storage value、请求体或响应正文；Network 最多记录非敏感 `method path status`。
- 禁止放宽 Graph/data-source exact-set、Dataset capability、Draft Authority、actor isolation、append-only 或 fail-closed 校验。
- 禁止直接编辑/清空 `data/local-paper-workspace*`、SQLite 或浏览器资料制造成功条件。
- 本轮只允许 Draft 与 Dataset Binding 变更；不得 Apply Runtime、启动 Paper Run、下单或增加交易所写能力。
- 保留用户既有修改；禁止 `reset`、`checkout`、`clean` 或回退无关改动。

## 第一阶段：复现并定位 Binding 断点

1. 只读确认 Git 状态、当前分支和 `origin/main`；阅读 LOOP-012/013、相关进度文档及 `b7d9fa6` 的实际 diff，不凭摘要猜测。
2. 审计完整链路：
   - Data Center intent payload；
   - Strategy Workspace pending intent 与创建成功后的 target Draft Reference；
   - `POST /api/orchestration/data-center/bindings` 的请求合同；
   - actor/conversation ownership、parent `draftId + versionId + fingerprint`；
   - Dataset `version + fingerprint + capability`；
   - idempotency key；
   - append-only Draft Version 与 Conversation Draft Reference 更新；
   - Web 成功态、错误态及刷新恢复读取模型。
3. 使用正式测试或受控本地服务复现点击确认后的服务端行为。诊断时应明确属于以下哪类：
   - 实际成功，仅 LOOP-013 的 Chrome 会话未完成观察；
   - 请求合同/路由/认证错误；
   - parent Authority 在创建 Draft 后变陈旧；
   - Dataset capability/source/version/fingerprint 不匹配；
   - Binding 已写入但 Conversation Draft Reference 或 Web 恢复投影缺失；
   - UI 异步竞态、重复请求、离页/刷新取消或错误状态不可见。
4. 不得用测试夹具或直接存储写入绕过正式服务路径。若产品链路确实正确，不为制造代码改动而重构。

## 第二阶段：必要的最小修复与自动化

若发现缺陷，修复必须保持以下行为：

- 点击确认只通过受认证的正式 Binding API；请求携带当前 actor/conversation 的完整 parent Draft Authority 与登记 Dataset 引用。
- 一次成功只产生一个新不可变 Draft Version，并 append-only 更新同一 Conversation 的权威 Draft Reference。
- 同一 idempotency key 重试返回相同结果；重复点击、重挂载或网络重试不得产生额外版本。
- 成功态必须显示新的 Draft version、CSV Dataset version/截断 fingerprint、Validation 与 `runtimeApplied=false`；失败态必须明确可见且可安全重试。
- 刷新和会话往返后只能从服务端事实恢复，不能依赖一次性事件、DOM 或仅内存结果。
- 后续 Composer 必须使用最新权威 Draft Reference，保留 Dataset binding，且不触发 `COPILOT_CONVERSATION_DRAFT_REFERENCE_CONFLICT`。
- 过期 parent、跨 actor/conversation、错误 source/capability、非法 Dataset、损坏 replay 与未认证请求继续 fail closed，且无 Draft/Tool/Runtime 副作用。
- 异步响应必须绑定当前 conversation/intent，离页或切换会话后的旧响应不得覆盖新状态；不得重新引入 render/load loop 或请求风暴。

至少覆盖这些行为级测试：

1. 正式 CSV Draft 创建后，Binding 成功生成且只生成一个新版本，并更新 Conversation Draft Reference。
2. 刷新等价的 read model 重建后，Dataset binding、version/fingerprint 与最新 Draft Reference 一致。
3. Binding 后继续一次 Copilot Draft 修改，无 Authority conflict，Dataset binding 不丢失。
4. 重复确认、同 key 重试、页面重挂载幂等；两个 conversation 与两个 actor 不串数据。
5. 陈旧 parent、错误 fingerprint/capability/source、未认证及损坏 replay fail closed。
6. 全链路 `runtimeApplied=false`，无 Paper Run、订单或 exchange write。

实现后运行：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

## 第三阶段：Agent Chrome 必验闭环

使用加载当前代码的单一 `npm run dev:paper` 链路。若端口已占用，先只读识别进程和代码版本；只处理本项目的陈旧进程，不误杀无关进程。不得修改或删除 workspace 数据。

### A. 中文 1440×900 正向链路

1. Agent 在真实 Chrome 打开 `http://127.0.0.1:5174/#data-center`，切换中文并设置 1440×900。
2. 确认无横向滚动、无遮挡；Binance Public 显示 public capability、无登记实时 Snapshot、`unavailable`；CSV Historical 的 Snapshot、Schema、Quality、Lineage、version/fingerprint 可见。
3. 通过可见 UI 点击 CSV Historical“送入编排”。在编排页创建或复用 CSV-compatible Agent Draft，不使用 Console、地址栏脚本、直接 API 或数据库准备。
4. 点击可见的确认绑定动作，必须观察明确成功态：新的不可变 Draft version、CSV Dataset version/fingerprint、Validation、`runtimeApplied=false`。
5. 确认没有自动启动 Paper Run，页面持续显示 Paper Only 与 Exchange writes OFF。

### B. Authority、刷新恢复与继续对话

1. 记录非敏感的 Draft version 标识及截断 fingerprint 是否可见；不得记录敏感值。
2. 刷新页面，确认绑定由服务端恢复，version/fingerprint 稳定，未多创建 Draft Version。
3. 通过可见历史会话 UI 切换到另一会话再返回，确认 pending/result/binding 不串会话，原绑定仍恢复。
4. 在 Composer 通过可见 UI 修改一个允许的 Draft 字段，确认产生后续不可变版本，无 Authority conflict，并保留 CSV Dataset binding。
5. 再刷新一次，确认最新权威 Draft 和绑定一致。

若当前 workspace 没有第二个会话，可通过页面“新建会话”创建；不得直接写数据库。若现有历史状态令前置条件不成立，应通过产品 UI 新建会话完成，不清空 workspace。

### C. 英文 820×760 与负向状态

- 切换 English、820×760，确认无横向滚动、无遮挡，创建/绑定结果、安全提示和错误状态可读。
- 通过可见 UI 验证至少一个负向状态，例如无兼容 Draft 时确认禁用、重复确认不产生新版本，或陈旧状态被明确拒绝；禁止在 Console 构造恶意请求。
- 页面切换、刷新和尺寸变化不得触发重复创建、重复绑定或请求风暴。

### D. Console 与 Network

- 清空真实 Chrome Console 后刷新并完成绑定、会话切换和继续对话；无 TradeBot 页面 error。浏览器扩展自身异步消息错误必须单独标注，不能冒充产品错误。
- 仅当 Agent Chrome 实际提供 Network 读取能力时，记录非敏感 `method path status`，至少覆盖资产 GET、CSV Draft 创建 POST、Binding POST、Conversation/Turn 恢复 GET、后续 Copilot POST；不得出现意外 401/5xx。
- 确认请求数量有界，没有 MutationObserver/render/load 导致的 GET/POST 风暴。
- 如果 Agent Chrome 无法读取 Network，Network 必须写 `NOT VERIFIED`，禁止任何替代证据，M2 保持 `IN_PROGRESS`。

## 文档、关闭规则与下一 Loop

只有实现/自动化及所有 Agent Chrome 必验项全部通过时：

1. 将 LOOP-013 标为 `PARTIAL`，将 LOOP-014 和 M2 标为 `COMPLETE`。
2. 更新 `product-optimization-plan-and-progress.md`、`product-roadmap-and-progress.md`、`project-status-and-handoff.md`，准确记录真实测试数量和 Chrome 证据。
3. 创建唯一编号 `LOOP-015` 进入 M3 实验场 V1，并明确其浏览器要求。
4. 更新 `docs/next-loop-prompt.md` 指向 LOOP-015。

若任一实现或 Chrome 项未通过：

- LOOP-014 标为 `PARTIAL`/`IN_PROGRESS`，M2 保持 `IN_PROGRESS`；
- 更新交接事实并创建唯一编号 `LOOP-015` 继续 M2，不得覆盖本文件或提前进入 M3；
- 不得要求用户做人工验收。

## Git 要求

- 任何代码或文档修改都必须创建范围明确的 commit 并 push 当前分支到 `origin`，即使 M2 未关闭。
- 提交前检查 staged diff，禁止提交 `data/local-paper-workspace*`、SQLite、Token、Secret、环境凭据或浏览器产物。
- push 后验证远端 branch ref 与本地 HEAD 一致。
- 不创建 PR，除非用户明确要求。

## 最终报告格式

```text
Loop ID：LOOP-014
验收模式：DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFIED / IN_PROGRESS
浏览器要求：必需；Agent 已使用真实 Chrome / Chrome 控制未完成
Binding 根因：<简述，若无需代码修复则明确说明>
CSV 正向 UI 绑定：PASS / NOT VERIFIED
Draft Authority 与刷新恢复：PASS / NOT VERIFIED
继续对话无冲突：PASS / NOT VERIFIED
中文 1440×900：PASS / NOT VERIFIED
英文 820×760：PASS / NOT VERIFIED
负向 fail-closed：PASS / FAIL
Console：PASS / NOT VERIFIED（区分产品与扩展错误）
Network：PASS / NOT VERIFIED（仅 method/path/status）
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false / NOT VERIFIED
自动化：check；test:ts x/x；build:web；diff-check
M2：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-015（M3 / M2）
Git：commit <hash>；branch <name>；push PASS / FAIL；未创建 PR
```
