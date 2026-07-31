# TradeBot Approved Lesson Semantic Materialization Loop

本 Loop 已于 2026-07-31 执行。目标是把 Approved Lesson Artifact 服务端物化为现有 `ApprovedReflectionLessonSchema`，并形成始终未应用的 Shadow Decision Context Projection。

生产 Reflection Report 当前不包含完整语义 Candidate，必须返回 `semantic_facts_unavailable`，不得由客户端或 LLM 补写。
