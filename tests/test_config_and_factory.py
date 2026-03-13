import pytest

from config import RuntimeConfig
from providers.factory import build_execution_provider, build_market_data_provider, build_market_rank_provider
from providers.data import BinanceFuturesMarketDataProvider, FallbackMarketDataProvider, SimMarketDataProvider
from providers.execution import BinanceFuturesExecutionProvider, PaperExecutionProvider, SimExecutionProvider
from providers.ranking import BinanceMarketRankProvider, MockMarketRankProvider


def test_runtime_config_from_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("TRADEBOT_DATA_PROVIDER", "binance")
    monkeypatch.setenv("TRADEBOT_MARKET_RANK_PROVIDER", "binance")
    monkeypatch.setenv("TRADEBOT_EXECUTION_PROVIDER", "paper")
    monkeypatch.setenv("TRADEBOT_LIVE_CONFIRM", "NO")
    monkeypatch.setenv("TRADEBOT_RECONCILIATION_AUTO_CANCEL_REMOTE_ONLY_ORDERS", "1")
    monkeypatch.setenv("TRADEBOT_RECONCILIATION_REMOTE_ONLY_CANCEL_MIN_CYCLE_AGE", "3")
    monkeypatch.setenv("TRADEBOT_RECONCILIATION_AUTO_CANCEL_REMOTE_ONLY_CONFLICTS_ONLY", "1")
    monkeypatch.setenv("TRADEBOT_EXECUTION_AUTO_CANCEL_CONFLICTING_PENDING_ORDERS", "1")
    monkeypatch.setenv("TRADEBOT_BACKTEST_MAX_OPEN_NOTIONAL_SHARE_OF_BAR", "0.015")
    monkeypatch.setenv("TRADEBOT_BACKTEST_MAX_OPEN_RETRIES", "4")
    monkeypatch.setenv("TRADEBOT_BACKTEST_FUNDING_RATE_BPS_PER_CYCLE", "1.5")
    cfg = RuntimeConfig.from_env()

    assert cfg.data_provider == "binance"
    assert cfg.market_rank_provider == "binance"
    assert cfg.execution_provider == "paper"
    assert cfg.live_confirm_token == "NO"
    assert cfg.reconciliation_auto_cancel_remote_only_orders is True
    assert cfg.reconciliation_remote_only_cancel_min_cycle_age == 3
    assert cfg.reconciliation_auto_cancel_remote_only_conflicts_only is True
    assert cfg.execution_auto_cancel_conflicting_pending_orders is True
    assert cfg.backtest_max_open_notional_share_of_bar == 0.015
    assert cfg.backtest_max_open_retries == 4
    assert cfg.backtest_funding_rate_bps_per_cycle == 1.5


def test_factory_default_sim():
    cfg = RuntimeConfig()
    assert isinstance(build_market_data_provider(cfg), SimMarketDataProvider)
    assert isinstance(build_market_rank_provider(cfg), MockMarketRankProvider)
    assert isinstance(build_execution_provider(cfg), SimExecutionProvider)


def test_factory_binance_data_with_fallback():
    cfg = RuntimeConfig(data_provider="binance", fallback_to_sim=True, binance_futures_base_url="https://fapi.example.com")
    provider = build_market_data_provider(cfg)
    assert isinstance(provider, FallbackMarketDataProvider)
    assert isinstance(provider.primary, BinanceFuturesMarketDataProvider)
    assert provider.primary.base_url == "https://fapi.example.com"


def test_factory_binance_rank_provider():
    cfg = RuntimeConfig(market_rank_provider="binance", binance_futures_base_url="https://fapi.example.com")
    provider = build_market_rank_provider(cfg)
    assert isinstance(provider, BinanceMarketRankProvider)
    assert provider.base_url == "https://fapi.example.com"


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


def test_factory_live_passes_auto_cancel_remote_only_orders():
    cfg = RuntimeConfig(
        execution_provider="binance_live",
        binance_api_key="k",
        binance_api_secret="s",
        reconciliation_auto_cancel_remote_only_orders=True,
        reconciliation_remote_only_cancel_min_cycle_age=2,
        reconciliation_auto_cancel_remote_only_conflicts_only=True,
    )
    provider = build_execution_provider(cfg)
    assert isinstance(provider, BinanceFuturesExecutionProvider)
    assert provider.auto_cancel_remote_only_orders is True
    assert provider.remote_only_cancel_min_cycle_age == 2
    assert provider.auto_cancel_remote_only_conflicts_only is True
