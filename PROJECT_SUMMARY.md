# AI Trader 项目总结

## 🎯 项目概述

这是一个基于 **DeepSeek 大模型**和 **Binance API** 的智能加密货币交易系统。系统将大模型的推理能力与严格的风控规则相结合，实现自动化交易。

## ✨ 核心特点

### 1. **LLM驱动的决策**
- 使用DeepSeek进行市场分析和策略决策
- 多周期技术指标融合
- 自然语言推理能力

### 2. **严格的风险管理**
- 硬编码风控规则（不可被LLM绕过）
- 单笔风险限制
- 连续亏损保护
- 回撤自动停止

### 3. **完整的系统架构**
- 模块化设计，易于扩展
- 完整日志记录
- 数据库存储
- 测试网支持

## 📁 项目结构

```
ai_trader/
├── src/                          # 源代码
│   ├── api/                      # API接入层
│   │   └── binance_client.py    # Binance客户端
│   ├── data/                     # 数据处理
│   │   └── processor.py         # 市场数据处理器
│   ├── features/                 # 特征工程
│   │   └── builder.py           # 特征构建器
│   ├── strategy/                 # 策略引擎
│   │   └── deepseek_engine.py   # DeepSeek决策引擎
│   ├── risk/                     # 风险管理
│   │   └── manager.py           # 风控管理器
│   ├── execution/                # 交易执行
│   │   └── engine.py            # 执行引擎
│   ├── monitoring/               # 监控日志
│   │   └── logger.py            # 交易日志器
│   ├── utils/                    # 工具模块
│   │   └── logger.py            # 日志工具
│   └── config.py                 # 配置管理
├── main.py                       # 主程序入口
├── test.py                       # 测试脚本
├── install.sh                    # 自动安装脚本
├── requirements.txt              # Python依赖
├── config.example.yaml           # 配置模板
├── .env.example                  # 环境变量模板
├── README.md                     # 项目说明
├── QUICK_START.md               # 快速开始指南
└── ARCHITECTURE.md              # 架构文档
```

## 🚀 快速开始

### 1. 安装

```bash
# 自动安装
./install.sh

# 或手动安装
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. 配置

```bash
# 复制环境变量文件
cp .env.example .env

# 编辑配置，填入API密钥
nano .env
```

### 3. 测试

```bash
python test.py
```

### 4. 运行

```bash
# 实盘模式（建议先用测试网）
python main.py --mode live
```

## 🔧 核心模块说明

### 1. Binance API Client
- 市场数据获取（K线、价格、订单簿）
- 账户管理（余额、持仓）
- 交易执行（开仓、平仓、止盈止损）

### 2. Market Data Processor
- 技术指标计算（MA、MACD、RSI、布林带等）
- 趋势识别
- 波动率分析
- 支撑阻力位识别

### 3. Feature Builder
- 多周期数据整合
- 市场上下文构建
- LLM输入格式化

### 4. DeepSeek Strategy Engine
- 调用DeepSeek API
- Prompt工程
- 决策生成和验证

### 5. Risk Manager
- 决策验证和修正
- 仓位计算
- 风险监控
- 连续亏损跟踪

### 6. Execution Engine
- 交易执行
- 订单管理
- 止盈止损设置

### 7. Trading Logger
- 决策记录
- 执行记录
- 交易统计
- 性能分析

## 📊 决策流程

```
1. 获取市场数据（Binance API）
   ↓
2. 计算技术指标（Processor）
   ↓
3. 构建特征上下文（Feature Builder）
   ↓
4. LLM决策（DeepSeek）
   ↓
5. 风控验证（Risk Manager）
   ↓
6. 执行交易（Execution Engine）
   ↓
7. 记录日志（Logger）
```

## 🛡️ 风控机制

### 硬编码规则（不可绕过）
1. ✅ 单笔风险 ≤ 1.5%
2. ✅ 总仓位 ≤ 30%
3. ✅ 最大杠杆 ≤ 5x
4. ✅ 连续亏损3次 → 暂停
5. ✅ 回撤 ≥ 10% → 暂停
6. ✅ 极端资金费率 → 拒绝开仓

### 动态风控
- 实时监控持仓
- 自动调整仓位
- 连续亏损降级

## 💾 数据存储

### SQLite 数据库
- `decisions`: 所有LLM决策
- `executions`: 交易执行结果
- `trades`: 完整交易记录
- `performance`: 性能指标

### 日志文件
- `logs/trading.log`: 详细运行日志
- 支持日志轮转和压缩

## 🎨 设计原则

### 1. LLM职责清晰
- ✅ 做决策推理
- ✅ 融合多维信息
- ❌ 不做数值计算
- ❌ 不控制实际资金

### 2. 安全优先
- 多层风控
- 完整审计
- 测试网优先

### 3. 可扩展性
- 模块化设计
- 易于添加指标
- 支持自定义策略

## 🔮 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | Python 3.8+ |
| API客户端 | python-binance |
| 数据处理 | pandas, numpy |
| 技术指标 | ta (Technical Analysis) |
| LLM | DeepSeek API (OpenAI兼容) |
| 数据库 | SQLite |
| 日志 | loguru |
| 配置 | YAML, dotenv |

## 📈 性能监控

系统自动跟踪：
- 总交易次数
- 胜率
- 总盈亏
- 夏普比率（TODO）
- 最大回撤
- 连续亏损

## ⚠️ 重要提示

### 风险警告
1. **加密货币交易风险极高**
2. **本系统仅供学习研究**
3. **不构成投资建议**
4. **可能造成资金损失**

### 使用建议
1. ✅ 充分理解代码逻辑
2. ✅ 先在测试网测试
3. ✅ 小额资金开始
4. ✅ 持续监控系统
5. ❌ 不要投入全部资金
6. ❌ 不要盲目信任LLM

## 🛠️ TODO List

- [ ] 完善回测系统
- [ ] 添加更多技术指标
- [ ] 支持多币种同时交易
- [ ] Web监控面板
- [ ] 电报/微信通知
- [ ] 更多LLM模型支持
- [ ] 策略对比测试
- [ ] 性能优化

## 📚 参考文档

- [快速开始指南](QUICK_START.md)
- [架构文档](ARCHITECTURE.md)
- [Binance API文档](https://binance-docs.github.io/apidocs/)
- [DeepSeek API文档](https://platform.deepseek.com/docs)

## 🤝 贡献

欢迎提交Issue和Pull Request！

## 📄 许可证

MIT License

---

**再次提醒**: 
⚠️ 本系统仅供学习研究，加密货币交易有风险，请谨慎使用！
