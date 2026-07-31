# TradeBot Registered Semantic Input Execution and Decision Context Assembly Loop

你现在继续开发 `/Users/hyx/Documents/workspace/tradebot`。先检查 Git 工作区并完整保留全部用户未提交修改，禁止破坏性 Git 命令，不要提交 Git。

## 目标

在现有 Generic Configurable Semantic Pipeline Preview 之后，接入第一个服务端注册的通用 Semantic Input Executor 和 Agent Adapter 链，使已验证配置能够产生现有 `MarketObservationArtifact` 与 `AgentSemanticAssessment`，并在真实 Portfolio、Risk、Data Quality 历史快照齐备时组装现有 `DecisionSemanticContext`。市场类型只能作为 Market Pack 元数据，不得硬编码为一级产品流程。

## 边界与交付

复用现有 Data Source Capability、Artifact Lineage、Agent Template、Historical Graph Executor 和 `DecisionSemanticContextSchema`；不得执行客户端代码，不得接受 URL、SQL、Runner、模块、路径、Secret、账户或 Runtime 参数。数据加载器和 Agent 实现只能由服务端注册。Capability 不兼容、未来数据、Schema 漂移、lineage 缺失、Portfolio/Risk 快照缺失均 fail closed。

至少交付：一个有界本地注册事实源、一个拆解 Agent、两个分析 Agent、不可变语义 Artifact 持久化、幂等执行、Bearer API、Decision Context ready/unavailable/stale 状态、现有 Copilot 的稀疏结果展示以及严格注入测试。所有结果保持 `decisionContextApplied=false`、`runtimeApplied=false`、`exchangeWriteAllowed=false`，不改变 DecisionPipeline、Selector、Position Monitor、Risk、Execution 或 Paper Runtime。

运行 check、全部 TypeScript tests、Web build、diff-check 和 dev:paper；完成桌面/窄屏中英文浏览器验证，浏览器不可用时如实记录。更新 Roadmap、Handoff，归档本 Prompt 并生成下一阶段 Prompt。

本 Prompt 已于 2026-07-31 直接执行。
