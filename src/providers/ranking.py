from __future__ import annotations

import json
import random
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass


@dataclass
class MarketRankRow:
    symbol: str
    score: float
    reason: str


class MarketRankProvider:
    def snapshot(self, symbols: list[str], cycle: int) -> dict[str, MarketRankRow]:
        raise NotImplementedError


class MockMarketRankProvider(MarketRankProvider):
    """Deterministic market-rank provider for local simulation."""

    def snapshot(self, symbols: list[str], cycle: int) -> dict[str, MarketRankRow]:
        out: dict[str, MarketRankRow] = {}
        for symbol in symbols:
            rng = random.Random(f"mr:{symbol}:{cycle // 2}")
            score = 45.0 + rng.random() * 55.0
            reason = "trend+search+inflow composite"
            out[symbol] = MarketRankRow(symbol=symbol, score=score, reason=reason)
        return out


class _BaseBinanceMarketRankProvider(MarketRankProvider):
    """Shared Binance rank provider for spot/futures ticker endpoints.

    Score combines trend, relative quote volume and relative trade count.
    """

    ticker_path: str

    def __init__(self, *, base_url: str, timeout_sec: float = 4.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec
        self._fallback = MockMarketRankProvider()

    def _get_json(self, path: str, query: dict[str, str] | None = None) -> object:
        qs = f"?{urllib.parse.urlencode(query)}" if query else ""
        url = f"{self.base_url}{path}{qs}"
        req = urllib.request.Request(url=url, method="GET", headers={"User-Agent": "TradeBot/0.1"})
        with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def snapshot(self, symbols: list[str], cycle: int) -> dict[str, MarketRankRow]:
        if not symbols:
            return {}
        try:
            payload = self._get_json(self.ticker_path)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
            return self._fallback.snapshot(symbols, cycle)

        if not isinstance(payload, list):
            return self._fallback.snapshot(symbols, cycle)

        ticker_map: dict[str, dict[str, object]] = {}
        for row in payload:
            if isinstance(row, dict):
                sym = str(row.get("symbol", ""))
                ticker_map[sym] = row

        selected_rows: list[dict[str, object]] = [ticker_map[s] for s in symbols if s in ticker_map]
        if not selected_rows:
            return self._fallback.snapshot(symbols, cycle)

        max_quote_volume = 1.0
        max_trade_count = 1.0
        for row in selected_rows:
            qv = float(row.get("quoteVolume", 0.0) or 0.0)
            tc = float(row.get("count", 0.0) or 0.0)
            if qv > max_quote_volume:
                max_quote_volume = qv
            if tc > max_trade_count:
                max_trade_count = tc

        out: dict[str, MarketRankRow] = {}
        for symbol in symbols:
            row = ticker_map.get(symbol)
            if row is None:
                out[symbol] = MarketRankRow(symbol=symbol, score=45.0, reason="ticker missing -> neutral")
                continue

            change_pct = float(row.get("priceChangePercent", 0.0) or 0.0)
            quote_volume = float(row.get("quoteVolume", 0.0) or 0.0)
            trade_count = float(row.get("count", 0.0) or 0.0)

            # Map trend from roughly [-10%, +10%] to [0, 100] and clamp.
            trend_score = max(0.0, min(100.0, (change_pct + 10.0) * 5.0))
            volume_score = max(0.0, min(100.0, quote_volume / max_quote_volume * 100.0))
            activity_score = max(0.0, min(100.0, trade_count / max_trade_count * 100.0))
            score = 0.45 * trend_score + 0.45 * volume_score + 0.10 * activity_score
            reason = f"binance trend={change_pct:.2f}% qv={quote_volume:.0f} trades={trade_count:.0f}"
            out[symbol] = MarketRankRow(symbol=symbol, score=score, reason=reason)

        return out


class BinanceSpotMarketRankProvider(_BaseBinanceMarketRankProvider):
    ticker_path = "/api/v3/ticker/24hr"

    def __init__(self, *, base_url: str = "https://api.binance.com", timeout_sec: float = 4.0) -> None:
        super().__init__(base_url=base_url, timeout_sec=timeout_sec)


class BinanceFuturesMarketRankProvider(_BaseBinanceMarketRankProvider):
    ticker_path = "/fapi/v1/ticker/24hr"

    def __init__(self, *, base_url: str = "https://fapi.binance.com", timeout_sec: float = 4.0) -> None:
        super().__init__(base_url=base_url, timeout_sec=timeout_sec)


class BinanceMarketRankProvider(BinanceFuturesMarketRankProvider):
    """Backwards-compatible alias for the default Binance futures rank provider."""
