# Walk-Forward 样本外验证

Walk-Forward 会在每一折中先使用训练窗口运行参数网格，再将当折最佳参数用于紧随其后的、没有参与选参的验证窗口。它不能证明策略有效，但能避免把同一段历史数据既用于调参又用于验证。

```sh
npm run backtest:ts -- walk-forward \
  --csv bars.csv \
  --symbols BTCUSDT \
  --grid '{"perTradeNotional":[500,1000],"minTrendStrength":[10,20]}' \
  --train-cycles 200 \
  --validation-cycles 50 \
  --step-cycles 50 \
  --window rolling \
  --output reports/walk-forward.json
```

`--window rolling` 保持固定训练长度；`--window expanding` 从第一根 K 线开始扩展训练区间。每一折都使用新的 Pipeline、模拟账户与 Reflection Agent，训练结束时间严格早于验证开始时间。

输出包含每折训练/验证边界、训练集选择的参数 fingerprint、样本外指标、最差回撤与参数稳定性统计。命令拒绝 `--llm`，避免 API 成本和非确定性进入参数选择。
