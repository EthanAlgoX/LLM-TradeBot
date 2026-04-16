from dataclasses import dataclass
from datetime import datetime

@dataclass
class TradeRecord:
    """交易记录"""
    symbol: str
    action: str
    timestamp: datetime
    pnl: float = 0.0
