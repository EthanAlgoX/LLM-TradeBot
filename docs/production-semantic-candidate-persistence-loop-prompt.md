# TradeBot Production Semantic Candidate Persistence Loop

本 Prompt 已执行。目标是让生产 Reflection 链路持久化真实 `ReflectionLessonCandidateSchema`，与 Review Candidate 建立可验证 fingerprint 绑定，并保持 Candidate、Lesson 和 Shadow Projection 全部不进入活跃 DecisionPipeline。

实现边界：复用现有语义合同；仅使用服务端失败 Trade、Decision Artifact、Market Pack、Reflection Agent Config 和 Evidence lineage；事实不足不生成；SQLite append-only；客户端不能上传 Candidate 或 Runtime 参数；Paper Only 和交易安全链保持不变。
