# LOOP-035 — F3 编排工作台结构化动态 DAG V1

```text
Loop ID：LOOP-035
里程碑：F3 Workbench V2
执行模式：IMPLEMENT_AND_AGENT_CHROME_VERIFY
浏览器要求：实现完成后必需；只能由 Agent 直接操作真实 Chrome，禁止用户手工代验
安全边界：只创建 Strategy Draft / no Preflight / no Backtest / no Runtime Apply / Paper Only / exchangeWriteAllowed=false
Git：任何代码或文档修改都必须 commit 并 push；不创建 PR
```

## 1. 当前事实与本轮边界

F1 已提供 actor-scoped、immutable、可发布/归档的四类 Agent Version Catalog，以及精确 `versionId + fingerprint`。F2 已提供数据与模型连接的 immutable Version、capability、health、impact 和 Secret reference 状态。当前编排工作台仍是浏览器内存中的 Sample/规则匹配预览。

本轮把工作台替换为首个真实纵向切片：

```text
自然语言需求
-> 服务端 Strategy Intent
-> 澄清问题或结构化 Recommendation
-> Published Agent Version 动态 DAG
-> 服务端严格校验
-> 用户点击“应用此方案”
-> immutable Strategy Draft（NOT_APPLIED）
```

本轮不执行 F4 的 Preflight、Backtest、Walk-Forward、Experiment Evidence，也不执行 F5 的模拟部署。不得启动 M4 Runtime、修改账户/订单/成交/持仓、执行 Champion 替换或接触 Live/M6。

## 2. 开始前

1. 阅读 `PRODUCT.md`、三份规划/进度/交接文档、LOOP-028/029、LOOP-032～034；
2. 检查 `git status`，完整保留既有用户修改；禁止 `reset`、`checkout`、`clean`；
3. 检索并复用现有 Conversation/Copilot、Configuration Draft、Pipeline Draft、Graph Validator、Agent Published Catalog、Connection Registry、Bearer actor、SQLite 与统一错误合同；
4. 禁止建立第二套 Conversation、Agent Catalog、Strategy Draft、Graph Validator 或 Dataset/Model Registry；
5. 先写清现有 Preview 路径将如何被真实服务端路径替代或明确隔离，不能让 Sample 与 REAL 推荐混在同一个事实视图中。

## 3. 真实最小纵向切片

至少完成两条行为链：

### 3.1 信息不足时只澄清

例如用户只输入“帮我做一个收益高的策略”时：

- 服务端生成结构化 `StrategyIntent`，标明已知条件、缺失字段和假设；
- 返回 1～3 个有界澄清问题，例如市场、周期、数据能力、风险偏好；
- 不生成虚假的 DAG，不创建 Strategy Draft，不调用 Runtime；
- 用户补充后，在同一 actor-scoped Conversation 中继续形成新 Turn，历史 append-only。

### 3.2 信息足够时推荐动态 DAG

至少支持并真实展示以下拓扑能力：

- 一对一；
- 一对多并行分支；
- 多对一汇聚；
- 不同输入分支最终汇入 Decision 和 Reflection；
- 系统锁定的 Portfolio -> Risk Gate -> Paper Execution 草案链。

验收示例应能表达：

```text
K 线输入
├─> 短周期分析 ─┐
├─> 中周期分析 ─┼─> 交易决策 ─> 风控门禁 ─> Paper Execution（锁定且未应用）
└─> 长周期分析 ─┘

财经新闻输入 -> 情绪解读 ────────────────────────┘
                                      └─> 反思 Agent（只消费已定义 Artifact）
```

实际节点名称和连接必须来自当前 actor 可见的 Published Agent Version；不得硬编码或发明一个不存在的 Agent。

## 4. 严格领域合同

新增或复用严格、版本化合同表达：

```text
StrategyIntent
+ conversation/turn authority
+ market / universe / horizon / cadence / objective / risk preference
+ required capabilities
+ assumptions / missing fields / clarification questions

StrategyRecommendation
+ recommendationId + fingerprint + provenance
+ exact intent ref
+ explanation / reasons / assumptions / gaps
+ nodes[] + edges[]
+ catalog snapshot ref
+ validation result
+ runtimeApplied=false

RecommendationNode
+ stable nodeId
+ exact published Agent Definition/Version/fingerprint
+ category and input/output Artifact Schema refs
+ exact Data/Model Connection refs inherited from Agent Version
+ systemOwned flag where applicable

RecommendationEdge
+ source node / output port
+ target node / input port
+ Artifact Schema ref
```

所有合同使用严格 Schema 和有界长度/数量。LLM 只返回结构化数据，不返回 HTML、JavaScript、SQL、URL、文件路径、工具实现、Prompt 覆盖或 Runtime 参数。

## 5. 推荐引擎与 LLM 边界

- 所有模型调用都在服务端，通过 F2 已注册且健康、支持 Structured Output/JSON 的 Model Connection/Adapter；浏览器不能直连 Provider，也不能读取 Secret；
- LLM 输出视为不可信建议，必须经过 Schema parse、Catalog resolution 和 Graph validation 后才能展示为 `VALIDATED_RECOMMENDATION`；
- LLM 只能选择 Catalog 中当前 Published 且未 Archived 的精确 Agent Version；不能生成 Agent、修改 Prompt、替换 Model/Data ref 或覆盖 System Policy；
- 服务端在必要时补齐并锁定 Portfolio、Risk Gate、Paper Execution 草案节点；LLM 不能删除、绕过、重排或声明已执行；
- 推荐记录必须标明 provenance：Provider/Model Connection ref、adapter mode、catalog snapshot fingerprint、生成时间和 fallback 状态，但不得包含 Secret；
- 本地开发/自动化若使用 registered deterministic adapter，必须明确显示 `DETERMINISTIC_STRUCTURED_ADAPTER`，不得伪装成在线 LLM；生产 Provider 不可用时返回稳定 unavailable/clarification 状态，不能回退到浏览器规则匹配并声称 REAL；
- prompt injection、要求泄露平台 Prompt/Secret、要求创建任意工具/代码、要求绕过风险链或直接交易时必须 fail closed，并保留安全的用户可读说明。

## 6. 服务端 DAG 校验

推荐落库和 Apply 前都必须重新校验：

- 图为 DAG，无自环、重复边、孤立必需节点或不可达终点；
- fan-out/fan-in 明确，节点/边数量、最大深度、并行度、Token/调用/超时/成本预算有界；
- Edge 的 Artifact Schema 与上下游端口兼容；
- Input 的数据 capability、market、observation window 与 cadence 可达；
- Agent Version 必须仍为 Published，fingerprint、Data/Model Connection ref 与 catalog snapshot 无漂移；
- 至少存在决策路径，并接入系统锁定 Portfolio/Risk/Paper Execution 草案链；
- Reflection 只连接允许的 Artifact，不得成为绕过 Risk 的执行通道；
- 任何错误返回稳定 issue code、节点/边定位和修复建议，不做静默降级。

优先扩展现有 Graph Validator；若现有合同不能直接表达 UI Recommendation，可增加薄的 Recommendation compiler，但不得复制验证规则。

## 7. 持久化、API 与 actor 隔离

- Conversation、Intent、Recommendation、Catalog Snapshot、Validation 和 Apply 结果均为服务端 authority，并可在刷新及 SQLite/Web/API 重启后恢复；
- 写入 append-only；同一对话的新需求产生新 Turn/Recommendation，不覆盖旧方案；
- 所有读取/写入从 Bearer 身份派生 actor；客户端不能提交 actor/owner/role；
- 列表/历史使用有界版本化 opaque cursor，并绑定 actor、kind 和 scope；
- 命令使用持久幂等，相同 key + 相同 payload 重放同一结果，相同 key + 不同 payload 冲突；
- stale catalog、stale recommendation、跨 actor、非法 cursor、未知字段/ID/ref、超限图和 `PUT/PATCH/DELETE` 均 fail closed，不能产生部分 Draft。

API 可按现有路由风格设计，但至少覆盖：

- 创建/继续 Workbench Conversation Turn；
- 读取 Conversation、Intent、Recommendation 与历史；
- 读取可用 Published Agent Catalog snapshot；
- 对 Recommendation 执行 Apply，创建 Strategy Draft；
- 不提供 Start/Run/Deploy/Trade/Approve 工具。

## 8. “应用此方案”与 Strategy Draft Authority

“应用此方案”只能复用现有 Configuration/Pipeline Draft 基础创建 immutable Strategy Draft：

- 精确绑定 Recommendation、Intent、Catalog Snapshot；
- 固化每个 Agent Version、Data/Dataset、Model Connection、Prompt Bundle、Schema、Tool Policy、预算和 Graph fingerprint；
- 固化系统补齐的 Portfolio/Risk/Paper Execution 草案链；
- 响应明确显示 `draftStatus=NOT_VALIDATED` 或现有等价状态、`runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`；
- Apply 后仅出现“下一步进入预上线检查（F4 尚未执行）”，不得显示回测通过、可模拟、已部署或已交易；
- 同一 Recommendation 重复 Apply 按幂等规则返回同一 Draft；Catalog 或 Agent fingerprint 漂移时拒绝创建并要求重新推荐。

## 9. 编排工作台 Web

保持用户已确认的“单一对话为主”设计，不恢复固定左右分栏：

- 用户消息与助手回复按 Turn 展示；刷新后由服务端历史恢复；
- 澄清回复只显示缺失项和继续输入，不显示假流程；
- 有效推荐在该条助手消息内展示说明、理由、假设/缺口、动态拓扑和 `应用此方案`；
- 桌面显示可读的分支/汇聚拓扑；窄屏降级为每个节点的上游/下游列表，不能横向溢出；
- 节点显示四类 Agent、精确 Version/fingerprint、Data/Model refs、真实/锁定状态；
- 系统节点明显标记 `SYSTEM LOCKED`，Paper Execution 显示 `NOT_APPLIED`；
- Apply 后显示真实 Strategy Draft ID/version/fingerprint 和下一门槛，不显示 Sample/Prototype 成功；
- 保留旧 Sample 仅可作为明确的开发样例或删除，不能与服务端 REAL 对话混用；localStorage 不能成为 Conversation、Recommendation 或 Draft 的事实源。

## 10. 自动化与负向验收

至少覆盖：

- 信息不足 -> clarification，不产生 Recommendation/Draft；
- 完整需求 -> 一对多、多对一、双输入分支的有效 DAG；
- 只选择 Published Version，Archived/Draft/跨 actor Agent 拒绝；
- cycle、自环、重复边、孤立节点、Schema 不兼容、数据/模型不可达、预算超限和锁定链缺失拒绝；
- LLM 非法 JSON、未知字段、发明 Agent、HTML/代码/URL/SQL/path/tool/Secret/Runtime 注入拒绝；
- Conversation 多 Turn、actor 隔离、cursor、持久幂等、并发与 SQLite 重启恢复；
- Apply 创建同一权威 Strategy Draft，fingerprint 漂移 fail closed；
- 不产生 Preflight、Backtest、Paper Deployment、Account、Order、Fill、Position、Shadow 或 Exchange Write 副作用。

执行并如实记录：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

`npm run test:ts` 必须自然结束并输出最终汇总。

## 11. Agent Chrome 验收

实现后必须由 Agent 直接操作真实 Chrome；禁止用户手工代验，也禁止用 API、日志、静态 DOM 或内置浏览器代替页面证据：

1. 中文 1440×900：输入一个信息不足的需求，确认只返回澄清问题且没有 Apply/Draft；
2. 补充市场、周期、风险和目标，在同一对话生成真实结构化推荐；
3. 验证拓扑至少包含 K 线短/中/长并行分析、新闻情绪分支、Decision 汇聚和系统锁定风险链；
4. 检查每个业务节点引用已发布 Agent Version/fingerprint，Provider/adapter provenance 与 REAL/DETERMINISTIC 标签准确；
5. 点击“应用此方案”，确认只生成 immutable Strategy Draft，显示真实 ID/version/fingerprint 和 F4 待检查状态；
6. 继续修改策略，确认追加新 Recommendation，旧推荐和旧 Draft 不被覆盖；
7. 刷新并重启本项目 Web/API，恢复多 Turn、两个 Recommendation 和已应用 Draft；
8. 英文 820×760：拓扑降级清晰、无横向滚动/遮挡、键盘焦点可见；
9. Console 清空后刷新，无 TradeBot 页面 error；Network 能力可用时只报告 method/path/status，不可用则标记 `TOOL_UNAVAILABLE`；
10. 全程确认 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`，没有 Preflight/Backtest/Simulation/订单副作用。

Chrome 控制不可用或真实链未闭环时，保留完成的实现，F3 标记 `IN_PROGRESS`，创建唯一编号 LOOP-036 continuation 并提交推送，不得虚报验收。

## 12. 文档、完成条件与 Git

- 更新 `docs/product-optimization-plan-and-progress.md`、`docs/product-roadmap-and-progress.md`、`docs/project-status-and-handoff.md`；
- 只有领域合同、真实服务端推荐路径、DAG 校验、Strategy Draft、重启恢复、自动化和 Chrome 全链都通过，F3 才可标记 `COMPLETE`；
- 完成后创建唯一编号的 F4 Prompt；未完成则创建唯一编号 LOOP-036 F3 continuation；同步替换 `docs/next-loop-prompt.md`；
- 禁止提交 Token、Secret、Provider 响应原文、浏览器资料、SQLite 运行数据和 `data/local-paper-workspace*`；
- 本轮任何修改都必须创建范围明确的 commit 并 push 当前 `main`；报告 commit hash、branch、push 状态及 PR 状态。

## 13. 最终回报模板

```text
Loop ID：LOOP-035
验收模式：IMPLEMENT_AND_AGENT_CHROME_VERIFY
浏览器要求：必需；Agent 是否完成真实 Chrome 验收
Strategy Intent / Clarification：PASS / PARTIAL / FAIL
Published Agent Catalog binding：PASS / PARTIAL / FAIL
Structured Recommendation：PASS / PARTIAL / FAIL
Dynamic DAG / Validator：PASS / PARTIAL / FAIL
Locked safety chain：PASS / PARTIAL / FAIL
Apply -> immutable Strategy Draft：PASS / PARTIAL / FAIL
Conversation / restart recovery：PASS / PARTIAL / FAIL
中文 1440×900：PASS / FAIL / NOT VERIFIED
英文 820×760：PASS / FAIL / NOT VERIFIED
Console：PASS / FAIL / TOOL_UNAVAILABLE
Network：PASS / FAIL / TOOL_UNAVAILABLE
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
自动化：check；test:ts（最终汇总）；build:web；diff-check
F3：COMPLETE / IN_PROGRESS
下一 Loop：唯一编号与文件名
Git：commit；branch；push；PR 状态
```
