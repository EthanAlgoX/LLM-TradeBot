# Paper Cycle

`paper-cycle` 使用 Binance Futures 的公共 GET 行情接口运行一次完整 Multi-Agent 周期。它不会调用任何 Binance 交易接口。

`--symbols` 是 Selector 的候选池，不是并行运行清单。默认 Strategy Profile 使用 `selector.topN = 1`：Selector 会对候选池过滤和排名，每个 cycle 只允许一个新标的进入 Data、Analysis、Decision 与 Risk 链路。已有持仓始终会额外进入 Position Monitor，以保证止盈、止损、趋势反转和最长持仓退出仍然工作。

默认只生成候选、分析、决策、风控、trace 与 Reflection 摘要，不改变本地账户：

```sh
npm run backtest:ts -- paper-cycle \
  --symbols BTCUSDT,ETHUSDT \
  --paper-db data/paper.db \
  --account-id paper:main \
  --trace-db data/tradebot.db
```

只有显式给出 `--execution-enabled`，通过 Risk 的订单才会写入本地 SQLite Paper 账户；这仍是模拟撮合，绝不向 Binance 下单：

```sh
npm run backtest:ts -- paper-cycle \
  --symbols BTCUSDT \
  --paper-db data/paper.db \
  --account-id paper:main \
  --execution-enabled
```

可选 `--llm deepseek` 启用 DeepSeek 的 Bull/Bear/Reflection 增强，需要 `DEEPSEEK_API_KEY`。若未启用，或 LLM 出错，系统保持规则模式。Reflection 报告默认写入 `paper.db.reflection.db`；可通过 `--reflection-db` 单独指定。
