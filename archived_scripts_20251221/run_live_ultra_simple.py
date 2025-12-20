"""
超简化实盘交易运行器 - 极简日志模式

运行方式：
  python run_live_ultra_simple.py

输出内容：
  ✅ 只显示：账户余额、当前价格、交易信号、执行结果
  ❌ 隐藏：所有技术指标、数据保存、警告信息
"""

import sys
import os
import logging

# 1. 完全静音loguru
os.environ['LOGURU_LEVEL'] = 'CRITICAL'
logging.getLogger().setLevel(logging.CRITICAL)

# 2. 静音所有警告
import warnings
warnings.filterwarnings('ignore')

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '.')))

from typing import Dict
from datetime import datetime

# 3. 重定向所有loguru输出到/dev/null
from loguru import logger
logger.remove()  # 移除所有处理器

from run_live_trading import LiveTradingBot, TRADING_CONFIG


class UltraSimpleLiveTradingBot(LiveTradingBot):
    """超简化版本 - 只显示关键交易信息"""
    
    def __init__(self, config: Dict = None):
        """初始化时静音所有日志"""
        # 临时重定向stdout
        import io
        old_stdout = sys.stdout
        sys.stdout = io.StringIO()
        
        try:
            super().__init__(config)
        finally:
            sys.stdout = old_stdout
        
        # 只显示配置摘要
        print("\n" + "="*80)
        print("🤖 AI Trader - 极简模式")
        print("="*80)
        print(f"💰 最大单笔: ${self.max_position_size:.2f} USDT")
        print(f"⚙️  杠杆: {self.config_dict['leverage']}x | 止损: {self.config_dict['stop_loss_pct']}% | 止盈: {self.config_dict['take_profit_pct']}%")
        print("="*80 + "\n")
    
    def run_once(self):
        """执行一次交易周期 - 极简日志"""
        print(f"🔄 {datetime.now().strftime('%H:%M:%S')} | 执行交易周期...")
        
        # 临时静音
        import io
        old_stdout = sys.stdout
        captured_output = io.StringIO()
        sys.stdout = captured_output
        
        try:
            # 执行父类方法
            result = super().run_once()
            
            # 恢复输出
            sys.stdout = old_stdout
            
            # 提取关键信息
            output = captured_output.getvalue()
            
            # 只显示关键信息
            for line in output.split('\n'):
                if any(keyword in line for keyword in [
                    '💰 合约账户余额',
                    '🎯 交易信号',
                    '✅ 当前无交易信号',
                    '✅ 订单执行成功',
                    '❌ 订单执行失败'
                ]):
                    print(line)
            
            return result
            
        except Exception as e:
            sys.stdout = old_stdout
            print(f"❌ 错误: {e}")
            return {
                'success': False,
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            }


def main():
    """主函数"""
    try:
        bot = UltraSimpleLiveTradingBot(TRADING_CONFIG)
        
        if TRADING_CONFIG['mode'] == 'once':
            # 单次运行
            result = bot.run_once()
            print(f"\n{'='*80}")
            print(f"✅ {datetime.now().strftime('%H:%M:%S')} | 周期完成")
            print(f"{'='*80}\n")
        else:
            # 持续运行
            import time
            interval = TRADING_CONFIG['interval_minutes'] * 60
            
            while True:
                result = bot.run_once()
                print(f"\n⏳ 等待 {TRADING_CONFIG['interval_minutes']} 分钟...\n")
                time.sleep(interval)
                
    except KeyboardInterrupt:
        print("\n⚠️  停止运行\n")
    except Exception as e:
        print(f"\n❌ 系统错误: {e}\n")


if __name__ == "__main__":
    main()
