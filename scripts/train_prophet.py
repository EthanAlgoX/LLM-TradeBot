#!/usr/bin/env python3
"""
🔮 Prophet ML 模型训练脚本
============================

从 Binance 获取历史数据，生成特征和标签，训练 ML 模型

Usage:
    python scripts/train_prophet.py --symbol BTCUSDT --days 30

Author: AI Trader Team
Date: 2025-12-21
"""

import os
import sys
import argparse
from datetime import datetime, timedelta

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
import numpy as np

from src.api.binance_client import BinanceClient
from src.features.technical_features import TechnicalFeatureEngineer
from src.models.prophet_model import ProphetMLModel, LabelGenerator, HAS_LIGHTGBM
from src.utils.logger import log


def fetch_historical_data(
    client: BinanceClient,
    symbol: str,
    interval: str = '5m',
    days: int = 30
) -> pd.DataFrame:
    """
    获取历史 K 线数据
    
    Args:
        client: Binance 客户端
        symbol: 交易对
        interval: K 线间隔
        days: 历史天数
    
    Returns:
        K 线 DataFrame
    """
    log.info(f"📥 获取 {symbol} 历史数据 ({days} 天, {interval})...")
    
    # 计算需要的 K 线数量
    if interval == '5m':
        limit = days * 24 * 12  # 每天 288 根 5 分钟 K 线
    elif interval == '15m':
        limit = days * 24 * 4
    elif interval == '1h':
        limit = days * 24
    else:
        limit = 1000
    
    # 分批获取数据（Binance 限制每次最多 1000 条）
    all_klines = []
    remaining = limit
    end_time = None
    
    while remaining > 0:
        batch_size = min(remaining, 1000)
        klines = client.client.futures_klines(
            symbol=symbol,
            interval=interval,
            limit=batch_size,
            endTime=end_time
        )
        
        if not klines:
            break
        
        all_klines = klines + all_klines
        end_time = klines[0][0] - 1  # 下一批的结束时间
        remaining -= batch_size
        
        log.info(f"   已获取 {len(all_klines)} 条 K 线...")
    
    # 转换为 DataFrame
    df = pd.DataFrame(all_klines, columns=[
        'timestamp', 'open', 'high', 'low', 'close', 'volume',
        'close_time', 'quote_volume', 'trades', 'taker_buy_base',
        'taker_buy_quote', 'ignore'
    ])
    
    # 数据类型转换
    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
    for col in ['open', 'high', 'low', 'close', 'volume']:
        df[col] = df[col].astype(float)
    
    df.set_index('timestamp', inplace=True)
    df = df.sort_index()
    
    log.info(f"✅ 获取完成: {len(df)} 条 K 线")
    log.info(f"   时间范围: {df.index[0]} ~ {df.index[-1]}")
    
    return df


def prepare_training_data(
    df: pd.DataFrame,
    feature_engineer: TechnicalFeatureEngineer,
    label_generator: LabelGenerator
) -> tuple:
    """
    准备训练数据
    
    Args:
        df: K 线数据
        feature_engineer: 特征工程器
        label_generator: 标签生成器
    
    Returns:
        (X, y) 元组
    """
    log.info("🔧 计算基础指标...")
    
    # 使用 MarketDataProcessor 计算基础指标
    from src.data.processor import MarketDataProcessor
    processor = MarketDataProcessor()
    
    # 直接调用内部方法计算指标
    df_with_indicators = processor._calculate_indicators(df.copy())
    
    log.info("🔧 构建高级特征...")
   
    # 生成特征
    features_df = feature_engineer.build_features(df_with_indicators)
    
    # 移除非数值列
    numeric_features = features_df.select_dtypes(include=[np.number])
    
    log.info(f"   特征数量: {len(numeric_features.columns)}")
    
    # 生成标签
    log.info("🏷️ 生成标签...")
    X, y = label_generator.prepare_training_data(
        features_df=numeric_features,
        price_df=df,
        price_col='close'
    )
    
    return X, y


def train_model(
    X: pd.DataFrame,
    y: pd.Series,
    val_ratio: float = 0.2,
    output_path: str = 'models/prophet_lgb.pkl'
) -> dict:
    """
    训练模型
    
    Args:
        X: 特征
        y: 标签
        val_ratio: 验证集比例
        output_path: 模型输出路径
    
    Returns:
        训练指标
    """
    # 分割训练集和验证集（时间序列，不能随机分割）
    split_idx = int(len(X) * (1 - val_ratio))
    X_train, X_val = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_val = y.iloc[:split_idx], y.iloc[split_idx:]
    
    log.info(f"📊 数据分割:")
    log.info(f"   训练集: {len(X_train)} 样本")
    log.info(f"   验证集: {len(X_val)} 样本")
    
    # 创建并训练模型
    model = ProphetMLModel()
    metrics = model.train(X_train, y_train, X_val, y_val)
    
    # 保存模型
    model.save(output_path)
    
    # 输出特征重要性
    importance = model.get_feature_importance()
    top_features = sorted(importance.items(), key=lambda x: x[1], reverse=True)[:10]
    
    log.info("📈 Top 10 特征重要性:")
    for name, imp in top_features:
        log.info(f"   {name}: {imp:.4f}")
    
    return metrics


def main():
    parser = argparse.ArgumentParser(description='训练 Prophet ML 模型')
    parser.add_argument('--symbol', type=str, default='BTCUSDT', help='交易对')
    parser.add_argument('--days', type=int, default=30, help='历史天数')
    parser.add_argument('--interval', type=str, default='5m', help='K 线间隔')
    parser.add_argument('--output', type=str, default='models/prophet_lgb.pkl', help='模型输出路径')
    parser.add_argument('--horizon', type=int, default=30, help='预测时间范围 (分钟)')
    parser.add_argument('--threshold', type=float, default=0.001, help='上涨阈值')
    
    args = parser.parse_args()
    
    print("\n" + "="*60)
    print("🔮 Prophet ML 模型训练")
    print("="*60)
    
    if not HAS_LIGHTGBM:
        print("❌ 错误: LightGBM 未安装")
        print("   请运行: pip install lightgbm scikit-learn")
        sys.exit(1)
    
    # 初始化组件
    client = BinanceClient()
    feature_engineer = TechnicalFeatureEngineer()
    label_generator = LabelGenerator(
        horizon_minutes=args.horizon,
        up_threshold=args.threshold
    )
    
    # 获取历史数据
    df = fetch_historical_data(
        client=client,
        symbol=args.symbol,
        interval=args.interval,
        days=args.days
    )
    
    if len(df) < 500:
        print(f"❌ 数据不足: 需要至少 500 条 K 线，当前只有 {len(df)} 条")
        sys.exit(1)
    
    # 准备训练数据
    X, y = prepare_training_data(df, feature_engineer, label_generator)
    
    if len(X) < 100:
        print(f"❌ 有效样本不足: 需要至少 100 条，当前只有 {len(X)} 条")
        sys.exit(1)
    
    # 训练模型
    metrics = train_model(X, y, output_path=args.output)
    
    print("\n" + "="*60)
    print("✅ 训练完成!")
    print("="*60)
    print(f"   训练样本: {metrics.get('train_samples', 0)}")
    print(f"   验证样本: {metrics.get('val_samples', 0)}")
    print(f"   训练 AUC: {metrics.get('train_auc', 0):.4f}")
    print(f"   验证 AUC: {metrics.get('val_auc', 0):.4f}")
    print(f"   模型路径: {args.output}")
    print()


if __name__ == '__main__':
    main()
