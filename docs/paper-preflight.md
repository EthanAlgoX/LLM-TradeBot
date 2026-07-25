# Paper Execution Preflight

在启用本地 Paper 模拟成交前，可先运行只读预检：

```sh
npm run backtest:ts -- preflight \
  --symbols BTCUSDT \
  --paper-db data/paper.db \
  --account-id paper:main
```

Preflight 先检查本地 safety 冷却；若仍在冷却，直接输出 `allowed: false`。否则它强制以 `executionEnabled=false` 运行一次实时数据、数据质量和决策链路。

该命令不会写入 Paper 订单、不会触发 Binance 写接口，也不会因为传入 `--execution-enabled` 而改变这一行为。
