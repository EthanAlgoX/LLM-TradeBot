# 环境变量配置说明

## 概述

本项目使用 `.env` 文件管理敏感信息（API 密钥等），这是一种安全的配置管理方式。

## 配置步骤

### 1. 创建配置文件

```bash
# 复制模板文件
cp .env.example .env
```

### 2. 编辑配置

```bash
# 使用编辑器打开
nano .env
# 或
vim .env
# 或
code .env
```

## 必需配置项

### BINANCE_API_KEY 和 BINANCE_API_SECRET

这是访问 Binance 交易所的凭证。

#### 测试网（推荐新手）

1. 访问 [Binance 合约测试网](https://testnet.binancefuture.com)
2. 使用 GitHub 或 Google 账号登录
3. 点击右上角头像 → "API Keys"
4. 生成新的 API Key
5. 复制 API Key 和 Secret Key

**优点**：
- ✅ 免费虚拟资金
- ✅ 无真实损失风险
- ✅ 完整功能测试

**示例配置**：
```env
BINANCE_API_KEY=your_testnet_api_key
BINANCE_API_SECRET=your_testnet_secret
```

#### 实盘（充分测试后）

1. 登录 [Binance](https://www.binance.com)
2. 进入账户设置 → API 管理
3. 创建新的 API Key
4. **重要设置**：
   - ✅ 启用"期货交易"权限
   - ✅ 设置 IP 白名单（推荐）
   - ❌ 不启用"提现"权限（安全）
5. 保存 API Key 和 Secret（只显示一次！）

**安全建议**：
- 🔒 设置 IP 白名单
- 🔒 只授予必要权限
- 🔒 定期轮换密钥
- 🔒 不要分享给任何人

**示例配置**：
```env
BINANCE_API_KEY=your_real_api_key
BINANCE_API_SECRET=your_real_secret
```

### DEEPSEEK_API_KEY

DeepSeek 大模型 API 密钥，用于智能决策。

#### 获取步骤

1. 访问 [DeepSeek Platform](https://platform.deepseek.com)
2. 注册/登录账户
3. 进入"API Keys"页面
4. 创建新的 API Key
5. 充值账户（按量计费）

#### 费用说明

- **DeepSeek-Chat**: ~¥1/百万 tokens
- **每次决策**: 约 2000-3000 tokens
- **每小时成本**: 约 ¥0.1-0.2（每分钟决策一次）
- **每天成本**: 约 ¥2.4-4.8（24小时运行）

**示例配置**：
```env
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
```

## 可选配置项

### REDIS_HOST 和 REDIS_PORT

Redis 缓存服务器配置（当前版本未使用，预留）。

**默认值**：
```env
REDIS_HOST=localhost
REDIS_PORT=6379
```

## 配置验证

### 检查配置是否生效

运行测试脚本：

```bash
python test.py
```

预期输出：
```
=== 测试配置模块 ===
✓ 配置模块正常

=== 测试Binance连接 ===
✓ Binance连接正常

=== 测试DeepSeek API ===
✓ DeepSeek API正常
```

### 常见错误

#### 错误1：Invalid API-key

```
✗ Binance连接失败: Invalid API-key
```

**原因**：
- API Key 错误或过期
- 使用了实盘 Key 但 config.yaml 配置了 testnet
- 使用了测试网 Key 但 config.yaml 配置了实盘

**解决**：
1. 检查 `.env` 中的 Key 是否正确
2. 检查 `config.yaml` 中 `binance.testnet` 设置
3. 重新生成 API Key

#### 错误2：Incorrect API key provided

```
✗ DeepSeek API失败: Incorrect API key provided
```

**原因**：
- DeepSeek API Key 错误
- 账户余额不足
- API Key 权限问题

**解决**：
1. 检查 API Key 是否正确
2. 登录 DeepSeek 平台查看余额
3. 重新生成 API Key

## 安全最佳实践

### 1. 不要提交到 Git

`.env` 文件已添加到 `.gitignore`，确保不会上传到代码仓库。

**检查**：
```bash
git status  # 不应该看到 .env 文件
```

### 2. 限制文件权限

```bash
# 设置为只有所有者可读写
chmod 600 .env
```

### 3. 使用环境变量的优先级

配置读取优先级：
1. **环境变量** (.env 文件)
2. config.yaml 文件
3. config.example.yaml 默认值

**推荐**：敏感信息放 `.env`，其他配置放 `config.yaml`

### 4. 不同环境使用不同密钥

- 开发环境：使用测试网 Key
- 生产环境：使用实盘 Key + IP 白名单

## 完整示例

### 测试网配置 (.env)

```env
# Binance 测试网
BINANCE_API_KEY=abc123testnet
BINANCE_API_SECRET=xyz789testnet

# DeepSeek
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 配合 config.yaml

```yaml
binance:
  testnet: true  # 使用测试网
  
trading:
  symbol: "BTCUSDT"
  
risk:
  max_risk_per_trade_pct: 1.0
```

## 故障排除

### 问题：找不到 .env 文件

**解决**：
```bash
# 确认当前目录
pwd

# 应该在项目根目录
cd /path/to/ai_trader

# 复制模板
cp .env.example .env
```

### 问题：配置不生效

**解决**：
```bash
# 1. 确认 .env 文件存在
ls -la .env

# 2. 查看文件内容
cat .env

# 3. 确认没有多余空格
# 正确: BINANCE_API_KEY=abc123
# 错误: BINANCE_API_KEY = abc123  (有空格)

# 4. 重启程序
python main.py --mode live
```

## 参考链接

- [Binance API 文档](https://binance-docs.github.io/apidocs/futures/cn/)
- [DeepSeek API 文档](https://platform.deepseek.com/docs)
- [python-dotenv 文档](https://github.com/theskumar/python-dotenv)
