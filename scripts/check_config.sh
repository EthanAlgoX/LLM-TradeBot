#!/bin/bash

# AI Trader - API 配置验证脚本

echo "=================================="
echo "API 配置验证工具"
echo "=================================="
echo ""

# 检查 .env 文件是否存在
if [ ! -f ".env" ]; then
    echo "❌ 错误: .env 文件不存在"
    echo ""
    echo "请执行以下命令创建："
    echo "  cp .env.example .env"
    echo "  nano .env"
    echo ""
    exit 1
fi

echo "✓ .env 文件存在"
echo ""

# 检查环境变量
echo "检查环境变量..."
echo ""

# 加载 .env
export $(cat .env | grep -v '^#' | xargs)

# 检查 BINANCE_API_KEY
if [ -z "$BINANCE_API_KEY" ] || [ "$BINANCE_API_KEY" = "your_binance_api_key_here" ]; then
    echo "❌ BINANCE_API_KEY 未配置或使用默认值"
    BINANCE_OK=false
else
    echo "✓ BINANCE_API_KEY 已配置 (${BINANCE_API_KEY:0:10}...)"
    BINANCE_OK=true
fi

# 检查 BINANCE_API_SECRET
if [ -z "$BINANCE_API_SECRET" ] || [ "$BINANCE_API_SECRET" = "your_binance_api_secret_here" ]; then
    echo "❌ BINANCE_API_SECRET 未配置或使用默认值"
    BINANCE_OK=false
else
    echo "✓ BINANCE_API_SECRET 已配置 (${BINANCE_API_SECRET:0:10}...)"
fi

# 检查 DEEPSEEK_API_KEY
if [ -z "$DEEPSEEK_API_KEY" ] || [ "$DEEPSEEK_API_KEY" = "your_deepseek_api_key_here" ]; then
    echo "❌ DEEPSEEK_API_KEY 未配置或使用默认值"
    DEEPSEEK_OK=false
else
    echo "✓ DEEPSEEK_API_KEY 已配置 (${DEEPSEEK_API_KEY:0:10}...)"
    DEEPSEEK_OK=true
fi

echo ""
echo "=================================="
echo "配置总结"
echo "=================================="

if [ "$BINANCE_OK" = true ] && [ "$DEEPSEEK_OK" = true ]; then
    echo "✓ 所有必需的 API 密钥已配置"
    echo ""
    echo "下一步："
    echo "  python test.py  # 运行测试"
    echo ""
    exit 0
else
    echo "❌ 部分 API 密钥未配置"
    echo ""
    echo "请编辑 .env 文件并填入真实的 API 密钥："
    echo "  nano .env"
    echo ""
    echo "获取 API 密钥："
    echo "  Binance: https://testnet.binancefuture.com (测试网)"
    echo "  DeepSeek: https://platform.deepseek.com"
    echo ""
    exit 1
fi
