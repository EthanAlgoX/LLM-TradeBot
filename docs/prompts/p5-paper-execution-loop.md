# P5.1 开发 Loop Prompt：纸面成交、持仓与确定性执行

## 上下文

先阅读：

- `docs/prompts/p5-paper-ledger-loop.md`
- `docs/strategy-lab-roadmap.md`
- `src/storage.py` 中的 `SimulationAccountRecord`、`SimulationOrderRecord`、`SimulationEquitySnapshotRecord`
- `src/services/simulation_strategy_service.py`
- `src/core/backtest_engine.py`

P5 已建立独立的模拟账户、订单、权益快照表，但尚未实现成交、持仓、费用、滑点或执行 API。

## 目标

将一个 **completed 且包含结构化、可执行决策证据** 的 SimulationRun 确定性地转换为纸面订单和成交，并更新独立模拟账户的现金、持仓和权益快照。

## 本轮交付

1. 新增 `SimulationFillRecord`、`SimulationPositionRecord` 与必要的现金账本/费用字段；保持与真实 portfolio 完全分离。
2. 创建模拟账户 API、账户详情 API、订单/成交/持仓/权益快照查询 API。
3. 创建“执行已完成运行到纸面账户”API：
   - 仅接受 `SimulationRun.status == completed`；
   - 仅接受有明确 action、stock_code、quantity/仓位与行情价格证据的结构化决策；
   - 同一 run 的同一决策幂等，重复调用不重复成交；
   - 使用确定性费用、滑点、最小交易单位、现金、最大仓位、集中度检查；
   - 拒绝时写入订单和拒绝原因，禁止静默跳过。
4. 行情缺失、决策不完整、资金不足、风险超限时不得成交，不得用页面演示价格补齐。
5. 账户变化后创建权益快照；现金 + 持仓市值应可重算为 equity。

## 非目标

- 不接真实券商或真实账户。
- 不从 UI 演示订单、静态净值、mock 收益生成账本。
- 不输出策略有效性、胜率或“可跟随”结论。
- 不改动 `portfolio_*`、alerts、backtest 的既有语义。

## 验收

- 可为一个已完成运行创建纸面订单/成交/持仓/权益快照；重复执行保持幂等。
- 无效运行或风险失败有明确订单状态和拒绝原因。
- API 结果可从 account → run → strategy version 追溯。
- 使用 Docker 验证建表、成功/拒绝/重复执行三条路径；清理测试数据。
- 更新 roadmap、simulation docs、changelog。

## 完成时汇报

说明执行规则、定价和风控边界，列出 API 与 Docker 验证结果，并把下一步限定为 P6 策略有效性评估。
