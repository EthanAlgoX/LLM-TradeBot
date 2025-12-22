from typing import Dict, Union, Optional

class SemanticConverter:
    """
    语义转换器：将技术指标数值转换为自然语言描述
    用于 DeepSeek 上下文输入和 Dashboard 前端展示
    """

    @staticmethod
    def get_rsi_semantic(rsi: Optional[float]) -> str:
        """RSI 语义转换"""
        if rsi is None: return "N/A (No Data)"
        
        if rsi >= 80:
            return "Extremely Overbought (Bearish Exhaustion)"
        elif rsi >= 70:
            return "Overbought (Bearish Warning)"
        elif rsi >= 60:
            return "Strong Bullish Momentum"
        elif rsi >= 45:
            return "Neutral (Weak Bullish)"
        elif rsi >= 30:
            return "Bearish Momentum"
        elif rsi >= 20:
            return "Oversold (Bullish Warning)"
        else:
            return "Extremely Oversold (Bullish Exhaustion)"

    @staticmethod
    def get_trend_semantic(score: Optional[float]) -> str:
        """趋势得分语义转换 (-100 ~ 100)"""
        if score is None: return "N/A (No Data)"
        
        if score >= 60:
            return "Strong Uptrend (Strong Buy)"
        elif score >= 25:
            return "Uptrend (Buy)"
        elif score >= 10:
            return "Weak Uptrend (Accumulation)"
        elif score >= -10:
            return "Sideways (Consolidation)"
        elif score >= -25:
            return "Weak Downtrend (Distribution)"
        elif score >= -60:
            return "Downtrend (Sell)"
        else:
            return "Strong Downtrend (Strong Sell)"

    @staticmethod
    def get_oscillator_semantic(score: Optional[float]) -> str:
        """震荡/反转得分语义转换 (-100 ~ 100)"""
        if score is None: return "N/A (No Data)"
        
        # Oscillator logic: Positive means Oversold (Buy signal), Negative means Overbought (Sell signal)
        if score >= 80:
            return "Strong Reversal (Buy)"
        elif score >= 40:
            return "Reversal Likely (Buy)"
        elif score >= 10:
            return "Weak Reversal (Watch Buy)"
        elif score >= -10:
            return "Neutral"
        elif score >= -40:
            return "Weak Reversal (Watch Sell)"
        elif score >= -80:
            return "Reversal Likely (Sell)"
        else:
            return "Strong Reversal Signal (Sell)"

    @staticmethod
    def get_sentiment_score_semantic(score: Optional[float]) -> str:
        """情绪得分语义转换 (0 ~ 100 or -100 ~ 100)"""
        if score is None: return "N/A (No Data)"
        
        if score >= 60:
            return "Very Bullish"
        elif score >= 20:
            return "Bullish"
        elif score >= -20:
            return "Neutral"
        elif score >= -60:
            return "Bearish"
        else:
            return "Very Bearish"

    @staticmethod
    def get_macd_semantic(value: Optional[float]) -> str:
        """MACD 语义转换 (Positive/Negative)"""
        if value is None: return "N/A (No Data)"

        # MACD Histogram value
        if value > 0.0005:  # Threshold depends on asset price, simplified for BTC/ETH
             return "Bullish Divergence (Positive)"
        elif value > 0:
             return "Weak Bullish (Positive)"
        elif value < -0.0005:
             return "Bearish Divergence (Negative)"
        elif value < 0:
             return "Weak Bearish (Negative)"
        else:
             return "Neutral (Zero)"

    @staticmethod
    def get_prophet_semantic(probability: Optional[float]) -> str:
        """Prophet预测概率语义转换 (0-1 or 0-100)
        
        Args:
            probability: P(Up) value, can be 0-1 or 0-100 (auto-detected)
        """
        if probability is None: return "N/A (No Data)"
        
        # Auto-detect if it's percentage or fraction
        prob = probability if probability <= 1.0 else probability / 100.0
        
        if prob >= 0.70:
            return "Strong Bullish"
        elif prob >= 0.55:
            return "Bullish"
        elif prob >= 0.45:
            return "Neutral"
        elif prob >= 0.30:
            return "Bearish"
        else:
            return "Strong Bearish"

    @staticmethod
    def get_oi_change_semantic(pct: Optional[float]) -> str:
        """持仓量变化语义转换 (Percentage)"""
        if pct is None: return "N/A (No Data)"

        if pct >= 5.0:
            return "Surge (Very Strong Interest)"
        elif pct >= 2.0:
            return "Rising (Strong Interest)"
        elif pct > 0.5:
             return "Slight Increase"
        elif pct > -0.5:
             return "Stable"
        elif pct > -2.0:
             return "Slight Decrease"
        elif pct > -5.0:
             return "Falling (Liquidation Likely)"
        else:
             return "Crash (Massive Liquidation)"
            
    @staticmethod
    def convert_analysis_map(vote_details: Dict[str, float]) -> Dict[str, str]:
        """将完整的 vote_details 数值字典转换为语义字典"""
        semantic_map = {}
        
        # 1. Trend Scores
        if 'trend_1h' in vote_details:
             semantic_map['trend_1h'] = SemanticConverter.get_trend_semantic(vote_details['trend_1h'])
        if 'trend_15m' in vote_details:
             semantic_map['trend_15m'] = SemanticConverter.get_trend_semantic(vote_details['trend_15m'])
        if 'trend_5m' in vote_details:
             semantic_map['trend_5m'] = SemanticConverter.get_trend_semantic(vote_details['trend_5m'])
             
        # 2. Oscillator Scores
        if 'oscillator_1h' in vote_details:
             semantic_map['oscillator_1h'] = SemanticConverter.get_oscillator_semantic(vote_details['oscillator_1h'])
        if 'oscillator_15m' in vote_details:
             semantic_map['oscillator_15m'] = SemanticConverter.get_oscillator_semantic(vote_details['oscillator_15m'])
        if 'oscillator_5m' in vote_details:
             semantic_map['oscillator_5m'] = SemanticConverter.get_oscillator_semantic(vote_details['oscillator_5m'])
             
        # 3. Sentiment
        if 'sentiment' in vote_details:
             semantic_map['sentiment'] = SemanticConverter.get_sentiment_score_semantic(vote_details['sentiment'])
             
        # 4. Strategist Total
        if 'strategist_total' in vote_details:
            # Assumes 0-100 or -100 to 100 depending on implementation. 
            # QuantAnalyst uses distinct logic, but let's approximate with trend semantic for now or custom
            score = vote_details['strategist_total']
            if score > 50: semantic_map['strategist_total'] = "Bullish Setup"
            elif score > 20: semantic_map['strategist_total'] = "Weak Bullish"
            elif score > -20: semantic_map['strategist_total'] = "Neutral"
            elif score > -50: semantic_map['strategist_total'] = "Weak Bearish"
            else: semantic_map['strategist_total'] = "Bearish Setup"
        
        # 5. Prophet Probability
        if 'prophet' in vote_details:
            semantic_map['prophet'] = SemanticConverter.get_prophet_semantic(vote_details['prophet'])
            
        return semantic_map

