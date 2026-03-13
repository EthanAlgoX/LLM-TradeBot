from __future__ import annotations

import pytest

from providers.data import BinanceFuturesMarketDataProvider
from providers.ranking import BinanceMarketRankProvider
from state import RuntimeState


class StaticFuturesDataProvider(BinanceFuturesMarketDataProvider):
    def __init__(self, klines: list[list[object]], ticker: dict[str, object]) -> None:
        super().__init__(base_url="https://fapi.example.com")
        self._klines = klines
        self._ticker = ticker

    def _get_json(self, path: str, query: dict[str, str]) -> object:  # noqa: ARG002
        if path == self.kline_path:
            return self._klines
        if path == self.ticker_path:
            return self._ticker
        raise AssertionError(f"unexpected path: {path}")


class StaticFuturesRankProvider(BinanceMarketRankProvider):
    def __init__(self, payload: list[dict[str, object]]) -> None:
        super().__init__(base_url="https://fapi.example.com")
        self._payload = payload

    def _get_json(self, path: str, query: dict[str, str] | None = None) -> object:  # noqa: ARG002
        assert path == self.ticker_path
        return self._payload


def test_futures_market_data_provider_parses_futures_payload():
    closes = [100.0 + i for i in range(30)]
    klines = [
        [
            1700000000000 + i * 60_000,
            str(close - 0.5),
            str(close + 1.0),
            str(close - 1.0),
            str(close),
            "10",
            0,
            "1000",
        ]
        for i, close in enumerate(closes)
    ]
    provider = StaticFuturesDataProvider(
        klines=klines,
        ticker={"quoteVolume": "2880000"},
    )

    snapshot = provider.fetch(symbol="BTCUSDT", state=RuntimeState(cycle=1, cash=10_000.0))

    assert snapshot.price == 129.0
    assert snapshot.momentum_30m_pct == pytest.approx(29.0, rel=0, abs=1e-4)
    assert snapshot.momentum_short_pct == pytest.approx((129.0 / 126.0 - 1.0) * 100.0, rel=0, abs=1e-4)
    assert snapshot.volume_ratio == pytest.approx(0.5, rel=0, abs=1e-4)
    assert snapshot.volatility_pct > 0.0


def test_futures_market_rank_provider_scores_selected_symbols():
    provider = StaticFuturesRankProvider(
        payload=[
            {"symbol": "BTCUSDT", "priceChangePercent": "4.0", "quoteVolume": "1000000", "count": "12000"},
            {"symbol": "ETHUSDT", "priceChangePercent": "-2.0", "quoteVolume": "400000", "count": "5000"},
            {"symbol": "XRPUSDT", "priceChangePercent": "1.0", "quoteVolume": "250000", "count": "3000"},
        ]
    )

    rows = provider.snapshot(["BTCUSDT", "ETHUSDT"], cycle=5)

    assert set(rows) == {"BTCUSDT", "ETHUSDT"}
    assert rows["BTCUSDT"].score > rows["ETHUSDT"].score
    assert "binance trend=4.00%" in rows["BTCUSDT"].reason
