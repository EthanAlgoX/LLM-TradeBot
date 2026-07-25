# Runtime Dashboard（CUI）

看板从本地 SQLite 读取 Paper 账户、最新 trace 和最新 Reflection 报告；它不请求市场数据、不读取密钥，也不执行订单。

```sh
npm run backtest:ts -- dashboard \
  --paper-db data/paper.db \
  --account-id paper:main \
  --trace-db data/tradebot.db \
  --reflection-db data/paper.db.reflection.db
```

默认输出为紧凑终端文本，包含现金、权益、仓位数、交易数、已实现盈亏、费用、trace 风控拒绝/执行动作，以及 Reflection 的建议和 LLM fallback 状态。

若存在安全状态库，还会显示连续失败次数、冷却截止时间与最近错误。看板只读本地 SQLite，不会触发行情或 LLM 请求。

若对应数据库、trace 或 Reflection 尚不存在，部分状态会显示 `unavailable`，不会影响其他部分展示。加上 `--json` 可获得稳定的 `RuntimeDashboard` JSON 合同，方便后续 TUI 或自动化消费。

需要周期性刷新时，使用有边界的 `dashboard-watch`：

```sh
npm run backtest:ts -- dashboard-watch \
  --paper-db data/paper.db \
  --account-id paper:main \
  --cycles 12 \
  --interval-seconds 5 \
  --clear
```

它必须显式指定轮数，并且只重新读取本地状态；不会执行订单。
