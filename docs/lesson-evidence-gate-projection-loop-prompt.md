# TradeBot Lesson Evidence Gate Projection Loop

本 Loop 已于 2026-07-31 执行。目标是把 `validation_passed` Candidate Validation Binding 服务端关联到现有 Strategy Evidence Binding，并复用现有 Backtest、Walk-Forward Job 和 Artifact 校验链路。

交付边界：客户端只提交 Trade、幂等键与受限动作；Evidence Scope、Actor、Runner、Evidence 和 Approval 均由服务端控制；本轮不执行 Human Approval、不创建 Approved Lesson、不修改 Strategy、Pipeline 或 Runtime。

完整执行合同来自此前的 `docs/next-loop-prompt.md`，完成后下一阶段切换为 Lesson Human Approval Loop。
