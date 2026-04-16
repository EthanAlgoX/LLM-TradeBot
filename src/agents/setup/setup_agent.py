from typing import Dict, List, Optional
from abc import ABC, abstractmethod

class SetupAgent(ABC):
    @abstractmethod
    def analyze(self, data: Dict) -> Dict:
        pass

    def get_system_prompt(self) -> Optional[str]:
        return None

    def _compute_setup_signals(self, data: Dict) -> Dict[str, Optional[float]]:
        kdj_j = data.get('kdj_j', 50)
        trend = data.get('trend_direction', 'neutral')
        close = data.get('close_15m', 0)
        bb_middle = data.get('bb_middle', 0)
        macd_diff = data.get('macd_diff', 0)

        if trend == 'long':
            if kdj_j < 40:
                stance = 'PULLBACK_ZONE'
                zone = 'GOOD_ENTRY'
            elif kdj_j > 80:
                stance = 'OVERBOUGHT'
                zone = 'WAIT'
            else:
                stance = 'NEUTRAL'
                zone = 'MONITOR'
        elif trend == 'short':
            if kdj_j > 60:
                stance = 'RALLY_ZONE'
                zone = 'GOOD_ENTRY'
            elif kdj_j < 20:
                stance = 'OVERSOLD'
                zone = 'WAIT'
            else:
                stance = 'NEUTRAL'
                zone = 'MONITOR'
        else:
            stance = 'NEUTRAL'
            zone = 'WAIT'

        if macd_diff > 0:
            macd_signal = 'BULLISH'
        elif macd_diff < 0:
            macd_signal = 'BEARISH'
        else:
            macd_signal = 'NEUTRAL'

        bb_position = 'ABOVE_MID' if close > bb_middle else 'BELOW_MID'

        return {
            'stance': stance,
            'zone': zone,
            'kdj_j': kdj_j,
            'trend': trend,
            'bb_position': bb_position,
            'macd_signal': macd_signal,
            'macd_diff': macd_diff
        }