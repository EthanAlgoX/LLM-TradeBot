# LOOP-021 — M4 多模拟运行中心 V1

```text
Loop ID：LOOP-021
里程碑：M4 多模拟运行中心
状态：READY
前置 Loop：LOOP-020（COMPLETE，M3 实验场 V1 已关闭）
执行环境：本地仓库 + 实现后由 Agent 直接控制真实 Google Chrome
浏览器要求：实现后必需；只允许 Agent 操作真实 Chrome，禁止用户手工验收、截图或 DevTools 交接
验收模式：MULTI_PAPER_RUNTIME_CENTER_AND_AGENT_CHROME_VERIFIED
Git 要求：任何代码或文档修改都必须 commit 并 push；不创建 PR
```

## 本轮目标

把当前单一 Paper Runtime 控制卡扩展为服务端权威的“多模拟运行中心 V1”：用户可以从历史 Strategy Version 启动多个独立模拟实例，让它们同时在后台持续运行，并在同一交易页面通过“模拟 / 真实”分段选择器切换视图。

本轮只实现多 Paper Simulation。“真实”视图必须如实展示当前 capability 和未授权状态，不得伪造 Live，不得新增交易所写入。实验场 Candidate 仍只是 `candidate_for_validation`，不能自动部署。

目标闭环：

```text
Strategy Version
-> 创建 Paper Deployment（未启动）
-> Preflight
-> 显式启动
-> 多实例后台非重叠运行
-> Overview 多曲线比较
-> Detail 查看轨迹、交易、配置和数据
-> 安全停止 / 归档
-> Web/API 重启恢复
```

## 强制安全边界

- 全程 Paper Only，`exchangeWriteAllowed=false`。
- 唯一动作链保持 `Decision -> Portfolio -> Risk -> Execution`。
- Copilot、Experiment、Candidate、Analysis、Reflection 都不能直接创建运行实例、下单或 Apply Runtime。
- 创建 Deployment、Preflight、Start、Stop、Archive 必须是独立、显式、actor-scoped 的受控动作。
- 禁止实现自动晋升、自动替换 Champion、Live/Canary、真实账户、Secret、交易所写 Adapter；这些属于 M5-M7。
- “模拟 / 真实”切换只改变展示，不得 Start/Stop/切换任何后台实例。
- 每个模拟实例使用独立虚拟账户、持仓、订单、Trace、Artifact、PnL 和安全状态；禁止共享可变账户状态。
- 不得使用 localStorage、内存 Map、Mock/random 曲线或临时 JSON 作为 Deployment/Run 权威事实源。
- 不得改写或清空 `data/local-paper-workspace*` 来制造验收数据，不得提交 SQLite、Token、Secret、Evidence 或浏览器产物。
- 禁止要求用户人工操作浏览器；Agent Chrome 不可用时如实保持 M4 `IN_PROGRESS`。

## 第一阶段：审计现有 Runtime 与性能

先阅读并复用现有能力：

- Current Crypto Paper Runtime binding、Approved Paper Plan/Run、Preflight、Safety Store；
- Paper account、execution、cycle journal、Artifact Ledger、Runtime Evidence；
- Sequential Cycle Runner 和非重叠执行约束；
- M3 的 Strategy Version、Experiment/Candidate 与 Dataset/Graph lineage；
- 当前交易页挂载生命周期和 M2/M3 已建立的有界 host/epoch 模式。

必须先回答并用测试锁定：

1. 当前哪些组件隐含单例 account/run，哪些可安全参数化为 deployment scope；
2. `npm run dev:paper` 启动时哪些任务自动启动，是否会扫描/恢复全部实例并造成页面卡顿；
3. 如何在不阻塞 API/UI 的前提下对多个实例做有界、非重叠调度；
4. Web 离开交易页后是否会停止轮询并取消陈旧请求；
5. 哪些现有表需要显式 `deployment_id/run_id/account_id` 归属或新建只读投影。

性能护栏：服务启动不得自动执行无限历史回放或同步跑完所有 Deployment；恢复只重建调度状态，后台周期必须有全局并发上限、单实例 non-overlap 和退避。

## 第二阶段：严格领域合同与 SQLite 权威模型

新增或收敛以下严格 Zod 合同，全部 `.strict()`：

### Paper Deployment

- `deploymentId`、actor、name、lifecycle；
- Strategy Version / executable configuration ref；
- Dataset/version/fingerprint、Graph/Plan/Profile、Market refs；
- virtual account ref、initial capital、fee/slippage/execution model 的真实来源；
- schedule interval、createdAt、startedAt、stoppedAt、archivedAt；
- latest run/cycle/heartbeat、health、failure policy；
- `runtimeApplied=false`（表示未触及 Live Runtime）与 `exchangeWriteAllowed=false`。

### 生命周期

建议最小状态机：

```text
draft -> preflight_passed -> running -> stopping -> stopped -> archived
                         \-> failed / close_only
stopped -> preflight_passed -> running
```

- 非法跳转 fail closed；Archive 后不可恢复运行。
- Start 必须要求最新 Preflight 与同一不可变 source fingerprint。
- source/Dataset/Graph/Execution/Risk 漂移时状态为 stale/blocked，不能静默改用 latest Draft。
- 重复命令同 key 同 request 幂等；同 key 不同 request 冲突。

### Repository / API

- SQLite append-only definition/event 或等价不可变聚合；禁止 UPDATE/DELETE 已锁定 definition/event。
- actor isolation；所有列表/detail/action 都从 Bearer actor 派生身份。
- 版本化、kind-bound、actor-bound cursor，`LIMIT limit + 1`。
- API 最少包含 catalog、deployment list/detail、create、preflight、start、stop、archive、overview、cycles/trades/artifacts 分页。
- 未知资源 404、已知资源未知方法 405、未认证 401、跨 actor 404/fail closed；错误只返回稳定 code。
- 客户端不得提交 account balance、PnL、position、trade、health、winner、runtime flag 或 executor implementation。

## 第三阶段：多实例运行与隔离

- 从 actor-owned、可 materialize、非 stale 的 Strategy Version 创建 Deployment。
- V1 至少支持 2 个、最多 10 个非归档 Deployment；上限写入服务端策略。
- 每个 Deployment 分配独立 Paper account 和独立 runtime scope。
- 调度器必须有：全局并发上限、单 Deployment non-overlap、lease/fencing、heartbeat、失败计数、退避、close-only 和安全停止。
- 一个实例失败不能阻塞其他实例，也不能污染其他账户或 Evidence。
- Stop 语义明确：停止新周期；有持仓时默认 close-only/受控退出，不得直接丢弃持仓。
- 服务重启恢复 running/stopping/close-only 状态；不得把 terminal run 恢复成 active。
- 所有交易事实继续来自现有 Paper execution 和唯一动作链，不建立第二套模拟撮合器。
- Overview 曲线从持久化账户/周期事实投影；不同起始时间支持共同区间和标准化收益，不能客户端伪造比较基线。

## 第四阶段：交易页信息架构

在交易 Agent 页顶部增加“模拟 / 真实”分段选择器：

- 切换不产生 Runtime 副作用；刷新恢复的是视图偏好，不是运行控制。
- “真实”视图保持当前能力边界，并明确 `Live unavailable / exchange writes off`；不能把 Paper 叫做真实成交。
- “模拟”视图包含 Overview 和 Detail 两层，不复制一套独立页面壳。

### 模拟 Overview

- 多曲线总览：最多同时选择 5 条；默认标准化收益，可切换绝对权益；显示共同区间和数据缺口。
- 实例列表：状态、策略版本、运行时长、累计收益、最大回撤、交易数、健康、最后心跳。
- 创建入口：选择 Strategy Version、名称、初始资金、频率；先创建再 Preflight/Start。
- 清晰区分 running、stopped、failed、close-only、archived 和 stale。
- 曲线必须有界降采样，长历史不得向 DOM 写入每个原始点。

### Paper Run Detail

至少提供五个子 Tab：

1. 表现：equity、return、drawdown、交易/费用/风险拒绝；
2. Agent 轨迹：按 cycle 查看输入、分析、Decision、Portfolio、Risk、Execution 和 Reflection Evidence；
3. 交易：订单、成交、持仓、费用与可追溯 lineage；
4. 配置与数据：Strategy/Draft、Dataset fingerprint、Graph、Profile、Execution/Risk snapshot；
5. 晋升评估：只读显示 Experiment/Candidate/约束/运行时长等事实，输出“数据不足/可继续观察/可提交后续验证”，不得自动审批或替换。

UI 要求：

- 中文/英文、1440×900 和 820×760 无横向滚动、无遮挡；键盘 focus 可见。
- actor/route/deployment 切换使用 AbortController + epoch，旧响应不能串实例。
- mount/unmount 有界；禁止 MutationObserver 监听自身 render 形成循环。
- 页面空闲时请求频率有界，详情数据按 Tab 懒加载并分页。
- Console 不写大对象、Token、完整 Evidence 或敏感账户数据。

## 第五阶段：行为测试

新增独立测试，最低覆盖：

1. contracts 严格字段、非法 ID/状态/数值/未知字段拒绝；
2. Repository actor isolation、append-only、重启恢复、cursor 与幂等冲突；
3. 2 个实例独立 account/position/order/trace/artifact/PnL；
4. scheduler 全局并发有界、单实例不重叠、lease/fencing、失败隔离与退避；
5. create -> preflight -> start -> stop -> restart -> archive 正向和非法跳转负向；
6. source/Dataset fingerprint 漂移 fail closed；
7. 重启恢复 active/terminal 状态正确；
8. overview 曲线和指标来自持久事实，共同区间/标准化计算可复现；
9. Web 视图切换无副作用、表单状态稳定、stale response 隔离、降采样有界；
10. API 认证、跨 actor、方法/路由、畸形 percent ID、oversized body 和错误脱敏；
11. 无 Live、Approval、自动 Candidate 部署、exchange-write 路径；
12. M1 历史会话、M2 Dataset Binding、M3 Experiment/Replay/Candidate 不回归。

测试总数必须高于 353；不得只增加 smoke test。

## 第六阶段：自动化与 Agent Chrome 验收

先运行：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

然后由 Agent 直接控制真实 Google Chrome，使用单一当前代码的 `npm run dev:paper`：

### 中文 1440×900

1. 进入交易 Agent，确认“模拟 / 真实”切换只改变视图。
2. 通过可见 UI 从两个不同 Strategy Version 各创建一个 Deployment。
3. 分别 Preflight、Start，确认两个实例同时 running、账户/曲线/交易事实独立。
4. 等待至少多个真实周期；Overview 曲线、收益、回撤、交易数、heartbeat 更新且页面不卡顿。
5. 在两个实例间快速切换 Detail 与五个子 Tab，确认数据不串台。
6. 停止其中一个，另一个继续运行；归档 stopped 实例，running 实例不受影响。
7. 刷新 Web 并重启本项目 Web/API，确认状态、曲线、账户、Detail 和选择恢复。
8. 切到“真实”，确认 Live unavailable、Exchange writes OFF；再切回模拟，后台实例状态未改变。

### English 820×760

- 重复 Overview/Detail/视图切换关键路径；无横向滚动、无遮挡，focus 可见。

### 负向与 Console

- 未 Preflight 时 Start 禁用/拒绝；跨 actor/失效 Strategy/stale fingerprint fail closed。
- 重复 Start/Stop/Archive 不产生重复 Run/Event。
- Console 清理后 TradeBot 页面 error 为 0；扩展自身异步消息错误单独标注。
- 若 Agent Chrome 提供 Network，只报告非敏感 `method path status` 并确认无意外 401/5xx；不可用则记录 `TOOL_UNAVAILABLE`，禁止人工或其他工具替代。

全程确认：

```text
runtimeApplied=false
Paper Only
exchangeWriteAllowed=false
```

## M4 关闭规则

只有合同、持久化、多实例隔离、调度、Overview/Detail、自动化和 Agent Chrome 全部通过，才能把 M4 标为 `COMPLETE`。

完成时创建唯一 `LOOP-022` 进入 M5 Shadow 与晋升建议；未完成时 `LOOP-022` 继续 M4。无论完成与否，新的 Prompt 文件名必须唯一编号，不得覆盖本文件。

## Git 与最终报告

- 检查 staged diff，禁止提交 `data/local-paper-workspace*`、SQLite、Token、Secret、Evidence、截图或浏览器文件。
- 创建范围明确的 commit 并 push 当前分支到 `origin`；验证远端 ref 与本地 HEAD 一致。
- 不创建 PR，除非用户明确要求。

最终报告至少包含：Loop ID、浏览器模式、合同/Repository/多实例隔离/调度/UI/恢复/双尺寸/Console/Network/Runtime safety、自动化总数、M4 状态、下一 Loop、commit hash、branch、push 结果。
