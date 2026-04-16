"""
Trigger Agent - 5m Trigger Analysis

Analyzes 5m timeframe data and produces semantic analysis:
- Candlestick patterns (engulfing, etc.)
- Volume analysis (RVOL)
- Entry trigger assessment
"""

from typing import Dict
from src.utils.logger import log

from .trigger_agent import TriggerAgent

class TriggerAgentNoLLM(TriggerAgent):
    """
    5m Trigger Analysis Agent (no LLM)

    Uses rule-based heuristics only.
    """

    def __init__(self):
        log.info("⚡ Trigger Agent (no LLM) initialized")

    def analyze(self, data: Dict) -> Dict:
        signals = self._compute_trigger_signals(data)
        analysis = self._get_fallback_analysis(data)
        result = {
            'analysis': analysis,
            'stance': signals['stance'],
            'metadata': {
                'status': signals['status'],
                'pattern': signals['pattern'],
                'rvol': round(signals['rvol'], 1),
                'volume_breakout': signals['volume_breakout']
            }
        }
        log.info(f"⚡ Trigger Agent (no LLM) [{signals['stance']}] (Pattern: {signals['pattern']}, RVOL: {signals['rvol']:.1f}x) for {data.get('symbol', 'UNKNOWN')}")

        try:
            from src.server.state import global_state
            if hasattr(global_state, 'saver') and hasattr(global_state, 'current_cycle_id'):
                global_state.saver.save_trigger_analysis(
                    analysis=analysis,
                    input_data=data,
                    symbol=data.get('symbol', 'UNKNOWN'),
                    cycle_id=global_state.current_cycle_id,
                    model='rule_based'
                )
        except Exception as e:
            log.warning(f"Failed to save trigger analysis log: {e}")

        return result

    def _get_fallback_analysis(self, data: Dict) -> str:
        """Fallback analysis using rule-based heuristics"""
        pattern = data.get('pattern') or data.get('trigger_pattern')
        rvol = data.get('rvol') or data.get('trigger_rvol', 1.0)
        trend = data.get('trend_direction', 'neutral')
        
        if pattern and pattern != 'None':
            return f"5m trigger CONFIRMED: {pattern} pattern detected with RVOL={rvol:.1f}x. Entry signal is valid for {trend} position."
        elif rvol > 1.5:
            return f"5m shows high volume activity (RVOL={rvol:.1f}x) but no clear pattern. Monitor for pattern formation."
        else:
            return f"5m shows no trigger pattern. RVOL={rvol:.1f}x is normal. Wait for engulfing pattern or volume breakout before entry."
