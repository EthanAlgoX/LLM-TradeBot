# DeepSeek 接入

TradeBoard 的 LLM 仅用于 Bull / Bear 对抗观点；不能绕过 `Decision -> Portfolio -> Risk -> Execution` 链路，也没有任何交易所写权限。

配置环境变量（不要提交 `.env`）：

```sh
export DEEPSEEK_API_KEY="..."
export DEEPSEEK_MODEL="deepseek-v4-flash" # 可选，当前默认值
export DEEPSEEK_BASE_URL="https://api.deepseek.com" # 可选
export DEEPSEEK_TIMEOUT_MS="15000" # 可选
```

显式启用后，回测的 Bull、Bear 与 Reflection Agent 会调用 DeepSeek；超时、API 错误、空响应或不合法结构化输出会降级回规则 Agent：

```sh
npm run backtest:ts -- backtest --csv bars.csv --symbols BTCUSDT --llm deepseek
```

Reflection 始终先生成规则报告，DeepSeek 只能追加经 schema 和上限校验的建议。报告包含 provider、model、fallback 与错误类别，但不记录 API Key 或完整提示词。所有 adjustment 仅供下一轮决策读取，不会自动改仓、改风控或下单。

API 采用 `POST /chat/completions` 与 JSON mode。默认模型为 `deepseek-v4-flash`；旧项目中的 `deepseek-chat` 已在 DeepSeek 当前文档中列为兼容旧名称，不应用作新默认值。
