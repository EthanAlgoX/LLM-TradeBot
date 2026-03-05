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
    symbol_cooldowns: dict[str, int] = field(default_factory=dict)

    def has_position(self, symbol: str) -> bool:
        return symbol in self.positions

    def is_on_cooldown(self, symbol: str) -> bool:
        """Check if a symbol is on cooldown after a recent loss."""
        return self.symbol_cooldowns.get(symbol, 0) > self.cycle

    def set_cooldown(self, symbol: str, until_cycle: int) -> None:
        """Set a cooldown for a symbol until a specific cycle."""
        self.symbol_cooldowns[symbol] = until_cycle
