# P5.3 开发 Loop Prompt：纸面账户工作台、运行选择与拒绝回放

## 前置阅读

- `docs/prompts/p5-paper-execution-service-loop.md`
- `docs/strategy-lab-roadmap.md`
- `apps/dsa-web/src/pages/SimulationTradingPage.tsx`
- `api/v1/endpoints/simulation.py`
- `src/services/simulation_paper_execution_service.py`

当前已能创建单个独立纸面账户，页面可显示创建后的初始现金和权益；尚无账户列表、账户切换、运行选择或订单回放。

## 目标

把纸面账户区从单次创建表单变成可审阅的工作台：用户能选择账户、查看初始权益、从完成的模拟运行中选择回放对象，并看到订单是否因证据/行情/风控不足而被拒绝。页面优先，真实成交仍属于后续切片。

## 本轮范围

1. 后端：增加纸面账户列表/详情 API，返回账户、初始权益快照及该账户的订单摘要；不得读取 portfolio 表。
2. 后端：增加“为账户准备执行某个 completed run”的 API，复用 fail-closed 服务；若 P4 没有可信结构化决策，创建或返回 `rejected` 订单和明确原因。
3. 前端：
   - 账户选择器、空状态与创建账户入口；
   - 最近 completed/failed/queued 运行列表，只有 completed 可选为回放对象；
   - 订单时间线显示 `pending/rejected/filled`（本轮正常主要为 rejected）；
   - 拒绝原因、关联 run 与策略版本可见；
   - 任何未接通成交能力都显示“待接入”，不得显示虚构持仓或收益。
4. 提供刷新、加载失败、无账户、无 completed 运行、无订单四种状态。

## 硬约束

- 只执行 completed SimulationRun；其他状态不可执行，界面解释原因。
- 同一账户 + 同一 run 重复准备执行必须幂等。
- 不用 UI 演示数据创建订单、成交或权益变化。
- 不修改 portfolio、alerts、backtest、真实交易。
- 保持 Docker 部署、移动端可读、aria-live 状态反馈。

## 验收

1. 可创建两个纸面账户并切换，数据只来自 simulation_* 表。
2. 选择 completed 运行后，能看到可追溯的 rejected 订单或幂等返回；没有结构化决策时不产生 fill。
3. 页面准确表达等待、拒绝和待接入，不暗示真实成交。
4. 运行针对性 API/持久化验证、前端 lint/build、Docker health check；清理测试数据并更新文档。

## 完成时汇报

说明账户/运行/订单回放的页面路径、API、验证结果和仍待接入的成交能力；下一步限定为真实结构化决策适配与纸面 fill/position 计算。
