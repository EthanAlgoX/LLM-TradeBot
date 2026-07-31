# TradeBot Lesson Human Approval Loop

本 Loop 已于 2026-07-31 执行。目标是把 `approval_required` Evidence Gate 收敛为 Lesson 专属、不可变、可审计的 Human Approval，并创建仍未进入 Decision Context 的 Approved Lesson Artifact。

边界：不调用 Strategy Approval，不创建 Approved Paper Plan，不修改 Strategy、Pipeline、Decision Context 或 Runtime；客户端只能提交 Trade、approve/reject、rationale 和幂等键。
