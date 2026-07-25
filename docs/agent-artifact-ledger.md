# Agent Artifact Ledger

每次 TradeBot cycle 都有一个 `traceId`。当运行命令提供 `--artifact-db` 时，Pipeline 会把每个 Agent 调用的结构化输入、输出、版本、耗时和状态写入本地 SQLite append-only ledger。

```sh
npm run backtest:ts -- paper-cycle --symbols BTCUSDT --paper-db data/paper.db --account-id paper:main --artifact-db data/artifacts.db
npm run backtest:ts -- artifacts --artifact-db data/artifacts.db --trace-id 'paper:paper:main:...'
```

可按标的和阶段过滤：

```sh
npm run backtest:ts -- artifacts --artifact-db data/artifacts.db --trace-id TRACE_ID --symbol BTCUSDT --stage decision
```

记录阶段包括 Selector、DataSync、DataQuality、Analysis、Bull/Bear、Decision、Portfolio、Risk、PortfolioRisk、Execution、PositionMonitor 与 Reflection。Artifact 使用 `traceId` 串起完整时间线；Execution artifact 会保存本地订单 ID（如果产生）。

Artifact 只保存 Agent 已经消费或产生的结构化业务数据。它不会保存 API Key、环境变量、完整 LLM prompt 或其它 secret。错误会以安全错误信息记录为 `error` artifact，随后继续抛出，由既有 runtime safety guard 处理。

## Trade Review

使用 `review` 可将同一个 trace 的 artifacts 汇总为按时间排序的决策时间线：

```sh
npm run backtest:ts -- review --artifact-db data/artifacts.db --trace-id TRACE_ID
npm run backtest:ts -- review --artifact-db data/artifacts.db --order-id paper:42
```

按订单 ID 查询时，系统先定位对应的 Execution artifact，再自动加载该 trace 的完整 Agent 时间线。报告会汇总决策动作、风控是否通过、执行状态，以及 fallback/error 数量；该命令只读本地 SQLite，不改变交易或账户状态。
