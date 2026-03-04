from __future__ import annotations

from tradebot.config import RuntimeConfig
from tradebot.providers.data import (
    BinanceSpotMarketDataProvider,
    FallbackMarketDataProvider,
    MarketDataProvider,
    SimMarketDataProvider,
)
from tradebot.providers.execution import (
    BinanceCredentials,
    BinanceFuturesExecutionProvider,
    ExecutionProvider,
    PaperExecutionProvider,
    SimExecutionProvider,
)
from tradebot.providers.ranking import BinanceMarketRankProvider, MarketRankProvider, MockMarketRankProvider


def build_market_data_provider(cfg: RuntimeConfig) -> MarketDataProvider:
    if cfg.data_provider == "sim":
        return SimMarketDataProvider()
    if cfg.data_provider == "binance":
        primary = BinanceSpotMarketDataProvider(base_url=cfg.binance_spot_base_url, timeout_sec=cfg.http_timeout_sec)
        if cfg.fallback_to_sim:
            return FallbackMarketDataProvider(primary=primary, fallback=SimMarketDataProvider())
        return primary
    raise ValueError(f"unsupported data_provider={cfg.data_provider}")


def build_market_rank_provider(cfg: RuntimeConfig) -> MarketRankProvider:
    if cfg.market_rank_provider == "mock":
        return MockMarketRankProvider()
    if cfg.market_rank_provider == "binance":
        return BinanceMarketRankProvider(base_url=cfg.binance_spot_base_url, timeout_sec=cfg.http_timeout_sec)
    raise ValueError(f"unsupported market_rank_provider={cfg.market_rank_provider}")


def build_execution_provider(cfg: RuntimeConfig) -> ExecutionProvider:
    if cfg.execution_provider == "sim":
        return SimExecutionProvider()
    if cfg.execution_provider == "paper":
        return PaperExecutionProvider()
    if cfg.execution_provider == "binance_live":
        if not cfg.binance_api_key or not cfg.binance_api_secret:
            raise ValueError("binance_live requires TRADEBOT_BINANCE_API_KEY and TRADEBOT_BINANCE_API_SECRET")
        creds = BinanceCredentials(api_key=cfg.binance_api_key, api_secret=cfg.binance_api_secret)
        return BinanceFuturesExecutionProvider(
            credentials=creds,
            base_url=cfg.binance_futures_base_url,
            timeout_sec=cfg.http_timeout_sec,
            live_confirm_token=cfg.live_confirm_token,
        )
    raise ValueError(f"unsupported execution_provider={cfg.execution_provider}")
