# 数据源接入：当前实现与目标模型

> 当前实现：Crypto / CSV / Binance Futures Public
> 目标模型：跨市场 Data Source Registry + Capability Negotiation
> 总体规划：`architecture-and-delivery-plan.md`

## 当前实现

当前代码参考 `../LLM-TradeBot` 的 DataSync、SymbolSelector 与 BinanceTrader，已经实现：

- 使用 Binance Futures 公共 REST `/fapi/v1/ticker/24hr` 获取候选流动性和最新价格；
- 并发读取 `5m`、`15m`、`1h` K 线；
- 使用本地短 TTL 缓存，避免同一 cycle 重复请求；
- 剔除不可用 OHLC 行，不修正或平滑市场价格；
- 使用已收盘 K 线，避免未来数据；
- CSV 历史源支持当前固定的多周期合同；
- `--symbols` 是 Selector 候选池，默认 `topN = 1`，每轮只允许一个新标的进入下游；
- 未入选标的保留排名和拒绝原因。

实时单次运行：

```sh
npm run backtest:ts -- paper-cycle \
  --symbols BTCUSDT,ETHUSDT \
  --paper-db data/paper.db \
  --account-id paper:main
```

默认不执行订单；即使显式开启 execution，也只使用本地 Paper SQLite，不调用 Binance 写接口。

## 当前限制

当前实现把以下假设写入合同或 Adapter：

- 市场是 Crypto；
- 数据主要是 OHLCV；
- 周期固定为 `5m/15m/1h`；
- Selector 指标依赖这些周期；
- Data Source kind 主要是 CSV 或 Binance Futures Public。

这些是当前可运行基线，不是长期产品约束。

## 目标接入模型

未来统一拆为：

```text
Data Provider
  -> Connector
  -> Normalizer / Processing Agent
  -> Typed Market Artifact
```

- Data Provider：Binance、A 股行情商、财经新闻源等外部提供方；
- Connector：鉴权、请求、限流、缓存、重试和健康检查；
- Processing Agent：标准化、去重、实体识别、特征或影响分析；
- Artifact：带 provenance、版本、时间语义和有效期的结构化输出。

## Data Source Capability

用户接入数据源后，系统必须先探测：

- 市场和标的覆盖；
- 数据类型；
- 原生粒度；
- 历史范围；
- 实时更新方式和延迟；
- 时区、交易日历和时间戳语义；
- 缺失、重复、乱序和完整度；
- 是否允许聚合；
- Secret 是否通过安全后端引用。

Pipeline 只有在能力匹配后才能编译。

## 周期与观察窗口

系统不再假设一定存在 `5m/15m/1h`：

- 数据只有日线时，可以运行单周期日线 Agent；
- 数据包含日/周/月时，可以运行三窗口模板；
- 新闻和公告可以使用事件批次或滚动窗口；
- 宏观数据可以使用月度或季度报告期；
- 允许从细粒度合法聚合粗粒度，并记录 lineage；
- 禁止从日线伪造分钟数据。

## 缺失和降级

- Required 输入缺失：禁止新开仓；
- Optional 输入缺失：按显式策略降级，并降低置信度；
- 已批准 Fallback：切换备用 Connector 或规则 Agent；
- 时间未对齐：拒绝当前批次；
- 关键行情完全中断：进入 Only Close；
- 所有降级写入 Trace 和 Artifact Ledger。

下一阶段先为现有 Binance/CSV Adapter 生成 Capability Manifest，再迁移通用合同；不直接重写当前交易行为。
