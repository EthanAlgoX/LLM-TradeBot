"""
实盘合约交易运行器 - 简化日志版本

运行方式：
  python run_live_trading_simple.py

特点：
  ✅ 只显示关键交易信息
  ✅ 隐藏数据保存/技术指标计算等细节日志
  ✅ 清晰的决策和执行提示
"""

import sys
import os

# 设置环境变量，静音loguru
os.environ['LOGURU_LEVEL'] = 'WARNING'

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '.')))

from typing import Dict
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')  # 忽略警告

from run_live_trading import LiveTradingBot, TRADING_CONFIG

# 覆盖print函数，过滤掉不必要的输出
original_print = print
muted_keywords = [
    '保存 JSON', '保存 CSV', '保存 Parquet', '步骤1数据已保存',
    '步骤2数据已保存', '步骤3数据已保存', 'Step2归档',
    '特征工程完成', '开始特征工程', 'Warm-up标记',
    '开始验证', '数据验证通过', '快照生成', '处理K线',
    '保存步骤', '归档'
]

def filtered_print(*args, **kwargs):
    """过滤后的print函数"""
    message = ' '.join(str(arg) for arg in args)
    # 检查是否包含需要静音的关键词
    if not any(keyword in message for keyword in muted_keywords):
        original_print(*args, **kwargs)

# 替换全局print
import builtins
builtins.print = filtered_print


class SimpleLiveTradingBot(LiveTradingBot):
    """简化日志版本的实盘交易机器人"""
    
    def run_once(self):
        """
        执行一次完整的交易周期（简化日志版）
        
        Returns:
            dict: 交易结果
        """
        original_print("\n" + "="*80)
        original_print(f"🔄 交易周期 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        original_print("="*80 + "\n")
        
        try:
            # 调用父类方法
            result = super().run_once()
            return result
            
        except Exception as e:
            original_print(f"\n❌ 交易周期执行失败: {e}")
            return {
                'success': False,
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            }


def main():
    """主函数"""
    # 显示配置信息
    original_print("\n" + "="*80)
    original_print("⚙️  简化日志模式")
    original_print("="*80)
    original_print("✅ 已过滤数据保存和技术指标日志")
    original_print("✅ 只显示关键交易决策信息")
    original_print("="*80 + "\n")
    
    # 创建并运行机器人
    bot = SimpleLiveTradingBot(TRADING_CONFIG)
    
    try:
        if TRADING_CONFIG['mode'] == 'once':
            # 单次运行
            result = bot.run_once()
            original_print(f"\n{'='*80}")
            original_print(f"✅ 运行完成")
            original_print(f"{'='*80}\n")
        else:
            # 持续运行
            bot.run_continuous(TRADING_CONFIG['interval_minutes'])
            
    except KeyboardInterrupt:
        original_print("\n\n⚠️  收到停止信号，退出...")
    except Exception as e:
        original_print(f"\n❌ 错误: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
