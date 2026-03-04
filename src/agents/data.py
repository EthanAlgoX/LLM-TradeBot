from __future__ import annotations

from agents.base import BaseAgent
from contracts import MarketSnapshot, SCHEMA_V2
from providers.data import MarketDataProvider, SimMarketDataProvider
from state import RuntimeState


class DataAgent(BaseAgent):
    name = "data_agent"

    def __init__(self, provider: MarketDataProvider | None = None) -> None:
        self.provider = provider or SimMarketDataProvider()

    def fetch(self, *, trace_id: str, symbol: str, state: RuntimeState) -> MarketSnapshot:
        provider_snapshot = self.provider.fetch(symbol=symbol, state=state)
        state.prices[symbol] = provider_snapshot.price

        return MarketSnapshot(
            schema_version=SCHEMA_V2,
            trace_id=trace_id,
            symbol=symbol,
            price=provider_snapshot.price,
            momentum_30m_pct=provider_snapshot.momentum_30m_pct,
            volatility_pct=provider_snapshot.volatility_pct,
            volume_ratio=provider_snapshot.volume_ratio,
        )
