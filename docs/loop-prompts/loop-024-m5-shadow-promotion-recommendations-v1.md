# LOOP-024 — M5 Shadow 与晋升建议 V1

Loop ID：LOOP-024
里程碑：M5 Shadow 与晋升建议
状态：READY
前置 Loop：LOOP-023（M4 COMPLETE）
执行环境：本地仓库 + 实现后由 Agent 直接控制真实 Google Chrome
验收模式：SHADOW_READ_ONLY_EVIDENCE_AND_AGENT_CHROME_VERIFIED
Git 要求：任何代码或文档修改都必须 commit 并 push；不创建 PR

## 已完成基线

LOOP-023 已关闭 M4：服务端已使用现有 Current Crypto `Decision -> Portfolio -> Risk -> Execution` Paper 链执行多个 deployment-scoped 实例；账户、持仓、订单、交易、Trace、Artifact、PnL、lease/fencing 和 scheduler scope 已隔离。真实 Chrome 已验证两个不同 Strategy Version 的实例、close-only `close_long`、刷新、Web/API 重启、中文 1440×900、英文 820×760 和 `Paper Only` 边界。

不得删除、替代或通过页面轮询驱动这条 M4 链路。

## M5 目标与安全边界

为一个已存在的 M4 Paper Deployment 构建独立、只读的 Shadow decision/evidence 闭环，并生成版本化的 Promotion Recommendation。Shadow 是观察和比较能力，不是新的 Paper 或 Live Runtime。

- 全程保持 `runtimeApplied=false`、`exchangeWriteAllowed=false`、Paper Only。
- M5 不实现 Live、Canary、真实账户、交易所写 Adapter、自动 Start/Stop、自动晋升、Champion 替换、持仓迁移或 Runtime Apply。
- Shadow 不得写入 M4 Paper account、position、order、fill、cycle journal、risk/safety state 或既有 Artifact；如需持久化，使用独立 actor/deployment/run scope 的 append-only Shadow 事实。
- 只接受服务端物化的 immutable Strategy Version、Dataset、Graph、Execution、Risk、M4 cycle/account snapshot 和 Artifact lineage；客户端不得提交 prices、positions、PnL、decision、policy、候选版本、SQL、URL、path、runner 或实现。
- 任何 source/Dataset/Graph/Execution/Risk/account/Artifact fingerprint 漂移或证据缺失都必须 explicit unavailable/stale/fail closed，不推测、补造或静默读取 latest。
- 禁止清空、改写或提交 `data/local-paper-workspace*`、SQLite、Token、Evidence、截图、浏览器缓存或运行日志来制造验收。

## 交付要求

1. 定义严格的 Shadow definition、run、cycle、comparison 和 recommendation contracts；所有持久 definition/event/projection append-only、actor-scoped、cursor-bound、幂等且可恢复。
2. 从一个明确 M4 deployment/run/cycle 读取只读 snapshot，构造与原 Paper 运行隔离的 Shadow Decision Context；显式保留 source/lineage fingerprint 与 as-of 时间。
3. Shadow 只能调用受限、服务端注册的只读 decision/evidence adapter；不得调用 Execution Port，且必须验证不存在 Paper/Live 写入。
4. 对 Champion/Challenger 使用同一 scope 和可复现口径输出差异：decision、risk、expected exposure、数据质量、health 与证据缺口。不得把描述性差异称为因果或收益保证。
5. 定义版本化 Promotion Policy，并由服务端仅生成 `insufficient_data`、`observe`、`recommend_validation` 或等价只读建议。Recommendation 永远不能批准、部署、替换 Champion 或改变运行实例。
6. 在现有交易 Agent/M4 中心复用只读入口；明确显示 Shadow 状态、来源 deployment/cycle、scope、freshness、缺失原因、对比与 recommendation。不可用时不显示伪造分数或曲线。
7. UI 保持中英文、AbortController/epoch 隔离、有界分页和无副作用的 Simulation/Live 切换；不得新增第二个运行控制入口。

## 自动化与 Chrome 验收

新增行为级测试，保持全量通过，至少覆盖：

- 读取一个真实 M4 Paper snapshot 后生成独立 Shadow 事实；
- 账户/订单/成交/安全状态零写入，Execution adapter 不可达；
- actor、deployment、run、cycle、cursor 与 recommendation scope 隔离；
- stale/missing/ambiguous lineage 失败关闭；
- 幂等、并发、恢复和 terminal recommendation 不重复；
- Promotion Recommendation 只读，不能启动、停止、归档、Apply Runtime、替换 Champion 或写交易所；
- M1-M4、特别是 M4 双实例调度和 close-only 不回归。

执行并记录 `npm run check`、`npm run test:ts`、`npm run build:web` 和 `git diff --check`。

然后由 Agent 直接控制真实 Chrome：在中文 1440×900 和英文 820×760 选择有真实 M4 事实的实例，查看 Shadow 来源/差异/建议/不可用或 stale 状态；快速切换实例与页面、刷新和 Web/API 重启后确认不串台且不产生交易动作。检查 Console；若 Network 或 Console clear 能力不可用，记录 `TOOL_UNAVAILABLE`，不得改为人工验收。

## 关闭规则

仅当 Shadow 真实消费 M4 持久事实、全程无交易写入、Recommendation 只读、自动化及双尺寸 Agent Chrome 均通过时，才标记 M5 `COMPLETE`。否则保持 `IN_PROGRESS` 并创建唯一编号后续 Prompt；不得覆盖本文件。

最终更新产品计划、路线图、交接和 `next-loop-prompt.md`；确认不会提交本地运行产物；commit 并 push 当前分支，不创建 PR。
