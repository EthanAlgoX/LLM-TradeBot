# LOOP-016 — M2 CSV Binding UI 合同与 Agent Chrome 最终收尾

```text
Loop ID：LOOP-016
里程碑：M2 数据中心 V1
状态：READY
前置 Loop：LOOP-015（IN_PROGRESS，Composer 服务端链路已修复；Chrome Binding 返回 REQUEST_CONTRACT_INVALID）
执行环境：本地仓库 + 实现后由 Agent 直接控制真实 Google Chrome
浏览器要求：实现后必需；禁止用户手工验收或 DevTools 交接
验收模式：CONTRACT_FIX_AND_AGENT_CHROME_VERIFIED
```

## 目标

修复真实 Chrome 中通过可见 UI 确认 CSV Dataset Binding 时返回的 `REQUEST_CONTRACT_INVALID`，然后完整重验：

`CSV 资产 → 送入编排 → CSV-compatible Draft → Binding → 刷新/重启恢复 → Composer 允许字段修改 → 新版本继续保留 binding`

本轮应关闭前端 payload 与服务端严格 Schema 的真实合同断点，而不是放宽校验或只改错误提示。全部产品行为、自动化和 Agent Chrome 验收通过后关闭 M2，进入 M3。

## 已确认基线

- 当前基线提交：`0ca86b7c2a2c1de70c2891cec6a832d3bbb0119f`，已推送 `origin/main`。
- LOOP-015 已修复：
  - CSV Historical Agent Template 允许 `confidenceThreshold`；
  - 域错误不再错误包装为 `INTERNAL_ORCHESTRATION_ERROR`；
  - recipe/preset/Graph 按权威 Agent Draft 的模板、Market Pack 与 exact source set 唯一选择；
  - 重启后从持久化 replay 恢复 Configuration → Pipeline mapping。
- 自动化基线：333/333 PASS；绑定后 Composer 的 Authority、CSV binding 保留及重启恢复在自动化中通过。
- Agent Chrome 当前看到中文页面和 CSV 资产，但可见确认 Binding 返回 `REQUEST_CONTRACT_INVALID`；因此上述 Composer 修复尚未取得 Chrome 端到端证据。
- Console 产品 error 为 0；仅有浏览器扩展异步消息错误。Network 能力为 `TOOL_UNAVAILABLE`。
- Runtime 安全基线：`runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

## 强制边界

- 禁止要求用户点击、截图、打开 DevTools、查看 Network/Storage 或口头验收。必须由 Agent 直接控制真实 Google Chrome。
- API、HTTP 测试、服务日志与 Schema 调试仅用于诊断和自动化，不得替代 Chrome UI 功能验收。
- 不得读取、复制或报告 Authorization、Token、Cookie/Storage value、请求体或响应正文。
- 禁止把 `.strict()` 改为 passthrough、提高边界掩盖错误、移除 fingerprint/capability/Authority 字段，或在服务端静默丢弃非法字段。
- 保持完整 `draftId + versionId + fingerprint` Authority、actor/conversation isolation、append-only、Dataset capability/fingerprint、Graph/source exact-set 与 fail-closed。
- 禁止直接编辑/清空 `data/local-paper-workspace*`、SQLite 或浏览器资料制造成功状态。
- 不得 Apply Runtime、启动 Paper Run、下单或增加交易所写能力。
- 保留用户既有修改；禁止 `reset`、`checkout`、`clean` 或回退无关改动。

## 第一阶段：精确定位合同失败字段

1. 只读确认 Git 状态、HEAD 与 `origin/main`，阅读 LOOP-015 结果及 `0ca86b7` 实际 diff。
2. 对比三处事实：
   - Data Center 资产生成的 pending intent；
   - `confirmBinding()` 实际构造的 JSON；
   - 服务端 `BindingRequest` 严格 Schema。
3. 用共享 Schema `safeParse` 或正式 HTTP 行为测试重放与真实 UI 等价的 payload，记录非敏感的失败字段名、规则与长度，不记录 token 或完整敏感 payload。
4. 优先验证高概率根因：Web 当前使用 ``ui.${draft.versionId}.${intent.fingerprint}`` 生成 `idempotencyKey`，服务端限制 `.min(8).max(160)`；必须计算真实值长度并证明是否越界。仍需检查所有字段，不能只凭该假设修改。
5. 检查是否存在第二个合同漂移：fingerprint 格式、conversationId 长度、mode、version、capabilityId、额外字段、`undefined` 序列化及前端恢复后的 Draft Reference。
6. 在代码修改前写出明确根因，确认 400 发生前没有创建 Configuration Version、Conversation Turn、Tool/Runtime 或其他持久化副作用。

## 第二阶段：共享合同与最小修复

### 1. 消除前后端合同漂移

- 将 Dataset Binding request 的严格 Zod Schema 和 TypeScript 类型放入合适的共享 contracts 模块，并由 HTTP handler 直接使用该 Schema。
- Web 构造 payload 时使用共享类型或窄化 helper；不要继续维护一份与服务端分离的手写接口。
- Schema 保持 strict；只导出安全、业务必要字段，不把 actor、Runtime、Validation 结果或服务端事实交给客户端填写。
- 若共享现有模块会造成循环依赖，应选择最小无环位置，不为本轮重构整个 Data Center。

### 2. 修复有界幂等键

如果确认是 `idempotencyKey` 超长：

- 改为长度明确小于合同上限的稳定 opaque key；不能把完整 Draft ID、Dataset fingerprint 或其他无限/长输入直接拼接。
- 同一次可见 Binding 动作的重复点击、响应丢失后的安全重试和组件重挂载必须复用同一 key；成功后或切换到不同 conversation/draft/dataset 时才轮换。
- key 只能表达幂等身份，不能承载 Token、路径、请求正文或其他敏感数据。
- 不要仅把服务端上限调大；除非现有正式 ID 合同确实证明 160 本身不合理，并补充全局边界分析。

### 3. 错误与状态

- 合同错误继续稳定返回 400 `REQUEST_CONTRACT_INVALID`，且无副作用；测试可断言安全 issue path，但生产响应不得泄露 Zod 原始对象或敏感值。
- UI 合同本身正确时，确认 Binding 应进入明确 loading/success 状态；失败后按钮可安全重试，pending intent 和 Composer 状态不丢失。
- 绑定成功只能创建一个不可变 Draft Version，并 append-only 更新同一 actor/conversation 的权威 Draft Reference。
- 刷新、服务重启和会话切换后从服务端恢复，不依赖 CustomEvent 或仅内存结果。

## 第三阶段：行为级自动化

至少覆盖：

1. 使用与 Web helper 相同的真实 payload 通过共享 Binding Schema 和正式 HTTP handler，返回 201、`runtimeApplied=false`。
2. 真实最大长度 Draft/conversation/Dataset 标识下，生成的 idempotency key 仍满足边界且不泄露原始 fingerprint。
3. 同一 Binding 动作重试/重复点击只产生一个 Version/Turn；不同 conversation、Draft 或 Dataset 产生不同 key，不串 actor。
4. 旧的超长 key、额外字段、畸形 fingerprint、错误 mode、陈旧 parent、错误 capability/source 和未认证请求 fail closed，且无任何 Draft/Turn/Runtime 副作用。
5. 正式 CSV Draft → Binding → Replay/重启 → `confidenceThreshold=0.72` Composer 更新成功；更新版本完整保留 Dataset binding、CSV recipe/preset/Graph 与 exact source set。
6. 服务重启后 Authority 指向最新更新版本，刷新和会话往返不重复 Binding 或 Draft。
7. 全链路无 Runtime Apply、Paper Run、订单或 exchange write；不重新引入 render/load loop。

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

1. Agent 在真实 Chrome 打开 `http://127.0.0.1:5174/#data-center`，中文、1440×900；确认页面稳定、无横向滚动、无遮挡。
2. 通过可见 UI 选择 CSV Historical“送入编排”，创建或复用 CSV-compatible Agent Draft。
3. 点击确认 Binding；必须看到成功的新不可变 Draft Version、Dataset version/截断 fingerprint、Validation 与 `runtimeApplied=false`，不得再出现 `REQUEST_CONTRACT_INVALID`。
4. 刷新页面，并在必要时重启本项目 Web/API 后刷新；确认 Binding、Draft version/fingerprint 与权威引用从服务端恢复，未重复创建版本。
5. 在可见 Composer 提交：`修改 Analysis Agent 的 confidenceThreshold，设置为 0.72。`
6. 必须看到新的不可变 Draft Version、字段 Diff、CSV Dataset binding 保留、CSV recipe/Graph 事实一致、无 `INTERNAL_ORCHESTRATION_ERROR` 或 Authority conflict。
7. 再刷新并切换到另一会话后返回，确认最新版本和 binding 恢复且不串会话。

所有前置状态必须通过产品 UI 创建或恢复；禁止 Console、地址栏脚本、直接 API、数据库写入或清空 workspace。

### B. 英文 820×760、负向与性能

- 切换 English、820×760，确认无横向滚动、无遮挡；Binding 成功、Draft Diff、Dataset 信息、安全提示和错误状态可读。
- 通过可见 UI 验证至少一个负向状态，例如非法/不允许字段被稳定拒绝，或重复确认不产生额外版本；禁止用 Console 构造请求。
- 页面切换、刷新和尺寸变化不得触发重复 Binding、重复 Draft、GET/POST 风暴或高 CPU/内存回归。
- 全程保持 `runtimeApplied=false`、Paper Only、Exchange writes OFF。

### C. Console 与 Network

- 清空 Agent Chrome Console 后完成整条链路并刷新；TradeBot 页面 error 为 0。浏览器扩展异步消息错误单独标注，不作为产品错误。
- 若 Agent Chrome 提供 Network 能力，仅记录非敏感 `method path status`，确认 Binding 和 Copilot POST 无意外 401/4xx/5xx，请求数量有界。
- 若 Agent Chrome 仍明确不提供 Network 读取能力，报告 `Network：TOOL_UNAVAILABLE`；禁止人工、Playwright、内置浏览器、curl、日志或数据库替代，不得写 `PASS`。
- 在可见 Chrome 功能链路、Console、自动化、正式 HTTP 行为测试与 Runtime safety 全部通过时，`TOOL_UNAVAILABLE` 不单独阻止 M2 关闭；Chrome 页面控制本身失败仍记 `NOT VERIFIED` 并阻止关闭。

## M2 关闭与下一 Loop

仅当以下全部通过时关闭 M2：

- UI Binding 不再触发合同错误，成功且幂等；
- 绑定后 Composer 修改成功并保留 CSV binding；
- Authority、刷新/服务重启恢复、会话隔离通过；
- 中英文双尺寸、负向、Console、性能和 Runtime safety 通过；
- 自动化全部通过；Network 为 `PASS` 或明确 `TOOL_UNAVAILABLE`。

关闭时：

1. 将 LOOP-015 标为 `PARTIAL`，LOOP-016 与 M2 标为 `COMPLETE`，保留 LOOP-005～015 历史事实。
2. 更新 `product-optimization-plan-and-progress.md`、`product-roadmap-and-progress.md`、`project-status-and-handoff.md`。
3. 创建唯一编号 `LOOP-017`，进入 M3 实验场 V1，并明确浏览器要求。
4. 更新 `docs/next-loop-prompt.md` 指向 LOOP-017。

如任一产品、自动化或 Chrome 可见功能项失败：LOOP-016 与 M2 保持 `IN_PROGRESS`，创建唯一编号 LOOP-017 继续 M2；不得覆盖本文件或要求人工验收。

## Git 要求

- 任何代码或文档修改都必须创建范围明确的 commit 并 push 当前分支到 `origin`，即使 M2 未关闭。
- 提交前检查 staged diff；禁止提交 `data/local-paper-workspace*`、SQLite、Token、Secret、环境凭据或浏览器产物。
- push 后验证远端 branch ref 与本地 HEAD 一致。
- 不创建 PR，除非用户明确要求。

## 最终报告格式

```text
Loop ID：LOOP-016
验收模式：CONTRACT_FIX_AND_AGENT_CHROME_VERIFIED / IN_PROGRESS
浏览器要求：实现后必需；Agent 已使用真实 Chrome / Chrome 控制未完成
Binding 合同根因：<具体字段与规则>
共享 Binding Schema：PASS / FAIL
有界稳定 idempotency key：PASS / FAIL
CSV 正向 UI Binding：PASS / NOT VERIFIED
绑定后 Composer：PASS / NOT VERIFIED
CSV binding 保留：PASS / NOT VERIFIED
Draft Authority 与刷新/重启恢复：PASS / NOT VERIFIED
中文 1440×900：PASS / NOT VERIFIED
英文 820×760：PASS / NOT VERIFIED
负向 fail-closed：PASS / FAIL
Console：PASS / NOT VERIFIED（区分产品与扩展错误）
Network：PASS / TOOL_UNAVAILABLE / NOT VERIFIED（PASS 时仅 method/path/status）
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false / NOT VERIFIED
自动化：check；test:ts x/x；build:web；diff-check
M2：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-017（M3 / M2）
Git：commit <hash>；branch <name>；push PASS / FAIL；未创建 PR
```
