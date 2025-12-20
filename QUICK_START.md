# 快速开始指南

## 1. 安装依赖

```bash
# 创建虚拟环境（推荐）
python3 -m venv venv
source venv/bin/activate  # macOS/Linux

# 安装依赖
pip install -r requirements.txt
```

## 2. 配置

### 方式一：使用环境变量（推荐）

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，填入你的API密钥
nano .env
```

填写以下内容：
```
BINANCE_API_KEY=你的币安API_KEY
BINANCE_API_SECRET=你的币安API_SECRET
DEEPSEEK_API_KEY=你的DeepSeek_API_KEY
```

### 方式二：使用配置文件

```bash
# 复制配置模板
cp config.example.yaml config.yaml

# 编辑配置文件
nano config.yaml
```

## 3. 获取API密钥

### Binance API
1. 登录 [Binance](https://www.binance.com)
2. 进入账户设置 → API管理
3. 创建新的API密钥
4. **重要**：建议先使用测试网
   - 测试网地址: https://testnet.binancefuture.com

### DeepSeek API
1. 访问 [DeepSeek](https://platform.deepseek.com)
2. 注册/登录账户
3. 获取API密钥

## 4. 测试系统

运行测试脚本验证配置：

```bash
python test.py
```

预期输出：
```
=== 测试配置模块 ===
✓ 配置模块正常

=== 测试Binance连接 ===
✓ Binance连接正常

...
```

## 5. 运行系统

### 实盘模式（谨慎！）

⚠️ **强烈建议先在测试网运行！**

```bash
python main.py --mode live
```

### 回测模式（开发中）

```bash
python main.py --mode backtest --start 2024-01-01 --end 2024-12-01
```

## 6. 监控

系统会自动记录日志到：
- 控制台输出：实时交易信息
- 文件日志：`logs/trading.log`
- 数据库：`logs/trading.db`（包含所有决策和交易记录）

### 查看日志

```bash
# 实时查看日志
tail -f logs/trading.log

# 查看数据库
sqlite3 logs/trading.db
```

### SQL查询示例

```sql
-- 查看最近10条决策
SELECT * FROM decisions ORDER BY id DESC LIMIT 10;

-- 查看交易统计
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
  AVG(pnl_pct) as avg_pnl_pct
FROM trades WHERE status = 'CLOSED';
```

## 7. 风险提示

⚠️ **重要警告**

1. **加密货币交易风险极高**
2. **本系统仅供学习研究**
3. **建议使用测试网进行测试**
4. **实盘前请充分理解代码逻辑**
5. **不要投入超过你能承受损失的资金**

## 8. 配置调整

### 风险参数（在 `config.yaml` 中）

```yaml
risk:
  max_risk_per_trade_pct: 1.5      # 单笔最大风险
  max_total_position_pct: 30.0     # 最大总仓位
  max_leverage: 5                   # 最大杠杆
  max_consecutive_losses: 3         # 最大连续亏损
  stop_trading_on_drawdown_pct: 10.0  # 回撤停止交易阈值
```

### 交易参数

```yaml
trading:
  symbol: "BTCUSDT"                  # 交易对
  timeframes: ["1m", "5m", "15m", "1h"]  # 分析周期
  leverage: 5                         # 默认杠杆
```

## 9. 停止系统

按 `Ctrl+C` 优雅停止系统。系统会：
1. 完成当前交易
2. 保存所有日志
3. 显示最终统计

## 10. 故障排除

### 问题：无法连接Binance

**解决**：
- 检查API密钥是否正确
- 确认网络连接
- 验证IP白名单设置
- 尝试使用测试网

### 问题：DeepSeek返回错误

**解决**：
- 检查API密钥
- 验证账户余额
- 查看API限额

### 问题：风控频繁拒绝

**解决**：
- 降低 `max_risk_per_trade_pct`
- 增加 `max_consecutive_losses`
- 检查账户余额是否充足

## 11. 进阶使用

### 自定义Prompt

编辑 `src/strategy/deepseek_engine.py` 中的 `_build_system_prompt()` 方法。

### 添加技术指标

编辑 `src/data/processor.py` 中的 `_calculate_indicators()` 方法。

### 修改风控规则

编辑 `src/risk/manager.py` 中的 `validate_decision()` 方法。

## 12. 下一步

- [ ] 完善回测系统
- [ ] 添加更多技术指标
- [ ] 支持多币种交易
- [ ] 开发Web监控面板
- [ ] 优化Prompt工程
