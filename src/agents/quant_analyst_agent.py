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
from typing import Dict
from ta.momentum import RSIIndicator
from ta.trend import MACD, EMAIndicator

from src.agents.data_sync_agent import MarketSnapshot
from src.utils.logger import log


class TrendSubAgent:
    """
    趋势分析员（子Agent）
    
    职责：判断市场趋势方向和强度
    输出：trend_score (-100 到 +100)
    """
    
    def analyze(self, snapshot: MarketSnapshot) -> Dict:
        """
        计算趋势得分
        
        得分逻辑：
        - 1h EMA金叉 → +40分 (主趋势)
        - 15m MACD扩大 → +30分 (中期确认)
        - 5m 价格突破 → +30分 (短期动量)
        - live_view修正 → ±20分 (实时修正)
        
        Args:
            snapshot: 市场快照 (stable_xx DataFrames intended to be populated by MarketDataProcessor)
            
        Returns:
            分析结果字典
        """
        score = 0
        details = {}
        
        # 1. 1h 主趋势判断 (权重40%)
        stable_1h = snapshot.stable_1h
        if not stable_1h.empty and len(stable_1h) > 50:
            # 优先使用预计算指标
            if 'ema_12' in stable_1h.columns and 'ema_26' in stable_1h.columns:
                last_ema_12 = stable_1h['ema_12'].iloc[-1]
                last_ema_26 = stable_1h['ema_26'].iloc[-1]
            else:
                # 兼容模式：现场计算
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
            
            score += trend_1h_score
            details['1h_trend'] = trend_1h_status
            details['1h_ema12'] = float(last_ema_12)
            details['1h_ema26'] = float(last_ema_26)
        
        # 2. 实时修正 (权重±20%) - 核心创新
        live_1h = snapshot.live_1h
        if live_1h:
            # 计算当前K线的涨跌幅
            open_price = float(live_1h.get('open', 0))
            close_price = float(live_1h.get('close', 0))
            
            if open_price > 0:
                candle_change = (close_price - open_price) / open_price
                
                # 如果当前K线大跌1%，即使stable是上涨的，也要降低得分
                if candle_change < -0.01:
                    live_correction = -20
                    details['live_correction'] = "大跌1%，趋势可能反转"
                elif candle_change > 0.01:
                    live_correction = 20
                    details['live_correction'] = "大涨1%，趋势正在加速"
                else:
                    live_correction = 0
                    details['live_correction'] = "正常波动"
                
                score += live_correction
                details['live_candle_change'] = f"{candle_change*100:.2f}%"
        
        # 3. 15m 中期确认 (权重30%)
        stable_15m = snapshot.stable_15m
        if not stable_15m.empty and len(stable_15m) > 30:
            # 优先使用预计算指标
            if 'macd_diff' in stable_15m.columns:
                current_macd = stable_15m['macd_diff'].iloc[-1]
                prev_macd = stable_15m['macd_diff'].iloc[-2]
            else:
                macd_ind = MACD(close=stable_15m['close'])
                macd_diff = macd_ind.macd_diff()
                current_macd = macd_diff.iloc[-1]
                prev_macd = macd_diff.iloc[-2]
            
            # 检查MACD柱状图是否扩大
            if current_macd > prev_macd > 0:
                trend_15m_score = 30  # MACD金叉且扩大
                trend_15m_status = "上涨加速"
            elif current_macd < prev_macd < 0:
                trend_15m_score = -30  # MACD死叉且扩大
                trend_15m_status = "下跌加速"
            else:
                trend_15m_score = 0
                trend_15m_status = "震荡"
            
            score += trend_15m_score
            details['15m_trend'] = trend_15m_status
            details['15m_macd_diff'] = float(current_macd)
        
        # 限制得分范围
        score = max(-100, min(100, score))
        
        return {
            'score': score,
            'details': details,
            'confidence': abs(score)  # 得分越极端，置信度越高
        }


class OscillatorSubAgent:
    """
    震荡分析员（子Agent）
    
    职责：判断超买超卖和反转信号
    输出：reversion_score (-100 到 +100)
    """
    
    def analyze(self, snapshot: MarketSnapshot) -> Dict:
        """
        计算反转得分
        
        得分逻辑：
        - 1h RSI > 75 → -80 (超买严重，建议做空)
        - 5m RSI < 25 → +80 (超卖严重，建议做多)
        - live_view实时RSI → ±20分 (实时修正)
        
        Args:
            snapshot: 市场快照
            
        Returns:
            分析结果字典
        """
        score = 0
        details = {}
        
        # 1. 计算实时RSI (关键优化)
        stable_5m = snapshot.stable_5m
        live_5m = snapshot.live_5m
        
        if not stable_5m.empty and live_5m:
            # 将live_5m添加到stable_5m计算RSI
            df_with_live = stable_5m.copy()
            
            # 构造live K线的DataFrame行
            live_row = pd.DataFrame([{
                'open': float(live_5m.get('open', 0)),
                'high': float(live_5m.get('high', 0)),
                'low': float(live_5m.get('low', 0)),
                'close': float(live_5m.get('close', 0)),
                'volume': float(live_5m.get('volume', 0))
            }])
            
            # 添加到DataFrame
            df_with_live = pd.concat([df_with_live, live_row], ignore_index=True)
            
            # 计算RSI
            rsi_5m = RSIIndicator(close=df_with_live['close'], window=14).rsi()
            live_rsi = rsi_5m.iloc[-1] if len(rsi_5m) > 0 else 50
            
            # 基于RSI打分
            if live_rsi > 75:
                rsi_score = -80  # 强烈建议卖出/做空
                rsi_status = "超买严重"
            elif live_rsi < 25:
                rsi_score = +80  # 强烈建议买入/做多
                rsi_status = "超卖严重"
            elif live_rsi > 65:
                rsi_score = -40  # 轻度超买
                rsi_status = "轻度超买"
            elif live_rsi < 35:
                rsi_score = +40  # 轻度超卖
                rsi_status = "轻度超卖"
            else:
                rsi_score = 0
                rsi_status = "中性"
            
            score += rsi_score
            details['5m_rsi'] = float(live_rsi)
            details['5m_status'] = rsi_status
        
        # 2. 1h RSI确认
        stable_1h = snapshot.stable_1h
        if not stable_1h.empty:
            if 'rsi' in stable_1h.columns:
                last_rsi_1h = stable_1h['rsi'].iloc[-1]
            else:
                rsi_1h = RSIIndicator(close=stable_1h['close'], window=14).rsi()
                last_rsi_1h = rsi_1h.iloc[-1] if len(rsi_1h) > 0 else 50
            
            # 1h超买超卖的权重更高
            if last_rsi_1h > 80:
                score -= 20  # 额外扣分
                details['1h_warning'] = "1h级别超买"
            elif last_rsi_1h < 20:
                score += 20  # 额外加分
                details['1h_warning'] = "1h级别超卖"
            
            details['1h_rsi'] = float(last_rsi_1h)
        
        # 限制得分范围
        score = max(-100, min(100, score))
        
        return {
            'score': score,
            'details': details,
            'confidence': abs(score),
            'total_oscillator_score': score # Add this for new integration
        }


class SentimentSubAgent:
    """
    情绪分析员 (The Sentiment Analyst)
    
    职责：分析外部量化数据 (Netflow, OI)
    输出：sentiment_score (-100 到 +100)
    """
    
    def analyze(self, snapshot: MarketSnapshot) -> Dict:
        """
        分析外部 API 与 Binance 原生提供的情绪数据
        """
        score = 0
        details = {}
        q_data = getattr(snapshot, 'quant_data', {})
        b_funding = getattr(snapshot, 'binance_funding', {})
        b_oi = getattr(snapshot, 'binance_oi', {})
        
        # 1. 机构资金流 (Institution Netflow) - 来自外部 API
        if q_data:
            netflow = q_data.get('netflow', {}).get('institution', {}).get('future', {})
            nf_1h = netflow.get('1h', 0)
            nf_15m = netflow.get('15m', 0)
            
            if nf_1h > 0: score += 30
            elif nf_1h < 0: score -= 30
            
            if nf_15m > 0: score += 20
            elif nf_15m < 0: score -= 20
                
            details['inst_netflow_1h'] = nf_1h
        
        # 2. 资金费率 (Funding Rate) - Binance 原生 (逆向指标)
        if b_funding:
            f_rate = b_funding.get('funding_rate', 0)
            details['binance_funding_rate'] = f_rate
            
            # 资金费率过高 (>0.03%)：多头过度拥挤，警惕多头踩踏
            if f_rate > 0.0003:
                score -= 30
                details['funding_signal'] = "多头拥挤"
            # 资金费率过低 (< -0.01%)：空头过度拥挤，警惕空头挤压
            elif f_rate < -0.0001:
                score += 30
                details['funding_signal'] = "空头拥挤"
            else:
                details['funding_signal'] = "中性"

        # 3. 持仓量 (Open Interest) - 跨源验证
        if b_oi:
            details['binance_oi_value'] = b_oi.get('open_interest', 0)
            
        score = max(-100, min(100, score))
        details['total_sentiment_score'] = score
        return details


class QuantAnalystAgent:
    """
    量化策略师 (The Strategist)
    
    职责：协调趋势、震荡与情绪分析员
    输出：综合分析报告
    """
    
    def __init__(self):
        self.trend_agent = TrendSubAgent()
        self.oscillator_agent = OscillatorSubAgent()
        self.sentiment_agent = SentimentSubAgent()
        log.info("👨‍🔬 量化策略师 (The Strategist) 初始化完成")

    async def analyze_all_timeframes(self, snapshot: MarketSnapshot) -> Dict:
        """
        分析所有周期（异步版本，适配DecisionCoreAgent）
        """
        log.strategist("📊 开始量化分析...")
        
        # 1. 趋势与震荡得分
        trend_results = self.trend_agent.analyze(snapshot)
        osc_results = self.oscillator_agent.analyze(snapshot)
        
        # 2. 外部情绪得分
        sentiment_results = self.sentiment_agent.analyze(snapshot)
        
        # 3. 综合判断 (权重: 趋势 40%, 震荡 30%, 情绪 30%)
        t_score = trend_results.get('total_trend_score', 0)
        o_score = osc_results.get('total_oscillator_score', 0)
        s_score = sentiment_results.get('total_sentiment_score', 0)
        
        composite_score = (t_score * 0.4) + (o_score * 0.3) + (s_score * 0.3)
        
        log.strategist(f"  ├─ 趋势得分: {t_score}")
        log.strategist(f"  ├─ 反转得分: {o_score}")
        log.strategist(f"  ├─ 情绪得分: {s_score}")
        log.strategist(f"  └─ 综合得分: {composite_score:.1f}")
        
        report = {
            'comprehensive': {
                'score': composite_score,
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
            'sentiment': sentiment_results
        }
        
        log.strategist(f"✅ 量化分析完成，主信号: {report['comprehensive']['signal']}")
        
        return report

    def _score_to_signal(self, score: float) -> str:
        """将得分转换为信号标签"""
        if score > 30:
            return "buy"
        elif score < -30:
            return "sell"
        else:
            return "neutral"

    async def analyze(self, snapshot: MarketSnapshot) -> Dict:
        """兼容性接口，返回综合分析内容"""
        result = await self.analyze_all_timeframes(snapshot)
        return result['comprehensive']

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
