# P4 开发 Loop Prompt：多 Agent 模拟运行时

先阅读 `docs/strategy-lab-roadmap.md`、`docs/simulation-trading.md`、`docs/prompts/p3-strategy-editor-loop.md`、`src/agent/orchestrator.py`、`src/services/simulation_strategy_service.py` 和 `api/v1/endpoints/simulation.py`。

## 目标

让一个**已保存的策略版本**实际进入原项目的多 Agent 编排，并保存可回放的运行证据：输入快照、每个 Agent 的 Prompt/输入/输出、候选池、决策、反思和异常。运行结果与真实持仓、告警、回测、券商完全隔离。

## 必须复用

- `AgentOrchestrator` 的 quick / standard / full / specialist 四种模式。
- 既有选股、历史分析、决策信号与 Skill 资产只能作为只读输入。
- P1/P3 的 `SimulationStrategyVersionRecord` 和 `SimulationRunRecord`：运行必须关联版本 ID，绝不直接引用可变 UI 状态。

## 本轮范围

1. 为 SimulationRun 增加可序列化的事件/步骤记录；至少有 input、analysis、screening、risk、decision、reflection 六类阶段。
2. 增加“执行已记录运行” API。运行状态严格遵循 queued → running → completed / failed；只有真正执行成功才 completed。
3. 以策略版本 config 构建运行上下文；对缺少股票标的、LLM 配置、数据源或编排失败保存明确错误事件和失败状态。
4. 提供运行详情 API，前端展示运行状态、阶段时间线、输入摘要与错误信息；可重试失败或 queued 运行。
5. 不生成纸面订单、持仓、收益或有效性结论（P5/P6 范围）。

## 硬约束

- 不伪造 Agent 输出；没有可执行上下文必须 failed/degraded，并说明恢复动作。
- Prompt、输入和输出均写入运行快照，敏感内容按现有脱敏规则处理。
- 不修改历史 AnalysisHistory 或真实领域资产。
- 异步/长任务不能阻塞 API worker；采用已有任务机制或后台任务，并保持运行可查询。
- 所有数据库变更兼容已有 SQLite。

## 验收

- 完整运行可查看各阶段事件；失败运行也有可解释错误。
- 同一版本重试生成新的 run，不覆盖旧 run。
- 页面能触发运行、刷新状态和查看详情。
- lint/build、后端针对性测试、Docker health check 均通过；更新 roadmap、simulation docs、changelog。
