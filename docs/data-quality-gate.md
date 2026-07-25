# 市场数据质量门

`paper-cycle` 与 `paper-watch` 在 DataSync 后运行数据质量门。若数据不合格，系统会记录 `data_quality` trace 并阻断分析、Bull/Bear、Decision、Risk 与 Execution。

默认要求：每个周期至少 50 根已收盘 K 线、时间对齐、以及最新 quote 不超过 900 秒。可调整：

```sh
npm run backtest:ts -- paper-cycle \
  --symbols BTCUSDT \
  --paper-db data/paper.db \
  --account-id paper:main \
  --min-bars-5m 100 \
  --min-bars-15m 80 \
  --min-bars-1h 80 \
  --max-quote-age-seconds 600
```

质量门不会补造数据、平滑价格或替代缺失 K 线。典型拒绝原因包括：周期缺失、已收盘 K 线数量不足、时间未对齐及 quote 陈旧。
