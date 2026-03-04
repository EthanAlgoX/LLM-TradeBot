from dataclasses import dataclass, field
import os


@dataclass
class SelectorConfig:
    top_n: int = 10
    ai500_weight: float = 0.45
    market_rank_weight: float = 0.45
    feedback_weight: float = 0.10


@dataclass
class DecisionConfig:
    fast_trend_threshold: float = 2.0
    open_threshold: float = 60.0
    llm_enabled: bool = False


@dataclass
class RiskConfig:
    max_leverage: float = 5.0
    min_rr: float = 1.2
    max_position_notional: float = 10_000.0


@dataclass
class RuntimeConfig:
    selector: SelectorConfig = field(default_factory=SelectorConfig)
    decision: DecisionConfig = field(default_factory=DecisionConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    initial_cash: float = 100_000.0
    per_trade_notional: float = 2_000.0
    data_provider: str = "sim"  # sim | binance
    market_rank_provider: str = "mock"  # mock | binance
    execution_provider: str = "sim"  # sim | paper | binance_live
    fallback_to_sim: bool = True
    http_timeout_sec: float = 4.0
    binance_spot_base_url: str = "https://api.binance.com"
    binance_futures_base_url: str = "https://fapi.binance.com"
    binance_api_key: str | None = None
    binance_api_secret: str | None = None
    live_confirm_token: str = "NO"
    persistence_enabled: bool = False
    persistence_path: str = "data/tradebot.db"

    # AI500 candidate universe (reference from LLM-TradeBot)
    ai500_candidates: list[str] = field(
        default_factory=lambda: [
            "FETUSDT", "RENDERUSDT", "TAOUSDT", "NEARUSDT", "GRTUSDT",
            "WLDUSDT", "ARKMUSDT", "LPTUSDT", "THETAUSDT", "ROSEUSDT",
            "PHBUSDT", "CTXCUSDT", "NMRUSDT", "RLCUSDT", "GLMUSDT",
            "IQUSDT", "MDTUSDT", "AIUSDT", "NFPUSDT", "XAIUSDT",
            "JASMYUSDT", "ICPUSDT", "FILUSDT", "VETUSDT", "LINKUSDT",
            "ACTUSDT", "GOATUSDT", "TURBOUSDT", "PNUTUSDT",
        ]
    )

    @classmethod
    def from_env(cls) -> "RuntimeConfig":
        cfg = cls()
        cfg.data_provider = os.getenv("TRADEBOT_DATA_PROVIDER", cfg.data_provider)
        cfg.market_rank_provider = os.getenv("TRADEBOT_MARKET_RANK_PROVIDER", cfg.market_rank_provider)
        cfg.execution_provider = os.getenv("TRADEBOT_EXECUTION_PROVIDER", cfg.execution_provider)
        cfg.fallback_to_sim = os.getenv("TRADEBOT_FALLBACK_TO_SIM", "1") not in {"0", "false", "False"}
        cfg.http_timeout_sec = float(os.getenv("TRADEBOT_HTTP_TIMEOUT_SEC", str(cfg.http_timeout_sec)))
        cfg.binance_spot_base_url = os.getenv("TRADEBOT_BINANCE_SPOT_BASE_URL", cfg.binance_spot_base_url)
        cfg.binance_futures_base_url = os.getenv("TRADEBOT_BINANCE_FUTURES_BASE_URL", cfg.binance_futures_base_url)
        cfg.binance_api_key = os.getenv("TRADEBOT_BINANCE_API_KEY")
        cfg.binance_api_secret = os.getenv("TRADEBOT_BINANCE_API_SECRET")
        cfg.live_confirm_token = os.getenv("TRADEBOT_LIVE_CONFIRM", cfg.live_confirm_token)
        cfg.persistence_enabled = os.getenv("TRADEBOT_PERSISTENCE_ENABLED", "0") in {"1", "true", "True"}
        cfg.persistence_path = os.getenv("TRADEBOT_PERSISTENCE_PATH", cfg.persistence_path)
        return cfg
