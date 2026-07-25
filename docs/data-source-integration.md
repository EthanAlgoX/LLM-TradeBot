# 从 LLM-TradeBot 借鉴的数据源接入

本项目参考 `../LLM-TradeBot` 的 DataSync、SymbolSelector 与 BinanceTrader 实现，保留了适合无前端 TUI/CLI 架构的部分：

- 使用 Binance Futures 公共 REST 数据：`/fapi/v1/ticker/24hr` 批量获取流动性与最新价格，再按标的并发读取 `5m`、`15m`、`1h` K 线。
- 以本地短 TTL 缓存优先，避免同一 cycle 的多 Agent 重复拉取；缓存过期才重新 GET。
- 只剔除不可用的 OHLC 行（非有限值、`high/low` 逻辑错误、重复开盘时间）；绝不修正、平滑或篡改市场价格。
- 选币趋势强度由 `15m` 与 `1h` 共同计算，`5m` 用于 30 分钟动量与波动率，避免只按单一周期排名。
- DataSync 仍只使用已收盘 K 线；当前未收盘 bar 不进入规则分析或回测。

TradeBoard 不迁移 LLM-TradeBot 的 WebSocket 常驻管理、前端全局状态或 Binance 写接口。实时单次运行使用：

```sh
npm run backtest:ts -- paper-cycle \
  --symbols BTCUSDT,ETHUSDT \
  --paper-db data/paper.db \
  --account-id paper:main
```

默认不执行任何订单；即便加上 `--execution-enabled`，也只写入本地 Paper SQLite 账户。
