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
    stop_loss: float = 0.0
    take_profit: float = 0.0
    entry_source: str = ""
    entry_confidence: float = 0.0
    entry_reason: str = ""


@dataclass
class TradeRecord:
    cycle: int
    symbol: str
    action: str
    qty: float
    price: float
    pnl: float = 0.0
    realized_pnl: float = 0.0
    fee: float = 0.0
    funding: float = 0.0
    event_type: str = "trade"
    source: str = ""
    confidence: float = 0.0
    reason: str = ""


@dataclass
class ExecutionReportRecord:
    trace_id: str
    cycle: int
    symbol: str
    action: str
    requested_qty: float
    filled_qty: float
    requested_price: float
    fill_price: float | None = None
    status: str = ""
    provider: str = ""
    reduce_only: bool = False
    exchange_order_id: str = ""
    message: str = ""
    source: str = ""
    confidence: float = 0.0
    reason: str = ""


@dataclass
class ExchangeOrderRecord:
    trace_id: str
    cycle: int
    symbol: str
    action: str
    requested_qty: float
    executed_qty: float
    requested_price: float
    avg_price: float | None = None
    status: str = ""
    provider: str = ""
    reduce_only: bool = False
    is_active: bool = False
    exchange_order_id: str = ""
    side: str = ""
    order_type: str = "MARKET"
    message: str = ""
    status_history: list[str] = field(default_factory=list)
    source: str = ""
    confidence: float = 0.0
    reason: str = ""


@dataclass
class OrderIntentRecord:
    trace_id: str
    cycle: int
    symbol: str
    action: str
    requested_qty: float
    requested_price: float
    leverage: float
    reduce_only: bool = False
    provider: str = ""
    source: str = ""
    confidence: float = 0.0
    reason: str = ""


@dataclass
class FillRecord:
    trace_id: str
    cycle: int
    symbol: str
    action: str
    qty: float
    price: float
    fee: float = 0.0
    provider: str = ""
    exchange_order_id: str = ""
    liquidity: str = ""
    reduce_only: bool = False
    message: str = ""


@dataclass
class ReconciliationReportRecord:
    trace_id: str
    cycle: int
    provider: str
    status: str
    local_cash: float
    remote_cash: float | None = None
    local_positions: dict[str, float] = field(default_factory=dict)
    remote_positions: dict[str, float] = field(default_factory=dict)
    local_order_statuses: dict[str, str] = field(default_factory=dict)
    remote_order_statuses: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    message: str = ""
    repaired: bool = False
    repair_actions: list[str] = field(default_factory=list)


@dataclass
class RuntimeState:
    cycle: int = 0
    cash: float = 100_000.0
    peak_equity: float | None = None
    positions: dict[str, Position] = field(default_factory=dict)
    trades: list[TradeRecord] = field(default_factory=list)
    exchange_orders: list[ExchangeOrderRecord] = field(default_factory=list)
    order_intents: list[OrderIntentRecord] = field(default_factory=list)
    fills: list[FillRecord] = field(default_factory=list)
    execution_reports: list[ExecutionReportRecord] = field(default_factory=list)
    reconciliation_reports: list[ReconciliationReportRecord] = field(default_factory=list)
    prices: dict[str, float] = field(default_factory=dict)
    reflection_hint: str = ""
    symbol_cooldowns: dict[str, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.peak_equity is None:
            self.peak_equity = float(self.cash)

    def has_position(self, symbol: str) -> bool:
        return symbol in self.positions

    def has_pending_order(self, symbol: str) -> bool:
        return any(order.symbol == symbol and order.is_active for order in self.exchange_orders)

    def get_active_order(self, symbol: str) -> ExchangeOrderRecord | None:
        for order in reversed(self.exchange_orders):
            if order.symbol == symbol and order.is_active:
                return order
        return None

    def is_on_cooldown(self, symbol: str) -> bool:
        """Check if a symbol is on cooldown after a recent loss."""
        return self.symbol_cooldowns.get(symbol, 0) > self.cycle

    def set_cooldown(self, symbol: str, until_cycle: int) -> None:
        """Set a cooldown for a symbol until a specific cycle."""
        self.symbol_cooldowns[symbol] = until_cycle

    def update_peak_equity(self, equity: float) -> None:
        """Track the best mark-to-market equity reached so far."""
        if self.peak_equity is None or equity > self.peak_equity:
            self.peak_equity = float(equity)
