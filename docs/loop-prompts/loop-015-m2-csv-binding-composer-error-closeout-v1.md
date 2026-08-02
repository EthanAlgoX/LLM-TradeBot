# LOOP-015 — M2 CSV Binding 后 Composer 错误与 Agent Chrome 收尾

```text
Loop ID：LOOP-015
里程碑：M2 数据中心 V1
状态：READY
前置 Loop：LOOP-014（PARTIAL，绑定及刷新恢复已通过；继续对话出现 INTERNAL_ORCHESTRATION_ERROR）
执行环境：本地仓库 + Agent 直接控制真实 Google Chrome
浏览器要求：实现后必需；禁止用户手工验收或 DevTools 交接
验收模式：DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFIED
```

## 目标

定位并修复 CSV Dataset Binding 成功、刷新恢复后，通过 Composer 修改允许字段时出现的 `INTERNAL_ORCHESTRATION_ERROR`。修复后必须证明：继续对话生成新的不可变 Agent Draft Version、保留 CSV binding、权威 Draft Reference 同步前进且刷新后可恢复，全程不影响 Runtime。

本轮不重复实现已经通过的 Data Asset、CSV-compatible Draft 创建、Binding 或恢复投影。完成正式服务路径的行为级回归后，由 Agent 直接操作真实 Chrome 完成最后验收；通过后关闭 M2 并进入 M3。

## 已确认基线

- 当前基线提交：`69d785d710f2db2293227137b494a9ba5aa5d999`，已推送 `origin/main`。
- LOOP-014 已由 Agent Chrome 验证：CSV 正向 UI Binding、服务端权威引用、刷新恢复、中文 1440×900、英文 820×760 及负向 fail-closed 均为 `PASS`。
- 恢复读模型现能投影 Dataset version/fingerprint；同毫秒追加的权威 Turn 排序已稳定。
- 唯一已观察到的产品阻塞是：绑定并恢复后提交允许的 Composer 修改，页面返回 `INTERNAL_ORCHESTRATION_ERROR`。
- 自动化基线为 332/332 PASS。
- Console 未见 TradeBot 页面 error；仅见浏览器扩展自身异步消息错误。
- Agent Chrome 当前不提供 Network 面板读取能力；不得伪报 Network PASS，也不得要求人工补验。
- 安全基线：`runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

## 强制边界

- 禁止要求用户点击、截图、打开 DevTools、查看 Network/Storage 或口头报告结果；只允许 Agent 直接控制真实 Google Chrome。
- API、HTTP 测试、服务日志和数据库只可用于诊断及自动化回归，不得替代 Chrome UI 功能验收。
- 禁止读取、复制或输出 Authorization、Token、Cookie/Storage value、请求体或响应正文。
- 保持完整 `draftId + versionId + fingerprint` Authority、actor/conversation isolation、append-only、Dataset capability/fingerprint、Graph/source exact-set 与 fail-closed。
- 不得通过删除 Dataset binding、退回 Binance Graph、放宽 schema/validation 或捕获后伪装成功来消除错误。
- 禁止直接编辑/清空 `data/local-paper-workspace*`、SQLite 或浏览器资料制造前置状态。
- 不得 Apply Runtime、启动 Paper Run、下单或增加交易所写能力。
- 保留用户既有修改；禁止 `reset`、`checkout`、`clean` 或回退无关改动。

## 第一阶段：复现并取得真实根因

1. 只读检查 Git 状态、分支、HEAD 与 `origin/main`，完整阅读 LOOP-014 结果、提交 `69d785d` 的 diff 及相关服务/HTTP/回放代码。
2. 用正式服务调用或行为测试稳定复现以下序列，禁止直接写 repository 伪造最终状态：
   - 创建 CSV-compatible Agent Draft；
   - 通过正式 Data Center Binding 服务绑定登记的 CSV Dataset；
   - 从 Conversation Replay 恢复最新权威 Draft Reference；
   - 提交 `修改 Analysis Agent 的 confidenceThreshold，设置为 0.72。`；
   - 观察实际抛错位置、错误类型和持久化副作用。
3. 必须定位原始异常，不以 HTTP 层的通用 `INTERNAL_ORCHESTRATION_ERROR` 作为根因。重点审计但不限于：
   - 同一 Agent Template 被多个 recipe 使用时，`updateDraft()` 是否错误选择数组中的第一个 Current Crypto recipe，而非与当前 CSV Draft 的 source set/preset/Graph 相符的 recipe；
   - Dataset Binding 生成的新 Configuration Version 是否仍能确定性映射到原 CSV Pipeline Draft/Graph，尤其是刷新或服务重启后；
   - 更新后的 payload 是否原样保留 `dataBindings`、CSV `dataSourceIds`、observation windows 与 Market Pack；
   - Proposal、Validation、capability summary、Graph/schema refs 是否混用了 Binance 与 CSV 注册事实；
   - synthetic Binding Turn 的 tool results/selected context 是否让恢复逻辑取得错误 pipeline mapping；
   - 域错误是否被错误地落入未知异常 500。
4. 在修改前写出一句明确根因，并证明错误发生前后是否产生了孤立 Draft Version、Turn 或其他副作用。

## 第二阶段：最小行为修复

- Recipe/Preset/Graph 选择必须由当前权威 Draft 的服务端事实确定，不能只按 Agent Template 找第一个候选，也不能信任客户端声明。
- 若 Pipeline Draft 映射需要恢复，应从受控持久化事实确定性重建；不得依赖单进程内存或碰巧存在的旧 Tool Result。
- Agent Draft 更新必须以绑定后的最新版本为 parent，只修改允许字段，同时完整保留 CSV `dataBindings`、data sources、windows 和其他未修改配置。
- 成功只产生一个新不可变 Draft Version 和一个对应 Conversation Turn；权威引用更新到新版本，刷新/重启后可恢复。
- 重试和重复提交按既有 idempotency 合同处理，不得制造孤立或重复版本。
- 已知域冲突应返回稳定、非敏感的 4xx 错误码；真正未知异常可保持通用 500，但不得泄露内部信息。
- Web 成功态必须显示最新版本、Dataset binding 与 `runtimeApplied=false`；失败时保留 Composer 内容并显示稳定错误码。
- 不得重新引入 Data Center render/load loop、请求风暴或跨会话异步污染。

## 第三阶段：自动化验收

至少增加以下行为级覆盖：

1. 正式创建 CSV Agent Draft → 正式 Binding → Replay 恢复 → 允许字段更新，全链路成功。
2. 更新后的 payload 只改变目标参数，CSV Dataset `assetId/datasetId/version/fingerprint/capabilityId/mode` 全部保持一致。
3. 更新结果使用 CSV-compatible recipe/preset/Graph；不得回退或混入 Binance Graph/source。
4. Conversation 最新 Authority 指向更新后的完整 reference；刷新等价回读和 SQLite 服务重启后仍一致。
5. 同一 idempotency key 重试不重复创建 Version/Turn；两个 actor、两个 conversation 不串状态。
6. 陈旧 parent、篡改 Dataset fingerprint/capability、错误 source set、未认证及损坏 replay fail closed，且无副作用。
7. 整条链路 `runtimeApplied=false`，无 Paper Run、订单或 exchange write。
8. HTTP 层不再将该合法更新返回为 `INTERNAL_ORCHESTRATION_ERROR`。

最终运行：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

## 第四阶段：Agent Chrome 必验

使用包含当前修改的单一 `npm run dev:paper` 链路。端口占用时先只读识别，只处理本项目陈旧进程，不误杀无关进程；不得删除 workspace 数据。

### A. 中文 1440×900 完整链路

1. Agent 用真实 Chrome 打开 `http://127.0.0.1:5174/#data-center`，中文、1440×900；确认页面稳定、无横向滚动或遮挡。
2. 通过可见 UI 送入 CSV Historical，创建或复用 CSV-compatible Agent Draft，并确认 Dataset Binding。不得用 Console、地址栏脚本、直接 API 或数据库准备。
3. 刷新后确认绑定卡片从服务端恢复，Draft version 与截断 Dataset fingerprint 稳定。
4. 在可见 Composer 提交：`修改 Analysis Agent 的 confidenceThreshold，设置为 0.72。`
5. 必须观察到新的不可变 Draft Version、字段 Diff、Validation、保留的 CSV Dataset binding 与 `runtimeApplied=false`；不得出现 `INTERNAL_ORCHESTRATION_ERROR`、Authority conflict 或 binding 丢失。
6. 再刷新并切换到另一会话后返回，确认最新 Draft/binding 恢复且不串会话、不重复创建版本。

### B. 英文 820×760、负向与性能

- 切换 English、820×760，确认无横向滚动、无遮挡；最新 Draft、Dataset binding、Diff、安全提示与错误状态可读。
- 通过可见 UI 验证至少一个负向状态，如不允许字段被拒绝或重复确认不产生新版本；禁止通过 Console 构造请求。
- 页面切换、刷新和尺寸变化后请求数量与 CPU/内存表现有界，不得重新出现 render/load loop。
- 全程保持 `runtimeApplied=false`、Paper Only、Exchange writes OFF。

### C. Console 与 Network 证据规则

- 清空 Agent Chrome Console 后执行上述流程并刷新；TradeBot 页面 error 必须为 0。浏览器扩展异步消息错误单独标记，不作为产品错误。
- 若 Agent Chrome 提供 Network 读取能力，仅记录非敏感 `method path status`，确认 Draft 创建、Binding、Conversation/Turn GET 与继续对话 POST 无意外 401/5xx，且请求数量有界。
- 若当前 Agent Chrome 明确不提供 Network 读取能力，报告 `Network：TOOL_UNAVAILABLE`。禁止以人工、Playwright、内置浏览器、curl、日志或数据库替代，也不得写 `PASS`。
- `TOOL_UNAVAILABLE` 是宿主工具限制，不再单独阻止 M2 关闭；前提是本轮 Chrome 可见功能链路、Console、自动化、HTTP 行为测试及 Runtime safety 全部通过。若 Chrome 页面控制本身失败，则仍为 `NOT VERIFIED` 并阻止关闭。

## M2 关闭与下一 Loop

满足以下全部条件时关闭 M2：

- 合法的绑定后 Composer 修改在正式服务与 Agent Chrome 中成功；
- CSV binding、最新 Authority、刷新/重启恢复及会话隔离通过；
- 中英文双尺寸、负向状态、Console、性能和 Runtime safety 通过；
- Network 为 `PASS`，或在其他条件全部通过时明确记录为 `TOOL_UNAVAILABLE`；
- 完整自动化通过。

关闭时：

1. 将 LOOP-015 和 M2 标为 `COMPLETE`，保留 LOOP-005～014 的历史 PARTIAL 事实。
2. 更新 `product-optimization-plan-and-progress.md`、`product-roadmap-and-progress.md`、`project-status-and-handoff.md`。
3. 创建唯一编号 `LOOP-016` 进入 M3 实验场 V1，并明确浏览器要求。
4. 更新 `docs/next-loop-prompt.md` 指向 LOOP-016。

如任一产品、自动化或可见 Chrome 功能项失败：LOOP-015 与 M2 保持 `IN_PROGRESS`，创建唯一编号 LOOP-016 继续 M2；不得覆盖本文件或要求人工验收。

## Git 要求

- 任何代码或文档修改都必须创建范围明确的 commit 并 push 当前分支到 `origin`，即使 M2 未关闭。
- 提交前检查 staged diff；禁止提交 `data/local-paper-workspace*`、SQLite、Token、Secret、环境凭据或浏览器产物。
- push 后验证远端 branch ref 与本地 HEAD 一致。
- 不创建 PR，除非用户明确要求。

## 最终报告格式

```text
Loop ID：LOOP-015
验收模式：DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFIED / IN_PROGRESS
浏览器要求：实现后必需；Agent 已使用真实 Chrome / Chrome 控制未完成
Composer 根因：<明确根因>
正式 CSV Binding → Composer 回归：PASS / FAIL
CSV binding 保留：PASS / NOT VERIFIED
Draft Authority 与刷新/重启恢复：PASS / NOT VERIFIED
继续对话无冲突：PASS / NOT VERIFIED
中文 1440×900：PASS / NOT VERIFIED
英文 820×760：PASS / NOT VERIFIED
负向 fail-closed：PASS / FAIL
Console：PASS / NOT VERIFIED（区分产品与扩展错误）
Network：PASS / TOOL_UNAVAILABLE / NOT VERIFIED（PASS 时仅 method/path/status）
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false / NOT VERIFIED
自动化：check；test:ts x/x；build:web；diff-check
M2：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-016（M3 / M2）
Git：commit <hash>；branch <name>；push PASS / FAIL；未创建 PR
```
