# 🤖 AI Trader - 基于 DeepSeek 的加密货币自动交易系统

<div align="center">

![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)
![Status](https://img.shields.io/badge/Status-Beta-yellow.svg)

**一个将大模型推理能力与严格风控相结合的智能交易系统**

[快速开始](#-快速开始) • [架构设计](#-架构设计) • [核心特点](#-核心特点) • [文档](#-文档)

</div>

---

## 📖 项目概述

AI Trader 是一个基于 **Binance API** 和 **DeepSeek 大模型**的智能加密货币交易系统。系统将 LLM 的强大推理能力应用于市场分析和策略决策，同时通过硬编码的风控规则确保资金安全。

### 设计理念

- ✅ **LLM 做决策，不做计算** - 所有技术指标由代码计算，LLM只负责推理
- ✅ **风控不可绕过** - 硬编码规则层层把关
- ✅ **完整可审计** - 所有决策过程可追溯
- ✅ **测试网优先** - 充分测试后再实盘

## 🏗️ 架构设计

```
┌───────────────────────────────┐
│         Binance API            │  ← 市场数据 & 交易执行
└──────────────┬────────────────┘
               ↓
┌───────────────────────────────┐
│     Market Data Processor     │  ← 技术指标 & 市场状态
└──────────────┬────────────────┘
               ↓
┌───────────────────────────────┐
│      Feature & Context        │  ← 多周期特征整合
└──────────────┬────────────────┘
               ↓
┌───────────────────────────────┐
│   DeepSeek Strategy Engine    │  ← LLM 决策推理
└──────────────┬────────────────┘
               ↓
┌───────────────────────────────┐
│       Risk Manager            │  ← 风控验证 & 修正
└──────────────┬────────────────┘
               ↓
┌───────────────────────────────┐
│     Execution Engine          │  ← 交易执行
└──────────────┬────────────────┘
               ↓
┌───────────────────────────────┐
│   Logging & Monitoring        │  ← 日志 & 性能分析
└───────────────────────────────┘
```

## ✨ 核心特点

### 1. 🧠 DeepSeek 驱动的决策
- 多周期市场分析
- 自然语言推理
- 自动生成交易理由
- 可解释的决策过程

### 2. 🛡️ 严格的风险管理
```python
硬编码规则（不可被 LLM 绕过）：
├── 单笔风险 ≤ 1.5%
├── 总仓位 ≤ 30%
├── 最大杠杆 ≤ 5x
├── 连续亏损3次 → 暂停交易
├── 回撤 ≥ 10% → 暂停交易
└── 极端资金费率 → 拒绝开仓
```

### 3. 📊 完整的技术分析
- 多周期K线分析（1m, 5m, 15m, 1h）
- 20+ 技术指标（MA, MACD, RSI, 布林带等）
- 趋势识别 & 波动率分析
- 支撑阻力位自动识别

### 4. 💾 完整的日志系统
- SQLite 数据库存储
- 所有决策可追溯
- 交易统计 & 性能分析
- LLM 原始输出存档

## 🚀 快速开始

### 1. 自动安装

```bash
# 克隆项目
git clone <your-repo-url>
cd ai_trader

# 运行自动安装脚本
./install.sh
```

### 2. 配置 API 密钥

```bash
# 复制环境变量文件
cp .env.example .env

# 编辑配置（填入你的 API 密钥）
nano .env
```

需要配置：
- **Binance API Key** - [获取地址](https://www.binance.com/en/my/settings/api-management)
- **DeepSeek API Key** - [获取地址](https://platform.deepseek.com)

⚠️ **建议先使用 Binance 测试网**: https://testnet.binancefuture.com

### 3. 运行测试

```bash
python test.py
```

预期输出：
```
=== 测试配置模块 ===
✓ 配置模块正常

=== 测试Binance连接 ===
✓ Binance连接正常

=== 测试市场数据处理 ===
✓ 市场数据处理正常

...
```

### 4. 启动系统

```bash
# 实盘模式（测试网）
python main.py --mode live

# 回测模式（开发中）
python main.py --mode backtest --start 2024-01-01 --end 2024-12-01
```

## 📁 项目结构

```
ai_trader/
├── src/
│   ├── api/                    # Binance API 接入
│   │   └── binance_client.py
│   ├── data/                   # 市场数据处理
│   │   └── processor.py
│   ├── features/               # 特征工程
│   │   └── builder.py
│   ├── strategy/               # 策略引擎
│   │   └── deepseek_engine.py
│   ├── risk/                   # 风险管理
│   │   └── manager.py
│   ├── execution/              # 交易执行
│   │   └── engine.py
│   ├── monitoring/             # 监控日志
│   │   └── logger.py
│   └── utils/                  # 工具模块
│       └── logger.py
├── main.py                     # 主程序
├── test.py                     # 测试脚本
├── requirements.txt            # 依赖包
└── config.example.yaml         # 配置模板
```

## 🎯 使用场景

### ✅ 适合
- 学习量化交易
- 研究 LLM 在交易中的应用
- 测试交易策略
- 个人小资金交易

### ❌ 不适合
- 高频交易（系统每分钟决策一次）
- 大资金交易（需要更复杂的风控）
- 完全自动化（建议人工监控）

## 📊 决策示例

```json
{
  "action": "open_long",
  "confidence": 82,
  "leverage": 3,
  "position_size_pct": 10,
  "stop_loss_pct": 0.8,
  "take_profit_pct": 1.6,
  "reasoning": "1h趋势向上，RSI 65未超买，成交量放大，MACD金叉..."
}
```

## 📚 文档

- [� 新手入门指南](GETTING_STARTED.md) - 从零开始，手把手教学
- [⚡ 快速开始](QUICK_START.md) - 快速安装和配置步骤
- [🔑 API 密钥配置](API_KEYS_REFERENCE.md) - API 密钥配置快速参考
- [⚙️ 配置指南](CONFIG_GUIDE.md) - 详细配置说明
- [🏗️ 架构文档](ARCHITECTURE.md) - 系统架构和模块说明
- [📝 项目总结](PROJECT_SUMMARY.md) - 完整项目概览

## ⚙️ 配置说明

### 风险参数 (config.yaml)

```yaml
risk:
  max_risk_per_trade_pct: 1.5      # 单笔最大风险
  max_total_position_pct: 30.0     # 最大总仓位
  max_leverage: 5                   # 最大杠杆
  max_consecutive_losses: 3         # 连续亏损限制
  stop_trading_on_drawdown_pct: 10.0  # 回撤停止阈值
```

### 交易参数

```yaml
trading:
  symbol: "BTCUSDT"
  timeframes: ["1m", "5m", "15m", "1h"]
  leverage: 5
```

## 🔍 监控和日志

### 实时日志
```bash
tail -f logs/trading.log
```

### 数据库查询
```bash
sqlite3 logs/trading.db

# 查看最近决策
SELECT * FROM decisions ORDER BY id DESC LIMIT 10;

# 查看交易统计
SELECT COUNT(*), AVG(pnl_pct), SUM(pnl) FROM trades WHERE status='CLOSED';
```

## ⚠️ 风险提示

<div align="center">

### ⚠️ 重要警告 ⚠️

**加密货币交易风险极高，可能导致本金全部损失**

1. 本系统**仅供学习研究**
2. **不构成任何投资建议**
3. 使用前请**充分理解代码逻辑**
4. 建议先在**测试网充分测试**
5. 实盘请使用**小额资金**
6. **持续监控系统运行**

</div>

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | Python 3.8+ |
| API | python-binance, ccxt |
| 数据处理 | pandas, numpy |
| 技术分析 | ta (Technical Analysis) |
| LLM | DeepSeek API (OpenAI 兼容) |
| 数据库 | SQLite |
| 日志 | loguru |
| 配置 | YAML, python-dotenv |

## 🗺️ Roadmap

- [x] 基础架构搭建
- [x] Binance API 接入
- [x] 技术指标计算
- [x] DeepSeek 决策引擎
- [x] 风险管理系统
- [x] 交易执行引擎
- [x] 日志监控系统
- [ ] 回测系统完善
- [ ] Web 监控面板
- [ ] 多币种支持
- [ ] 更多 LLM 模型
- [ ] 策略优化工具

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

---

<div align="center">

**如果这个项目对你有帮助，请给个 ⭐️**

Made with ❤️ by AI Trader Team

</div>
