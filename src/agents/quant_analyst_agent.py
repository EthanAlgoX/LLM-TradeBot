"""
量化策略师 (The Strategist) Agent - 重构版

职责：
按时间周期组织技术分析，而非按指标类型
- 6小时分析：完整技术指标集
- 2小时分析：完整技术指标集
- 半小时分析：完整技术指标集

优化点：
- 时间周期为中心的组织方式
- 便于LLM理解每个时间周期的完整技术面
- 扩展指标集：EMA, MA, BOLL, RSI, MACD, KDJ, ATR, OBV
"""

import pandas as pd
from typing import Dict
from dataclasses import asdict

from src.agents.data_sync_agent import MarketSnapshot
# from src.agents.timeframe_analyzer import TimeframeAnalyzer, TimeframeAnalysis  # Not needed - using real 1h/15m data
from src.utils.logger import log
from src.utils.oi_tracker import oi_tracker


class QuantAnalystAgent:
    """
    量化策略师 (The Strategist)
    
    提供情绪分析和OI燃料验证
    技术指标分析现在直接在main.py中使用真实1h/15m/5m数据
    """
    
    def __init__(self):
        """初始化量化策略师"""
        log.info("👨‍🔬 The Strategist (QuantAnalyst Agent) initialized - Simplified mode")
    
    async def analyze_all_timeframes(self, snapshot: MarketSnapshot) -> Dict:
        """
        执行分析（简化版）
        
        Args:
            snapshot: 市场快照
            
        Returns:
            分析结果字典
        """
        # 只提供情绪分析，技术分析在main.py中直接使用真实数据
        sentiment = self._analyze_sentiment(snapshot)
        
        # 返回简化结果（保持向后兼容）
        result = {
            'sentiment': sentiment,
            # 空的占位符，实际分析在main.py中进行
            'timeframe_6h': {},
            'timeframe_2h': {},
            'timeframe_30m': {},
            'trend': {'score': 0, 'details': {}},
            'oscillator': {'score': 0, 'details': {}},
            'overall_score': 0,
        }
        
        return result
    
    def analyze(self, snapshot: MarketSnapshot) -> Dict:
        """
        执行多时间周期技术分析
        
        Args:
            snapshot: 市场快照（包含5m K线数据）
            
        Returns:
            分析结果字典，按时间周期组织
        """
        df_5m = snapshot.stable_5m
        current_price = snapshot.live_5m.get('close', df_5m['close'].iloc[-1] if not df_5m.empty else 0)
        
        # 执行三个时间周期的分析
        analysis_6h = self.analyzer_6h.analyze(df_5m, current_price)
        analysis_2h = self.analyzer_2h.analyze(df_5m, current_price)
        analysis_30m = self.analyzer_30m.analyze(df_5m, current_price)
        
        # 计算情绪分析（保留原有逻辑）
        sentiment = self._analyze_sentiment(snapshot)
        
        # 组织返回结果
        result = {
            # 按时间周期组织的分析结果
            'timeframe_6h': asdict(analysis_6h),
            'timeframe_2h': asdict(analysis_2h),
            'timeframe_30m': asdict(analysis_30m),
            
            # 情绪分析
            'sentiment': sentiment,
            
            # 为了向后兼容，保留旧的键名映射
            'trend': self._map_to_legacy_trend(analysis_6h, analysis_2h, analysis_30m),
            'oscillator': self._map_to_legacy_oscillator(analysis_6h, analysis_2h, analysis_30m),
            
            # 综合评分（加权平均）
            'overall_score': self._calculate_overall_score(analysis_6h, analysis_2h, analysis_30m, sentiment),
        }
        
        return result
    
    def _analyze_sentiment(self, snapshot: MarketSnapshot) -> Dict:
        """
        分析市场情绪（保留原有逻辑）
        
        基于：
        - 资金费率
        - 持仓量变化
        - 其他市场情绪指标
        """
        details = {}
        q_data = getattr(snapshot, 'quant_data', {})
        b_funding = getattr(snapshot, 'binance_funding', {})
        b_oi = getattr(snapshot, 'binance_oi', {})
        
        has_data = False
        score = 0
        
        # 资金费率分析
        if b_funding and 'funding_rate' in b_funding:
            has_data = True
            funding_rate = float(b_funding['funding_rate']) * 100
            details['funding_rate'] = funding_rate
            
            if funding_rate > 0.05:
                score -= 30
                details['funding_signal'] = "极度贪婪（高资金费率）"
            elif funding_rate > 0.01:
                score -= 15
                details['funding_signal'] = "贪婪"
            elif funding_rate < -0.05:
                score += 30
                details['funding_signal'] = "极度恐惧（负资金费率）"
            elif funding_rate < -0.01:
                score += 15
                details['funding_signal'] = "恐惧"
            else:
                details['funding_signal'] = "中性"
        
        # 持仓量变化分析
        if b_oi and 'open_interest' in b_oi:
            has_data = True
            oi_value = float(b_oi['open_interest'])
            
            # Get symbol for tracking
            symbol = getattr(snapshot, 'symbol', 'BTCUSDT')
            
            # 🔴 CRITICAL FIX: Check for anomaly BEFORE recording
            # Get 24h change WITHOUT recording current value first
            oi_change_24h = oi_tracker.get_change_pct(symbol, hours=24)
            
            # OI Anomaly Detection
            # Values > 200% or < -80% are likely data errors and should be filtered
            OI_ANOMALY_THRESHOLD_HIGH = 200.0  # >200% = data error
            OI_ANOMALY_THRESHOLD_LOW = -80.0   # <-80% = data error
            
            oi_is_anomaly = False
            if oi_change_24h is not None:
                if oi_change_24h > OI_ANOMALY_THRESHOLD_HIGH or oi_change_24h < OI_ANOMALY_THRESHOLD_LOW:
                    oi_is_anomaly = True
                    details['oi_anomaly'] = True
                    details['oi_anomaly_value'] = oi_change_24h
                    details['oi_signal'] = f"⚠️ DATA_ANOMALY ({oi_change_24h:.1f}% exceeds threshold)"
                    log.warning(f"[{symbol}] OI Anomaly detected: {oi_change_24h:.1f}% - NOT recording to tracker")
                    # Reset to None to prevent downstream corruption
                    oi_change_24h = None
            
            # ✅ Only record if NOT anomalous
            if not oi_is_anomaly:
                oi_tracker.record(symbol, oi_value)
                # Recalculate after recording
                oi_change_24h = oi_tracker.get_change_pct(symbol, hours=24)
            
            if oi_change_24h is not None and not oi_is_anomaly:
                details['oi_change_24h_pct'] = oi_change_24h
                details['oi_anomaly'] = False
                
                if oi_change_24h > 20:
                    score += 20
                    details['oi_signal'] = "OI significantly increased"
                elif oi_change_24h > 10:
                    score += 10
                    details['oi_signal'] = "OI increased"
                elif oi_change_24h < -20:
                    score -= 20
                    details['oi_signal'] = "OI significantly decreased"
                elif oi_change_24h < -10:
                    score -= 10
                    details['oi_signal'] = "OI decreased"
                else:
                    details['oi_signal'] = "OI stable"
        
        # 🔥 Calculate OI Fuel (Layer 1 of Four-Layer Strategy)
        # Skip fuel calculation if OI is anomalous
        oi_change = details.get('oi_change_24h_pct', 0)
        oi_is_anomaly = details.get('oi_anomaly', False)
        
        if oi_is_anomaly:
            # Mark fuel as invalid due to data anomaly
            oi_fuel = {
                'oi_change_24h': None,
                'fuel_signal': 'DATA_ANOMALY',
                'fuel_score': 0,
                'whale_trap_risk': False,
                'fuel_strength': 'unknown',
                'divergence_alert': False,
                'data_error': True,
                'anomaly_value': details.get('oi_anomaly_value', 0)
            }
        else:
            oi_fuel = {
                'oi_change_24h': oi_change,
                'fuel_signal': 'strong' if oi_change > 5 else
                              'moderate' if oi_change > 2 else
                              'weak' if oi_change > 0 else
                              'whale_exit' if oi_change < -5 else 'negative',
                'fuel_score': min(100, max(-100, int(oi_change * 10))),
                'whale_trap_risk': oi_change < -5,
                'fuel_strength': 'strong' if abs(oi_change) > 3.0 else
                                'weak' if abs(oi_change) < 1.0 else 'moderate',
                'divergence_alert': oi_change < -5.0,
                'data_error': False
            }
        
        return {
            'score': score if has_data else 0,
            'details': details,
            'has_data': has_data,
            'total_sentiment_score': score if has_data else 0,
            'oi_change_24h_pct': oi_change,
            'oi_fuel': oi_fuel,  # 🆕 OI fuel indicator
        }
