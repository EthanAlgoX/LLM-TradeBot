"""
Trend Agent - 1h Trend Analysis

Analyzes 1h timeframe data and produces semantic analysis:
- EMA20/60 trend direction
- OI fuel status
- ADX trend strength
- Market regime
"""

from typing import Dict
from src.utils.logger import log

from .trend_agent import TrendAgent

class TrendAgentNoLLM(TrendAgent):
    """
    1h Trend Analysis Agent (no LLM)

    Uses rule-based heuristics only.
    """

    def __init__(self):
        log.info("📈 Trend Agent (no LLM) initialized")

    def analyze(self, data: Dict) -> Dict:
        signals = self._compute_trend_signals(data)
        analysis = self._get_fallback_analysis(data)
        result = {
            'analysis': analysis,
            'stance': signals['stance'],
            'metadata': {
                'strength': signals['strength'],
                'adx': round(signals['adx'], 1),
                'oi_fuel': signals['fuel'],
                'oi_change': round(signals['oi_change'], 1)
            }
        }
        log.info(f"📈 Trend Agent (no LLM) [{signals['stance']}] (Strength: {signals['strength']}, ADX: {signals['adx']:.1f}) for {data.get('symbol', 'UNKNOWN')}")

        try:
            from src.server.state import global_state
            if hasattr(global_state, 'saver') and hasattr(global_state, 'current_cycle_id'):
                global_state.saver.save_trend_analysis(
                    analysis=analysis,
                    input_data=data,
                    symbol=data.get('symbol', 'UNKNOWN'),
                    cycle_id=global_state.current_cycle_id,
                    model='rule_based'
                )
        except Exception as e:
            log.warning(f"Failed to save trend analysis log: {e}")

        return result

    def _get_fallback_analysis(self, data: Dict) -> str:
        close = data.get('close_1h', 0)
        ema20 = data.get('ema20_1h', 0)
        ema60 = data.get('ema60_1h', 0)
        oi_change = data.get('oi_change', 0)
        adx = data.get('adx', 20)

        if close > ema20 > ema60:
            trend = "uptrend"
        elif close < ema20 < ema60:
            trend = "downtrend"
        else:
            trend = "neutral"

        fuel = "strong" if abs(oi_change) > 3 else "moderate" if abs(oi_change) >= 1 else "weak"
        strength = "strong" if adx > 25 else "weak"

        return f"1h shows {trend} with {fuel} OI fuel ({oi_change:+.1f}%). ADX={adx:.0f} indicates {strength} trend strength. {'Suitable for trend trading.' if adx >= 20 and abs(oi_change) >= 1 else 'Not suitable for trend trading.'}"
