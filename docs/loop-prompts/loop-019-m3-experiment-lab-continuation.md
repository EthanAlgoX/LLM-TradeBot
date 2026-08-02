# LOOP-019 — M3 实验场 V1 实现审计与全链收尾

```text
Loop ID：LOOP-019
里程碑：M3 实验场 V1
状态：READY
前置 Loop：LOOP-018（IN_PROGRESS）
执行环境：本地仓库 + 修复后由 Agent 直接控制真实 Google Chrome
浏览器要求：必需；只允许 Agent 操作真实 Chrome，禁止用户手工验收或 DevTools 交接
验收模式：M3_IMPLEMENTATION_AUDIT_FIX_AND_AGENT_CHROME_VERIFIED
```

## 本轮目标

LOOP-018 已替换静态 Mock Lab，并新增 Experiment contracts、SQLite 聚合、API、Graph Evidence 复用和 Candidate-only UI；但本轮不能只重试 Chrome。

先对已提交实现做行为级审计，修复会导致页面卡顿、伪公平、伪重放、Candidate 无依据或数据不可恢复的问题；补齐真实自动化后，再由 Agent 直接操作真实 Chrome 完成端到端验收。只有实现、自动化和 Chrome 证据同时闭环，才能把 M3 标为 `COMPLETE`。

继续遵守 [`loop-018-m3-experiment-lab-v1.md`](loop-018-m3-experiment-lab-v1.md) 的完整产品、安全和数据权威要求；本文件列出的已知风险具有优先级，不能因为页面“看起来能用”而跳过。

## 当前基线与已知风险

- 基线提交：`b04a95dcdbd52fc15d16ef99c5d5b9fd636625dd`。
- 自动化仍为 `336/336`，与 M2 基线相同，说明 Experiment 的关键行为尚无充分新增回归覆盖。
- LOOP-018 的 Chrome 在实验场 DOM 读取时超时，必须优先按产品性能故障诊断，不能预设为 Chrome 工具故障。
- `apps/web/src/experiment-workspace-api.ts` 当前的全局 `MutationObserver` 在观察 `#app` 后调用 `render()`，而 `render()` 又修改 `innerHTML`；这可能形成自触发渲染循环，与 M2 已修复的数据中心卡死模式相似。
- 当前 Experiment 合同未完整持久化 objective、constraints、execution/risk/model/prompt/failure policy 等锁定事实；Evidence 使用 `unknown`，缺少严格 Scorecard、Diff、lineage 和 replay result 合同。
- 当前 comparability 主要根据 materialized profile ID 是否唯一判断，未逐项比较锁定维度，也未真正落实请求的 comparison mode。
- 当前 Candidate 只检查 `CONTROLLED + evidence_complete`，未应用 objective/constraints、未明确选中的 participant，也未验证 Evidence eligibility。
- 当前 `replay` 路由仅返回现有记录，没有重新验证锁定输入、artifact 和结果 fingerprint。
- 当前 Repository 分页使用裸 experiment ID cursor，未达到版本化、kind-bound、`limit + 1`、稳定 createdAt tie-break 的要求；事件和定义的完整性/归属校验也需审计。
- 当前 UI 只展示部分 Backtest 指标；缺少真实 equity、Walk-Forward folds/validation、配置 Diff、约束结论、完整 lineage、实验列表/切换与可恢复错误状态。

以上是审计入口，不代表缺陷清单已经穷尽。必须阅读实际代码和测试后按事实修复。

## 强制边界

- 全程保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。
- 实验场不得调用或暴露 Approval、Deploy、Paper Plan、Paper Run、Runtime Apply、Order 或 exchange-write。
- 不得修改 `StrategyEvidenceApprovalService` 的生产晋升语义来迁就历史实验。
- 不得另建第二套回测引擎；继续复用现有 Graph Backtest/Walk-Forward runner、durable jobs 和已验证 artifacts。
- 不得使用 Mock 指标、随机曲线、客户端计算赢家、CLI 子进程、临时 JSON、localStorage 或内存 Map 作为事实源。
- 不得直接编辑/清空 `data/local-paper-workspace*`、SQLite 或浏览器资料制造参与者和结果。
- 禁止要求用户点击、截图、操作 DevTools 或口头报告 PASS/FAIL。
- 保留用户既有修改；禁止 `git reset`、`checkout`、`clean` 或回退无关文件。

## 第一阶段：启动与性能根因闭环

1. 只读检查端口和本项目进程；只启动一条 `npm run dev:paper`。若端口被占用，先确认是否为本项目陈旧进程，不得误杀无关进程。
2. 在调用 Chrome 前，用代码审计和现有测试确认 Experiment Workspace 的挂载生命周期。
3. 删除 MutationObserver 自触发渲染模式，采用与 Data Center 已验证方案一致的有界 host identity、显式 mount/unmount、request cancellation 和 stale-response epoch。
4. 页面自身渲染不得再次触发无界 render；路由切换、语言切换、实验切换和 API 返回都只能产生有界请求与渲染。
5. 补自动化或可重复诊断，证明：
   - 空闲实验页不会持续增长 DOM mutation、fetch、timer、listener 或内存；
   - `#lab/#experiment` 往返不会重复挂载和重复发起 job；
   - 陈旧 catalog/list/detail/action 响应不能覆盖当前实验；
   - action busy/error 后可恢复，不使用 `alert()` 作为生产错误状态。
6. 性能护栏通过后才进入 Agent Chrome；若 Chrome 再超时，先检查页面/renderer CPU、内存和请求风暴，再判断工具通道。

## 第二阶段：服务端权威合同与不可变快照

### Experiment Definition

扩充严格、版本化 Schema，使服务端不可变 definition 至少持久化：

- actor、idempotency、createdAt、definition fingerprint；
- 2～5 个 participant 的 Strategy `draftId/versionId/fingerprint`；
- materialized executable fingerprint；
- transitive Agent/Prompt/Graph/Profile/Candidate Set/Historical Plan refs 与 fingerprints；
- Dataset id/version/fingerprint、timezone、calendar、range、universe；
- initial capital、fee、slippage、execution model；
- Risk lock；
- Model/Prompt lock；若当前是 rule-only，明确记录 `none/rule`，不得伪造；
- failure policy、Walk-Forward Plan；
- objective 和 constraints。

不得使用 `z.unknown()` 作为最终 Evidence/Scorecard 权威边界。为 Backtest ref、Walk-Forward ref、Scorecard、equity、Diff、constraint result、Candidate、Replay result 和 lineage 建立严格安全投影。Prompt 正文、密钥、内部路径、SQL 和未授权 payload 不得下发。

创建 Experiment 后更新任一源 Draft/child Draft，不得改变既有 Experiment 的 definition fingerprint 或 replay input。若锁定依赖已不可验证，标记 `stale/unavailable` 并 fail closed，禁止回退到 latest。

### Comparability

由服务端逐项比较实际锁定维度，而不是根据 ID 是否不同推断：

- `STRATEGY_COMPARISON`：Dataset/time/universe/execution/risk/model 相同，只允许声明的策略或 Prompt 维度变化；
- `MODEL_COMPARISON`：Strategy/Prompt/Dataset/risk 相同，只允许 Model 变化；
- `AGENT_GRAPH_COMPARISON`：Dataset/execution/risk/model 相同，只允许 Graph/topology 变化；
- `OPEN_CLASS`：存在多维漂移，只能描述性比较，无因果赢家和 Candidate；
- `INCOMPATIBLE`：Market、Dataset、Graph、metric mode 或运行能力不兼容，拒绝 Evidence job。

服务端返回 changed dimensions、locked dimensions 和稳定 issue codes。客户端的 requested mode 只是请求，不能自行宣称 `CONTROLLED`。

## 第三阶段：持久化、Evidence、Scorecard、Replay 与 Candidate

### SQLite Repository

- Definition、状态事件、participant Evidence refs、Replay 和 Candidate 都 append-only；禁止 UPDATE/DELETE 覆盖历史。
- actor-scoped idempotency：同 key + 同 request 返回同一 Experiment；同 key + 不同 fingerprint 为稳定冲突。
- 列表使用 SQL `limit + 1`，版本化且 kind-bound 的 opaque cursor，以及 `createdAt + stable ID` tie-break；禁止裸 ID cursor。
- 事件读取必须绑定 actor-owned definition；损坏 JSON、schema、event sequence 或 fingerprint fail closed。
- 重启后恢复相同 definition、状态、jobs、Evidence refs、Scorecard、Candidate 和 cursor 行为。

### Evidence execution

- 每个 participant 的 Backtest/Walk-Forward job 使用稳定、受界、actor/experiment-scoped idempotency；最多 5 个，可顺序或显式有界并发。
- 验证 Dataset/Plan/Profile/Candidate Set 与锁定 snapshot 一致后才提交 job。
- 单 participant 失败时保留其他结果并记录 `partial`；不得让一个 Promise rejection 丢失全部已完成结果，也不得把缺失结果当 0。
- 只从通过 fingerprint/manifest 校验的 Graph Evidence Artifact 投影指标。
- Scorecard 至少包含真实可用的 total return、max drawdown、trade/fill/risk rejection/cycle count、equity points、Walk-Forward folds/validation；Sharpe、Sortino、Profit Factor 等不存在时明确 `unavailable`。
- Diff 由服务端基于安全配置投影生成；客户端只渲染。

### Replay

Replay 必须是独立、可审计行为，而不是 GET 别名：

- 使用锁定 refs 和 snapshot 验证或重放；不读取 latest Draft 替换输入；
- 同输入复用幂等 jobs 或验证相同 Evidence；
- 生成严格 replay result，比较 definition/evidence/result fingerprints；
- artifact 被篡改、依赖缺失或结果漂移时 fail closed，并保留稳定 issue code；
- 重放不得创建重复 jobs、Candidate、Paper Run 或 Runtime 副作用。

### Candidate

- 只有 `CONTROLLED`、Backtest 和 Walk-Forward 完整、artifacts 有效、promotion eligible、全部 constraints 通过时才可创建。
- 服务端按 `maximize_total_return` 在合格参与者中选出明确 participant；不得依赖 opaque score。
- 应用 `maxDrawdownPctLte`、`minimumTradeCount`、`walkForwardPositive`、`runtimeFailureCountEqZero`，并返回逐项 PASS/FAIL 与原始值。
- Candidate 必须包含 participant、Experiment definition、Evidence/result fingerprints，状态仅为 `candidate_for_validation`，append-only、actor-scoped、幂等且 `runtimeApplied=false`。
- 平局、样本不足、Open Class、Incompatible、partial/failed/stale、约束失败均不得伪造赢家或 Candidate。

## 第四阶段：HTTP 与真实工作台补齐

### HTTP

保留并完善以下受认证路由：

```text
GET  /api/orchestration/experiments/catalog
GET  /api/orchestration/experiments?limit=&cursor=
POST /api/orchestration/experiments
GET  /api/orchestration/experiments/:experimentId
POST /api/orchestration/experiments/:experimentId/backtest
POST /api/orchestration/experiments/:experimentId/walk-forward
POST /api/orchestration/experiments/:experimentId/candidate
POST /api/orchestration/experiments/:experimentId/replay
```

- body/query/path strict 且有界；畸形 percent ID、非法 cursor、超大 body、未知字段和跨 actor fail closed。
- 已知资源未知方法返回 405；未知资源 404；认证失败 401；冲突 409；稳定域错误不能统一伪装为内部错误。
- 错误响应只包含稳定 code/安全 path，不回显异常 message、SQL、路径、Prompt、Token 或 payload。
- 不增加 approve/apply/deploy/run-paper/order 路由。

### UI

在真实数据驱动下补齐：

1. Experiment 列表、分页、选择、空状态与刷新/重启恢复；
2. 2～5 participant 创建器，server-derived eligibility；
3. Fairness Lock：锁定项、变化项、CONTROLLED/OPEN_CLASS/INCOMPATIBLE 与 issue codes；
4. Backtest → Walk-Forward → Candidate 分阶段动作及 busy/partial/failed/stale 状态；
5. 同时间轴 equity（可视化和文本替代）、真实 Scorecard、Walk-Forward folds、unavailable metrics；
6. 服务端配置 Diff、constraint PASS/FAIL 与 Evidence lineage；
7. Replay 结果和 fingerprint stability；
8. Candidate 明确为“待后续验证”，页面没有 Approval、Deploy、Paper Run 或 Runtime Apply；
9. inline 错误与恢复动作，不用 `alert()`，不把 domain failure 只写入 `console.warn()`；
10. 中文/英文、键盘、focus visible、aria-live、窄屏可读，无横向溢出。

全局状态必须按 actor、route 和 selected experiment 隔离；旧响应不能覆盖新选择。切换语言、路由、分页或实验不得自动启动 Evidence、Replay 或 Candidate。

## 第五阶段：自动化验收

至少新增并通过以下行为测试；不能只沿用 336/336 基线：

1. 2/5 participant 正向；1/6、重复、跨 actor、非 Strategy、stale/invalid/unsupported 负向。
2. Catalog/Experiment actor isolation、有界 SQL pagination、版本化 kind cursor、重启恢复、损坏记录 fail closed。
3. definition 持久化完整 lock/objective/constraints/transitive snapshot；源 Draft 更新不改变旧 fingerprint。
4. 三种 controlled mode、Open Class、Incompatible 的真实维度比较及 issue codes。
5. Backtest/Walk-Forward job idempotency、有界执行、partial failure、artifact/manifest 篡改拒绝。
6. Scorecard/equity/WF/Diff/lineage 只来自验证后的真实 Evidence；不可用指标不补值。
7. Replay 使用锁定版本，fingerprint 稳定，无重复 job；漂移和损坏 fail closed。
8. Candidate 应用 objective/全部 constraints，锁定 winner participant；Open Class、约束失败和 Evidence 不完整不能生成。
9. Candidate、Replay、GET、路由切换均无 Approval/Paper/Runtime/Order 副作用。
10. HTTP 的 auth、actor、body、cursor、method、path、percent encoding 和错误脱敏。
11. Web 没有 Atlas/8.7%/4.6% 等 Mock，没有发布动作；无 MutationObserver/render/fetch storm；stale async isolation。
12. M1 历史会话、M2 Dataset Binding/Composer/恢复及唯一动作链不回归。

最终运行：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

报告真实测试数；若仍为 336/336，M3 不得关闭。

## 第六阶段：Agent Chrome 全链验收（必需）

仅在性能护栏和自动化通过后执行。Agent 必须直接控制真实 Google Chrome，不得让用户参与，也不得用内置浏览器、Playwright、curl、日志、API 或数据库替代以下 UI 证据。

### A. 中文 1440×900 与创建

1. 打开 `http://127.0.0.1:5174/#experiment`；确认页面可快速稳定读取，空闲 30 秒无持续重绘、卡顿或请求风暴。
2. 确认静态 Atlas、8.7%/4.6% Mock、Approval 和 Paper 发布按钮不存在。
3. 若少于两个 eligible Strategy Version，只能由 Agent 通过可见编排 UI 创建两个兼容历史 Draft；不得直接调用 API、Console 或数据库造数据。
4. 选择 2 个兼容 participant，配置 Dataset/time/Walk-Forward/objective/constraints，创建真实 Experiment。
5. 验证 Fairness Lock、版本/fingerprint、transitive refs、比较模式和安全状态可见；无横向滚动、无遮挡。

### B. Evidence、比较、Replay 与 Candidate

1. 通过可见 UI 运行 Backtest，等待每个 participant 完成或明确 partial/failed；查看真实 equity 和 Backtest Scorecard。
2. 运行 Walk-Forward，查看 folds/validation、真实 Evidence refs 和 unavailable metrics。
3. 查看服务端 Diff、changed/locked dimensions、逐项 constraint PASS/FAIL 和 lineage。
4. 执行 Replay；确认 definition/evidence/result fingerprint 稳定，没有新增重复 jobs。
5. 仅在 eligible 时创建 Candidate；确认选中的 participant 与 objective/constraints 一致，状态为 `candidate_for_validation`。
6. 确认页面无 Approval、Deploy、Paper Run、Runtime Apply；交易/Paper 状态未改变。
7. 刷新页面，再重启本项目 Web/API；恢复同一 Experiment、participants、jobs、Evidence、Scorecard、Replay 和 Candidate。

### C. 负向、公平性与隔离

- 少于 2 个 participant 时创建禁用或明确 fail closed。
- 通过可见 UI 创建或选择 Open Class 组合；确认展示漂移维度，只作描述性比较，无因果 winner，Candidate 禁用。
- 若 UI 可组成 Incompatible 条件，确认 Evidence action 被拒绝且稳定错误可读；不可伪造数据强行制造。
- 新建或切换第二 Experiment，再快速往返；确认异步状态、结果和错误不串台。
- 验证列表分页或至少列表选择、刷新恢复不会切回错误实验。

### D. English 820×760、Console 与 Network

- 切换 English、820×760；创建器、Fairness Lock、阶段、equity/Scorecard、Diff、lineage、错误和 Candidate 可读，无横向滚动、无遮挡。
- 清空 Console 后执行主流程、切换、刷新和服务重启；TradeBot 页面 error 为 0。浏览器扩展自身异步消息错误单独标注，不能当作产品 PASS 或 FAIL。
- 若 Agent Chrome 提供 Network，只报告非敏感 `method path status`，确认 Experiment GET/POST/job/replay 无意外 401/5xx。
- 若 Network 工具不可用，记录 `TOOL_UNAVAILABLE`；禁止人工或其他工具替代。其余产品项全部通过时，Network 单项不阻止 M3 关闭。

### E. Runtime safety

全链确认：

```text
runtimeApplied=false
Paper Only
exchangeWriteAllowed=false
```

并确认 Experiment 未产生 Approval、Paper Plan、Paper Run、Order、position 或 exchange-write 副作用。

## 失败分流与 M3 关闭规则

- 若页面再次卡顿或 DOM 超时：先按性能/生命周期缺陷处理，修复并回归，不得直接归因于 Chrome。
- 若 Chrome 在页面稳定、性能护栏通过后仍不可用：如实记录控制通道证据，M3 保持 `IN_PROGRESS`，但继续完成所有不依赖 Chrome 的代码和自动化工作。
- 任一核心实现项、真实 Chrome 产品项或 Runtime safety 未通过：M3 保持 `IN_PROGRESS`。
- 只有合同、持久化、API、真实 Evidence/Scorecard/Replay/Candidate、自动化、双尺寸 Chrome、Console 和 Runtime safety 全部闭环，才将 M3 标为 `COMPLETE`。Network 为 `TOOL_UNAVAILABLE` 可按前述规则豁免。

完成时：

1. 将 LOOP-018、LOOP-019 和 M3 标为 `COMPLETE`；更新准确测试数与 Chrome 证据。
2. 更新 `docs/product-optimization-plan-and-progress.md`、`docs/product-roadmap-and-progress.md`、`docs/project-status-and-handoff.md`。
3. 创建唯一编号 `docs/loop-prompts/loop-020-m4-multi-paper-runtime-center-v1.md`，进入 M4，并明确浏览器要求。
4. 更新 `docs/next-loop-prompt.md` 指向 LOOP-020。

未完成时：

1. LOOP-019/M3 保持 `IN_PROGRESS`，准确记录实现与 Chrome 缺口。
2. 创建唯一编号 `LOOP-020` 继续 M3；不得覆盖既有 Prompt 或提前进入 M4。
3. 更新 `docs/next-loop-prompt.md` 指向该续办文件。

## Git 要求

- 任何代码或文档修改都必须创建范围明确的 commit 并 push 当前分支到 `origin`，即使 M3 未关闭。
- 提交前检查 staged diff，禁止提交 `data/local-paper-workspace*`、SQLite、Token、Secret、环境凭据、Evidence 临时文件或浏览器产物。
- push 后验证远端 branch ref 与本地 HEAD 一致。
- 不创建 PR，除非用户明确要求。

## 最终报告格式

```text
Loop ID：LOOP-019
验收模式：M3_IMPLEMENTATION_AUDIT_FIX_AND_AGENT_CHROME_VERIFIED / IN_PROGRESS
浏览器要求：必需；Agent 已使用真实 Chrome / Chrome 控制未完成
页面性能与挂载生命周期：PASS / FAIL
Experiment 严格合同与不可变快照：PASS / FAIL
Repository/API/actor isolation：PASS / FAIL
2～5 participant 与 Fairness Lock：PASS / PARTIAL / FAIL
Backtest Evidence：PASS / NOT VERIFIED
Walk-Forward Evidence：PASS / NOT VERIFIED
真实 Scorecard/equity/Diff/lineage：PASS / NOT VERIFIED
Replay fingerprint：PASS / NOT VERIFIED
Objective/Constraints 与 Candidate-only：PASS / NOT VERIFIED
中文 1440×900：PASS / NOT VERIFIED
英文 820×760：PASS / NOT VERIFIED
负向/Open Class/实验隔离：PASS / NOT VERIFIED
Console：PASS / NOT VERIFIED
Network：PASS / TOOL_UNAVAILABLE / NOT VERIFIED（PASS 时仅 method/path/status）
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false / NOT VERIFIED
自动化：check PASS/FAIL；test:ts x/x；build:web PASS/FAIL；diff-check PASS/FAIL
M3：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-020（M4 / M3，含唯一文件名）
Git：commit <hash>；branch <name>；push PASS / FAIL；未创建 PR
```
