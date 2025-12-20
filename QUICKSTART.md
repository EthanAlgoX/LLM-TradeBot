# 🚀 AI Trader 快速启动指南

## ✅ 当前状态

项目已经在 TradingLLM Anaconda 环境下成功完成以下配置:

- ✅ Python 环境: TradingLLM (Python 3.11.13)
- ✅ 依赖包安装完成
- ✅ 配置文件统一命名 (BINANCE_API_KEY, BINANCE_API_SECRET, DEEPSEEK_API_KEY)
- ✅ 项目目录结构创建 (logs/, data/)
- ✅ 测试运行通过 (部分功能需要真实 API 密钥)

## 📋 测试结果概览

```
✓ 配置模块        - 正常
✓ Binance 连接    - 正常 (测试网模式)
✓ 市场数据处理    - 正常
✗ 特征构建        - 需要真实 API 密钥
✓ DeepSeek API    - 正常
```

## 🔑 下一步操作

### 1. 配置 API 密钥

```bash
# 1. 复制环境变量模板
cd /Users/yunxuanhan/Documents/workspace/ai/ai_trader
cp .env.example .env

# 2. 编辑 .env 文件，填入真实的 API 密钥
# - Binance API: https://www.binance.com/zh-CN/my/settings/api-management
# - DeepSeek API: https://platform.deepseek.com/api_keys
vi .env
```

**⚠️ 重要提示:**
- 建议先使用 Binance 测试网 (config.yaml 中 `testnet: true`)
- 测试网申请: https://testnet.binancefuture.com
- API 密钥要严格保密，不要提交到 Git

### 2. 激活 Conda 环境

```bash
# 激活 TradingLLM 环境
conda activate TradingLLM

# 验证 Python 版本
python --version  # 应该显示 Python 3.11.13
```

### 3. 运行测试

```bash
# 进入项目目录
cd /Users/yunxuanhan/Documents/workspace/ai/ai_trader

# 运行完整测试
python test.py
```

### 4. 启动交易系统

```bash
# 模拟模式 (回测)
python main.py --mode backtest

# 实盘模式 (需要真实 API 密钥和足够的风险承受能力)
# ⚠️ 仅在充分测试后使用!
python main.py --mode live
```

## 📁 项目结构

```
ai_trader/
├── config.yaml           # 主配置文件 (已统一命名)
├── config.example.yaml   # 配置示例
├── .env                  # 环境变量 (需创建，不提交到 Git)
├── .env.example          # 环境变量示例
├── main.py               # 主程序入口
├── test.py               # 测试脚本
├── requirements.txt      # 依赖包列表
├── logs/                 # 日志目录
├── data/                 # 数据目录
└── src/                  # 源代码
    ├── api/              # API 接口
    ├── strategy/         # 策略引擎
    ├── risk/             # 风控模块
    ├── execution/        # 执行引擎
    ├── features/         # 特征构建
    ├── monitoring/       # 监控日志
    └── utils/            # 工具函数
```

## 🔧 常见问题

### 1. 如何切换 Python 环境?

```bash
# 方法1: 使用 conda
conda activate TradingLLM

# 方法2: 直接使用完整路径
/opt/anaconda3/envs/TradingLLM/bin/python test.py
```

### 2. API 密钥格式错误?

检查 .env 文件:
```bash
# 正确格式 (无引号)
BINANCE_API_KEY=your_actual_key_here
BINANCE_API_SECRET=your_actual_secret_here
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxx

# 错误格式 (不要使用占位符或引号)
BINANCE_API_KEY="BINANCE_API_KEY"  # ❌
BINANCE_API_KEY=your_binance_api_key_here  # ❌ 这是占位符
```

### 3. 如何查看日志?

```bash
# 实时查看日志
tail -f logs/trading.log

# 查看最近100行
tail -n 100 logs/trading.log
```

### 4. 如何重新安装依赖?

```bash
conda activate TradingLLM
pip install -r requirements.txt --upgrade
```

## 📚 相关文档

- [配置指南](./CONFIG_GUIDE.md) - 详细配置说明
- [API 密钥参考](./API_KEYS_REFERENCE.md) - API 密钥快速参考
- [README](./README.md) - 项目概览

## ⚠️ 风险提示

1. **测试先行**: 在实盘前务必在测试网充分测试
2. **小额开始**: 实盘初期使用小额资金
3. **风险控制**: 设置合理的止损和仓位管理
4. **持续监控**: 定期检查系统运行状态和交易日志
5. **资金安全**: API 密钥仅开启必要权限,禁用提现权限

## 🎯 性能优化建议

1. **使用测试网**: 开发和测试阶段使用 Binance 测试网
2. **日志管理**: 定期清理旧日志文件
3. **数据缓存**: 合理使用 Redis 缓存市场数据
4. **监控告警**: 设置异常情况的告警通知

---

**项目状态**: ✅ 环境配置完成，可以开始配置 API 密钥并运行

**最后更新**: 2025-12-16

如有问题,请查看相关文档或日志文件。
