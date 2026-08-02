# LOOP-030 — F1 Agent 中心版本化配置 V1

```text
Loop ID：LOOP-030
里程碑：F1 Agent Center V1
执行模式：IMPLEMENT_AND_AGENT_CHROME_VERIFY
浏览器要求：实现后必需；只能由 Agent 直接操作真实 Chrome，禁止用户手工代验
安全边界：Paper Only / no Runtime Apply / exchangeWriteAllowed=false
Git：任何代码或文档修改都必须 commit 并 push；不创建 PR
```

## 1. 开始前

1. 阅读 `PRODUCT.md`、`docs/product-optimization-plan-and-progress.md`、`docs/product-roadmap-and-progress.md`、`docs/project-status-and-handoff.md`。
2. 检查 `git status`，保留所有既有用户修改；禁止 reset、checkout、clean。
3. 检索现有 Agent Template Registry、Configuration Draft、Dataset Binding、Model Provider/Adapter、SQLite Repository、Bearer actor 和 Web Agent Center，优先扩展现有事实，禁止建立第二套平行 Registry/Draft 模型。
4. 本轮不修改 M4/M5 Runtime、账户、订单、成交、Shadow、Live 或 Exchange Write。

## 2. 本轮目标

把当前 Sample Agent Center 改成首个真实、actor-scoped、可重启恢复的 Agent Definition/Version 管理垂直切片。至少覆盖一个 Input Agent 和一个 Analysis Agent 的创建、读取、修改成新版本与刷新恢复。

F1 可以保持 `IN_PROGRESS`；不要为了关闭里程碑一次做完测试台、发布治理和所有 Agent 类型。

## 3. 领域合同

建立或复用严格合同表达：

```text
AgentDefinition
+ immutable AgentVersion
+ category: input | analysis | decision | reflection
+ registered template reference
+ data binding or upstream Artifact Schema refs
+ model connection ref when required
+ editable agent instruction prompt
+ system-owned policy prompt reference
+ input/output Schema refs
+ tool permission policy ref
+ token/call/timeout budget
+ parent version + fingerprint
```

要求：

- Definition 有稳定 ID；Version append-only，不允许 update/delete；
- actor 从 Bearer 身份派生，客户端不能注入 actor/owner/role；
- 修改 Data、Model、Prompt、Schema、预算或上游都必须创建新版本；
- parent `versionId + fingerprint` 不匹配时 fail closed；
- category、Template、Data/Model/Schema/Tool ref 必须从服务端 Registry 解析；
- 客户端不能上传代码、模块、Runner、URL、SQL、文件路径、工具实现、API Key 或完整平台 Prompt；
- System-owned policy、输出 Schema 和 Risk/Execution 权限不可编辑；
- Input Agent 的 Connector/Normalizer 保持确定性，用户 Prompt 只解释标准化事实。

## 4. Repository 与 API

实现 actor-scoped、append-only、SQLite 持久化和重启恢复；列表/版本历史使用有界版本化 opaque cursor，绑定 actor、kind 和查询 scope。

API 使用现有 Orchestration Bearer 身份与统一响应/错误合同，至少支持：

- Agent Definition 列表；
- 单个 Definition 与最新权威 Version；
- Version 历史；
- 创建 Definition + v1 Draft；
- 从精确 parent 创建新 Draft Version。

非法 ID、未知 ref、跨 actor、损坏记录、超限分页、未知字段、PUT/PATCH/DELETE 和幂等键冲突均 fail closed，不产生部分写入。

## 5. Web Agent 中心

保持四页导航和当前视觉语言。将 Sample Catalog 替换或明确分区为真实服务端 Agent：

- Input / Analysis / Decision / Reflection 四类；
- 列表显示名称、类别、版本、状态、数据/上游、模型和引用状态；
- 详情至少提供：概览、数据或上游、模型、System Prompt、Schema、版本历史；测试台可在本轮显示明确 `PLANNED`，不得伪造执行；
- Prompt 编辑器必须同时显示“用户可编辑行为层”和“平台规则锁定”边界；不能读取或显示完整平台 Prompt；
- 创建和保存新版本后，UI 立即以服务端回读的 `versionId + fingerprint` 为 authority；
- 刷新后恢复相同 Definition 与最新 Version；localStorage 不能成为版本事实源；
- Decision/Reflection 若本轮尚未开放写入，应明确只读或 Planned，不使用假成功按钮。

## 6. 自动化验收

至少覆盖：

- 严格 Schema 和未知字段拒绝；
- Input/Analysis 正向创建与新版本；
- Prompt/Data/Model/Schema/ref 漂移与 parent conflict；
- actor 隔离、cursor scope、幂等、append-only；
- SQLite 文件重启恢复；
- 平台 Prompt、Secret、工具/代码/URL/SQL/path/Runtime 注入拒绝；
- 新版本不修改任何运行中 Strategy、M4/M5 facts 或交易安全状态。

执行并如实记录：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

## 7. Agent Chrome 验收

实现后直接使用真实 Chrome：

1. 中文 1440×900：四类目录、真实/Planned 边界、无横向溢出；
2. 创建一个 Input Agent v1，绑定可用的已注册数据引用，编辑用户 Prompt；
3. 基于精确 parent 创建 v2，确认 v1 不变、版本和 fingerprint 可见；
4. 创建或读取一个 Analysis Agent，确认上游 Artifact 与 Model ref 可见；
5. 刷新页面以及重启本项目 Web/API 后恢复 Definition、v1/v2 和最新 authority；
6. 英文 820×760：无横向溢出、无遮挡、键盘焦点可见；
7. Console 无 TradeBot 页面 error；如 Network 能力可用，只报告 method/path/status；
8. 全程确认 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

若 Chrome 控制不可用，不得用用户手工、API、日志或静态 DOM 代替；F1 保持 `IN_PROGRESS`，但已完成代码仍须提交推送并生成新的唯一编号 continuation Prompt。

## 8. 文档与 Git

- 更新三份规划/进度/交接文档，区分 `REAL`、`PARTIAL`、`PLANNED`；
- 只有全链验收满足才将 F1 标为 `COMPLETE`，否则保持 `IN_PROGRESS`；
- 下一 Prompt 使用 LOOP-031 或更高的唯一编号，禁止复用文件名；
- 禁止提交 Token、Secret、浏览器数据、SQLite 运行库和 `data/local-paper-workspace*`；
- 提交范围明确的 commit 并 push 当前 `main`，报告 commit hash 和远端一致性。
