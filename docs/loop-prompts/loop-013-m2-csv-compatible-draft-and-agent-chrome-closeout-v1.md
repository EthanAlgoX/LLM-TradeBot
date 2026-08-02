# LOOP-013 — M2 CSV-Compatible Draft 创建与 Agent Chrome 收尾

```text
Loop ID：LOOP-013
里程碑：M2 数据中心 V1
状态：READY
前置 Loop：LOOP-012（PARTIAL，Binding UI 已完成，但没有可由 UI 创建的 CSV-backed Draft）
执行环境：本地仓库 + 实现后由 Agent 直接控制真实 Google Chrome
浏览器要求：必需；只接受 Agent Chrome 验证，禁止用户手工验收
验收模式：IMPLEMENTATION_AND_AGENT_CHROME_VERIFIED
```

## 目标

补齐“待绑定 CSV Historical → 通过可见 UI 确定性创建或选择兼容 Market/Agent Draft → 确认 Dataset Binding → 刷新/切换会话恢复 → 继续对话”的最后闭环。当前缺口是服务端没有可由现有 UI 稳定产生的 CSV-backed Draft，不是再次重复点击验收。先修复能力模型和可见创建路径，再由 Agent 直接操作真实 Chrome；全部通过后关闭 M2。

## 已确认事实与根因

- LOOP-012 已实现 `tradebot:orchestration-data-intent` 消费者、待绑定卡片、确认 API、append-only Draft Reference 更新与刷新恢复代码。
- 当前卡片只有在 Conversation 当前 Draft 为 Market/Agent 且 `selected.dataSourceIds` 含 `data-source:csv-historical` 时才允许绑定。
- Current Crypto Copilot recipe 默认使用 `CURRENT_CRYPTO_PIPELINE_GRAPH.dataSourceRefs`，当前注册 Graph 的 data-source set 是 Binance Public。
- Copilot 虽能从消息提取显式 `data-source:csv-historical`，但 `OrchestrationIntentCompiler` 会用 `exactSet` 拒绝与注册 Graph 不一致的 source set；不得移除、放宽或绕过这项校验。
- 因而本轮必须提供真实、服务端注册、能力与 Graph 一致的 CSV-compatible Draft 创建路径；不能靠特定历史 workspace、直接改 SQLite、隐藏 API 脚本或伪造前端状态完成验收。

## 强制边界

- 保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。
- 本轮只能创建 Draft/不可变 Draft Version 和 Dataset Binding；不得 Apply Runtime、启动 Paper Run、下单或触发交易所写入。
- 保持 Draft Authority 对完整 `draftId + versionId + fingerprint` 的严格比较，保持 actor isolation、append-only、Graph/data-source exact-set 与 capability validation。
- 禁止把 CSV source 塞进只支持 Binance 的 Graph；禁止用类型断言、客户端自称兼容或放宽 Validation 冒充支持。
- 禁止直接修改或清空 `data/local-paper-workspace*`、SQLite、浏览器资料、Token 或凭据来制造前置条件。
- 禁止要求用户点击、截图、打开 DevTools 或口头报告；Chrome 不可控或证据不足时保持 `IN_PROGRESS`。
- 保留用户既有修改；禁止 `reset`、`checkout`、`clean` 或回退无关改动。

## 第一阶段：实现真实 CSV-Compatible Draft 能力

### 1. 选择最小且语义真实的服务端模型

先审计现有 CSV Historical Graph、Preset、Capability Manifest、Configuration Draft 与 Copilot recipe。优先复用已经存在且与注册 CSV Dataset 的市场、窗口、schema 和 lineage 相符的历史 CSV Graph；只有现有资产不能表达时才增加最小的新注册定义。

推荐方向是增加独立的 CSV Historical Draft preset/recipe/Graph binding，而不是改变 Current Crypto live Graph：

- data-source set 必须精确包含实际支持的 `data-source:csv-historical`；
- observation windows 必须与 CSV capability 的原生窗口和 Graph 请求一致；
- Market Pack、Agent Template、schema refs 与 Graph 节点必须全部在服务端注册并可验证；
- 产生的 Conversation `selected.draftReference` 必须指向 actor-owned `market` 或 `agent` Configuration Draft，而不是不可绑定的 `strategy` Draft；
- payload 的 `dataSourceIds` 必须包含 CSV source，且初始 `dataBindings` 可以为空，等待用户确认绑定；
- Validation 若无法真实通过，应清晰 fail closed，不得返回虚假 `proposal`。

如果选择新增窄用途“准备兼容 Draft”服务合同，也必须复用同一注册表、配置服务、验证与 Conversation Draft Authority，并证明它不是绕过 Copilot/Graph 合同的后门。不要同时实现两套互相竞争的创建路径。

### 2. 在待绑定卡片提供确定性可见入口

当当前会话没有兼容 Draft 时，卡片不能只显示不可操作原因；增加中英文明确操作，例如“创建 CSV 兼容 Draft / Create CSV-compatible Draft”。

- 点击后通过正式受认证的编排路径创建 Draft，不能要求用户输入隐藏 ID 或背诵 prompt。
- UI 请求必须携带/派生当前 pending intent 的非敏感服务端引用，并由服务端重新校验，不信任客户端显示文本。
- 创建进行中、成功、validation failure、readonly、conflict 与网络失败状态必须可见；重复点击有界且幂等。
- 创建成功后，待绑定 intent 不得丢失，卡片应自动切换为可确认状态并显示目标 Draft version。
- 不允许创建后自动静默绑定；“创建兼容 Draft”和“确认 Dataset Binding”是两个清晰动作。
- 若当前会话已有兼容 Draft，直接复用，不重复创建。
- 切换会话时 pending intent、目标 Draft 和成功结果不能串会话；过期异步响应不能覆盖新会话状态。

### 3. 完成 Binding、Authority 与恢复一致性

- 确认绑定仍调用受认证的 `POST /api/orchestration/data-center/bindings`，提交完整 parent `draftId/versionId/fingerprint`、Dataset version/fingerprint/capability 和稳定 idempotency key。
- 成功后只创建一个新不可变 Draft Version，并 append-only 更新同一 actor/conversation 的权威 Draft Reference。
- 刷新、切换到另一会话再返回后，从服务端恢复相同 Dataset binding、version 与 fingerprint，不依赖一次性 CustomEvent 或仅内存中的 `bindingResult`。
- 后续 Composer 消息必须基于绑定后的权威 Draft；不得出现 `COPILOT_CONVERSATION_DRAFT_REFERENCE_CONFLICT`。
- 对过期 parent、跨 actor、错误 source/capability、非法 Dataset、重复请求和损坏 replay 一律 fail closed，且无 Draft/Tool/Runtime 副作用。

## 第二阶段：自动化验证

至少补足以下行为级覆盖；测试必须验证行为和持久化事实，不只匹配文案：

1. CSV-compatible preset/Graph/recipe 的 source set、window、Market Pack 与 capability 完整注册且严格匹配。
2. 通过正式创建路径产生 actor-owned Market/Agent Draft，payload 含 CSV source，Validation 结果真实，`runtimeApplied=false`。
3. 不兼容 Graph + CSV source 继续被 exact-set 校验拒绝，未放宽既有边界。
4. 无兼容 Draft 时 UI 状态能触发一次创建；重复点击/重挂载/重试不重复创建，成功后 pending intent 仍在且绑定按钮可用。
5. 创建后确认绑定只产生一个新不可变版本；同一 idempotency key 重试返回同一结果。
6. 刷新和会话往返恢复绑定后的 Draft Reference 与 Dataset version/fingerprint；继续 Copilot 消息无 Authority conflict。
7. 两个 actor、两个 conversation、陈旧 parent、错误 capability/source、未认证和损坏 replay fail closed。
8. 全链路没有 Runtime Apply、Paper Run、订单或 exchange write；不重新引入 render/load loop 或请求风暴。

若实现暴露 LOOP-012 的 append-only/idempotency 缺陷，应在本轮修正并增加回归测试，不得只修改验收脚本。

## 第三阶段：Agent Chrome 完整验收（实现后必需）

只能由 Agent 直接控制真实 Google Chrome。先确认单一正确的 `npm run dev:paper` 链路；代码变更后应使用加载新代码的服务进程，但不得删除或篡改 workspace 数据。已有正确进程占用端口时先只读识别，避免误杀无关进程。

### A. 中文 1440×900：创建与绑定

1. 打开 `http://127.0.0.1:5174/#data-center`，确认页面稳定、无横向滚动、无遮挡。
2. 确认 Binance Public 为 public capability、无登记实时 Snapshot、`unavailable`；CSV Historical 的 Snapshot、Schema、Quality、Lineage、version/fingerprint 可见。
3. 点击 CSV Historical“送入编排”，确认出现待绑定卡片。
4. 在没有兼容 Draft 的情况下，通过卡片可见按钮创建 CSV-compatible Draft；不得使用地址栏脚本、Console、直接 API 或数据库准备。
5. 确认创建结果指向 Market/Agent Draft、Data Source 显示 CSV Historical、Validation 真实可见，待绑定卡片仍保留且确认按钮可用。
6. 点击确认绑定，确认新 Draft version、Dataset version/fingerprint、Validation 和 `runtimeApplied=false` 可见；确认没有自动启动 Paper Run。

### B. 刷新、会话隔离与继续对话

1. 记录非敏感的 version 标识与截断 fingerprint 是否可见，不记录任何 Token/value。
2. 刷新页面，确认同一绑定从服务端恢复，version/fingerprint 稳定且没有多创建版本。
3. 切换到另一历史会话再返回，确认状态不串会话且绑定仍恢复。
4. 在可见 Composer 中提交一次允许的 Draft 字段修改，确认生成后续不可变版本、保留 Dataset binding，且没有 Draft Reference conflict。
5. 再次刷新，确认最新权威 Draft 与绑定仍一致。

### C. 英文 820×760 与负向路径

- 切换 English、820×760，确认无横向滚动、无遮挡；创建、绑定、安全提示和错误状态文案可读。
- 通过可见 UI 验证至少一个安全负向状态（例如无兼容 Draft 时确认禁用、重复确认不重复创建，或陈旧状态被明确拒绝），不得直接构造恶意请求。
- 全程保持 `runtimeApplied=false`、Paper Only、Exchange writes OFF。

### D. Console 与 Network

- 清空真实 Chrome Console 后刷新并完成创建、绑定和继续对话，确认无 TradeBot 页面 error；浏览器扩展自身消息错误必须与产品错误区分。
- 仅在 Agent Chrome 确实提供 Network 读取能力时，记录非敏感 `method path status`：资产 GET、Copilot/Draft 创建、Binding POST、Conversation/Turn 恢复和后续 Copilot POST 均无意外 401/5xx。
- 请求数量必须有界，无 DOM mutation 导致的 GET/POST 风暴。
- 不得读取、复制或报告 Authorization、Cookie/Storage value、请求 body 或响应正文。
- 若 Agent Chrome 无法读取 Network，不得用 API、服务日志、Playwright、内置浏览器或人工交接替代，也不得报告 PASS；保留其他已完成证据并将 M2 维持 `IN_PROGRESS`。

## 关闭规则与下一 Loop

只有实现、自动化和所有 Agent Chrome 必验项全部通过时：

1. 将 LOOP-013 和 M2 标为 `COMPLETE`，准确记录测试数量和浏览器证据。
2. 更新 `product-optimization-plan-and-progress.md`、`product-roadmap-and-progress.md`、`project-status-and-handoff.md`，保留 LOOP-005～012 的历史 PARTIAL 事实。
3. 创建唯一编号 LOOP-014（M3 实验场 V1），明确浏览器要求。
4. 更新 `docs/next-loop-prompt.md` 指向 LOOP-014。

若任何实现或浏览器项未通过：LOOP-013 标为 `PARTIAL`/`IN_PROGRESS`，M2 保持 `IN_PROGRESS`；创建新的唯一编号 LOOP-014 继续 M2，不得覆盖本文件或提前进入 M3。

## 自动化与 Git

- 最终运行：`npm run check`、`npm run test:ts`、`npm run build:web`、`git diff --check`。
- 任何代码或文档修改都必须创建范围明确的 commit 并 push 当前分支到 `origin`，即使 M2 仍未关闭。
- 提交前检查 staged diff；禁止提交 `data/local-paper-workspace*`、SQLite、Token、Secret、环境凭据或浏览器产物。
- push 后验证远端 branch ref 与本地 HEAD 一致。
- 不创建 PR，除非用户明确要求。

## 最终报告格式

```text
Loop ID：LOOP-013
验收模式：IMPLEMENTATION_AND_AGENT_CHROME_VERIFIED / IN_PROGRESS
浏览器要求：必需；Agent 已使用真实 Chrome / Chrome 控制未完成
CSV-compatible Draft 能力：PASS / FAIL
可见 Draft 创建入口：PASS / FAIL
CSV 正向 UI 绑定：PASS / NOT VERIFIED
Draft Authority 与刷新恢复：PASS / NOT VERIFIED
继续对话无冲突：PASS / NOT VERIFIED
中文 1440×900：PASS / NOT VERIFIED
英文 820×760：PASS / NOT VERIFIED
负向 fail-closed：PASS / FAIL
Console：PASS / NOT VERIFIED
Network：PASS / NOT VERIFIED（仅 method/path/status）
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false / NOT VERIFIED
自动化：check；test:ts x/x；build:web；diff-check
M2：COMPLETE / IN_PROGRESS
下一 Loop：唯一编号及所属里程碑 / 未生成
Git：commit <hash>；branch <name>；push PASS / FAIL；未创建 PR
```
