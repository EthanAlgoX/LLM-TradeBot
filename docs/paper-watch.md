# 受控 Paper Watch

`paper-watch` 是有边界的顺序运行器，用于连续执行若干次 `paper-cycle`。它要求显式给出 `--cycles`，不提供默认无限循环。

```sh
npm run backtest:ts -- paper-watch \
  --symbols BTCUSDT \
  --paper-db data/paper.db \
  --account-id paper:main \
  --cycles 12 \
  --interval-seconds 300 \
  --trace-db data/tradebot.db
```

每轮必须等待上一轮完成，避免数据同步、账户持久化和 Reflection 状态并发交错。默认遇错停止；加 `--continue-on-error` 才会记录失败后继续下一轮。

默认 `executionEnabled=false`。只有显式 `--execution-enabled` 才能在风险检查通过后写入本地 SQLite Paper 账户；这不是 Binance 下单。运行完成后可通过 `dashboard` 查看账户、trace 与复盘摘要。
