from typing import Dict, List, Optional
from abc import ABC, abstractmethod

class TriggerAgent(ABC):
    @abstractmethod
    def analyze(self, data: Dict) -> Dict:
        pass

    def get_system_prompt(self) -> Optional[str]:
        return None

    def _compute_trigger_signals(self, data: Dict) -> Dict[str, Optional[float]]:
        pattern = data.get('pattern') or data.get('trigger_pattern')
        rvol = data.get('rvol') or data.get('trigger_rvol', 1.0)
        volume_breakout = data.get('volume_breakout', False)

        if pattern and pattern != 'None':
            stance = 'CONFIRMED'
            status = 'PATTERN_DETECTED'
        elif volume_breakout or rvol > 1.0:
            stance = 'VOLUME_SIGNAL'
            status = 'BREAKOUT'
        else:
            stance = 'WAITING'
            status = 'NO_SIGNAL'

        return {
            'stance': stance,
            'status': status,
            'pattern': pattern if pattern and pattern != 'None' else 'NONE',
            'rvol': rvol,
            'volume_breakout': volume_breakout
        }
