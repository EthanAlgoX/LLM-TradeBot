# P5 开发 Loop Prompt：纸面执行账本与权益曲线

先阅读：

- `docs/strategy-lab-roadmap.md`
- `docs/simulation-trading.md`
- `docs/prompts/p4-agent-runtime-loop.md`
- `src/storage.py` 中的 simulation 与 portfolio 相关模型
- `src/services/simulation_strategy_service.py`
- `src/core/backtest_engine.py`
- `api/v1/endpoints/simulation.py`

## 目标

为已完成的多 Agent 模拟运行建立独立纸面账本：现金、模拟订单、模拟成交、模拟持仓、费用、滑点和权益快照。用户可以按运行回放组合变化，但系统绝不创建真实订单或写入真实 portfolio。

## 前置条件

- 只允许消费状态为 `completed` 且有结构化决策证据的 SimulationRun。
- P4 运行服务必须已部署并能保存阶段事件；缺少有效决策时不得创建订单。
- 每条账本记录必须关联 `simulation_run_id` 和 `strategy_version_id`。

## 本轮范围

### 1. 独立纸面账户与账本模型

- SimulationAccount：初始资金、币种、状态、创建时间。
- SimulationOrder：标的、方向、数量、限价/市价、状态、来源运行、风险边界。
- SimulationFill：成交价、数量、费用、滑点、成交时间。
- SimulationPosition：按账户与标的聚合的数量、成本、已实现/未实现盈亏。
- SimulationEquitySnapshot：现金、市值、权益、回撤、估值时间。

使用新表；禁止复用或写入 portfolio_*、alerts、backtest 领域表。

### 2. 执行规则

- 从 P4 的结构化决策中解析明确的 buy/add/reduce/sell 与目标标的；证据不完整时拒绝执行并保留原因。
- 成交价格来自明确的行情快照；没有行情时订单停留为 pending/failed，不能使用 UI 演示价格。
- 费用、滑点、最小交易单位、现金不足、最大仓位、同标的集中度均应被确定性校验。
- 支持幂等：同一 run 的同一决策不能因重试重复成交。
- 所有计算使用 Decimal 或等价精度策略，不使用浮点累积资金误差。

### 3. API 与前端

- 创建/查看纸面账户；执行某个完成运行；查看订单、成交、持仓和权益曲线。
- 在模拟交易页新增“纸面账户”区，但空状态必须告诉用户需要先完成 Agent 运行。
- 显示订单状态与拒绝原因；运行失败、未完成、证据不足时不能出现可成交的视觉暗示。
- 历史运行可回放其订单、持仓和权益快照；桌面与移动端均可读。

## 非目标与硬约束

- 不接券商、交易所或真实账户；不复用真实持仓数据。
- 不输出“策略有效”或“可跟随”结论（P6/P7）。
- 不用静态演示订单伪装账本结果。
- 不修改已有 portfolio、backtest、alerts 行为。
- 保持 SQLite 数据库兼容，新表与迁移需安全。
- 更新 `docs/strategy-lab-roadmap.md`、`docs/simulation-trading.md` 与 `docs/CHANGELOG.md`。
- 使用 Docker 服务完成验证；前端 lint/build、后端针对性测试、Docker health check 必须通过。

## 验收标准

1. 一条完成且证据完整的模拟运行，只能生成一组可追溯的纸面订单与成交。
2. 现金、持仓、费用、滑点与权益快照可由账本重新计算并与 API 一致。
3. 缺少行情、资金不足、风险越界和无效决策均被拒绝并记录明确原因。
4. 页面能区分“无运行”“运行未完成”“订单待成交”“已成交”“拒绝”，且不暗示真实交易。
5. 所有账本记录可从 account → run → strategy version 追溯，且不影响任何真实资产。

## 完成时汇报

说明纸面账本的数据模型、执行规则、API 和页面入口；列出验证结果、Docker 状态，并将下一步限定为 P6 策略有效性评估。
