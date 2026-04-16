from typing import Dict

class FourLayerStateContainer:
    def __init__(self):
        self.layer4_wait_streak = 0
        self.layer4_trigger_streak = 0
        self.layer4_adaptive_state: Dict[str, Dict[str, int]] = {}