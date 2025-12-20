# 系统架构文档

## 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Trader System                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐       ┌──────────────┐                    │
│  │  Binance API │──────▶│ Market Data  │                    │
│  │              │       │  Processor   │                    │
│  └──────────────┘       └──────┬───────┘                    │
│                                 │                             │
│                                 ▼                             │
│                         ┌──────────────┐                     │
│                         │   Feature    │                     │
│                         │   Builder    │                     │
│                         └──────┬───────┘                     │
│                                 │                             │
│                                 ▼                             │
│                         ┌──────────────┐                     │
│                         │  DeepSeek    │                     │
│                         │  Strategy    │                     │
│                         │   Engine     │                     │
│                         └──────┬───────┘                     │
│                                 │                             │
│                                 ▼                             │
│                         ┌──────────────┐                     │
│                         │     Risk     │                     │
│                         │   Manager    │                     │
│                         └──────┬───────┘                     │
│                                 │                             │
│                                 ▼                             │
│                         ┌──────────────┐                     │
│                         │  Execution   │                     │
│                         │    Engine    │                     │
│                         └──────┬───────┘                     │
│                                 │                             │
│                                 ▼                             │
│                         ┌──────────────┐                     │
│                         │  Monitoring  │                     │
│                         │   & Logging  │                     │
│                         └──────────────┘                     │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 模块详解

### 1. Binance API (`src/api/binance_client.py`)

**职责**：
- 获取市场数据（K线、价格、订单簿）
- 获取账户信息（余额、持仓）
- 执行交易（开仓、平仓、止盈止损）
- 获取资金费率、持仓量等合约数据

**核心方法**：
- `get_klines()`: 获取K线数据
- `get_market_data_snapshot()`: 获取完整市场快照
- `get_futures_position()`: 获取持仓信息
- `place_market_order()`: 下市价单
- `set_stop_loss_take_profit()`: 设置止盈止损

### 2. Market Data Processor (`src/data/processor.py`)

**职责**：
- 处理原始K线数据
- 计算技术指标（MA、MACD、RSI、布林带等）
- 判断市场状态（趋势、波动率、动量）
- 寻找支撑/阻力位

**关键输出**：
```python
{
    'trend': 'strong_uptrend',
    'volatility': 'high',
    'momentum': 'strong',
    'rsi': 65.5,
    'macd_signal': 'bullish',
    'key_levels': {
        'support': [91000, 90500],
        'resistance': [92800, 93500]
    }
}
```

**设计原则**：
- ✅ 所有数值计算在这里完成
- ✅ 不让LLM做数学运算
- ✅ 输出人类可读的状态描述

### 3. Feature Builder (`src/features/builder.py`)

**职责**：
- 整合多周期市场数据
- 构建LLM输入上下文
- 格式化为文本和结构化数据

**输入示例**：
```python
{
    'market_overview': {...},
    'multi_timeframe': {
        '5m': {...},
        '15m': {...},
        '1h': {...}
    },
    'position_context': {...},
    'risk_constraints': {...}
}
```

**关键方法**：
- `build_market_context()`: 构建完整上下文
- `format_for_llm()`: 格式化为Markdown文本

### 4. DeepSeek Strategy Engine (`src/strategy/deepseek_engine.py`)

**职责**：
- 调用DeepSeek API做决策
- 管理Prompt工程
- 验证LLM输出格式

**决策输出**：
```json
{
  "action": "open_long",
  "confidence": 82,
  "leverage": 3,
  "position_size_pct": 10,
  "stop_loss_pct": 0.8,
  "take_profit_pct": 1.6,
  "reasoning": "多周期趋势向上，RSI未超买..."
}
```

**Prompt策略**：
- System Prompt: 定义角色、规则、输出格式
- User Prompt: 提供市场上下文
- Temperature: 0.3（保持决策稳定）

### 5. Risk Manager (`src/risk/manager.py`)

**职责**：
- 验证LLM决策
- 修正/拒绝不合规操作
- 跟踪连续亏损和回撤
- 计算实际仓位大小

**硬编码规则**：
1. 单笔风险 ≤ 1.5%
2. 总仓位 ≤ 30%
3. 最大杠杆 ≤ 5x
4. 连续亏损3次 → 停止交易
5. 回撤 ≥ 10% → 停止交易
6. 极端资金费率 → 拒绝开仓

**关键方法**：
- `validate_decision()`: 验证并修正决策
- `calculate_position_size()`: 计算开仓数量
- `record_trade()`: 记录交易结果

### 6. Execution Engine (`src/execution/engine.py`)

**职责**：
- 执行经过风控的决策
- 下单、设置止盈止损
- 处理开仓、平仓、加仓、减仓

**执行流程**：
```
验证 → 设置杠杆 → 下单 → 设置止盈止损 → 确认
```

### 7. Monitoring & Logging (`src/monitoring/logger.py`)

**职责**：
- 记录所有决策和执行
- 存储到SQLite数据库
- 计算交易统计
- 生成性能报告

**数据库表**：
- `decisions`: LLM决策记录
- `executions`: 执行结果
- `trades`: 交易记录（开仓→平仓）
- `performance`: 性能指标

## 数据流

```
1. Binance API → K线数据
2. Processor → 技术指标 + 市场状态
3. Feature Builder → 结构化上下文
4. DeepSeek → 交易决策
5. Risk Manager → 验证/修正
6. Execution Engine → 执行交易
7. Logging → 记录结果
```

## 配置系统

### config.yaml
```yaml
binance:      # Binance配置
deepseek:     # DeepSeek配置
trading:      # 交易参数
risk:         # 风控规则
logging:      # 日志配置
backtest:     # 回测配置
```

### 环境变量 (.env)
```
BINANCE_API_KEY=...
BINANCE_API_SECRET=...
DEEPSEEK_API_KEY=...
```

## 运行模式

### 1. Live模式
- 实时获取市场数据
- 每60秒执行一次决策循环
- 真实下单

### 2. Backtest模式（TODO）
- 使用历史数据
- 模拟LLM决策
- 无真实下单

## 安全机制

1. **多层风控**
   - LLM自身判断
   - 风控模块硬编码规则
   - 连续亏损保护
   - 回撤保护

2. **日志审计**
   - 记录所有决策过程
   - 可追溯每笔交易
   - LLM原始输出存档

3. **测试网优先**
   - 默认使用测试网
   - 真实环境前充分测试

## 扩展点

### 添加技术指标
编辑 `src/data/processor.py`

### 优化Prompt
编辑 `src/strategy/deepseek_engine.py`

### 调整风控
编辑 `src/risk/manager.py`

### 支持多币种
修改 `main.py` 支持多symbol循环

## 性能考虑

- **API限频**: Binance有严格限频，需控制请求频率
- **LLM延迟**: DeepSeek调用需1-3秒，已考虑
- **数据库**: SQLite足够应对单机部署
- **并发**: 当前为单线程，多币种需改造
