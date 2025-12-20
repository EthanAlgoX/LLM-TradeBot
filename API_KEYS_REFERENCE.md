# 🔑 API 密钥快速参考

## 环境变量名称统一规范

所有配置文件使用统一的环境变量名称：

| 用途 | 环境变量名 | 说明 |
|------|-----------|------|
| Binance API Key | `BINANCE_API_KEY` | 币安 API 密钥 |
| Binance API Secret | `BINANCE_API_SECRET` | 币安 API 密钥 |
| DeepSeek API Key | `DEEPSEEK_API_KEY` | DeepSeek API 密钥 |

## 配置位置

### .env 文件（推荐）✅

```env
BINANCE_API_KEY=你的币安API密钥
BINANCE_API_SECRET=你的币安密钥
DEEPSEEK_API_KEY=你的DeepSeek密钥
```

### config.yaml 文件（会被 .env 覆盖）

```yaml
binance:
  api_key: "BINANCE_API_KEY"        # 占位符
  api_secret: "BINANCE_API_SECRET"  # 占位符

deepseek:
  api_key: "DEEPSEEK_API_KEY"       # 占位符
```

## 配置优先级

```
.env 环境变量 > config.yaml 配置文件
```

## 快速设置（3步）

### 1️⃣ 复制模板

```bash
cp .env.example .env
```

### 2️⃣ 编辑 .env

```bash
nano .env
```

填入实际的 API 密钥：
```env
BINANCE_API_KEY=实际的密钥
BINANCE_API_SECRET=实际的密钥  
DEEPSEEK_API_KEY=实际的密钥
```

### 3️⃣ 验证配置

```bash
python test.py
```

## 获取 API 密钥

### 📍 Binance 测试网（推荐新手）

1. 访问: https://testnet.binancefuture.com
2. 注册/登录
3. 创建 API Key
4. 复制 Key 和 Secret

### 📍 Binance 实盘（谨慎使用）

1. 访问: https://www.binance.com
2. 账户 → API 管理
3. 创建 API Key
4. **启用**: 读取 + 期货交易
5. **禁用**: 提现
6. **设置**: IP 白名单
7. 复制 Key 和 Secret

### 📍 DeepSeek

1. 访问: https://platform.deepseek.com
2. 注册/登录
3. API Keys → 创建新密钥
4. 充值账户（约 ¥10 可用很久）
5. 复制 API Key

## 安全检查清单

- [ ] ✅ .env 文件已添加到 .gitignore
- [ ] ✅ 不在代码中硬编码密钥
- [ ] ✅ 测试网优先测试
- [ ] ✅ 实盘 API 设置 IP 白名单
- [ ] ✅ 不启用提现权限
- [ ] ❌ 不分享 .env 文件
- [ ] ❌ 不截图包含密钥的内容

## 故障排查

### ❌ Invalid API-key

**可能原因**：
- API Key 复制错误（有空格或换行）
- 使用了实盘 Key 但配置了测试网
- 使用了测试网 Key 但配置了实盘

**解决**：
```bash
# 1. 检查 .env 文件
cat .env

# 2. 确认 config.yaml 中的 testnet 设置
grep testnet config.yaml

# 3. 重新复制 API Key（确保无空格）
```

### ❌ IP not allowed

**原因**: API Key 设置了 IP 白名单

**解决**：
1. 登录 Binance
2. API 管理 → 编辑 API
3. 添加当前 IP 或选择"不限制"

### ❌ DeepSeek: Insufficient balance

**原因**: DeepSeek 账户余额不足

**解决**：
1. 登录 DeepSeek 平台
2. 充值账户（¥10-20 即可）

## 配置示例

### 完整的 .env 文件

```env
# ===========================================
# AI Trader 配置文件
# 警告: 不要提交此文件到 Git！
# ===========================================

# Binance API (测试网)
BINANCE_API_KEY=abcdefghijklmnopqrstuvwxyz1234567890
BINANCE_API_SECRET=1234567890abcdefghijklmnopqrstuvwxyz

# DeepSeek API
DEEPSEEK_API_KEY=sk-1234567890abcdef

# Redis (可选)
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 最小配置（仅必需项）

```env
BINANCE_API_KEY=你的密钥
BINANCE_API_SECRET=你的密钥
DEEPSEEK_API_KEY=你的密钥
```

## 测试配置

运行测试验证所有 API 密钥：

```bash
python test.py
```

预期输出：
```
=== 测试配置模块 ===
交易对: BTCUSDT
最大杠杆: 5
✓ 配置模块正常

=== 测试Binance连接 ===
BTCUSDT 当前价格: $95,123.45
获取到 5 根K线
✓ Binance连接正常

=== 测试DeepSeek API ===
决策: hold
✓ DeepSeek API正常
```

## 多环境管理

### 创建多个配置文件

```bash
# 测试网配置
cp .env.example .env.test
nano .env.test  # 填入测试网密钥

# 实盘配置
cp .env.example .env.prod
nano .env.prod  # 填入实盘密钥
```

### 切换环境

```bash
# 使用测试网
cp .env.test .env

# 使用实盘
cp .env.prod .env
```

## 下一步

✅ 配置完成后：

1. 📝 阅读 [配置指南](CONFIG_GUIDE.md)
2. �� 查看 [快速开始](QUICK_START.md)
3. 🏗️ 了解 [系统架构](ARCHITECTURE.md)

---

**记住**: 保护好你的 API 密钥 = 保护好你的资金！��
