# LOOP-023 — M4 Deployment-scoped Paper Cycle 收尾 V1

```text
Loop ID：LOOP-023
里程碑：M4 多模拟运行中心
状态：READY
前置 Loop：LOOP-022（IN_PROGRESS）
执行环境：本地仓库 + 实现后由 Agent 直接控制真实 Google Chrome
浏览器要求：实现后必需；只允许 Agent 操作真实 Chrome，禁止用户手工验收、截图、DevTools 交接或代报 PASS
验收模式：DEPLOYMENT_SCOPED_REAL_PAPER_CYCLE_AND_AGENT_CHROME_VERIFIED
Git 要求：任何代码或文档修改都必须 commit 并 push；不创建 PR
```

## 任务背景

LOOP-022 已完成以下基础，不得重复另建第二套：

- Deployment 的 actor-scoped SQLite definition/event 聚合；
- run/cycle/trade/artifact 持久 Projection 与 deployment/kind-bound cursor；
- 模拟/真实无副作用切换、Simulation Overview、创建入口；
- Paper Detail 的表现、Agent 轨迹、交易、配置与数据、晋升评估五个 Tab，以及惰性请求、AbortController/epoch 隔离；
- 中文/英文、1440×900/820×760 响应式基础；
- Paper Only、`runtimeApplied=false`、`exchangeWriteAllowed=false`；
- 359/359 TypeScript 自动化基线。

当前阻塞 M4 的根本问题不是页面或只读 Projection，而是 Deployment 调度器尚未执行真实的：

```text
Decision -> Portfolio -> Risk -> Execution
```

因此当前无法证明两个实例产生独立、可恢复的 cycle、持仓、订单、成交和 Artifact，也无法证明 Stop 的 close-only 语义。本轮必须关闭这一运行内核缺口；不得用计数器、随机曲线、Mock trade、前端合成数据或日志代替真实 Paper 事实。

## 强制安全边界

- 全程 Paper Only，`runtimeApplied=false`，`exchangeWriteAllowed=false`。
- 唯一交易动作链保持 `Decision -> Portfolio -> Risk -> Execution`；不得建立第二套模拟撮合器或绕过 Risk/Execution。
- 每个 Deployment 必须使用独立 account、position、order、trade、cycle journal、trace、artifact、PnL 和 scheduler scope。
- Copilot、Experiment、Candidate、Reflection 不能直接 Start、Stop、Apply Runtime 或写入交易事实。
- M4 不实现 Live、Canary、Shadow、自动晋升、自动替换 Champion、Secret、真实账户或交易所写 Adapter。
- “模拟 / 真实”切换只改变展示，不能启动、暂停、停止或替换任何 Deployment。
- 禁止清空、改写或提交 `data/local-paper-workspace*`、SQLite、Token、Evidence、截图、浏览器缓存等本地产物来制造验收结果。
- 禁止要求用户人工操作；Agent Chrome 不可用时如实保持 M4 `IN_PROGRESS`。

## 第一阶段：审计现有 Paper Runtime 并锁定接线方案

先阅读并复用：

- `current-crypto-paper-runtime-binding` 与当前 Production Composition；
- Paper account/execution、position 恢复、cycle journal、Artifact Ledger、Runtime Evidence；
- Sequential Cycle Runner、Paper Runtime Operations、Preflight/Safety Store；
- `multi-paper-runtime`、`multi-paper-runtime-http` 与现有 Web Center；
- Approved Paper Plan、Strategy Version materialization、Dataset/Graph/Profile/Risk/Execution lineage。

用代码和测试明确：

1. 当前 runtime 中哪些依赖仍是进程级或 actor 级单例；
2. 哪些 SQLite 表、repository key 或 binding 缺少 `deploymentId/runId/accountId` scope；
3. 如何为每个 Deployment 构造独立 cycle execution context，同时复用现有 DecisionPipeline；
4. Scheduler 如何在启动时仅恢复 active deployment，不同步回放全部历史；
5. Stop/close-only、failure/backoff、lease/fencing 和 restart 分别由哪个服务端组件负责；
6. API/UI 读取的 run/cycle/trade/artifact 是否确实来自同一套权威 Paper 事实。

不得通过删除旧能力、放宽校验或把现有单例账户在多个 Deployment 间共享来完成接线。

## 第二阶段：Deployment-scoped Runtime Composition

实现一个明确的 deployment runtime factory/binding（命名可遵循现有代码风格），输入至少包含：

- actorId、deploymentId、runId、accountId；
- immutable Strategy Version、Dataset version/fingerprint、Graph/Plan/Profile；
- Execution/Risk/Fee/Slippage snapshot；
- schedule interval、source fingerprint 与 Paper safety capability。

输出必须是可释放、可恢复且互不共享可变状态的 runtime handle，并满足：

- 每个 Deployment 的 account/position/order/trade/cycle/artifact key 均带稳定 scope；
- 相同 Deployment 重启恢复原账户和持仓，不创建新账户或重置余额；
- 不同 Deployment 即使使用同一 Strategy Version，也不能共享持仓、幂等键、trace 或 Artifact；
- source fingerprint、Dataset、Graph、Execution 或 Risk 漂移时 fail closed，不静默使用 latest；
- 每个真实 cycle 都记录 Decision、Portfolio、Risk、Execution 的可追踪 lineage；
- non-trade/hold/reject cycle 也必须形成真实、可解释的周期事实，不能伪造成 trade。

如果现有表结构无法安全 scope，应进行最小、可迁移且向后兼容的扩展；禁止破坏 M0-M3 既有 Runtime Evidence。

## 第三阶段：有界多实例调度器接线

把现有 `BoundedMultiPaperScheduler` 或其等价组件接入本地 Paper Production Composition：

- API/Web 启动不能等待任何交易周期完成；调度器在后台异步工作；
- 只恢复 actor-owned 且 lifecycle 为 `running`、`stopping` 或 `close_only` 的 Deployment；
- 全局并发上限明确且可测试，单 Deployment 严格 non-overlap；
- 每次执行前取得 lease/fencing token，陈旧 worker 不能追加新事实；
- 记录 heartbeat、latest run/cycle、failure count 和 next retry；
- 单实例异常只影响自身，按有界 backoff 重试，不能阻塞其他实例；
- 不得 busy loop、同步跑完整历史或随页面轮询触发 cycle；
- 页面关闭、路由切换或“模拟 / 真实”切换不能停止后台实例；
- 进程退出时有界释放 timer/lease，不写半个 cycle。

明确区分：

```text
Deployment lifecycle = 用户控制的长期模拟实例状态
Run = 一次可恢复的运行区段
Cycle = 唯一动作链的一次原子执行事实
```

不得用 API GET、DOM render 或浏览器刷新驱动周期运行。

## 第四阶段：Stop、close-only 与重启恢复

完成真实状态语义：

- Stop 后立即停止创建普通新周期；
- 无持仓时安全进入 `stopped`；
- 有持仓时进入 `stopping/close_only`，只允许降低或关闭既有风险敞口；
- close-only cycle 必须经过 Decision/Portfolio/Risk/Execution，不能直接改数据库持仓；
- 平仓成功后进入 `stopped`，失败时记录健康与退避，不能丢失持仓；
- 重复 Stop、Start、Archive 保持幂等，不产生重复 run/cycle/order/event；
- Archive 只允许 terminal/stopped Deployment，且不删除历史事实；
- Web/API 重启后恢复 running、stopping、close-only、stopped 和 archived 的正确状态；terminal run 不得复活；
- 重启前未完成的 lease/cycle 通过 fencing 和幂等执行恢复或安全失败，不能双重成交。

必须用行为测试覆盖“恢复已有多头持仓后 close-only 产生 `close_long`”或等价真实路径，并证明另一个 Deployment 不受影响。

## 第五阶段：权威 Projection 与完整 UI

复用 LOOP-022 的 Projection/API/UI，补齐真实数据消费，不得另建页面：

- Overview 的 equity、return、drawdown、trade count、health、heartbeat 必须由持久账户/cycle/trade 事实投影；
- 至少可同时显示两条真实实例曲线，最多选择五条；标准化收益与共同区间计算可复现；
- 没有事实时明确显示 unavailable/insufficient，不生成平滑曲线；
- Detail 五个 Tab 必须实际渲染对应分页结果，不能只发请求后显示 loaded；
- Agent 轨迹按 cycle 展示 Decision/Portfolio/Risk/Execution 与 Artifact lineage；
- 交易 Tab 区分 order、fill、position、fee 和 risk rejection；
- 配置与数据展示 immutable Strategy/Dataset/Graph/Profile/Execution/Risk fingerprint；
- 晋升评估保持只读，仅显示事实和“数据不足/继续观察/可提交后续验证”，不得自动部署；
- actor/route/deployment/tab 快速切换继续使用 AbortController + epoch，陈旧响应不能串实例；
- 历史曲线有界降采样，DOM 不写入全部原始点；页面空闲轮询有界。

“真实”视图继续明确显示 `Live unavailable / Exchange writes OFF`，不得把 Paper fill 称为真实成交。

## 第六阶段：自动化验收

新增行为级测试，测试总数必须高于 359，最低覆盖：

1. 两个 Deployment 同时执行多个真实 cycle；
2. 独立 account/position/order/trade/trace/artifact/PnL，且同 Strategy Version 也不串 scope；
3. 每个 cycle 的 Decision -> Portfolio -> Risk -> Execution lineage 完整；
4. hold、risk reject 和 trade 三类结果的 Projection 真实、稳定；
5. 全局并发有界、单实例 non-overlap、lease/fencing 和陈旧 worker 拒绝；
6. 一个实例失败/退避时另一个继续 cycle；
7. Stop 无持仓直接停止；有持仓进入 close-only 并受控平仓；
8. close-only 恢复场景产生真实 `close_long` 或等价平仓动作；
9. Web/API 重启后恢复两个实例的 lifecycle、账户、持仓、cycle 和 Artifact；
10. terminal run 不复活，重复命令不追加重复事实；
11. source/Dataset/Graph/Execution/Risk 漂移 fail closed；
12. actor isolation、严格 cursor、跨 deployment/kind cursor 拒绝；
13. Overview 指标/曲线从持久事实计算且降采样有界；
14. Detail Tab 真实消费数据、stale response 隔离、视图切换无副作用；
15. HTTP 未认证、跨 actor、未知资源、错误 method、畸形 ID/body fail closed；
16. 无 Live、自动 Candidate 部署、Runtime Apply 或 exchange write 路径；
17. M1 会话、M2 Dataset Binding、M3 Experiment/Candidate 及现有单 Paper Runtime 不回归。

执行并记录真实结果：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

## 第七阶段：Agent 真实 Chrome 验收

实现和自动化完成后，使用 Chrome 控制技能由 Agent 直接操作真实 Google Chrome。禁止用户手工验收，也禁止用 API、服务端日志、内置浏览器或截图代替 UI 证据。

使用单一当前代码的 `npm run dev:paper`，先排除旧进程/错误 bundle，但不得删除本地 workspace 数据制造结果。

### 中文 1440×900

1. 打开交易 Agent，确认“模拟 / 真实”切换只改变视图。
2. 通过可见 UI 从两个不同 Strategy Version 各创建一个 Deployment，依次 Preflight、Start。
3. 确认两个实例同时为 running，并等待各自产生至少多个真实 cycle。
4. 确认两个实例的 account、heartbeat、equity、return、trade count 和曲线独立更新。
5. 快速切换两个实例及五个 Detail Tab，确认 Decision/Portfolio/Risk/Execution、交易、配置与 Artifact 不串台。
6. 停止其中一个：若有持仓，观察 close-only/受控退出直至 stopped；另一个持续产生新 cycle。
7. 刷新页面，确认 Deployment、曲线、Detail、当前选择和运行状态恢复。
8. 重启本项目 Web/API，确认 running 实例继续、stopped 实例不复活，账户/持仓/交易/Artifact 不重置。
9. 切到“真实”，确认 Live unavailable、Paper Only、Exchange writes OFF；切回模拟后后台状态未改变。

### English 820×760

- 重复 Overview、实例选择、Detail、模拟/真实切换的关键路径；
- 无横向滚动、无遮挡，键盘 focus 可见；
- 长 ID、fingerprint、表格和图例不撑破布局。

### 负向、Console 与 Network

- 未 Preflight 时 Start 禁用或稳定拒绝；无 Draft/失效 Strategy/stale fingerprint fail closed；
- 重复 Start/Stop/Archive 不产生重复事实；
- 清空 Console 后刷新，TradeBot 页面 error 为 0；扩展自身异步消息错误单独标注；
- 若 Agent Chrome 提供 Network，只报告非敏感 `method path status` 并确认无意外 401/5xx；若能力不可用，记录 `TOOL_UNAVAILABLE`，不得转为人工验收。

全程确认：

```text
runtimeApplied=false
Paper Only
exchangeWriteAllowed=false
```

## M4 关闭规则

只有以下全部成立，才可把 M4 标记为 `COMPLETE`：

- 两个 Deployment 真实并发执行唯一 Paper 动作链；
- 账户、持仓、订单、交易、Trace、Artifact、PnL 和 scheduler scope 隔离；
- Stop/close-only、失败隔离、lease/fencing 和重启恢复通过；
- Overview/五 Tab Detail 展示真实持久事实；
- 自动化总数高于 359 且全量通过；
- Agent Chrome 中文/英文双尺寸、刷新/重启、Console 与 Runtime safety 通过。

若全部通过：

- 更新 M4 为 `COMPLETE`；
- 创建唯一编号 `LOOP-024`，进入 M5 Shadow 与晋升建议；
- 不得在本轮提前实现 M5。

若任一项未通过：

- M4 保持 `IN_PROGRESS`；
- 创建唯一编号 `LOOP-024` 继续关闭明确剩余缺口；
- 不得覆盖本文件或重复使用旧 Prompt 文件名。

## 文档、Git 与最终报告

- 更新 `docs/product-optimization-plan-and-progress.md`、`docs/product-roadmap-and-progress.md`、`docs/project-status-and-handoff.md` 和 `docs/next-loop-prompt.md`，只记录真实完成项。
- 检查 staged diff，禁止提交 `data/local-paper-workspace*`、SQLite、Token、Secret、Evidence、截图、浏览器或运行日志产物。
- 所有代码和文档修改必须创建范围明确的 commit，并 push 当前分支到 `origin`；验证远端 ref 与本地 HEAD 一致。
- 不创建 PR，除非用户明确要求。

最终报告必须包含：Loop ID、验收模式、真实 cycle 接线、两实例隔离、调度/lease/fencing、close-only、Projection/UI、刷新/重启、中文 1440×900、英文 820×760、Console、Network、Runtime safety、自动化总数、M4 状态、下一 Loop、commit hash、branch 和 push 结果。
