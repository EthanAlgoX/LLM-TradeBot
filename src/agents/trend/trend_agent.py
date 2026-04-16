from typing import Dict, Optional
from abc import ABC, abstractmethod

class TrendAgent(ABC):
    @abstractmethod
    def analyze(self, market_snapshot) -> Dict:
        pass

    def get_system_prompt(self) -> Optional[str]:
        return None
    

    def _compute_trend_signals(self, data: Dict) -> Dict[str, Optional[float]]:
        close = data.get('close_1h', 0)
        ema20 = data.get('ema20_1h', 0)
        ema60 = data.get('ema60_1h', 0)
        adx = data.get('adx', 0)
        oi_change = data.get('oi_change', 0)

        if close > ema20 > ema60:
            stance = 'UPTREND'
        elif close < ema20 < ema60:
            stance = 'DOWNTREND'
        else:
            stance = 'NEUTRAL'

        if adx > 25:
            strength = 'STRONG'
        elif adx >= 20:
            strength = 'MODERATE'
        else:
            strength = 'WEAK'

        if abs(oi_change) > 3:
            fuel = 'STRONG'
        elif abs(oi_change) >= 1:
            fuel = 'MODERATE'
        else:
            fuel = 'WEAK'

        return {
            'stance': stance,
            'strength': strength,
            'fuel': fuel,
            'adx': adx,
            'oi_change': oi_change
        }
