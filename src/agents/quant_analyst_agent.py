"""
量化策略师 (The Strategist) Agent

职责：
1. 趋势分析员：基于EMA/MACD计算趋势得分
2. 震荡分析员：基于RSI/BB计算反转得分
3. 实时价格修正：利用live_view更新指标

优化点：
- 得分制（-100~+100）替代布尔值
- 实时RSI计算（包含live K线）
- 多指标加权
"""

import pandas as pd
import numpy as np
from typing import Dict, Optional
from ta.momentum import RSIIndicator
from ta.trend import MACD, EMAIndicator

from src.agents.data_sync_agent import MarketSnapshot
from src.utils.logger import log
from src.utils.oi_tracker import oi_tracker


class TrendSubAgent:
    """
    趋势分析员（子Agent）
    
    职责：判断市场趋势方向和强度
    输出：trend_score (-100 到 +100)
    """
    
    def analyze(self, snapshot: MarketSnapshot) -> Dict:
        """
        计算趋势得分 (None表示无数据)
        """
        # Init specific scores to None
        trend_1h_score = None
        trend_15m_score = None
        trend_5m_score = None
        details = {}
        
        # 1. 1h 主趋势判断 (权重40%)
        stable_1h = snapshot.stable_1h
        if not stable_1h.empty and len(stable_1h) > 50:
            if 'ema_12' in stable_1h.columns and 'ema_26' in stable_1h.columns:
                last_ema_12 = stable_1h['ema_12'].iloc[-1]
                last_ema_26 = stable_1h['ema_26'].iloc[-1]
            else:
                ema_12 = EMAIndicator(close=stable_1h['close'], window=12).ema_indicator()
                ema_26 = EMAIndicator(close=stable_1h['close'], window=26).ema_indicator()
                last_ema_12 = ema_12.iloc[-1]
                last_ema_26 = ema_26.iloc[-1]
            
            if last_ema_12 > last_ema_26:
                trend_1h_score = 40
                trend_1h_status = "上涨"
            else:
                trend_1h_score = -40
                trend_1h_status = "下跌"
            
            details['1h_trend'] = trend_1h_status
            details['1h_ema12'] = float(last_ema_12)
            details['1h_ema26'] = float(last_ema_26)
        
        # 2. 5m 短期动量 (权重20%)
        live_5m = snapshot.live_5m
        if live_5m:
            open_price = float(live_5m.get('open', 0))
            close_price = float(live_5m.get('close', 0))
            
            if open_price > 0:
                candle_change = (close_price - open_price) / open_price
                
                if candle_change > 0.005: 
                    trend_5m_score = 30
                    details['live_correction'] = "5m强劲拉升"
                elif candle_change > 0.002:
                    trend_5m_score = 15
                    details['live_correction'] = "5m温和上涨"
                elif candle_change < -0.005: 
                    trend_5m_score = -30
                    details['live_correction'] = "5m强劲下跌"
                elif candle_change < -0.002: 
                    trend_5m_score = -15
                    details['live_correction'] = "5m温和下跌"
                else:
                    trend_5m_score = 0
                    details['live_correction'] = "5m正常波动"
                
                details['live_candle_change'] = f"{candle_change*100:.2f}%"
        
        # 3. 15m 中期确认 (权重30%)
        stable_15m = snapshot.stable_15m
        if not stable_15m.empty and len(stable_15m) > 30:
            if 'macd_diff' in stable_15m.columns:
                current_macd = stable_15m['macd_diff'].iloc[-1]
                prev_macd = stable_15m['macd_diff'].iloc[-2]
            else:
                macd_ind = MACD(close=stable_15m['close'])
                macd_diff = macd_ind.macd_diff()
                current_macd = macd_diff.iloc[-1]
                prev_macd = macd_diff.iloc[-2]
            
            if current_macd > 0:
                if current_macd > prev_macd:
                    trend_15m_score = 30
                    trend_15m_status = "上涨加速"
                else:
                    trend_15m_score = 15
                    trend_15m_status = "多头回遮"
            elif current_macd < 0:
                if current_macd < prev_macd:
                    trend_15m_score = -30
                    trend_15m_status = "下跌加速"
                else:
                    trend_15m_score = -15
                    trend_15m_status = "空头反弹"
            else:
                trend_15m_score = 0
                trend_15m_status = "震荡"
            
            details['15m_trend'] = trend_15m_status
            details['15m_macd_diff'] = float(current_macd)
        
        # Calculate Total Score
        # If Main Trend (1h) is missing, Total is None
        total_score = None
        if trend_1h_score is not None:
             total_score = trend_1h_score
             # Add other components if they exist, otherwise treat as 0 for sum
             # Or better: if 15m missing, assume neutral? Yes, safer than failing.
             total_score += (trend_15m_score or 0)
             total_score += (trend_5m_score or 0)
        
             # Limit range
             total_score = max(-100, min(100, total_score))
        
        return {
            'score': total_score if total_score is not None else 0, # Legacy compact fallback
            'details': details,
            'confidence': abs(total_score) if total_score is not None else 0,
            'total_trend_score': total_score, # Can be None
            'trend_1h_score': trend_1h_score,
            'trend_15m_score': trend_15m_score,
            'trend_5m_score': trend_5m_score
        }


class OscillatorSubAgent:
    """
    震荡分析员（子Agent）
    """
    
    def analyze(self, snapshot: MarketSnapshot) -> Dict:
        details = {}
        
        # Init scores to None
        osc_5m_score = None
        osc_15m_score = None
        osc_1h_score = None
        
        # 1. 5m RSI
        stable_5m = snapshot.stable_5m
        live_5m = snapshot.live_5m
        
        if not stable_5m.empty and live_5m:
            df_with_live = stable_5m.copy()
            live_row = pd.DataFrame([{
                'open': float(live_5m.get('open', 0)),
                'high': float(live_5m.get('high', 0)),
                'low': float(live_5m.get('low', 0)),
                'close': float(live_5m.get('close', 0)),
                'volume': float(live_5m.get('volume', 0))
            }])
            df_with_live = pd.concat([df_with_live, live_row], ignore_index=True)
            rsi_5m = RSIIndicator(close=df_with_live['close'], window=14).rsi()
            live_rsi = rsi_5m.iloc[-1] if len(rsi_5m) > 0 else 50
            
            if live_rsi > 75: osc_5m_score = -80; rsi_status = "超买严重"
            elif live_rsi < 25: osc_5m_score = +80; rsi_status = "超卖严重"
            elif live_rsi > 65: osc_5m_score = -40; rsi_status = "轻度超买"
            elif live_rsi < 35: osc_5m_score = +40; rsi_status = "轻度超卖"
            else: osc_5m_score = 0; rsi_status = "中性"
            
            details['5m_rsi'] = float(live_rsi)
            details['5m_status'] = rsi_status
        
        # 2. 15m RSI
        stable_15m = snapshot.stable_15m
        if not stable_15m.empty:
            if 'rsi' in stable_15m.columns:
                rsi_15m_val = stable_15m['rsi'].iloc[-1]
            else:
                rsi_15m_calc = RSIIndicator(close=stable_15m['close'], window=14).rsi()
                rsi_15m_val = rsi_15m_calc.iloc[-1] if len(rsi_15m_calc) > 0 else 50
            
            if rsi_15m_val > 75: osc_15m_score = -60; details['15m_status'] = "超买"
            elif rsi_15m_val < 25: osc_15m_score = +60; details['15m_status'] = "超卖"
            elif rsi_15m_val > 65: osc_15m_score = -30; details['15m_status'] = "轻度超买"
            elif rsi_15m_val < 35: osc_15m_score = +30; details['15m_status'] = "轻度超卖"
            else: osc_15m_score = 0; details['15m_status'] = "中性"
            
            details['15m_rsi'] = float(rsi_15m_val)
        
        # 3. 1h RSI
        stable_1h = snapshot.stable_1h
        if not stable_1h.empty:
            if 'rsi' in stable_1h.columns:
                last_rsi_1h = stable_1h['rsi'].iloc[-1]
            else:
                rsi_1h = RSIIndicator(close=stable_1h['close'], window=14).rsi()
                last_rsi_1h = rsi_1h.iloc[-1] if len(rsi_1h) > 0 else 50
            
            if last_rsi_1h > 80: osc_1h_score = -40; details['1h_warning'] = "1h级别超买"
            elif last_rsi_1h < 20: osc_1h_score = +40; details['1h_warning'] = "1h级别超卖"
            elif last_rsi_1h > 70: osc_1h_score = -20; details['1h_status'] = "1h轻度超买"
            elif last_rsi_1h < 30: osc_1h_score = +20; details['1h_status'] = "1h轻度超卖"
            else: osc_1h_score = 0; details['1h_status'] = "1h中性"
            
            details['1h_rsi'] = float(last_rsi_1h)
        
        # Calculate Total Score
        total_score = None
        # Require at least 1h or 15m to be valid
        if osc_1h_score is not None or osc_15m_score is not None:
             total_score = int((osc_5m_score or 0) * 0.3 + (osc_15m_score or 0) * 0.3 + (osc_1h_score or 0) * 0.4)
             total_score = max(-100, min(100, total_score))
        
        return {
            'score': total_score if total_score is not None else 0,
            'details': details,
            'confidence': abs(total_score) if total_score is not None else 0,
            'total_oscillator_score': total_score,
            'osc_5m_score': osc_5m_score,
            'osc_15m_score': osc_15m_score,
            'osc_1h_score': osc_1h_score,
            'rsi_5m': details.get('5m_rsi'),
            'rsi_15m': details.get('15m_rsi'),
            'rsi_1h': details.get('1h_rsi')
        }


class SentimentSubAgent:
    """
    情绪分析员 (The Sentiment Analyst)
    """
    
    def analyze(self, snapshot: MarketSnapshot) -> Dict:
        details = {}
        q_data = getattr(snapshot, 'quant_data', {})
        b_funding = getattr(snapshot, 'binance_funding', {})
        b_oi = getattr(snapshot, 'binance_oi', {})
        
        has_data = False
        score = 0
        
        # 1. Netflow
        if q_data:
            has_data = True
            netflow = q_data.get('netflow', {}).get('institution', {}).get('future', {})
            nf_1h = netflow.get('1h', 0)
            nf_15m = netflow.get('15m', 0)
            
            if nf_1h > 0: score += 30
            elif nf_1h < 0: score -= 30
            if nf_15m > 0: score += 20
            elif nf_15m < 0: score -= 20
                
            details['inst_netflow_1h'] = nf_1h
            details['inst_netflow_15m'] = nf_15m
        
        # 2. Funding Rate
        if b_funding:
            has_data = True
            f_rate = b_funding.get('funding_rate', 0)
            details['binance_funding_rate'] = f_rate
            
            if f_rate > 0.0003: score -= 30; details['funding_signal'] = "多头拥挤"
            elif f_rate < -0.0001: score += 30; details['funding_signal'] = "空头拥挤"
            else: details['funding_signal'] = "中性"

        # 3. OI
        oi_change_pct = None
        if b_oi:
            has_data = True
            oi_value = b_oi.get('open_interest', 0)
            symbol = b_oi.get('symbol', 'BTCUSDT')
            
            oi_stats = oi_tracker.get_stats(symbol)
            oi_change_pct = oi_stats.get('change_24h', 0.0)
            oi_change_1h = oi_stats.get('change_1h', 0.0)
            
            details['binance_oi_value'] = oi_value
            details['oi_change_24h_pct'] = oi_change_pct
            details['oi_change_1h_pct'] = oi_change_1h
            details['oi_records'] = oi_stats.get('records', 0)
            
            if oi_change_pct > 10: score += 10
            elif oi_change_pct < -10: score -= 10
            if oi_change_1h > 5: score += 5
            elif oi_change_1h < -5: score -= 5
            
        score = max(-100, min(100, score))
        total_score = score if has_data else None
        
        return {
            'score': total_score if total_score is not None else 0,
            'details': details,
            'confidence': abs(total_score) if total_score is not None else 0,
            'total_sentiment_score': total_score,
            'oi_change_24h_pct': oi_change_pct
        }


from src.agents.regime_detector import RegimeDetector

class QuantAnalystAgent:
    """
    量化策略师 (The Strategist)
    """
    
    def __init__(self):
        self.trend_agent = TrendSubAgent()
        self.oscillator_agent = OscillatorSubAgent()
        self.sentiment_agent = SentimentSubAgent()
        self.regime_detector = RegimeDetector()
        log.info("👨‍🔬 量化策略师 (The Strategist) 初始化完成")

    async def analyze_all_timeframes(self, snapshot: MarketSnapshot) -> Dict:
        """
        分析所有周期
        """
        trend_results = self.trend_agent.analyze(snapshot)
        osc_results = self.oscillator_agent.analyze(snapshot)
        sentiment_results = self.sentiment_agent.analyze(snapshot)
        
        # New: Analyze Market Regime & Position
        # Uses stable_5m for calculation
        regime_results = self.regime_detector.detect_regime(snapshot.stable_5m)
        
        t_score = trend_results.get('total_trend_score')
        o_score = osc_results.get('total_oscillator_score')
        s_score = sentiment_results.get('total_sentiment_score')
        
        # Calculate composite score with DYNAMIC WEIGHTS
        # If a component is missing (None), redistribute its weight to available components
        composite_score = None
        
        weights = {'trend': 0.4, 'oscillator': 0.3, 'sentiment': 0.3}
        available_components = {}
        
        if t_score is not None:
            available_components['trend'] = t_score
        if o_score is not None:
            available_components['oscillator'] = o_score
        if s_score is not None:
            available_components['sentiment'] = s_score
        
        if available_components:
            # Calculate total weight of available components
            total_available_weight = sum(weights[k] for k in available_components.keys())
            
            # Normalize weights and calculate weighted score
            weighted_sum = 0
            for name, score in available_components.items():
                normalized_weight = weights[name] / total_available_weight
                weighted_sum += score * normalized_weight
            
            composite_score = weighted_sum
            # Ensure within bounds
            composite_score = max(-100, min(100, composite_score))
        
        report = {
            'comprehensive': {
                'score': composite_score if composite_score is not None else 0,
                'signal': self._score_to_signal(composite_score),
                'volatility': self._calculate_volatility(snapshot),
                'details': {
                    'trend': trend_results,
                    'oscillator': osc_results,
                    'sentiment': sentiment_results
                }
            },
            'trend': trend_results,
            'oscillator': osc_results,
            'sentiment': sentiment_results,
            'regime': regime_results  # New: Regime Analysis
        }
        
        return report

    def _score_to_signal(self, score: Optional[float]) -> str:
        """将得分转换为信号标签"""
        if score is None: return "neutral"
        if score > 30:
            return "buy"
        elif score < -30:
            return "sell"
        else:
            return "neutral"

    async def analyze(self, snapshot: MarketSnapshot) -> Dict:
        """兼容性接口，返回综合分析内容"""
        result = await self.analyze_all_timeframes(snapshot)
        return result # Return full report for DecisionCoreAgent access to granular data

    def _calculate_volatility(self, snapshot: MarketSnapshot) -> float:
        """
        计算波动率
        使用ATR/价格作为波动率指标
        """
        df = snapshot.stable_5m
        if df.empty or 'atr' not in df.columns:
            return 0.5
            
        latest_atr = df['atr'].iloc[-1]
        latest_price = snapshot.live_5m.get('close', df['close'].iloc[-1])
        
        if latest_price == 0: return 0.5
        return float(latest_atr / latest_price)


# 测试函数
def test_quant_analyst_agent():
    """测试量化分析师"""
    from src.agents.data_sync_agent import DataSyncAgent
    import asyncio
    
    async def run_test():
        print("\n" + "="*80)
        print("测试：量化分析师 (Quant Analyst Agent)")
        print("="*80)
        
        # 获取数据
        data_agent = DataSyncAgent()
        snapshot = await data_agent.fetch_all_timeframes("BTCUSDT")
        
        # 分析
        quant_agent = QuantAnalystAgent()
        analysis = quant_agent.analyze(snapshot)
        
        # 输出结果
        print("\n[分析结果]")
        print(f"  趋势得分: {analysis['trend_score']}")
        print(f"  趋势详情: {analysis['trend_details']}")
        print(f"\n  反转得分: {analysis['reversion_score']}")
        print(f"  反转详情: {analysis['reversion_details']}")
        print(f"\n  波动率: {analysis['volatility']:.4f}")
        
        print("\n" + "="*80)
        print("✅ 测试完成")
        print("="*80 + "\n")
    
    asyncio.run(run_test())


if __name__ == "__main__":
    test_quant_analyst_agent()
