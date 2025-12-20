"""
实盘合约交易运行器 - 使用真实资金进行自动交易

配置方式：
1. 修改本文件顶部的 TRADING_CONFIG 字典
2. 或使用命令行参数: python run_live_trading.py --max-position 100 --mode continuous

默认配置：
- 最大单笔: $100 USDT
- 运行模式: 单次
- 杠杆: 1x
- 止损: 1%
- 止盈: 2%
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '.')))

from typing import Dict, Optional
import time
from datetime import datetime
import json
import argparse

from src.api.binance_client import BinanceClient
from src.data.processor import MarketDataProcessor
from src.features.builder import FeatureBuilder
from src.risk.manager import RiskManager
from src.execution.engine import ExecutionEngine
from src.config import Config
from src.utils.trade_logger import trade_logger
from src.utils.data_saver import DataSaver
from src.utils.logger import log
from src.utils.simple_logger import simple_log  # 新增：简化日志


# ============================================================================
# 交易配置 - 在此修改参数
# ============================================================================
TRADING_CONFIG = {
    # 资金管理
    'max_position_size': 120.0,      # 最大单笔交易金额 (USDT) - 调整到满足最低要求
    'position_pct': 80,              # 使用账户余额的百分比 (%) - 提高到80%确保满足100 USDT最低要求
    
    # 杠杆和风控
    'leverage': 1,                   # 杠杆倍数 (1-5, 建议1-2)
    'stop_loss_pct': 1,              # 止损百分比 (%)
    'take_profit_pct': 2,            # 止盈百分比 (%)
    
    # 运行模式
    'mode': 'once',                  # 'once' 单次运行, 'continuous' 持续运行
    'interval_minutes': 5,           # 持续运行时的间隔 (分钟)
    
    # 安全设置
    'confirm_before_trade': True,    # 交易前确认 (True/False)
    'confirm_seconds': 5,            # 确认等待时间 (秒)
}
# ============================================================================


class LiveTradingBot:
    """实盘合约交易机器人"""
    
    def __init__(self, config: Dict = None):
        """
        初始化交易机器人
        
        Args:
            config: 配置字典，如果不提供则使用默认TRADING_CONFIG
        """
        self.config_dict = config or TRADING_CONFIG.copy()
        
        print("\n" + "="*80)
        print("🤖 AI Trader - 合约交易机器人")
        print("="*80)
        
        self.config = Config()
        self.client = BinanceClient()
        self.processor = MarketDataProcessor()
        self.feature_builder = FeatureBuilder()
        self.risk_manager = RiskManager()
        self.execution_engine = ExecutionEngine(self.client, self.risk_manager)
        # 实例化数据保存器，用于归档实盘交易事件（step9）
        self.data_saver = DataSaver()
        
        self.max_position_size = self.config_dict['max_position_size']
        self.is_running = False
        self.trade_history = []
        
        print(f"\n⚙️  交易配置:")
        print(f"  - 交易类型: 合约交易 (FUTURES)")
        print(f"  - 最大单笔: ${self.max_position_size:.2f} USDT")
        print(f"  - 仓位比例: {self.config_dict['position_pct']}%")
        print(f"  - 杠杆倍数: {self.config_dict['leverage']}x")
        print(f"  - 止损: {self.config_dict['stop_loss_pct']}%")
        print(f"  - 止盈: {self.config_dict['take_profit_pct']}%")
        print(f"  - 运行模式: {'单次' if self.config_dict['mode'] == 'once' else '持续'}")
        if self.config_dict['mode'] == 'continuous':
            print(f"  - 检查间隔: {self.config_dict['interval_minutes']}分钟")
        print(f"  - 交易确认: {'启用' if self.config_dict['confirm_before_trade'] else '禁用'}")
        
    def get_account_balance(self) -> float:
        """获取合约账户余额"""
        try:
            futures_account = self.client.get_futures_account()
            available_balance = futures_account['available_balance']
            return available_balance
        except Exception as e:
            print(f"❌ 获取合约账户余额失败: {e}")
            return 0.0
    
    def _estimate_slippage(self, volume_ratio: float) -> float:
        """
        估算滑点（单位：基点 bps）
        
        基于经验公式：滑点 ≈ k / sqrt(volume_ratio)
        其中 k 为市场常数（BTC约0.1）
        
        Args:
            volume_ratio: 成交量相对均值的比率
            
        Returns:
            预期滑点（基点 bps）
        """
        import math
        if volume_ratio <= 0:
            return 100.0  # 极端情况
        
        # BTC市场常数（基于历史数据拟合）
        k = 0.1
        slippage_bps = k / math.sqrt(volume_ratio)
        
        # 限制在合理范围
        return min(slippage_bps, 100.0)
    
    def _validate_multiframe_prices(self, multi_timeframe_states: Dict) -> None:
        """
        验证多周期价格的独立性（静默检查，只在异常时警告）
        
        检查不同周期的价格是否异常一致（容忍度：0.01%）
        如果价格完全相同，说明可能使用了未完成K线（伪多周期）
        """
        prices = []
        for tf, state in multi_timeframe_states.items():
            price = state.get('price', 0)
            if price > 0:
                prices.append((tf, price))
        
        if len(prices) < 2:
            return
        
        # 检查价格是否异常一致
        price_values = [p[1] for p in prices]
        max_price = max(price_values)
        min_price = min(price_values)
        
        # 计算价格差异百分比
        if max_price > 0:
            diff_pct = (max_price - min_price) / max_price * 100
            
            # 如果价格差异小于0.01%，发出简洁警告
            if diff_pct < 0.01:
                print(f"⚠️  多周期价格异常一致 (差异{diff_pct:.4f}%)，可能使用了未完成K线")
    
    def get_market_data(self, symbol: str = "BTCUSDT") -> Optional[Dict]:
        """获取市场数据并构建特征"""
        try:
            # 获取多周期K线数据
            # ✅ 修正：增加数据量以确保指标稳定性
            # - SMA_50 需要 50 根数据，前 49 根为 NaN
            # - EMA/MACD 需要 3-5 倍周期才能完全收敛
            # - Warmup 期需要 105 根（MACD 完全收敛）
            # - 因此获取 300 根（3 倍最大周期），确保有足够的有效数据
            klines_5m = self.client.get_klines(symbol, '5m', limit=300)
            klines_15m = self.client.get_klines(symbol, '15m', limit=300)
            klines_1h = self.client.get_klines(symbol, '1h', limit=300)
            
            if not all([klines_5m, klines_15m, klines_1h]):
                print("❌ 数据获取失败")
                return None
            
            # Step1: 保存所有周期的原始K线数据
            try:
                self.data_saver.save_step1_klines(klines_5m, symbol, '5m', save_formats=['json', 'csv', 'parquet'])
                self.data_saver.save_step1_klines(klines_15m, symbol, '15m', save_formats=['json', 'csv', 'parquet'])
                self.data_saver.save_step1_klines(klines_1h, symbol, '1h', save_formats=['json', 'csv', 'parquet'])
                print("✅ Step1: K线数据获取完成 (300根×3周期)")
            except Exception as e:
                print(f"⚠️  Step1失败: {e}")
            
            # Step2: 计算技术指标（多周期独立）
            df_5m = self.processor.process_klines(klines_5m, symbol, '5m')
            df_15m = self.processor.process_klines(klines_15m, symbol, '15m')
            df_1h = self.processor.process_klines(klines_1h, symbol, '1h')
            
            # Step2: 保存技术指标数据（5m为主，包含统计报告）
            try:
                snapshot_id = df_5m.attrs.get('snapshot_id', 'unknown')
                self.data_saver.save_step2_indicators(df_5m, symbol, '5m', snapshot_id, save_stats=True)
                print("✅ Step2: 技术指标计算完成 (SMA/EMA/MACD/RSI/BB)")
            except Exception as e:
                print(f"⚠️  Step2失败: {e}")
            
            # Step3: 特征工程（真正的高级特征构建）
            from src.features.technical_features import TechnicalFeatureEngineer
            
            try:
                engineer = TechnicalFeatureEngineer()
                features_5m = engineer.build_features(df_5m)
                features_15m = engineer.build_features(df_15m)
                features_1h = engineer.build_features(df_1h)
                
                # 保存特征数据（去除 warmup 期）
                features_5m_valid = features_5m[features_5m.get('is_warmup', True) == False]
                if not features_5m_valid.empty:
                    feature_version = features_5m.attrs.get('feature_version', 'v1.0')
                    self.data_saver.save_step3_features(
                        features_5m_valid, symbol, '5m', snapshot_id, feature_version, save_stats=True
                    )
                    print(f"✅ Step3: 特征工程完成 (+{engineer.feature_count}个特征, 总{len(features_5m.columns)}列)")
            except Exception as e:
                print(f"⚠️  Step3失败: {e}, 使用基础指标")
                features_5m = df_5m
                features_15m = df_15m
                features_1h = df_1h
            
            # 获取合约账户信息
            futures_account = self.client.get_futures_account()
            
            # 添加多周期信息
            multi_timeframe_states = {
                '5m': self._extract_key_indicators(df_5m),
                '15m': self._extract_key_indicators(df_15m),
                '1h': self._extract_key_indicators(df_1h)
            }
            
            # 检查指标完整性（静默检查，只在有问题时警告）
            for tf, df in [('5m', df_5m), ('15m', df_15m), ('1h', df_1h)]:
                completeness = self.processor.check_indicator_completeness(df, min_coverage=0.95)
                multi_timeframe_states[tf]['indicator_completeness'] = completeness
                
                if not completeness['is_complete']:
                    log.warning(f"[{symbol}] {tf}周期指标覆盖率: {completeness['overall_coverage']:.1%}")
            
            # 🔴 新增：多周期价格验证（静默检查，只在异常时警告）
            self._validate_multiframe_prices(multi_timeframe_states)
            
            # 创建快照
            latest_1h = df_1h.iloc[-2]  # ✅ 修正：使用已完成的K线
            snapshot = {
                'price': {'price': float(latest_1h['close'])},
                'funding': {'funding_rate': 0},
                'oi': {},
                'orderbook': {}
            }
            
            # 构建市场上下文
            market_state = self.feature_builder.build_market_context(
                symbol=symbol,
                multi_timeframe_states=multi_timeframe_states,
                snapshot=snapshot,
                position_info=None
            )
            
            # 添加当前价格（方便后续使用）
            market_state['current_price'] = float(latest_1h['close'])
            market_state['timeframes'] = multi_timeframe_states
            
            # Step4: 保存多周期上下文
            try:
                context = {
                    'symbol': symbol,
                    'timestamp': datetime.now().isoformat(),
                    'current_price': market_state['current_price'],
                    'multi_timeframe_states': multi_timeframe_states,
                    'snapshot': snapshot
                }
                self.data_saver.save_step4_context(context, symbol, '5m', snapshot_id)
                print("✅ Step4: 多周期上下文构建完成")
            except Exception as e:
                print(f"⚠️  Step4失败: {e}")
            
            return market_state
            
        except Exception as e:
            print(f"❌ 市场数据获取失败: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def _extract_key_indicators(self, df) -> Dict:
        """
        提取关键指标（支持完整特征传递）
        
        🔴 重要：使用已完成的K线（df.iloc[-2]）而非未完成的K线（df.iloc[-1]）
        这样可以确保多周期数据的真实独立性
        
        返回结构：
        - 基础指标（兼容旧逻辑）：price, rsi, macd, trend, volume_ratio
        - Step3关键特征：features.critical / features.important
        """
        if df is None or df.empty or len(df) < 2:
            return {}
        
        # ✅ 修正：使用已完成的K线（倒数第二根）
        # 原因：df.iloc[-1] 是未完成K线，多个周期的未完成K线价格相同（伪多周期）
        # 使用 df.iloc[-2] 可以保证不同周期数据的独立性
        latest = df.iloc[-2]  # ✅ 使用已完成的K线
        
        # === 基础指标（保持兼容性） ===
        result = {
            'price': float(latest['close']),
            'rsi': float(latest.get('rsi', 0)),
            'macd': float(latest.get('macd', 0)),
            'macd_signal': float(latest.get('macd_signal', 0)),
            'trend': self._determine_trend(df),
            'volume_ratio': float(latest.get('volume_ratio', 1.0)),
        }
        
        # === Step3 关键特征（增强决策） ===
        # 只传递关键特征，避免数据过载
        result['features'] = {
            'critical': {
                'trend_confirmation_score': float(latest.get('trend_confirmation_score', 0)),
                'market_strength': float(latest.get('market_strength', 0)),
                'bb_position': float(latest.get('bb_position', 50)),
                'atr_normalized': float(latest.get('atr_normalized', 0)),
                'price_to_sma20_pct': float(latest.get('price_to_sma20_pct', 0)),
                'ema_cross_strength': float(latest.get('ema_cross_strength', 0)),
            },
            'important': {
                'trend_sustainability': float(latest.get('trend_sustainability', 0)),
                'overbought_score': int(latest.get('overbought_score', 0)),
                'oversold_score': int(latest.get('oversold_score', 0)),
                'reversal_probability': int(latest.get('reversal_probability', 0)),
                'volatility_20': float(latest.get('volatility_20', 0)),
                'risk_signal': float(latest.get('risk_signal', 0)),
            }
        }
        
        return result
    
    def _determine_trend(self, df) -> str:
        """
        判断趋势
        
        🔴 重要：使用已完成的K线进行趋势判断
        """
        if df is None or df.empty or len(df) < 2:
            return 'unknown'
        
        # ✅ 使用已完成的K线（倒数第二根）
        latest = df.iloc[-2]
        sma_20 = latest.get('sma_20', 0)
        sma_50 = latest.get('sma_50', 0)
        price = latest['close']
        
        if sma_20 > sma_50 and price > sma_20:
            return 'uptrend'
        elif sma_20 < sma_50 and price < sma_20:
            return 'downtrend'
        else:
            return 'sideways'
    
    def generate_signal(self, market_state: Dict) -> str:
        """
        生成交易信号 - 多层决策架构
        
        Layer 1: 基础规则（基于趋势+RSI，保持兼容）
        Layer 2: 增强规则（使用 Step3 关键特征）
        Layer 3: 风险过滤（流动性、波动率、反转风险）
        
        决策融合：Layer1 & Layer2 的交集 + Layer3 否决权
        """
        # Layer 1: 基础规则信号
        base_signal = self._basic_rule_signal(market_state)
        
        # Layer 2: 增强规则信号（使用 Step3 特征）
        enhanced_signal = self._enhanced_rule_signal(market_state)
        
        # Layer 3: 风险过滤
        risk_veto = self._risk_filter(market_state)
        
        # 决策融合
        final_signal = self._merge_signals(base_signal, enhanced_signal, risk_veto)
        
        # Step5 & Step6: 保存决策分析
        self._generate_decision_report(market_state, base_signal, enhanced_signal, risk_veto, final_signal)
        
        return final_signal
    
    def _basic_rule_signal(self, market_state: Dict) -> str:
        """
        Layer 1: 基础规则策略
        
        基于多周期趋势 + RSI，保持原有逻辑兼容性
        """
        timeframes = market_state.get('timeframes', {})
        
        # 获取各周期趋势
        trend_5m = timeframes.get('5m', {}).get('trend', 'unknown')
        trend_15m = timeframes.get('15m', {}).get('trend', 'unknown')
        trend_1h = timeframes.get('1h', {}).get('trend', 'unknown')
        
        # 获取RSI
        rsi_5m = timeframes.get('5m', {}).get('rsi', 50)
        rsi_15m = timeframes.get('15m', {}).get('rsi', 50)
        rsi_1h = timeframes.get('1h', {}).get('rsi', 50)
        
        # 多周期趋势一致性检查
        uptrend_count = sum([
            trend_5m == 'uptrend',
            trend_15m == 'uptrend',
            trend_1h == 'uptrend'
        ])
        
        downtrend_count = sum([
            trend_5m == 'downtrend',
            trend_15m == 'downtrend',
            trend_1h == 'downtrend'
        ])
        
        # 买入信号：至少2个周期上涨 + RSI不超买
        if uptrend_count >= 2 and rsi_1h < 70 and rsi_15m < 75:
            return 'BUY'
        # 卖出信号：至少2个周期下跌 或 RSI严重超买
        elif downtrend_count >= 2 or (rsi_5m > 80 and rsi_15m > 75):
            return 'SELL'
        else:
            return 'HOLD'
    
    def _enhanced_rule_signal(self, market_state: Dict) -> str:
        """
        Layer 2: 增强规则策略
        
        使用 Step3 的关键特征进行更精准的决策
        - trend_confirmation_score: 多指标趋势确认（-3到+3）
        - market_strength: 市场强度（趋势×成交量×波动率）
        - trend_sustainability: 趋势持续性评分
        - reversal_probability: 反转可能性（0-5）
        - overbought/oversold_score: 综合超买超卖评分（0-3）
        """
        timeframes = market_state.get('timeframes', {})
        
        # 提取 1h 周期的关键特征（主要决策周期）
        tf_1h = timeframes.get('1h', {})
        features = tf_1h.get('features', {})
        critical = features.get('critical', {})
        important = features.get('important', {})
        
        # 提取关键特征
        trend_score = critical.get('trend_confirmation_score', 0)  # -3 到 +3
        market_strength = critical.get('market_strength', 0)
        bb_position = critical.get('bb_position', 50)  # 0-100
        sustainability = important.get('trend_sustainability', 0)
        reversal_prob = important.get('reversal_probability', 0)  # 0-5
        overbought = important.get('overbought_score', 0)  # 0-3
        oversold = important.get('oversold_score', 0)  # 0-3
        
        # === 增强买入条件 ===
        strong_uptrend = (
            trend_score >= 2 and          # 多指标确认上涨（至少2个指标看多）
            market_strength > 0.5 and     # 市场强度足够（有成交量配合）
            sustainability > 0.3 and      # 趋势可持续（方向稳定）
            reversal_prob < 3 and         # 反转风险低
            overbought < 2                # 未严重超买
        )
        
        # === 增强卖出条件 ===
        strong_downtrend = (
            trend_score <= -2 and         # 多指标确认下跌
            market_strength > 0.5         # 下跌动能强
        )
        
        serious_overbought = (overbought >= 3)  # 极度超买（RSI+BB+价格偏离都触发）
        high_reversal_risk = (reversal_prob >= 4)  # 反转风险高
        
        # === 决策 ===
        if strong_uptrend:
            return 'BUY'
        elif strong_downtrend or serious_overbought or high_reversal_risk:
            return 'SELL'
        else:
            return 'HOLD'
    
    def _risk_filter(self, market_state: Dict) -> Dict:
        """
        Layer 3: 风险过滤层
        
        检查高风险条件，提供否决权
        
        Returns:
            {
                'allow_buy': bool,
                'allow_sell': bool,
                'reasons': List[str]
            }
        """
        timeframes = market_state.get('timeframes', {})
        tf_1h = timeframes.get('1h', {})
        features = tf_1h.get('features', {})
        important = features.get('important', {})
        
        # 提取风险指标
        volatility = important.get('volatility_20', 0)
        risk_signal = important.get('risk_signal', 0)
        volume_ratio = tf_1h.get('volume_ratio', 1.0)
        
        allow_buy = True
        allow_sell = True
        reasons = []
        
        # 风险检查1: 极端波动率（>10%）
        if volatility > 10:
            allow_buy = False
            reasons.append(f'波动率过高 ({volatility:.1f}% > 10%)')
        
        # 风险检查2: 极低流动性
        MIN_VOLUME_RATIO = 0.3
        if volume_ratio < MIN_VOLUME_RATIO:
            allow_buy = False
            allow_sell = False
            reasons.append(f'流动性不足 ({volume_ratio:.1%} < {MIN_VOLUME_RATIO:.1%})')
        
        # 风险检查3: 高风险信号（高波动×低流动）
        if risk_signal > 5:
            allow_buy = False
            reasons.append(f'综合风险过高 ({risk_signal:.2f} > 5)')
        
        return {
            'allow_buy': allow_buy,
            'allow_sell': allow_sell,
            'reasons': reasons
        }
    
    def _merge_signals(self, base_signal: str, enhanced_signal: str, risk_veto: Dict) -> str:
        """
        决策融合：基础信号 + 增强信号 + 风险否决
        
        融合规则：
        1. 风险否决优先（allow_buy=False → 强制HOLD）
        2. 基础信号和增强信号一致 → 采纳
        3. 基础信号和增强信号冲突 → 保守选HOLD
        """
        # 风险否决
        if base_signal == 'BUY' and not risk_veto['allow_buy']:
            print(f"⚠️  风险否决BUY: {', '.join(risk_veto['reasons'])}")
            return 'HOLD'
        
        if base_signal == 'SELL' and not risk_veto['allow_sell']:
            print(f"⚠️  风险否决SELL: {', '.join(risk_veto['reasons'])}")
            return 'HOLD'
        
        # 信号一致性检查
        if base_signal == enhanced_signal:
            return base_signal
        
        # 信号冲突：保守选择HOLD
        print(f"⚠️  信号冲突: 基础={base_signal}, 增强={enhanced_signal} → HOLD")
        return 'HOLD'
    
    def _generate_decision_report(
        self, 
        market_state: Dict, 
        base_signal: str, 
        enhanced_signal: str, 
        risk_veto: Dict, 
        final_signal: str
    ):
        """
        生成决策分析报告（Markdown格式）
        
        包含三层决策的详细分析
        """
        try:
            timeframes = market_state.get('timeframes', {})
            
            # 提取基础指标
            trend_5m = timeframes.get('5m', {}).get('trend', 'unknown')
            trend_15m = timeframes.get('15m', {}).get('trend', 'unknown')
            trend_1h = timeframes.get('1h', {}).get('trend', 'unknown')
            rsi_5m = timeframes.get('5m', {}).get('rsi', 50)
            rsi_15m = timeframes.get('15m', {}).get('rsi', 50)
            rsi_1h = timeframes.get('1h', {}).get('rsi', 50)
            
            # 提取增强特征
            tf_1h = timeframes.get('1h', {})
            features = tf_1h.get('features', {})
            critical = features.get('critical', {})
            important = features.get('important', {})
            
            trend_score = critical.get('trend_confirmation_score', 0)
            market_strength = critical.get('market_strength', 0)
            sustainability = important.get('trend_sustainability', 0)
            reversal_prob = important.get('reversal_probability', 0)
            overbought = important.get('overbought_score', 0)
            oversold = important.get('oversold_score', 0)
            
            # 生成Markdown格式的市场分析
            markdown_text = f"""# 市场分析报告（多层决策版）
            
## 交易对信息
- **交易对**: {market_state.get('symbol', 'BTCUSDT')}
- **当前价格**: ${market_state.get('current_price', 0):,.2f}
- **分析时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

## 多周期趋势分析
- **5分钟**: {trend_5m} (RSI: {rsi_5m:.1f})
- **15分钟**: {trend_15m} (RSI: {rsi_15m:.1f})
- **1小时**: {trend_1h} (RSI: {rsi_1h:.1f})

## 三层决策分析

### Layer 1: 基础规则信号
**信号**: {base_signal}

**依据**:
- 多周期趋势确认（至少2个周期一致）
- RSI超买超卖阈值检查

### Layer 2: 增强规则信号
**信号**: {enhanced_signal}

**依据（基于Step3高级特征）**:
- 趋势确认分数: {trend_score:.1f}/3 (多指标共振)
- 市场强度: {market_strength:.2f} (趋势×成交量×波动率)
- 趋势持续性: {sustainability:.2f}
- 反转可能性: {reversal_prob}/5
- 超买评分: {overbought}/3
- 超卖评分: {oversold}/3

### Layer 3: 风险过滤
**允许买入**: {'✅' if risk_veto['allow_buy'] else '❌'}  
**允许卖出**: {'✅' if risk_veto['allow_sell'] else '❌'}

"""
            if risk_veto['reasons']:
                markdown_text += "**风险提示**:\n"
                for reason in risk_veto['reasons']:
                    markdown_text += f"- {reason}\n"
            else:
                markdown_text += "**风险检查**: 通过\n"
            
            markdown_text += f"""
## 最终决策
**信号**: {final_signal}

**决策逻辑**:
"""
            if final_signal == base_signal == enhanced_signal:
                markdown_text += "- 基础信号与增强信号一致，信心较高\n"
            elif final_signal != base_signal or final_signal != enhanced_signal:
                markdown_text += f"- 信号冲突（基础={base_signal}, 增强={enhanced_signal}），保守选择{final_signal}\n"
            
            if not risk_veto['allow_buy'] and base_signal == 'BUY':
                markdown_text += "- 风险过滤否决了买入信号\n"
            if not risk_veto['allow_sell'] and base_signal == 'SELL':
                markdown_text += "- 风险过滤否决了卖出信号\n"
            
            # 保存Markdown分析
            snapshot_id = market_state.get('snapshot_id', 'live')
            self.data_saver.save_step5_markdown(
                markdown_text, 
                market_state.get('symbol', 'BTCUSDT'), 
                '5m', 
                snapshot_id
            )
            print("✅ Step5: 市场分析报告生成完成")
            
            # 保存决策结果
            decision_data = {
                'signal': final_signal,
                'confidence': self._calculate_confidence(base_signal, enhanced_signal, risk_veto, final_signal),
                'layers': {
                    'base_signal': base_signal,
                    'enhanced_signal': enhanced_signal,
                    'risk_veto': risk_veto
                },
                'analysis': {
                    'trend_5m': trend_5m,
                    'trend_15m': trend_15m,
                    'trend_1h': trend_1h,
                    'rsi_5m': rsi_5m,
                    'rsi_15m': rsi_15m,
                    'rsi_1h': rsi_1h,
                    'trend_score': trend_score,
                    'market_strength': market_strength,
                    'sustainability': sustainability,
                    'reversal_prob': reversal_prob,
                    'overbought': overbought,
                    'oversold': oversold
                },
                'timestamp': datetime.now().isoformat()
            }
            self.data_saver.save_step6_decision(
                decision_data, 
                market_state.get('symbol', 'BTCUSDT'), 
                '5m', 
                snapshot_id
            )
            print(f"✅ Step6: 决策完成 (信号={final_signal}, 置信度={decision_data['confidence']})")
            
        except Exception as e:
            print(f"⚠️  Step5/6失败: {e}")
    
    def _calculate_confidence(self, base: str, enhanced: str, risk_veto: Dict, final: str) -> int:
        """计算决策信心分数（0-100）"""
        if final == 'HOLD':
            return 0
        
        confidence = 50  # 基础分
        
        # 信号一致性加分
        if base == enhanced:
            confidence += 25
        
        # 风险检查通过加分
        if risk_veto['allow_buy'] and risk_veto['allow_sell']:
            confidence += 15
        
        # 风险否决扣分
        if risk_veto['reasons']:
            confidence -= 10 * len(risk_veto['reasons'])
        
        return max(0, min(100, confidence))
    
    def execute_trade(self, signal: str, market_state: Dict) -> bool:
        """
        执行交易
        
        Args:
            signal: 交易信号 (BUY/SELL/HOLD)
            market_state: 市场状态
            
        Returns:
            是否成功执行
        """
        if signal == 'HOLD':
            return False
        
        try:
            # 流动性风控检查（静默检查，只在有问题时输出）
            MIN_VOLUME_RATIO = 0.5
            WARN_VOLUME_RATIO = 0.7
            
            timeframes = market_state.get('timeframes', {})
            volume_ratio = timeframes.get('5m', {}).get('volume_ratio', 1.0)
            
            # 极低流动性：强制拒绝交易
            if volume_ratio < MIN_VOLUME_RATIO:
                print(f"❌ 流动性不足 ({volume_ratio:.1%} < {MIN_VOLUME_RATIO:.1%})，拒绝交易")
                return False
            
            # 流动性偏低：发出预警
            if volume_ratio < WARN_VOLUME_RATIO:
                print(f"⚠️  流动性偏低 ({volume_ratio:.1%}), 预期滑点 {self._estimate_slippage(volume_ratio):.2f}bps")
            
            # 获取当前价格
            current_price = market_state.get('current_price', 0)
            if current_price == 0:
                print("❌ 无法获取当前价格")
                return False
            
            # 计算交易数量
            balance = self.get_account_balance()
            margin = min(self.max_position_size, balance * (self.config_dict['position_pct'] / 100))
            leverage = self.config_dict['leverage']
            notional_value = margin * leverage
            
            # 检查最小名义金额要求
            MIN_NOTIONAL = self.client.get_symbol_min_notional(symbol)
            if MIN_NOTIONAL == 0:
                MIN_NOTIONAL = 5.0
            
            if notional_value < MIN_NOTIONAL:
                print(f"❌ 名义价值不足 (${notional_value:.2f} < ${MIN_NOTIONAL:.2f})，拒绝交易")
                return False
            
            quantity = notional_value / current_price
            
            print(f"\n💼 交易参数:")
            print(f"   信号: {signal} | 价格: ${current_price:,.2f}")
            print(f"   数量: {quantity:.6f} BTC | 名义: ${notional_value:,.2f} ({leverage}x)")
            
            # 执行前确认（可配置）
            if self.config_dict['confirm_before_trade']:
                confirm_sec = self.config_dict['confirm_seconds']
                print(f"⚠️  {confirm_sec}秒后执行，Ctrl+C取消...")
                time.sleep(confirm_sec)
            
            # 执行交易
            if signal == 'BUY':
                # 使用合约开多仓
                decision = {
                    'action': 'open_long',
                    'symbol': 'BTCUSDT',
                    'position_size_pct': self.config_dict['position_pct'],
                    'leverage': self.config_dict['leverage'],
                    'take_profit_pct': self.config_dict['take_profit_pct'],
                    'stop_loss_pct': self.config_dict['stop_loss_pct']
                }
                result = self.execution_engine.execute_decision(
                    decision=decision,
                    account_info={'available_balance': balance},
                    position_info=None,
                    current_price=current_price
                )
            else:  # SELL
                # 使用合约开空仓
                decision = {
                    'action': 'open_short',
                    'symbol': 'BTCUSDT',
                    'position_size_pct': self.config_dict['position_pct'],
                    'leverage': self.config_dict['leverage'],
                    'take_profit_pct': self.config_dict['take_profit_pct'],
                    'stop_loss_pct': self.config_dict['stop_loss_pct']
                }
                result = self.execution_engine.execute_decision(
                    decision=decision,
                    account_info={'available_balance': balance},
                    position_info=None,
                    current_price=current_price
                )
            
            if result and result.get('success'):
                print(f"✅ 交易执行成功 (订单ID: {result.get('order_id')})")
                
                # Step7: 保存交易执行记录
                try:
                    execution_record = {
                        'order_id': result.get('order_id'),
                        'symbol': 'BTCUSDT',
                        'action': signal.lower(),
                        'quantity': quantity,
                        'price': current_price,
                        'margin': margin,
                        'notional_value': notional_value,
                        'total_value': notional_value,
                        'leverage': self.config_dict['leverage'],
                        'status': 'filled',
                        'filled_time': datetime.now().isoformat(),
                        'decision': decision,
                        'execution_result': result
                    }
                    self.data_saver.save_step7_execution(execution_record, 'BTCUSDT', '5m', result.get('order_id'))
                    print("✅ Step7: 订单执行已记录")
                except Exception as e:
                    print(f"⚠️  Step7失败: {e}")
                
                # 使用新的交易日志系统记录开仓
                try:
                    side_str = 'LONG' if signal == 'BUY' else 'SHORT'
                    trade_logger.log_open_position(
                        symbol='BTCUSDT',
                        side=side_str,
                        decision=decision,
                        execution_result=result,
                        market_state=market_state,
                        account_info={'available_balance': balance}
                    )
                except Exception as e:
                    print(f"⚠️  交易日志记录失败: {e}")
                
                # 记录交易（保留原有的简单记录）
                self.trade_history.append({
                    'time': datetime.now().isoformat(),
                    'signal': signal,
                    'price': current_price,
                    'quantity': quantity,
                    'margin': margin,
                    'notional_value': notional_value,
                    'amount': notional_value,
                    'order_id': result.get('order_id')
                })
                
                # 保存交易记录（兼容旧格式）
                self._save_trade_history()
                
                # Step9: 归档实时交易事件
                try:
                    symbol = market_state.get('symbol', 'BTCUSDT') if isinstance(market_state, dict) else 'BTCUSDT'
                    timeframe = market_state.get('timeframe', '5m') if isinstance(market_state, dict) else '5m'
                    trade_event = {
                        'trade_id': result.get('order_id'),
                        'timestamp': datetime.now().isoformat(),
                        'signal': signal,
                        'price': current_price,
                        'quantity': quantity,
                        'margin': margin,
                        'notional_value': notional_value,
                        'amount': notional_value,
                        'order_id': result.get('order_id'),
                        'success': True,
                        'decision': decision,
                        'execution_result': result,
                        'market_state_snapshot': {
                            'current_price': market_state.get('current_price') if isinstance(market_state, dict) else None,
                            'timeframes': market_state.get('timeframes') if isinstance(market_state, dict) else None
                        },
                        'account_info': {'available_balance': balance}
                    }
                    self.data_saver.save_step9_trade_event(trade_event, symbol=symbol, timeframe=timeframe, trade_id=result.get('order_id'))
                    print("✅ Step9: 交易事件已归档")
                except Exception as e:
                    print(f"⚠️  Step9失败: {e}")
                
                return True
            else:
                print(f"❌ 交易执行失败: {result.get('error')}")
                return False
                
        except KeyboardInterrupt:
            print(f"\n⚠️  交易已取消")
            return False
        except Exception as e:
            print(f"❌ 交易执行错误: {e}")
            return False
    
    def _save_trade_history(self):
        """保存交易历史"""
        try:
            os.makedirs('logs/trades', exist_ok=True)
            filename = f"logs/trades/trade_history_{datetime.now().strftime('%Y%m%d')}.json"
            
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(self.trade_history, f, indent=2, ensure_ascii=False)
                
        except Exception as e:
            print(f"⚠️  交易历史保存失败: {e}")
    
    def run_once(self) -> Dict:
        """运行一次交易循环"""
        print(f"\n{'='*80}")
        print(f"🔄 交易循环 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*80}")
        
        # 获取账户余额
        balance = self.get_account_balance()
        print(f"💰 账户余额: ${balance:,.2f} USDT")
        
        if balance < self.max_position_size:
            print(f"⚠️  余额不足（需${self.max_position_size:.2f}），跳过交易")
            return {'status': 'insufficient_balance'}
        
        # 获取市场数据（包含Step1-4）
        print(f"\n📊 执行数据管道 (Step1-4)...")
        market_state = self.get_market_data()
        
        if not market_state:
            print("❌ 数据获取失败")
            return {'status': 'data_error'}
        
        # 生成信号（包含Step5-6）
        print(f"\n🎯 执行决策分析 (Step5-6)...")
        signal = self.generate_signal(market_state)
        print(f"📍 最终信号: {signal}")
        
        # 执行交易（包含Step7-9）
        if signal != 'HOLD':
            print(f"\n⚡ 执行交易流程 (Step7-9)...")
            executed = self.execute_trade(signal, market_state)
            return {
                'status': 'executed' if executed else 'failed',
                'signal': signal
            }
        else:
            print(f"\n✅ 观望模式，数据已归档")
            return {'status': 'hold'}
    
    def run_continuous(self, interval_minutes: int = 5):
        """
        持续运行交易机器人
        
        Args:
            interval_minutes: 检查间隔（分钟）
        """
        self.is_running = True
        print(f"\n🔄 开始持续运行模式，间隔 {interval_minutes} 分钟...")
        
        try:
            while self.is_running:
                result = self.run_once()
                
                if result['status'] == 'executed':
                    print(f"\n✅ 交易已执行，等待 {interval_minutes} 分钟...")
                elif result['status'] == 'hold':
                    print(f"\n⏳ 无交易信号，等待 {interval_minutes} 分钟...")
                
                # 等待下一次检查
                time.sleep(interval_minutes * 60)
                
        except KeyboardInterrupt:
            print(f"\n\n⚠️  收到停止信号，退出...")
            self.is_running = False


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(
        description='AI Trader - 合约实盘交易',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 单次运行，$100仓位
  python run_live_trading.py --max-position 100 --mode once
  
  # 持续运行，每5分钟检查
  python run_live_trading.py --mode continuous --interval 5
  
  # 测试模式（不执行交易）
  python run_live_trading.py --test
        """
    )
    
    parser.add_argument('--test', action='store_true',
                       help='测试模式（不执行真实交易）')
    parser.add_argument('--max-position', type=float,
                       help=f'最大单笔交易金额 (默认: {TRADING_CONFIG["max_position_size"]})')
    parser.add_argument('--position-pct', type=int,
                       help=f'使用账户余额百分比 (默认: {TRADING_CONFIG["position_pct"]}%)')
    parser.add_argument('--leverage', type=int, choices=[1, 2, 3, 4, 5],
                       help=f'杠杆倍数 (默认: {TRADING_CONFIG["leverage"]})')
    parser.add_argument('--stop-loss', type=float,
                       help=f'止损百分比 (默认: {TRADING_CONFIG["stop_loss_pct"]})')
    parser.add_argument('--take-profit', type=float,
                       help=f'止盈百分比 (默认: {TRADING_CONFIG["take_profit_pct"]})')
    parser.add_argument('--mode', choices=['once', 'continuous'],
                       help=f'运行模式 (默认: {TRADING_CONFIG["mode"]})')
    parser.add_argument('--interval', type=int,
                       help=f'持续运行间隔分钟数 (默认: {TRADING_CONFIG["interval_minutes"]})')
    parser.add_argument('--no-confirm', action='store_true',
                       help='禁用交易前确认')
    
    return parser.parse_args()



def main():
    """主函数"""
    args = parse_args()
    
    # 构建配置
    config = TRADING_CONFIG.copy()
    
    if args.max_position:
        config['max_position_size'] = args.max_position
    if args.position_pct:
        config['position_pct'] = args.position_pct
    if args.leverage:
        config['leverage'] = args.leverage
    if args.stop_loss:
        config['stop_loss_pct'] = args.stop_loss
    if args.take_profit:
        config['take_profit_pct'] = args.take_profit
    if args.mode:
        config['mode'] = args.mode
    if args.interval:
        config['interval_minutes'] = args.interval
    if args.no_confirm:
        config['confirm_before_trade'] = False
    
    # 测试模式
    if args.test:
        print("\n" + "="*80)
        print("🧪 测试模式 - 不会执行真实交易")
        print("="*80)
        config['confirm_before_trade'] = False  # 测试模式不需要确认
        bot = LiveTradingBot(config=config)
        bot.run_once()
        return
    
    # 显示风险警告和配置
    print("\n" + "="*80)
    print("WARNING: LIVE TRADING MODE")
    print("="*80)
    print("WARNING: This program will trade with REAL MONEY!")
    print("")
    print("Risk Notice:")
    print("  - Futures trading involves high risk and may result in total loss")
    print("  - Leverage amplifies both profits and losses")
    print("  - Market volatility may cause liquidation")
    print("  - System failures may lead to unexpected losses")
    print("")
    print("Current Configuration:")
    print(f"  Max Position: ${config['max_position_size']:.2f} USDT")
    print(f"  Position %: {config['position_pct']}%")
    print(f"  Leverage: {config['leverage']}x")
    print(f"  Stop Loss: {config['stop_loss_pct']}%")
    print(f"  Take Profit: {config['take_profit_pct']}%")
    print(f"  Mode: {'Once' if config['mode'] == 'once' else 'Continuous'}")
    if config['mode'] == 'continuous':
        print(f"  Interval: {config['interval_minutes']} minutes")
    print(f"  Confirm: {'Enabled' if config['confirm_before_trade'] else 'Disabled'}")
    
    print("\n如需修改配置，请:")
    print("  1. 编辑文件顶部的 TRADING_CONFIG")
    print("  2. 或使用命令行参数 (--help 查看帮助)")
    print("\n" + "="*80)
    
    # 创建交易机器人
    bot = LiveTradingBot(config=config)
    
    # 运行
    if config['mode'] == 'once':
        bot.run_once()
    else:
        bot.run_continuous(interval_minutes=config['interval_minutes'])


if __name__ == "__main__":
    main()
