# TradeBot Accepted Candidate Draft Binding and Contract Validation Loop

本文件保存 2026-07-31 已执行 Loop 的原始任务。执行范围、边界和测试要求与执行前的 `docs/next-loop-prompt.md` 一致。

## 目标

把已接受的 Lesson Candidate 通过不可变、服务端拥有的 binding 关联到现有 Configuration Draft Version 和 Pipeline Graph Version，并复用现有 Configuration Validation / Pipeline Graph Validator 产生真实 Contract Validation 状态。

## 已执行边界

- 客户端只提交 `selectedTradeId` 和幂等键。
- Candidate、Review、Evidence、Draft、Graph、Actor 和 fingerprint 全部由服务端解析。
- Binding SQLite append-only，版本具备 parent fingerprint。
- 复用现有 Configuration Draft Service 和 Pipeline Graph Validator。
- Validation passed 后下一门禁仅为 Backtest。
- 不创建 Approved Lesson、Evidence Job、Strategy mutation 或 Runtime apply。
- 保持 Paper Only、`runtimeApplied=false`、`exchangeWriteAllowed=false`。

详细交付结果见 `docs/project-status-and-handoff.md`。
