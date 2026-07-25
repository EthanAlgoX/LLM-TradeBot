# Paper Runtime 安全守卫

`paper-watch` 在每轮调用市场数据前先检查本地安全状态。连续失败达到阈值后，运行器进入冷却；冷却期间不会请求 Binance、不会运行 Agent，也不会因 `--execution-enabled` 而绕过保护。

```sh
npm run backtest:ts -- paper-watch \
  --symbols BTCUSDT \
  --paper-db data/paper.db \
  --account-id paper:main \
  --cycles 12 \
  --max-consecutive-failures 3 \
  --cooldown-seconds 300 \
  --max-executions-per-cycle 1
```

安全状态默认保存在 `paper.db.safety.db`，可使用 `--safety-db` 指定。它只持久化连续失败数、最近错误文本和冷却到期时间；不会保存 API Key、LLM 原始输入或交易所账户数据。

一次成功 cycle 会将连续失败数重置为零。默认失败即停止；结合 `--continue-on-error` 时，冷却仍优先于继续运行。
