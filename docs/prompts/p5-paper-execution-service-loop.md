# P5.2 开发 Loop Prompt：纸面执行服务、风控拒绝与权益重算

## 前置阅读

- `docs/prompts/p5-paper-execution-loop.md`
- `src/storage.py` 中全部 `Simulation*Record` 模型
- `src/services/simulation_strategy_service.py`
- `src/core/backtest_engine.py`
- `data_provider/` 的本地行情读取接口

P5.1 已有独立的 SimulationAccount、SimulationOrder、SimulationFill、SimulationPosition 和 SimulationEquitySnapshot 模型，但没有执行服务或 API。

## 目标

实现一个可重算、可拒绝、幂等的纸面执行服务：将有完整结构化决策证据的 completed SimulationRun 转换为独立模拟账本，不涉及真实账户。

## 必须实现

1. `SimulationPaperExecutionService` 与 repository：
   - 创建模拟账户；
   - 执行 completed run；
   - 查询账户、订单、成交、持仓、权益快照；
   - 所有写入使用单个 SQLite 事务与现有锁重试机制。
2. 决策解析必须 fail closed：仅接受规范化 buy/add/reduce/sell、股票代码、数量或可确定的仓位规则，以及可追溯行情价格。
3. 定价与风控：最小交易单位、可用现金、卖出可用数量、最大单标的仓位、手续费、滑点均必须确定性计算。
4. 拒绝记录：行情缺失、无决策证据、资金不足、仓位超限、重复执行均生成或返回可追溯原因，绝不静默成功。
5. 幂等：同一 run 同一 account 重复调用不得重复 fill、重复扣款或重复持仓。
6. 每次成交后写权益快照，且 `equity = cash + positions market value` 可重算。
7. FastAPI 端点与 Pydantic schema；所有响应标注为 simulation/paper，避免和 portfolio 混淆。

## 硬约束

- 仅消费 `SimulationRun.status == completed`；failed/queued/running 直接拒绝。
- 不使用 React 演示数据、固定价格或模拟净值作为成交依据。
- 不写入 portfolio、alerts、backtest 或外部券商。
- 金额计算采用 Decimal 或明确的分单位整数，不能以 float 累积作为资金权威。
- 无真实可执行证据时宁可 rejected，也不能创建成交。

## 验收

1. Docker 中验证：成功成交、行情缺失拒绝、资金不足拒绝、重复执行幂等四条路径。
2. 查询 API 可从 account → order/fill/position/snapshot → run/version 追溯。
3. 测试后清理验证数据；更新 roadmap、simulation docs 和 changelog。
4. P5.2 完成后，下一阶段才可做纸面账户前端工作台和 P6 有效性评估。
