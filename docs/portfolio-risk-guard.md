# 账户级 Portfolio Risk Guard

Paper 运行在单笔 `RuleRisk` 后、Execution 前执行账户级风险守卫。它读取本地 Paper PortfolioState，计算本次开仓后的预估保证金占用，并可阻断新开仓；平仓动作不会被该守卫阻断。

```sh
npm run backtest:ts -- paper-cycle \
  --symbols BTCUSDT \
  --paper-db data/paper.db \
  --account-id paper:main \
  --execution-enabled \
  --max-open-positions 1 \
  --max-used-margin-pct 50 \
  --max-order-notional 1000 \
  --max-executions-per-cycle 1
```

每次拒绝会写入 `portfolio_risk` trace，包含持仓数量、预估保证金占用或名义金额超限原因。守卫不修改账户，不会触发 Binance 写接口。
