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
    fast_trend_threshold: float = 0.8  # Ultra-aggressive for longs
    fast_trend_short_threshold: float = 100.0  # Disable fast shorts
    fast_trend_long_min_predict_up_prob: float = 0.50
    fast_trend_short_max_predict_up_prob: float = 0.10
    fast_trend_short_max_sentiment: float = -50.0
    max_holding_cycles: int = 36  # Extended to 36 hours to ride the massive multi-day rallies
    long_stop_loss_pct: float = 0.04  # Let longs breathe
    long_take_profit_pct: float = 0.08  # Run winners higher
    short_stop_loss_pct: float = 0.02
    short_take_profit_pct: float = 0.02
    open_threshold: float = 10.0  # Hyper-aggressive for rule longs
    long_reversal_close_score: float = -60.0  # Lowered so we don't close longs prematurely
    short_reversal_close_score: float = 100.0  # Disable short reversal closes
    llm_enabled: bool = False
    loss_cooldown_threshold_boost: float = 15.0
    stop_volatility_multiplier: float = 1.3
    take_profit_rr_ratio: float = 2.0
    symbol_cooldown_cycles: int = 1
    require_short_momentum_confirm: bool = False  # Relax for faster entries
    reflection_leverage_cap: float = 1.5
    min_volatility_pct_to_open: float = 0.2


@dataclass
class RiskConfig:
    max_leverage: float = 5.0
    min_rr: float = 1.0
    max_position_notional: float = 300_000.0
    max_concurrent_positions: int = 3
    max_drawdown_pct: float = 8.0
    max_loss_per_trade_pct: float = 50.0  # High limit to bypass hard blocks on extreme vol trades
    hard_block_max_loss: bool = True  # OPT-5: when True, worst-case loss check blocks the trade


@dataclass
class BacktestConfig:
    # OPT-1: trailing stop parameters
    trailing_stop_enabled: bool = True
    trailing_stop_activation_pct: float = 0.8  # Activate trail sooner (was 1.0%)
    trailing_stop_distance_pct: float = 3.0  # Wider trail (3%) to avoid getting stopped out on noise
    # OPT-8: time-decay stop tightening
    time_decay_stop_enabled: bool = True
    time_decay_tightening_factor: float = 0.12  # Faster stop tightening as position ages (was 0.05)
    # OPT-6: volatility-adaptive sizing
    vol_adaptive_sizing_enabled: bool = True
    vol_adaptive_base_vol_pct: float = 3.0  # Less aggressive vol scaling (was 2.0) so positions aren't over-shrunk


@dataclass
class RuntimeConfig:
    selector: SelectorConfig = field(default_factory=SelectorConfig)
    decision: DecisionConfig = field(default_factory=DecisionConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    backtest: BacktestConfig = field(default_factory=BacktestConfig)
    initial_cash: float = 100_000.0
    per_trade_notional: float = 130_000.0  # 130k exposure at 4x lev = 32.5k margin per trade
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
    backtest_fee_bps: float = 3.0
    backtest_slippage_bps: float = 1.0
    backtest_max_open_notional_share_of_bar: float = 0.02
    backtest_max_open_retries: int = 2
    backtest_funding_rate_bps_per_cycle: float = 0.0

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
        cfg.backtest_fee_bps = float(os.getenv("TRADEBOT_BACKTEST_FEE_BPS", str(cfg.backtest_fee_bps)))
        cfg.backtest_slippage_bps = float(os.getenv("TRADEBOT_BACKTEST_SLIPPAGE_BPS", str(cfg.backtest_slippage_bps)))
        cfg.backtest_max_open_notional_share_of_bar = float(
            os.getenv(
                "TRADEBOT_BACKTEST_MAX_OPEN_NOTIONAL_SHARE_OF_BAR",
                str(cfg.backtest_max_open_notional_share_of_bar),
            )
        )
        cfg.backtest_max_open_retries = int(os.getenv("TRADEBOT_BACKTEST_MAX_OPEN_RETRIES", str(cfg.backtest_max_open_retries)))
        cfg.backtest_funding_rate_bps_per_cycle = float(
            os.getenv(
                "TRADEBOT_BACKTEST_FUNDING_RATE_BPS_PER_CYCLE",
                str(cfg.backtest_funding_rate_bps_per_cycle),
            )
        )
        cfg.decision.fast_trend_threshold = float(
            os.getenv("TRADEBOT_DECISION_FAST_TREND_THRESHOLD", str(cfg.decision.fast_trend_threshold))
        )
        cfg.decision.fast_trend_short_threshold = float(
            os.getenv("TRADEBOT_DECISION_FAST_TREND_SHORT_THRESHOLD", str(cfg.decision.fast_trend_short_threshold))
        )
        cfg.decision.fast_trend_long_min_predict_up_prob = float(
            os.getenv(
                "TRADEBOT_DECISION_FAST_TREND_LONG_MIN_PUP",
                str(cfg.decision.fast_trend_long_min_predict_up_prob),
            )
        )
        cfg.decision.fast_trend_short_max_predict_up_prob = float(
            os.getenv(
                "TRADEBOT_DECISION_FAST_TREND_SHORT_MAX_PUP",
                str(cfg.decision.fast_trend_short_max_predict_up_prob),
            )
        )
        cfg.decision.fast_trend_short_max_sentiment = float(
            os.getenv(
                "TRADEBOT_DECISION_FAST_TREND_SHORT_MAX_SENTIMENT",
                str(cfg.decision.fast_trend_short_max_sentiment),
            )
        )
        cfg.decision.max_holding_cycles = int(
            os.getenv("TRADEBOT_DECISION_MAX_HOLDING_CYCLES", str(cfg.decision.max_holding_cycles))
        )
        cfg.decision.long_stop_loss_pct = float(
            os.getenv("TRADEBOT_DECISION_LONG_STOP_LOSS_PCT", str(cfg.decision.long_stop_loss_pct))
        )
        cfg.decision.long_take_profit_pct = float(
            os.getenv("TRADEBOT_DECISION_LONG_TAKE_PROFIT_PCT", str(cfg.decision.long_take_profit_pct))
        )
        cfg.decision.short_stop_loss_pct = float(
            os.getenv("TRADEBOT_DECISION_SHORT_STOP_LOSS_PCT", str(cfg.decision.short_stop_loss_pct))
        )
        cfg.decision.short_take_profit_pct = float(
            os.getenv("TRADEBOT_DECISION_SHORT_TAKE_PROFIT_PCT", str(cfg.decision.short_take_profit_pct))
        )
        cfg.decision.open_threshold = float(os.getenv("TRADEBOT_DECISION_OPEN_THRESHOLD", str(cfg.decision.open_threshold)))
        cfg.decision.long_reversal_close_score = float(
            os.getenv("TRADEBOT_DECISION_LONG_REVERSAL_CLOSE", str(cfg.decision.long_reversal_close_score))
        )
        cfg.decision.short_reversal_close_score = float(
            os.getenv("TRADEBOT_DECISION_SHORT_REVERSAL_CLOSE", str(cfg.decision.short_reversal_close_score))
        )
        return cfg
