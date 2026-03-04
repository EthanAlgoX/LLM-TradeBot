from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Position:
    symbol: str
    side: str
    qty: float
    entry_price: float
    leverage: float
    opened_cycle: int


@dataclass
class TradeRecord:
    cycle: int
    symbol: str
    action: str
    qty: float
    price: float
    pnl: float = 0.0


@dataclass
class RuntimeState:
    cycle: int = 0
    cash: float = 100_000.0
    positions: dict[str, Position] = field(default_factory=dict)
    trades: list[TradeRecord] = field(default_factory=list)
    prices: dict[str, float] = field(default_factory=dict)
    reflection_hint: str = ""

    def has_position(self, symbol: str) -> bool:
        return symbol in self.positions
