# Strategy Profile（策略配置）

`StrategyProfile` 是回测与 Paper 运行共用的、版本化的策略参数合同。它把选币、数据质量、决策、单笔风控、账户风控、模拟执行成本和 LLM 运行开关集中到一个 JSON 文件；Agent 之间仍只通过既有 typed contracts 通信。

使用方式：

```sh
npm run backtest:ts -- paper-cycle --symbols BTCUSDT --paper-db data/paper.db --account-id paper:main --profile config/conservative.json
npm run backtest:ts -- backtest --csv bars.csv --symbols BTCUSDT --profile config/conservative.json
```

文件是对内置默认 profile 的深度覆写。因此只需写需要改变的字段：

```json
{
  "profileId": "conservative-paper",
  "profileVersion": "v1",
  "decision": { "perTradeNotional": 250, "minimumConfidence": 70 },
  "accountRisk": { "maxOpenPositions": 1, "maxUsedMarginPct": 25, "maxOrderNotional": 250 },
  "llm": { "enabled": false, "timeoutMs": 15000, "fallbackToRules": true }
}
```

加载与 schema 校验发生在行情请求和纸面账户打开之前；无效 JSON、未知字段或超出范围的值会立即失败。CLI 中显式给出的数值参数仍覆盖 profile（例如 `--per-trade-notional 300`），并重新计算 fingerprint。

每一个 `paper-cycle` 的输出、`CycleRequest.configVersion` 与 journal 都记录实际 profile 的 SHA-256 短 fingerprint；来源文件名不参与计算。`profileId` 与 `profileVersion` 用于人类识别，fingerprint 用于复现。默认情况下，`--execution-enabled` 仍为关闭；即使开启也只影响本地 paper executor，绝不会调用 Binance 下单接口。

`experiment` 与 `walk-forward` 也接受 `--profile`，但强制规则模式。网格与 baseline 只允许优化以下数值字段：`initialCash`、`feeBps`、`slippageBps`、`perTradeNotional`、`minQuoteVolume`、`minPrice`、`minTrendStrength`、`maxVolatilityPct`。因此 JSON 不能绕过 profile 中的账户风控、杠杆上限或 LLM 禁用状态。

所有回测、实验和 Walk-Forward 输出现在都包含 `manifest`：其中记录 CSV 的 SHA-256 内容指纹、策略与 profile 版本、有效配置指纹、标的和时间范围。Paper manifest 改为声明 `binance_futures_public` 数据源与请求时间，因为实时公开行情没有可供固定的本地数据文件 hash。manifest 不会包含密钥、环境变量或 LLM 原文。

在真正运行前，可用只读 inspector 检查实际生效配置（不会打开 CSV、SQLite、Binance 或 LLM）：

```sh
npm run backtest:ts -- profile --profile config/conservative.json --max-cumulative-realized-loss 300
```

输出为 JSON，包含解析后的 profile、fingerprint、LLM 显式授权状态，以及持仓/保证金/名义金额和两项损失熔断的启用情况。若 profile 要求 LLM 但未传入 `--llm deepseek`，只会产生 warning，不会调用模型。

Paper journal 会随每个 cycle 写入 profile ID/version、配置 fingerprint 和 RunManifest 的数据源摘要。旧 journal 记录仍可读取，只是这些新增字段会显示为未知；`dashboard` 的 Latest cycle 行会显示新记录的 profile 与数据源信息。
