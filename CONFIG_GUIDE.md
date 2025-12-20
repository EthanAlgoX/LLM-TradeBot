# 配置指南

## 配置文件说明

AI Trader 支持两种配置方式，优先级如下：

```
环境变量 (.env) > 配置文件 (config.yaml)
```

## 推荐配置方式

### ✅ 敏感信息使用 .env（推荐）

**优点**：
- 更安全（.env 在 .gitignore 中，不会被提交）
- 更灵活（不同环境使用不同配置）
- 符合最佳实践

**步骤**：

1. 复制模板：
```bash
cp .env.example .env
```

2. 编辑 .env：
```env
# Binance API
BINANCE_API_KEY=你的API_KEY
BINANCE_API_SECRET=你的API_SECRET

# DeepSeek API
DEEPSEEK_API_KEY=你的DeepSeek_KEY
```

3. config.yaml 中保持占位符即可：
```yaml
binance:
  api_key: "BINANCE_API_KEY"      # 会被 .env 自动覆盖
  api_secret: "BINANCE_API_SECRET" # 会被 .env 自动覆盖
```

### ⚠️ 直接在 config.yaml 配置（不推荐）

如果你不想使用 .env，也可以直接在 config.yaml 中填写：

```yaml
binance:
  api_key: "实际的API_KEY"
  api_secret: "实际的API_SECRET"
```

**缺点**：
- 容易误提交到 Git
- 安全性较低

## 配置项详解

### Binance API

```yaml
binance:
  api_key: "BINANCE_API_KEY"
  api_secret: "BINANCE_API_SECRET"
  testnet: true  # true=测试网, false=实盘
```

**获取方式**：
- 测试网: https://testnet.binancefuture.com
- 实盘: https://www.binance.com/en/my/settings/api-management

**权限要求**：
- ✅ 读取 (Read)
- ✅ 期货交易 (Futures Trading)
- ❌ 提现 (Withdrawal) - 不需要，更安全

### DeepSeek API

```yaml
deepseek:
  api_key: "DEEPSEEK_API_KEY"
  base_url: "https://api.deepseek.com"
  model: "deepseek-chat"
  temperature: 0.3    # 0.0-1.0, 越低越稳定
  max_tokens: 2000    # 最大输出长度
```

**获取方式**：
- https://platform.deepseek.com

**费用**：
- 约 ¥1/百万 tokens
- 每小时约 ¥0.1-0.2

### 交易配置

```yaml
trading:
  symbol: "BTCUSDT"              # 交易对
  timeframes: ["1m", "5m", "15m", "1h"]  # 分析周期
  leverage: 5                     # 默认杠杆
```

**支持的交易对**：
- BTCUSDT (比特币)
- ETHUSDT (以太坊)
- BNBUSDT (币安币)
- 等所有 Binance 支持的永续合约

### 风控配置（重要！）

```yaml
risk:
  max_risk_per_trade_pct: 1.5      # 单笔最大风险 (%)
  max_total_position_pct: 30.0     # 最大总仓位 (%)
  max_leverage: 5                   # 最大杠杆
  max_consecutive_losses: 3         # 连续亏损限制
  stop_trading_on_drawdown_pct: 10.0  # 回撤停止阈值 (%)
```

**新手建议**：
```yaml
risk:
  max_risk_per_trade_pct: 1.0   # 降到 1%
  max_total_position_pct: 20.0  # 降到 20%
  max_leverage: 3                # 降到 3x
  max_consecutive_losses: 2      # 降到 2次
  stop_trading_on_drawdown_pct: 5.0  # 降到 5%
```

### Redis 配置（可选）

```yaml
redis:
  host: "localhost"
  port: 6379
  db: 0
```

**说明**：
- 当前版本未使用 Redis
- 预留给未来功能（缓存、消息队列等）

### 日志配置

```yaml
logging:
  level: "INFO"              # DEBUG, INFO, WARNING, ERROR
  file: "logs/trading.log"   # 日志文件路径
```

**日志级别**：
- `DEBUG`: 详细调试信息
- `INFO`: 正常运行信息（推荐）
- `WARNING`: 警告信息
- `ERROR`: 仅错误信息

### 回测配置

```yaml
backtest:
  start_date: "2024-01-01"
  end_date: "2024-12-01"
  initial_capital: 10000
```

**说明**：
- 当前版本回测功能开发中
- 配置预留给未来使用

## 配置优先级示例

假设：
- `.env` 中: `BINANCE_API_KEY=from_env`
- `config.yaml` 中: `api_key: "from_config"`

**结果**: 使用 `from_env` ✅

## 验证配置

运行测试脚本验证配置是否正确：

```bash
python test.py
```

预期输出：
```
=== 测试配置模块 ===
✓ 配置模块正常

=== 测试Binance连接 ===
✓ Binance连接正常
```

## 常见问题

### Q: 必须使用 .env 吗？

A: 不是必须，但**强烈推荐**。也可以直接在 config.yaml 配置，但要注意不要提交到 Git。

### Q: .env 和 config.yaml 都配置了怎么办？

A: .env 的优先级更高，会覆盖 config.yaml。

### Q: 如何在不同环境使用不同配置？

A: 创建多个环境变量文件：
```bash
.env.test    # 测试网配置
.env.prod    # 实盘配置
```

然后根据需要复制：
```bash
cp .env.test .env    # 使用测试网
# 或
cp .env.prod .env    # 使用实盘
```

### Q: 忘记配置 API Key 会怎样？

A: 程序会启动，但在调用 API 时会失败。运行 `python test.py` 可以提前发现问题。

### Q: 测试网和实盘如何切换？

A: 修改 config.yaml：
```yaml
binance:
  testnet: true   # 测试网
  # testnet: false  # 实盘
```

同时更新 .env 中对应的 API Key。

## 安全建议

1. ✅ **永远不要提交 .env 到 Git**
2. ✅ **使用测试网 API Key 测试**
3. ✅ **实盘 API Key 设置 IP 白名单**
4. ✅ **不启用提现权限**
5. ✅ **定期轮换 API Key**
6. ❌ **不要在公共场合分享 API Key**

## 配置模板

### 测试网配置 (.env.test)

```env
# Binance 测试网
BINANCE_API_KEY=测试网API_KEY
BINANCE_API_SECRET=测试网SECRET

# DeepSeek
DEEPSEEK_API_KEY=你的DeepSeek_KEY
```

### 实盘配置 (.env.prod)

```env
# Binance 实盘
BINANCE_API_KEY=实盘API_KEY
BINANCE_API_SECRET=实盘SECRET

# DeepSeek
DEEPSEEK_API_KEY=你的DeepSeek_KEY
```

## 下一步

配置完成后：

1. 运行测试：`python test.py`
2. 启动系统：`python main.py --mode live`
3. 查看日志：`tail -f logs/trading.log`

---

**记住**：配置正确是成功运行的第一步！ 🎯
