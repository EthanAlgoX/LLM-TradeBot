# TradeBot Generic Configurable Input and Multi-Agent Semantic Pipeline Loop

你现在继续开发 `/Users/hyx/Documents/workspace/tradebot`。先检查 Git 工作区，完整保留全部用户未提交修改；禁止 `git reset`、`git checkout --`、`git clean` 和覆盖无关修改，不要提交 Git。

## 产品校正

TradeBot 的一级能力不是分别支持 A 股、港股、美股或币圈，而是一个输入与 Agent 均可配置的多智能体交易系统。Market Pack 只负责描述输入语义、日历和执行规则；任意市场、行情、事件、财报或其他结构化事实都必须通过服务端注册 Data Source、Capability 和 Schema 接入。

## 本轮目标

复用现有 Configuration Draft、Registry、Capability、Agent Template、Observation Window、Pipeline Graph 和语义 Artifact 合同，建立市场无关的真实垂直切片：

```text
immutable Strategy / Agent Configuration Draft
-> registered Data Source + Capability resolution
-> configurable decomposition / analysis Agent topology
-> registered semantic input execution gate
-> Decision Context assembly gate
```

不得建立第二套 Draft、Agent、Graph、Evidence 或 Approval。客户端不得提交代码、模块、Runner、URL、SQL、文件路径、Secret、Runtime 参数或 Agent 实现。服务端必须返回稳定版本、fingerprint、Capability 和 Observation Window lineage，并明确 `decisionContextCreated=false`、`runtimeApplied=false`、`exchangeWriteAllowed=false`。

## 交付

1. 增加严格语义管线预览合同与服务，输入只允许现有 Strategy Configuration Version 和幂等键。
2. 从服务端 Registry 解析 Market Pack、Data Source Capability、Agent Template 和多 Agent 配置；未注册引用 fail closed。
3. 增加 Bearer API，Actor/Role 由服务端派生，未知字段严格拒绝。
4. 返回多 Agent 拓扑、Observation Window、输入/输出语义 Artifact 类型、Validation issue 和下一门禁。
5. Web 至少具备 loading、validation_failed、execution_required、ready、unavailable 状态模型，不提供 Runtime Apply 或交易操作。
6. 更新 PRODUCT、Roadmap、Handoff 和下一阶段 Prompt，明确产品已经从“按市场列功能”校正为“通用输入 + 可配置 Agent”。
7. 运行 `npm run check`、`npm run test:ts`、`npm run build:web`、`git diff --check` 和 `npm run dev:paper`；真实浏览器不可用时如实记录。

本 Prompt 已于 2026-07-31 直接执行。
