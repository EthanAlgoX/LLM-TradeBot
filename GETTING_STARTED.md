# 🚀 新手入门指南

欢迎使用 AI Trader！这份指南将帮助你从零开始搭建和运行系统。

## 第一步：环境准备

### 1.1 检查 Python 版本

```bash
python3 --version
```

需要 Python 3.8 或更高版本。

### 1.2 克隆项目（如果还没有）

```bash
git clone <your-repo-url>
cd ai_trader
```

## 第二步：安装系统

### 方式一：自动安装（推荐）

```bash
./install.sh
```

这将自动完成：
- ✅ 创建虚拟环境
- ✅ 安装所有依赖
- ✅ 创建配置文件模板
- ✅ 创建必要目录

### 方式二：手动安装

```bash
# 1. 创建虚拟环境
python3 -m venv venv

# 2. 激活虚拟环境
source venv/bin/activate  # macOS/Linux
# 或
.\venv\Scripts\activate  # Windows

# 3. 升级 pip
pip install --upgrade pip

# 4. 安装依赖
pip install -r requirements.txt

# 5. 创建配置文件
cp .env.example .env
cp config.example.yaml config.yaml

# 6. 创建目录
mkdir -p logs data
```

## 第三步：获取 API 密钥

### 3.1 Binance API（测试网）

⚠️ **强烈建议先使用测试网！**

1. 访问 [Binance 测试网](https://testnet.binancefuture.com)
2. 登录或注册
3. 进入 "API Keys" 页面
4. 创建新的 API Key
5. 保存 API Key 和 Secret（只显示一次！）

**注意**：测试网的资金是虚拟的，不会有真实损失。

### 3.2 Binance API（实盘）

⚠️ **仅在充分测试后使用！**

1. 登录 [Binance](https://www.binance.com)
2. 账户设置 → API 管理
3. 创建 API Key
4. 启用 "期货交易" 权限
5. **务必设置 IP 白名单**
6. 保存 API Key 和 Secret

### 3.3 DeepSeek API

1. 访问 [DeepSeek Platform](https://platform.deepseek.com)
2. 注册/登录账户
3. 进入 API Keys 页面
4. 创建新的 API Key
5. 充值账户（DeepSeek 是按量计费）
6. 保存 API Key

**费用参考**：
- DeepSeek-Chat: ~¥1/百万tokens
- 每次决策约消耗 2000-3000 tokens
- 每小时约 60 次决策 = ¥0.1-0.2/小时

## 第四步：配置系统

### 4.1 编辑 .env 文件

```bash
nano .env
```

填入：
```env
# Binance API（测试网）
BINANCE_API_KEY=你的测试网API_KEY
BINANCE_API_SECRET=你的测试网SECRET

# DeepSeek API
DEEPSEEK_API_KEY=你的DeepSeek_KEY

# Redis（可选，默认 localhost）
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 4.2 调整 config.yaml（可选）

```bash
nano config.yaml
```

重点配置项：

```yaml
# 确认测试网模式
binance:
  testnet: true  # ⚠️ 实盘前改为 false

# 调整风险参数（建议新手降低）
risk:
  max_risk_per_trade_pct: 1.0  # 降到 1%
  max_total_position_pct: 20.0  # 降到 20%
  max_leverage: 3               # 降到 3x

# 选择交易对
trading:
  symbol: "BTCUSDT"  # 也可以是 ETHUSDT, BNBUSDT 等
```

## 第五步：测试系统

### 5.1 运行测试脚本

```bash
python test.py
```

预期看到：
```
=== 测试配置模块 ===
✓ 配置模块正常

=== 测试Binance连接 ===
BTCUSDT 当前价格: $95,000.00
获取到 5 根K线
✓ Binance连接正常

=== 测试市场数据处理 ===
处理了 100 根K线
✓ 市场数据处理正常

=== 测试DeepSeek API ===
决策: hold
✓ DeepSeek API正常
```

### 5.2 如果测试失败

#### Binance 连接失败
```
✗ Binance连接失败: Invalid API-key
```
**解决**：
- 检查 .env 中的 API Key 是否正确
- 确认使用的是测试网 Key
- 检查 config.yaml 中 `testnet: true`

#### DeepSeek 失败
```
✗ DeepSeek API失败: Incorrect API key
```
**解决**：
- 检查 DeepSeek API Key
- 确认账户有余额
- 检查网络连接

## 第六步：首次运行

### 6.1 启动系统

```bash
python main.py --mode live
```

### 6.2 观察输出

你应该看到：
```
=== 初始化AI交易系统 ===
Binance客户端初始化完成 (测试网: True)
DeepSeek策略引擎初始化完成
...

=== 开始运行交易系统 ===

============================================================
开始新一轮分析 - BTCUSDT
============================================================

1h 趋势: uptrend, RSI: 65.5
调用DeepSeek进行决策...
LLM决策: hold (置信度: 75%)
理由: 当前趋势向上但RSI接近超买...
```

### 6.3 停止系统

按 `Ctrl+C`，系统会优雅退出并显示统计：
```
最终统计:
  总交易: 0
  胜率: 0.00%
  总盈亏: $0.00
```

## 第七步：监控系统

### 7.1 实时查看日志

开启新终端：
```bash
tail -f logs/trading.log
```

### 7.2 查看数据库

```bash
sqlite3 logs/trading.db

# 查看最近决策
sqlite> SELECT timestamp, action, confidence, reasoning 
        FROM decisions 
        ORDER BY id DESC LIMIT 5;

# 查看交易
sqlite> SELECT * FROM trades WHERE status='CLOSED';

# 退出
sqlite> .quit
```

### 7.3 监控要点

关注以下指标：
- ✅ 决策频率（应该每分钟一次）
- ✅ LLM 置信度（低于 50 应该 hold）
- ✅ 风控拒绝率（过高说明参数需调整）
- ✅ 连续亏损次数（达到 3 会暂停）

## 第八步：理解系统行为

### 8.1 正常决策流程

```
1. 获取市场数据 (5秒)
2. 计算技术指标 (1秒)
3. 调用 DeepSeek (2-3秒)
4. 风控验证 (<1秒)
5. 执行交易 (1-2秒)
6. 记录日志 (<1秒)
7. 等待 60 秒
```

### 8.2 常见决策

**Hold（观望）**
- 条件：市场不明确、低置信度、震荡市
- 最常见的决策（约 70-80%）

**Open Long（开多）**
- 条件：多周期向上、RSI 未超买、成交量放大
- 需要高置信度（>75）

**Close Position（平仓）**
- 条件：趋势反转、止盈/止损触发
- 优先级最高

## 第九步：常见问题

### Q1: 系统一直 hold 不开仓？

**A**: 这是正常的！系统非常保守，只在高置信度时开仓。可以：
- 降低决策阈值（修改 Prompt）
- 增加市场波动时段运行
- 查看 reasoning 了解为什么不开仓

### Q2: 风控频繁拒绝决策？

**A**: 检查：
- 账户余额是否充足
- 风险参数是否过严
- 是否有未平仓位

### Q3: DeepSeek 调用很慢？

**A**: 正常情况 2-3 秒，如果超过 10 秒：
- 检查网络连接
- DeepSeek 服务器可能繁忙
- 考虑减少 max_tokens

### Q4: 如何调整交易频率？

**A**: 修改 `main.py` 中的 `update_interval`：
```python
self.update_interval = 60  # 改为 120（2分钟）或 300（5分钟）
```

## 第十步：从测试网到实盘

### ⚠️ 实盘前检查清单

- [ ] 在测试网运行至少 **1周**
- [ ] 理解所有代码逻辑
- [ ] 胜率 > 50%
- [ ] 无严重 bug
- [ ] 风控规则合理
- [ ] 准备好承受损失
- [ ] 只投入可承受损失的资金

### 切换到实盘

1. 获取实盘 API Key
2. 修改 `.env`：
```env
BINANCE_API_KEY=实盘API_KEY
BINANCE_API_SECRET=实盘SECRET
```

3. 修改 `config.yaml`：
```yaml
binance:
  testnet: false  # ⚠️ 改为 false
```

4. **降低初始仓位**：
```yaml
risk:
  max_risk_per_trade_pct: 0.5  # 实盘建议更保守
  max_total_position_pct: 10.0
  max_leverage: 2
```

5. 小额资金开始（如 $100-500）

## 获取帮助

- 📖 [详细文档](QUICK_START.md)
- 🏗️ [架构说明](ARCHITECTURE.md)
- 💬 提交 Issue
- 📧 联系作者

---

**祝你交易顺利！记住：风险第一，学习第二，盈利第三。** 🚀
