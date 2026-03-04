from __future__ import annotations

import json
import random
import statistics
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from state import RuntimeState


@dataclass
class ProviderSnapshot:
    price: float
    momentum_30m_pct: float
    volatility_pct: float
    volume_ratio: float


class MarketDataProvider:
    def fetch(self, *, symbol: str, state: RuntimeState) -> ProviderSnapshot:
        raise NotImplementedError


class SimMarketDataProvider(MarketDataProvider):
    def fetch(self, *, symbol: str, state: RuntimeState) -> ProviderSnapshot:
        prev = state.prices.get(symbol)
        if prev is None:
            prev = 20.0 + (abs(hash(symbol)) % 10_000) / 100.0

        rng = random.Random(f"tick:{symbol}:{state.cycle}")
        drift_pct = rng.uniform(-1.8, 1.8)
        price = max(0.01, prev * (1 + drift_pct / 100.0))
        volume_ratio = max(0.3, min(3.5, 1.0 + rng.uniform(-0.8, 1.5)))
        volatility = max(0.1, min(6.0, abs(drift_pct) * 1.8 + rng.uniform(0.2, 1.1)))

        return ProviderSnapshot(
            price=round(price, 5),
            momentum_30m_pct=round(drift_pct * 2.8, 4),
            volatility_pct=round(volatility, 4),
            volume_ratio=round(volume_ratio, 4),
        )


class BinanceSpotMarketDataProvider(MarketDataProvider):
    """Public Binance spot data provider (no API key required)."""

    def __init__(self, *, base_url: str = "https://api.binance.com", timeout_sec: float = 4.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec

    def _get_json(self, path: str, query: dict[str, str]) -> object:
        qs = urllib.parse.urlencode(query)
        url = f"{self.base_url}{path}?{qs}"
        req = urllib.request.Request(url=url, method="GET", headers={"User-Agent": "TradeBot/0.1"})
        with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def fetch(self, *, symbol: str, state: RuntimeState) -> ProviderSnapshot:
        # Last 30 one-minute klines.
        klines_obj = self._get_json("/api/v3/klines", {"symbol": symbol, "interval": "1m", "limit": "30"})
        ticker_obj = self._get_json("/api/v3/ticker/24hr", {"symbol": symbol})

        if not isinstance(klines_obj, list) or len(klines_obj) < 2 or not isinstance(ticker_obj, dict):
            raise ValueError("invalid binance payload")

        closes: list[float] = []
        highs: list[float] = []
        lows: list[float] = []
        quote_vol_30m = 0.0
        for row in klines_obj:
            if not isinstance(row, list) or len(row) < 8:
                continue
            closes.append(float(row[4]))
            highs.append(float(row[2]))
            lows.append(float(row[3]))
            quote_vol_30m += float(row[7])

        if len(closes) < 2:
            raise ValueError("not enough kline points")

        price = closes[-1]
        momentum = (closes[-1] / closes[0] - 1.0) * 100.0

        # Intraday volatility in percent.
        high_30m = max(highs)
        low_30m = min(lows)
        volatility = (high_30m - low_30m) / price * 100.0 if price > 0 else 0.0

        quote_volume_24h = float(ticker_obj.get("quoteVolume", 0.0) or 0.0)
        baseline_per_30m = max(1.0, quote_volume_24h / 48.0)
        volume_ratio = quote_vol_30m / baseline_per_30m

        returns = []
        for i in range(1, len(closes)):
            prev = closes[i - 1]
            now = closes[i]
            if prev > 0:
                returns.append((now / prev - 1.0) * 100.0)
        if returns:
            volatility = max(volatility, statistics.pstdev(returns) * 4.0)

        return ProviderSnapshot(
            price=round(price, 5),
            momentum_30m_pct=round(momentum, 4),
            volatility_pct=round(max(0.01, volatility), 4),
            volume_ratio=round(max(0.01, volume_ratio), 4),
        )


class FallbackMarketDataProvider(MarketDataProvider):
    """Wrap a primary provider and fallback provider for resilient operation."""

    def __init__(self, primary: MarketDataProvider, fallback: MarketDataProvider) -> None:
        self.primary = primary
        self.fallback = fallback

    def fetch(self, *, symbol: str, state: RuntimeState) -> ProviderSnapshot:
        try:
            return self.primary.fetch(symbol=symbol, state=state)
        except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
            return self.fallback.fetch(symbol=symbol, state=state)
