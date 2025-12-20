#!/bin/bash

# AI Trader 安装脚本

set -e

echo "================================="
echo "AI Trader 自动安装脚本"
echo "================================="
echo ""

# 检查Python版本
echo "[1/6] 检查Python版本..."
if ! command -v python3 &> /dev/null; then
    echo "错误: 未找到Python3，请先安装Python 3.8+"
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
echo "✓ Python版本: $PYTHON_VERSION"
echo ""

# 创建虚拟环境
echo "[2/6] 创建虚拟环境..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo "✓ 虚拟环境已创建"
else
    echo "✓ 虚拟环境已存在"
fi
echo ""

# 激活虚拟环境
echo "[3/6] 激活虚拟环境..."
source venv/bin/activate
echo "✓ 虚拟环境已激活"
echo ""

# 安装依赖
echo "[4/6] 安装依赖包..."
pip install --upgrade pip
pip install -r requirements.txt
echo "✓ 依赖包安装完成"
echo ""

# 创建配置文件
echo "[5/6] 创建配置文件..."
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "✓ .env 文件已创建"
else
    echo "✓ .env 文件已存在"
fi

if [ ! -f "config.yaml" ]; then
    cp config.example.yaml config.yaml
    echo "✓ config.yaml 文件已创建"
else
    echo "✓ config.yaml 文件已存在"
fi
echo ""

# 创建必要目录
echo "[6/6] 创建必要目录..."
mkdir -p logs
mkdir -p data
echo "✓ 目录已创建"
echo ""

echo "================================="
echo "安装完成！"
echo "================================="
echo ""
echo "下一步:"
echo "1. 编辑 .env 文件，填入你的API密钥"
echo "   nano .env"
echo ""
echo "2. （可选）调整 config.yaml 配置"
echo "   nano config.yaml"
echo ""
echo "3. 运行测试脚本"
echo "   python test.py"
echo ""
echo "4. 启动交易系统（测试网模式）"
echo "   python main.py --mode live"
echo ""
echo "⚠️  警告: 请先在测试网测试！"
echo "================================="
