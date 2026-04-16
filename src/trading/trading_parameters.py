from dataclasses import dataclass

@dataclass
class TradingParameters:
    max_position_size: float = 100.0
    leverage: int = 1
    stop_loss_pct: float = 1.0
    take_profit_pct: float = 2.0
    kline_limit: int = 300
    test_mode: bool = False