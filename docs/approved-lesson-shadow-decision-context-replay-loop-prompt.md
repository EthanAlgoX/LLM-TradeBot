# TradeBot Approved Lesson Shadow Decision Context Replay Loop

本 Prompt 已执行。目标是从现有只读 Agent Artifact Ledger、Paper Trade、Semantic Candidate 和 Approved Lesson 构造并验证 `DecisionSemanticContextSchema` Shadow Replay，同时保持 `decisionContextApplied=false`、`runtimeApplied=false` 和 `exchangeWriteAllowed=false`。

实现边界：不创建第二套 Context；历史事实不足时 unavailable；Market 或 Artifact fingerprint 漂移时 stale；不连接活跃 DecisionPipeline；仅增加可审计历史快照记录，不改变 Agent 决策和交易动作。
