# TradeBot Generic Historical Semantic Evaluation Loop

你现在继续开发 `/Users/hyx/Documents/workspace/tradebot`。先检查 Git 工作区并完整保留全部用户未提交修改，禁止破坏性 Git 命令，不要提交 Git。

## 目标

把已持久化的通用 Semantic Pipeline Execution Record 接入现有 Historical Graph Executor、Graph Backtest、Walk-Forward、Strategy Evidence 和 Human Approval 链，证明同一组注册输入、Agent 配置和语义 Artifact 可以可复现地完成历史评估，而不依赖固定 Crypto 运行模板。

## 边界与交付

复用现有 Historical Graph Plan/Executor、Evidence Job、Artifact、Strategy Evidence Binding 和 Approval；不得创建第二套 Backtest、Walk-Forward 或 Approval。客户端只允许选择服务端已知的 Semantic Execution / Configuration 引用与幂等键，Dataset、Runner、Profile、Graph、Evidence、Actor 和时间范围全部由服务端解析。任何 Source、Capability、Configuration、Agent、Artifact 或 lineage fingerprint 漂移都必须 stale/fail closed。

至少覆盖：通用 bar input 与 event input 两条历史语义评估、相同输入可重放、未来数据拒绝、Capability 不兼容、Agent Adapter 漂移、Backtest/Walk-Forward 双门禁、Human Approval 前置阻断、Bearer 注入拒绝、Web Evidence 状态和现有交易安全回归。结果仍不得自动应用 Runtime；Paper Runtime 迁移必须留到独立后续 Loop。

运行 check、全部 TypeScript tests、Web build、diff-check 和 dev:paper；浏览器不可用时如实记录。更新 Roadmap、Handoff，归档本 Prompt 并生成下一阶段 Prompt。

本 Prompt 已于 2026-07-31 直接执行。
