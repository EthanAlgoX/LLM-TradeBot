import pytest

from config import RuntimeConfig
from providers.factory import build_execution_provider, build_market_data_provider, build_market_rank_provider
from providers.data import FallbackMarketDataProvider, SimMarketDataProvider
from providers.execution import PaperExecutionProvider, SimExecutionProvider
from providers.ranking import BinanceMarketRankProvider, MockMarketRankProvider


def test_runtime_config_from_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("TRADEBOT_DATA_PROVIDER", "binance")
    monkeypatch.setenv("TRADEBOT_MARKET_RANK_PROVIDER", "binance")
    monkeypatch.setenv("TRADEBOT_EXECUTION_PROVIDER", "paper")
    monkeypatch.setenv("TRADEBOT_LIVE_CONFIRM", "NO")
    monkeypatch.setenv("TRADEBOT_BACKTEST_MAX_OPEN_NOTIONAL_SHARE_OF_BAR", "0.015")
    monkeypatch.setenv("TRADEBOT_BACKTEST_MAX_OPEN_RETRIES", "4")
    cfg = RuntimeConfig.from_env()

    assert cfg.data_provider == "binance"
    assert cfg.market_rank_provider == "binance"
    assert cfg.execution_provider == "paper"
    assert cfg.live_confirm_token == "NO"
    assert cfg.backtest_max_open_notional_share_of_bar == 0.015
    assert cfg.backtest_max_open_retries == 4


def test_factory_default_sim():
    cfg = RuntimeConfig()
    assert isinstance(build_market_data_provider(cfg), SimMarketDataProvider)
    assert isinstance(build_market_rank_provider(cfg), MockMarketRankProvider)
    assert isinstance(build_execution_provider(cfg), SimExecutionProvider)


def test_factory_binance_data_with_fallback():
    cfg = RuntimeConfig(data_provider="binance", fallback_to_sim=True)
    provider = build_market_data_provider(cfg)
    assert isinstance(provider, FallbackMarketDataProvider)


def test_factory_binance_rank_provider():
    cfg = RuntimeConfig(market_rank_provider="binance")
    provider = build_market_rank_provider(cfg)
    assert isinstance(provider, BinanceMarketRankProvider)


def test_factory_live_requires_credentials(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("TRADEBOT_BINANCE_API_KEY", raising=False)
    monkeypatch.delenv("TRADEBOT_BINANCE_API_SECRET", raising=False)
    cfg = RuntimeConfig(execution_provider="binance_live")
    with pytest.raises(ValueError):
        build_execution_provider(cfg)


def test_factory_paper_execution_provider():
    cfg = RuntimeConfig(execution_provider="paper")
    provider = build_execution_provider(cfg)
    assert isinstance(provider, PaperExecutionProvider)
