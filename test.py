#!/usr/bin/env python3
"""
测试脚本 - 验证各模块功能
"""
import sys
from pathlib import Path

# 添加项目根目录到路径
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from src.config import config
from src.utils.logger import log
from src.api.binance_client import BinanceClient


def test_config():
    """测试配置加载"""
    log.info("=== 测试配置模块 ===")
    log.info(f"交易对: {config.trading.get('symbol')}")
    log.info(f"最大杠杆: {config.risk.get('max_leverage')}")
    log.info("✓ 配置模块正常\n")
    return True


def test_binance_connection():
    """测试Binance连接"""
    log.info("=== 测试Binance连接 ===")
    
    try:
        client = BinanceClient()
        
        # 获取价格
        symbol = 'BTCUSDT'
        price = client.get_ticker_price(symbol)
        log.info(f"{symbol} 当前价格: ${price['price']:,.2f}")
        
        # 获取K线
        klines = client.get_klines(symbol, '1h', limit=5)
        log.info(f"获取到 {len(klines)} 根K线")
        
        log.info("✓ Binance连接正常\n")
        return True
        
    except Exception as e:
        log.error(f"✗ Binance连接失败: {e}\n")
        return False


def test_market_processor():
    """测试市场数据处理"""
    log.info("=== 测试市场数据处理 ===")
    
    try:
        from src.data.processor import MarketDataProcessor
        
        client = BinanceClient()
        processor = MarketDataProcessor()
        
        symbol = 'BTCUSDT'
        klines = client.get_klines(symbol, '1h', limit=100)
        
        df = processor.process_klines(klines, symbol, '1h')
        log.info(f"处理了 {len(df)} 根K线")
        
        state = processor.get_market_state(df)
        log.info(f"市场状态: {state}")
        
        log.info("✓ 市场数据处理正常\n")
        return True
        
    except Exception as e:
        log.error(f"✗ 市场数据处理失败: {e}\n")
        return False


def test_feature_builder():
    """测试特征构建"""
    log.info("=== 测试特征构建 ===")
    
    try:
        from src.features.builder import FeatureBuilder
        from src.data.processor import MarketDataProcessor
        
        client = BinanceClient()
        processor = MarketDataProcessor()
        builder = FeatureBuilder()
        
        symbol = 'BTCUSDT'
        
        # 获取多周期数据（增加更多周期以提供全面的市场视角）
        multi_tf_states = {}
        timeframes = ['5m', '15m', '1h', '4h', '1d']
        
        log.info(f"正在获取 {len(timeframes)} 个时间周期的数据...")
        for tf in timeframes:
            try:
                klines = client.get_klines(symbol, tf, limit=100)
                df = processor.process_klines(klines, symbol, tf)
                if not df.empty:
                    multi_tf_states[tf] = processor.get_market_state(df)
                    log.info(f"  ✓ {tf} 周期数据获取成功")
            except Exception as e:
                log.warning(f"  ✗ {tf} 周期数据获取失败: {e}")
        
        # 获取快照
        snapshot = client.get_market_data_snapshot(symbol)
        
        # 构建上下文
        context = builder.build_market_context(
            symbol,
            multi_tf_states,
            snapshot,
            None
        )
        
        # 格式化为文本
        text = builder.format_for_llm(context)
        log.info("=" * 60)
        log.info("完整特征文本:")
        log.info("=" * 60)
        log.info(text)
        log.info("=" * 60)
        
        log.info("✓ 特征构建正常\n")
        return True
        
    except Exception as e:
        log.error(f"✗ 特征构建失败: {e}\n")
        return False


def test_deepseek():
    """测试DeepSeek API"""
    log.info("=== 测试DeepSeek API ===")
    
    try:
        from src.strategy.deepseek_engine import StrategyEngine
        from src.features.builder import FeatureBuilder
        from src.data.processor import MarketDataProcessor
        
        if not config.deepseek.get('api_key'):
            log.warning("未配置DeepSeek API Key，跳过测试\n")
            return False
        
        engine = StrategyEngine()
        
        # 使用真实的市场数据进行测试
        log.info("使用真实市场数据测试 DeepSeek 决策...")
        
        client = BinanceClient()
        processor = MarketDataProcessor()
        builder = FeatureBuilder()
        
        symbol = 'BTCUSDT'
        
        # 获取多周期数据
        multi_tf_states = {}
        for tf in ['5m', '15m', '1h', '4h', '1d']:
            try:
                klines = client.get_klines(symbol, tf, limit=100)
                df = processor.process_klines(klines, symbol, tf)
                if not df.empty:
                    multi_tf_states[tf] = processor.get_market_state(df)
            except:
                pass
        
        # 获取快照
        snapshot = client.get_market_data_snapshot(symbol)
        
        # 构建上下文
        context = builder.build_market_context(symbol, multi_tf_states, snapshot, None)
        
        # 格式化为 LLM 输入
        llm_context = builder.format_for_llm(context)
        
        test_data = {'timestamp': context['timestamp'], 'symbol': symbol}
        
        log.info("调用DeepSeek进行决策...")
        decision = engine.make_decision(llm_context, test_data)
        
        # 显示决策摘要
        log.info(f"\n{'='*60}")
        log.info(f"决策摘要:")
        log.info(f"  动作: {decision.get('action')}")
        log.info(f"  置信度: {decision.get('confidence')}%")
        log.info(f"  杠杆: {decision.get('leverage')}x")
        log.info(f"  仓位: {decision.get('position_size_pct')}%")
        if decision.get('analysis'):
            log.info(f"\n详细分析:")
            analysis = decision.get('analysis', {})
            for key, value in analysis.items():
                log.info(f"  {key}: {value}")
        log.info(f"{'='*60}\n")
        
        log.info("✓ DeepSeek API正常\n")
        return True
        
    except Exception as e:
        log.error(f"✗ DeepSeek API失败: {e}\n")
        return False


def main():
    """运行所有测试"""
    log.info("\n" + "="*60)
    log.info("AI Trader 系统测试")
    log.info("="*60 + "\n")
    
    results = {
        '配置': test_config(),
        'Binance连接': test_binance_connection(),
        '市场数据处理': test_market_processor(),
        '特征构建': test_feature_builder(),
        'DeepSeek API': test_deepseek()
    }
    
    log.info("="*60)
    log.info("测试结果汇总:")
    log.info("="*60)
    
    for name, result in results.items():
        status = "✓ 通过" if result else "✗ 失败"
        log.info(f"{name}: {status}")
    
    log.info("="*60 + "\n")


if __name__ == '__main__':
    main()
