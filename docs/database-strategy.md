# 策略定义存储

策略定义使用既有 `simulation_*` 隔离表：`simulation_strategies`、`simulation_strategy_versions`、`simulation_agent_instances`、`simulation_agent_connections`、`simulation_audit_events` 和 `simulation_publish_requests`。版本号在 SQLite 部分唯一索引中按策略唯一；`lineage_id` 为 Agent 建立跨版本索引；成本上限为 `Numeric(18,6)`。

`2026-08-10-strategy-definition-v1` 是可重复的增量 schema migration：它仅增加列、索引及默认值回填，不删除旧 JSON 配置或旧 simulation 数据。草稿保存、发布和复制草稿均在数据库事务内；审计事件与业务结果同事务提交。

冲突本地分叉幂等记录位于 `simulation_strategy_fork_requests`，保存源 Draft、幂等键、请求 hash 与生成 Strategy/Draft。副本重新生成 Agent ID 与 lineage，并按新 ID 重建 Connection；原 Draft 始终不被写入。

## 自动选股研究运行

`simulation_strategy_versions.screening_policy_json` 随草稿保存并在发布后不可变，保存 `strategy`、`market` 与 `maxCandidates`。旧版本的空值按兼容默认值 `dual_low / cn / 3` 解释，但新策略应在编辑器中显式保存该配置。

`simulation_strategy_run_batches` 是自动扫描研究的父记录，关联一个不可变正式版本，冻结选股参数、候选快照、后台状态和失败信息。每一个候选仍用既有 `simulation_runs` 创建独立研究图运行，因此版本、输入和 Agent 轨迹都可追溯。父批次不关联订单、成交、持仓或权益表。

`2026-08-14-strategy-runtime-screening-v1` 是增量迁移标记；新父表由 `metadata.create_all` 建立，现有 SQLite 的 `screening_policy_json` 使用 `ALTER TABLE` 追加，历史 JSON 和历史运行不会被重写。

`simulation_strategy_run_controls` 保存持续研究的用户意图，而不是某次执行结果：一个不可变正式版本至多一个控制记录，包含 `running`、`paused` 或 `terminated` 状态、间隔、下次触发时间和最近批次。持续控制重启后可恢复；每一周期仍创建独立 `simulation_strategy_run_batches`，因此暂停/终止不会破坏已经开始的批次记录。`2026-08-14-strategy-continuous-research-v1` 记录该增量 schema。
