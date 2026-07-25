# 回测实验与网格搜索

`experiment` 为每个参数组合创建独立的 DecisionPipeline、模拟账户与 Reflection Agent，因此组合之间不会继承仓位、订单、已平仓交易或复盘状态。

```sh
npm run backtest:ts -- experiment \
  --csv bars.csv \
  --symbols BTCUSDT \
  --grid '{"perTradeNotional":[500,1000],"minTrendStrength":[10,20]}' \
  --baseline '{"perTradeNotional":1000,"minTrendStrength":10}' \
  --output reports/experiment.json
```

可网格化的规则参数包括：`initialCash`、`feeBps`、`slippageBps`、`perTradeNotional`、`minQuoteVolume`、`minPrice`、`minTrendStrength` 与 `maxVolatilityPct`。

报告为稳定排序的 JSON，包含每个 trial 的参数 fingerprint、总收益、最大回撤、交易数、胜率、费用、拒绝率、综合 score，以及相对 baseline 的收益/回撤/交易数变化。综合 score 为收益减去回撤与费用惩罚，不能只凭收益挑选参数。

实验被限制为最多 128 个组合，且明确拒绝 `--llm`，避免模型调用成本和非确定性影响对比结论。
