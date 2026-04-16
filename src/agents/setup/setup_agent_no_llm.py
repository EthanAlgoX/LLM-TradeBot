"""
Setup Agent - 15m Setup Analysis

Analyzes 15m timeframe data and produces semantic analysis:
- KDJ oscillator position
- Bollinger Band position
- MACD momentum (15m)
- Entry zone assessment
"""

from typing import Dict
from src.utils.logger import log

from .setup_agent import SetupAgent

class SetupAgentNoLLM(SetupAgent):
    """
    15m Setup Analysis Agent (no LLM)

    Uses rule-based heuristics only.
    """

    def __init__(self):
        log.info("📊 Setup Agent (no LLM) initialized")

    def analyze(self, data: Dict) -> Dict:
        signals = self._compute_setup_signals(data)
        analysis = self._get_fallback_analysis(data)
        result = {
            'analysis': analysis,
            'stance': signals['stance'],
            'metadata': {
                'zone': signals['zone'],
                'kdj_j': round(signals['kdj_j'], 1),
                'trend': signals['trend'].upper(),
                'bb_position': signals['bb_position'],
                'macd_signal': signals['macd_signal'],
                'macd_diff': round(signals['macd_diff'], 2)
            }
        }
        log.info(f"📊 Setup Agent (no LLM) [{signals['stance']}] (Zone: {signals['zone']}, KDJ: {signals['kdj_j']:.1f}) for {data.get('symbol', 'UNKNOWN')}")

        try:
            from src.server.state import global_state
            if hasattr(global_state, 'saver') and hasattr(global_state, 'current_cycle_id'):
                global_state.saver.save_setup_analysis(
                    analysis=analysis,
                    input_data=data,
                    symbol=data.get('symbol', 'UNKNOWN'),
                    cycle_id=global_state.current_cycle_id,
                    model='rule_based'
                )
        except Exception as e:
            log.warning(f"Failed to save setup analysis log: {e}")

        return result

    def _get_fallback_analysis(self, data: Dict) -> str:
        """Fallback analysis using rule-based heuristics"""
        kdj_j = data.get('kdj_j', 50)
        trend = data.get('trend_direction', 'neutral')
        close = data.get('close_15m', 0)
        bb_middle = data.get('bb_middle', 0)
        
        if trend == 'long':
            if kdj_j < 40:
                return f"15m setup shows pullback zone with KDJ_J={kdj_j:.0f}. Good entry area for long positions. Price is {'below' if close < bb_middle else 'above'} BB middle."
            elif kdj_j > 80:
                return f"15m is overbought with KDJ_J={kdj_j:.0f}. Wait for pullback before entering long positions."
            else:
                return f"15m is in neutral zone with KDJ_J={kdj_j:.0f}. Wait for clearer pullback signal."
        elif trend == 'short':
            if kdj_j > 60:
                return f"15m setup shows rally zone with KDJ_J={kdj_j:.0f}. Good entry area for short positions."
            elif kdj_j < 20:
                return f"15m is oversold with KDJ_J={kdj_j:.0f}. Wait for rally before entering short positions."
            else:
                return f"15m is in neutral zone with KDJ_J={kdj_j:.0f}. Wait for clearer rally signal."
        else:
            return f"15m shows neutral setup with KDJ_J={kdj_j:.0f}. No clear entry signal."
