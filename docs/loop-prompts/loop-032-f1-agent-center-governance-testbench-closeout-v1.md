# LOOP-032 — F1 Agent 中心治理、测试台与收尾 V1

```text
Loop ID：LOOP-032
里程碑：F1 Agent Center V1
执行模式：IMPLEMENT_AND_AGENT_CHROME_VERIFY
浏览器要求：实现完成后必需；只能由 Agent 直接操作真实 Chrome，禁止用户手工代验
安全边界：Paper Only / runtimeApplied=false / exchangeWriteAllowed=false / no Runtime Apply
Git：任何代码或文档修改都必须 commit 并 push；不创建 PR
```

## 1. 当前事实与本轮边界

LOOP-030/031 已经完成真实 SQLite、Bearer actor-scoped 的 `AgentDefinition` / immutable `AgentVersion` 基础，Input/Analysis v1 创建、精确 parent `versionId + fingerprint` 的 v2、持久幂等、版本历史、cursor 隔离和重启恢复。Web 已经以服务端版本和 fingerprint 为 authority。

本轮只关闭 F1 的剩余能力：版本 Diff、校验/发布/克隆/归档治理、真实但严格受限的 Agent 测试台、四类 Agent 的真实边界，以及测试进程的 SQLite 资源释放。不要进入 F2 连接配置、F3 LLM 动态 DAG、F4 回测、F5 Simulation 或 M6 Live。

开始前必须：

1. 阅读 `PRODUCT.md`、三份规划/进度/交接文档、LOOP-030/031，以及当前 Agent Definition/Version 合同、Repository、API、Web 和测试；
2. 检查 `git status`，保留所有既有用户修改；禁止 `reset`、`checkout`、`clean`；
3. 复用现有 Agent Registry、Configuration Draft、Dataset/Model refs、Bearer actor、统一错误合同和 SQLite 事实；禁止建立第二套平行 Registry、版本库或测试执行体系；
4. 先定位 `npm run test:ts` 不输出终态汇总的异步 SQLite 句柄来源，禁止用 `forceExit`、超时缩短、吞错或减弱断言掩盖资源泄漏。

## 2. F1 完成定义

F1 只有在以下能力都是真实、可持久恢复且通过 Agent Chrome 验收时才可标记 `COMPLETE`：

- 四类目录都来自服务端权威事实；Input、Analysis、Decision、Reflection 均有明确真实能力状态；
- Agent Version 具备不可变历史、服务端 Diff、校验、发布到 Catalog、克隆和可追踪归档；
- 测试台执行的是服务端注册且严格受限的 fixture/adapter，不是假数据按钮，也不触发策略 Runtime；
- 刷新及 Web/API 重启后，状态、版本、fingerprint、治理记录和测试证据保持一致；
- 完整测试命令正常结束并输出终态汇总，不遗留异步 SQLite 句柄；
- 全程不修改账户、订单、成交、M4/M5、Runtime 或交易所写入状态。

如果因现有注册能力确实不能安全完成某一 Agent 类别，必须在 UI 和文档中显示准确的只读/不可用原因，F1 保持 `IN_PROGRESS`，并生成唯一编号 LOOP-033；不得用 Sample、硬编码成功或静态结果关闭 F1。

## 3. 生命周期与治理

在现有 append-only Agent Version 事实之上实现或补齐明确状态机。状态名称可遵循现有领域命名，但语义必须覆盖：

```text
Draft -> Validated -> Published -> Archived
```

要求：

- 校验、发布、归档均记录 append-only 事实和 actor/time/authority；不得 update/delete 历史版本；
- 只有当前精确 `versionId + fingerprint` 且校验通过的版本可以发布；过期 authority、未校验版本、未知 ref 或跨 actor 请求 fail closed；
- Published Version 才能进入服务端 Agent Catalog，Draft/Archived 不可被新的 Strategy 推荐选为可运行组件；
- 归档不能静默破坏既有 Strategy、Experiment、Paper 或 Evidence 引用；已有引用继续可读，新增选择受限；
- Clone 创建新的 `AgentDefinition + v1`，保留来源 lineage，但不共享可变状态、不改写原 Definition；
- 已发布或已归档 Version 不能原地编辑；继续修改只能从允许的精确 parent 创建新 Draft Version；
- 所有命令支持有界、持久幂等；相同 key 不同 payload 必须冲突。

## 4. 服务端版本 Diff

提供两个精确 Version 之间的服务端 Diff，至少覆盖：

- Data source / Dataset 或 upstream Artifact refs；
- Model connection/model refs；
- 用户可编辑 Agent instruction；
- input/output Schema refs；
- tool permission policy 和预算；
- parent、状态和 fingerprint。

Diff 必须来自服务端权威快照，不能信任客户端提交的旧值。只返回允许展示的字段与摘要，不返回完整平台 System Prompt、Secret value、凭证、内部工具实现或任意文件内容。

## 5. 真实且受限的 Agent 测试台

测试台的目标是验证一个不可变 Agent Version 的输入/输出合同，不是运行交易策略。

实现要求：

- 只允许选择服务端注册的测试 fixture、Dataset snapshot 或 upstream Artifact fixture；客户端不能上传任意代码、URL、SQL、路径、工具实现或 Secret；
- 精确绑定 `agentVersionId + fingerprint + fixture/version`，执行前重新解析 Registry refs 和 capability；
- Input Agent 保持 Connector/Normalizer 确定性，LLM 只能对标准化事实做受限解读；Analysis/Decision/Reflection 只能调用已注册 adapter/model capability；
- 输出必须按注册 output Schema 校验，并展示有界、已净化的输入摘要、输出摘要、状态、耗时、模型/调用用量和错误码；
- 测试运行写入独立 append-only Test Run/Evidence，不写 Configuration Draft、Strategy Draft、Paper account、order、fill、position、M4/M5 或 Runtime；
- 超时、Schema 不匹配、未知 fixture/ref、被禁用连接、跨 actor 和重放冲突均 fail closed；
- 若本地没有可安全调用的真实外部模型，使用现有服务端注册 deterministic adapter/fixture 路径并明确标为 `DETERMINISTIC_TEST_ADAPTER`，不得伪装成真实在线模型结果。

## 6. 四类 Agent 与 Web 工作台

保持当前四页产品结构，不新增一级页面。完善 Agent 中心：

- Input / Analysis / Decision / Reflection 四类列表与统一详情结构；
- 详情至少包含 Overview、Data/Upstream、Model、Prompt、Schema、Test、Versions；
- 展示服务端权威 Version 状态、fingerprint、parent、发布/归档状态和引用范围；
- v1/v2 可选择并查看字段级 Diff；
- 提供 Validate、Publish、Clone、Archive 的可见入口，按钮状态与服务端权限/状态机一致；
- 测试台可选择注册 fixture、执行并展示真实 Evidence；刷新后仍可读取；
- 用户可编辑 Prompt 与平台锁定 Policy 边界继续清晰，禁止显示完整平台 Prompt；
- Decision/Reflection 不得只显示无来源 Sample。若其注册 refs 支持，则接入同一真实版本流；若暂不支持，显示服务端返回的明确只读/不可用原因并保持 F1 未完成；
- localStorage 不能成为 Definition、Version、Lifecycle、Diff 或 Test Evidence 的事实源。

## 7. API、安全与负向测试

所有 API 继续使用现有 Bearer actor 身份、严格 request/response schema 和统一错误合同。至少覆盖：

- Definition/Version/Lifecycle/Test Evidence 正向持久化和 SQLite 重启恢复；
- actor、definition、version、category、cursor kind/scope 隔离；
- stale parent/fingerprint、发布未校验版本、重复发布、归档后非法变更、未知 ID/ref、非法状态跳转；
- clone lineage 与独立性；
- Diff 两端精确 authority 和跨 actor 拒绝；
- 测试 fixture/ref、输入/输出 Schema、超时和预算 fail closed；
- 代码、模块、URL、SQL、路径、任意工具、Secret、平台 Prompt、Runtime 参数和交易指令注入拒绝；
- `PUT/PATCH/DELETE` 及未知字段拒绝，不产生部分写入；
- 新增治理和测试事实不会改变任何 Strategy/Deployment/Account/Order/Fill/Shadow 或安全状态。

## 8. SQLite 资源释放与自动化

修复完整测试套件结束后仍保留异步 SQLite 句柄的问题：

- 找到具体未关闭的 Repository/Service/Server 生命周期；
- 为生产与测试提供幂等的显式 close/dispose；
- `after/afterEach` 关闭自己创建的资源，不关闭其他测试或运行实例；
- 不使用 `process.exit()`、runner `forceExit`、降低超时或跳过测试作为修复。

执行并如实记录：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

`npm run test:ts` 必须自然退出并输出最终 PASS/FAIL 汇总；若不能，F1 不得标记 `COMPLETE`。

## 9. Agent Chrome 验收

实现后必须由 Agent 直接操作真实 Chrome，禁止用户手工代验，也禁止用 API、日志、静态 DOM 或内置浏览器代替页面证据：

1. 中文 1440×900：打开四类 Agent，确认无横向滚动、无遮挡；
2. 打开现有 Input v1/v2，验证 history、精确 fingerprint 和服务端 Diff；
3. 对一个 Draft 执行 Validate -> Publish，确认 Catalog 状态真实变化；非法状态操作必须在 UI fail closed；
4. Clone 一个 Agent，确认新 Definition/v1 和来源 lineage；Archive 后确认历史仍可读且不能作为新发布候选；
5. 在测试台选择注册 fixture 并运行，确认真实状态、Schema 校验、耗时/用量与 Evidence；刷新后恢复；
6. 验证 Analysis 的 upstream/model，以及 Decision/Reflection 的真实可用或明确不可用边界；
7. 刷新页面并重启本项目 Web/API，重新验证 Version、Lifecycle、Diff、Catalog 与 Test Evidence；
8. 英文 820×760：无横向溢出、无遮挡、键盘焦点可见；
9. Console 清空后刷新，无 TradeBot 页面 error；Network 能力如可用，只报告 method/path/status，如不可用标记 `TOOL_UNAVAILABLE`，不能伪造；
10. 全程确认 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`，且没有 Paper Run 或交易事实变化。

Chrome 控制不可用时，保留已完成实现和自动化结果，F1 为 `IN_PROGRESS`，生成唯一编号 LOOP-033 并提交推送。

## 10. 文档、完成条件与 Git

- 更新 `docs/product-optimization-plan-and-progress.md`、`docs/product-roadmap-and-progress.md`、`docs/project-status-and-handoff.md`；
- F1 只有在领域、API、真实测试台、测试自然退出和 Chrome 全链均通过后才标记 `COMPLETE`；
- 完成时将 `docs/next-loop-prompt.md` 指向唯一编号的 F2 Prompt；未完成则指向唯一编号 LOOP-033 F1 continuation；禁止复用文件名；
- 禁止提交 Token、Secret、浏览器资料、SQLite 运行数据和 `data/local-paper-workspace*`；
- 本轮任何修改都必须创建范围明确的 commit 并 push 当前 `main`；报告 commit hash、branch、push 状态及是否创建 PR。

## 11. 最终回报模板

```text
Loop ID：LOOP-032
验收模式：IMPLEMENT_AND_AGENT_CHROME_VERIFY
浏览器要求：必需；Agent 是否完成真实 Chrome 验收
Lifecycle / Catalog：PASS / PARTIAL / FAIL
Version Diff：PASS / PARTIAL / FAIL
Clone / Archive：PASS / PARTIAL / FAIL
Agent Test Bench：PASS / PARTIAL / FAIL
四类 Agent 真实性：PASS / PARTIAL / FAIL
SQLite 资源释放：PASS / FAIL
中文 1440×900：PASS / FAIL / NOT VERIFIED
英文 820×760：PASS / FAIL / NOT VERIFIED
Console：PASS / FAIL / TOOL_UNAVAILABLE
Network：PASS / FAIL / TOOL_UNAVAILABLE
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
自动化：check；test:ts（最终汇总）；build:web；diff-check
F1：COMPLETE / IN_PROGRESS
下一 Loop：唯一编号与文件名
Git：commit；branch；push；PR 状态
```
