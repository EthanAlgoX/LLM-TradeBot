"""
AI Trader - 主程序
"""
import asyncio
import time
from typing import Dict
from src.config import config
from src.utils.logger import log
from src.api.binance_client import BinanceClient
from src.data.processor import MarketDataProcessor
from src.features.builder import FeatureBuilder
from src.strategy.deepseek_engine import StrategyEngine
from src.risk.manager import RiskManager
from src.execution.engine import ExecutionEngine
from src.monitoring.logger import TradingLogger


class AITrader:
    """AI交易主程序"""
    
    def __init__(self, mode: str = 'live'):
        """
        初始化AI交易系统
        
        Args:
            mode: 'live' 或 'backtest'
        """
        self.mode = mode
        
        # 初始化各模块
        log.info("=== 初始化AI交易系统 ===")
        
        self.binance = BinanceClient()
        self.processor = MarketDataProcessor()
        self.feature_builder = FeatureBuilder()
        self.strategy_engine = StrategyEngine()
        self.risk_manager = RiskManager()
        self.execution_engine = ExecutionEngine(self.binance, self.risk_manager)
        self.trading_logger = TradingLogger()
        
        # 交易配置
        self.symbol = config.trading.get('symbol', 'BTCUSDT')
        self.timeframes = config.trading.get('timeframes', ['1m', '5m', '15m', '1h'])
        self.update_interval = 60  # 每60秒更新一次
        
        # 状态
        self.is_running = False
        self.peak_balance = 0
        
        log.info(f"初始化完成 - 模式: {mode}, 交易对: {self.symbol}")
    
    def run(self):
        """启动交易系统"""
        self.is_running = True
        log.info("=== 开始运行交易系统 ===")
        
        if self.mode == 'live':
            self._run_live()
        elif self.mode == 'backtest':
            self._run_backtest()
        else:
            log.error(f"未知模式: {self.mode}")
    
    def _run_live(self):
        """实盘交易循环"""
        
        while self.is_running:
            try:
                log.info(f"\n{'='*60}")
                log.info(f"开始新一轮分析 - {self.symbol}")
                log.info(f"{'='*60}")
                
                # 1. 获取市场数据
                snapshot = self.binance.get_market_data_snapshot(self.symbol)
                
                # 2. 处理多周期K线
                multi_timeframe_states = {}
                for tf in self.timeframes:
                    klines = self.binance.get_klines(self.symbol, tf, limit=200)
                    df = self.processor.process_klines(klines, self.symbol, tf)
                    
                    if not df.empty:
                        state = self.processor.get_market_state(df)
                        multi_timeframe_states[tf] = state
                        log.info(f"{tf} 趋势: {state.get('trend')}, RSI: {state.get('rsi')}")
                
                # 3. 构建特征
                position_info = snapshot.get('position')
                market_context = self.feature_builder.build_market_context(
                    symbol=self.symbol,
                    multi_timeframe_states=multi_timeframe_states,
                    snapshot=snapshot,
                    position_info=position_info
                )
                
                # 格式化为文本
                context_text = self.feature_builder.format_for_llm(market_context)
                
                # 4. LLM决策
                log.info("调用DeepSeek进行决策...")
                decision = self.strategy_engine.make_decision(context_text, market_context)
                
                # 验证决策格式
                if not self.strategy_engine.validate_decision(decision):
                    log.error("LLM决策格式无效，跳过本轮")
                    time.sleep(self.update_interval)
                    continue
                
                log.info(f"LLM决策: {decision['action']} (置信度: {decision['confidence']}%)")
                log.info(f"理由: {decision['reasoning']}")
                
                # 5. 风险管理验证
                account_info = snapshot.get('account', {})
                is_valid, modified_decision, risk_msg = self.risk_manager.validate_decision(
                    decision,
                    account_info,
                    position_info,
                    market_context
                )
                
                # 记录决策
                self.trading_logger.log_decision(
                    decision,
                    market_context,
                    (is_valid, modified_decision, risk_msg)
                )
                
                if not is_valid:
                    log.warning(f"风控拒绝: {risk_msg}")
                    time.sleep(self.update_interval)
                    continue
                
                # 6. 执行交易
                if modified_decision['action'] != 'hold':
                    log.info("执行交易...")
                    
                    current_price = snapshot.get('price', {}).get('price', 0)
                    execution_result = self.execution_engine.execute_decision(
                        modified_decision,
                        account_info,
                        position_info,
                        current_price
                    )
                    
                    # 记录执行结果
                    self.trading_logger.log_execution(execution_result)
                    
                    if execution_result['success']:
                        log.info(f"✓ 执行成功: {execution_result['message']}")
                        
                        # 记录交易
                        if modified_decision['action'] in ['open_long', 'open_short']:
                            self.trading_logger.open_trade({
                                'timestamp': execution_result['timestamp'],
                                'symbol': self.symbol,
                                'side': modified_decision['action'].replace('open_', '').upper(),
                                'entry_price': execution_result.get('entry_price'),
                                'quantity': execution_result.get('quantity'),
                                'leverage': modified_decision['leverage']
                            })
                    else:
                        log.error(f"✗ 执行失败: {execution_result['message']}")
                
                # 7. 更新回撤
                current_balance = account_info.get('total_wallet_balance', 0)
                if current_balance > self.peak_balance:
                    self.peak_balance = current_balance
                
                self.risk_manager.update_drawdown(current_balance, self.peak_balance)
                
                # 8. 记录性能
                stats = self.trading_logger.get_trade_statistics()
                risk_status = self.risk_manager.get_risk_status()
                
                log.info(f"\n{'='*60}")
                log.info("性能统计:")
                log.info(f"  总交易: {stats['total_trades']}")
                log.info(f"  胜率: {stats['win_rate']:.2f}%")
                log.info(f"  总盈亏: ${stats['total_pnl']:.2f}")
                log.info(f"  连续亏损: {risk_status['consecutive_losses']}")
                log.info(f"  当前回撤: {risk_status['total_drawdown_pct']:.2f}%")
                log.info(f"{'='*60}\n")
                
                # 等待下一轮
                log.info(f"等待 {self.update_interval} 秒...")
                time.sleep(self.update_interval)
                
            except KeyboardInterrupt:
                log.info("接收到停止信号")
                self.stop()
                break
            except Exception as e:
                log.error(f"运行出错: {e}", exc_info=True)
                time.sleep(self.update_interval)
    
    def _run_backtest(self):
        """回测模式"""
        log.info("回测功能开发中...")
        # TODO: 实现回测逻辑
    
    def stop(self):
        """停止交易系统"""
        log.info("=== 停止交易系统 ===")
        self.is_running = False
        
        # 打印最终统计
        stats = self.trading_logger.get_trade_statistics()
        log.info(f"\n最终统计:")
        log.info(f"  总交易: {stats['total_trades']}")
        log.info(f"  胜率: {stats['win_rate']:.2f}%")
        log.info(f"  总盈亏: ${stats['total_pnl']:.2f}")


def main():
    """主入口"""
    import argparse
    
    parser = argparse.ArgumentParser(description='AI Trader - 智能交易系统')
    parser.add_argument(
        '--mode',
        type=str,
        default='live',
        choices=['live', 'backtest'],
        help='运行模式'
    )
    parser.add_argument(
        '--start',
        type=str,
        help='回测开始日期 (YYYY-MM-DD)'
    )
    parser.add_argument(
        '--end',
        type=str,
        help='回测结束日期 (YYYY-MM-DD)'
    )
    
    args = parser.parse_args()
    
    # 创建交易系统
    trader = AITrader(mode=args.mode)
    
    try:
        trader.run()
    except KeyboardInterrupt:
        trader.stop()


if __name__ == '__main__':
    main()
