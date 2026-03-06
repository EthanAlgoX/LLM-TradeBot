from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


SCHEMA_V2 = "v2"


@dataclass
class RankedSymbol:
    symbol: str
    rank: int
    score: float
    ai500_score: float
    market_rank_score: float
    feedback_score: float
    why: list[str] = field(default_factory=list)


@dataclass
class UniverseSet:
    schema_version: str
    trace_id: str
    generated_at: str
    top_symbols: list[RankedSymbol]
    fallback_source: str = "none"


@dataclass
class MarketSnapshot:
    schema_version: str
    trace_id: str
    symbol: str
    price: float
    momentum_30m_pct: float
    volatility_pct: float
    volume_ratio: float
    momentum_short_pct: float = 0.0  # OPT-2: short-lookback (e.g. 3-bar) momentum for confirmation


@dataclass
class SignalOutput:
    schema_version: str
    trace_id: str
    symbol: str
    trend_score: float
    oscillator_score: float
    sentiment_score: float


@dataclass
class PredictionOutput:
    schema_version: str
    trace_id: str
    symbol: str
    probability_up: float
    confidence: float


@dataclass
class ContextOutput:
    schema_version: str
    trace_id: str
    symbol: str
    market_rank: int
    reflection_hint: str


@dataclass
class SemanticOutput:
    schema_version: str
    trace_id: str
    symbol: str
    trend_stance: str
    setup_stance: str
    trigger_stance: str


@dataclass
class ConsensusSignal:
    schema_version: str
    trace_id: str
    symbol: str
    trend_score: float
    osc_score: float
    sentiment_score: float
    predict_up_prob: float
    alignment_bias: str
    alignment_ok: bool
    semantic: dict[str, str]
    context: dict[str, Any]
    momentum_short_pct: float = 0.0  # OPT-2: short-lookback momentum for trend confirmation


@dataclass
class ProposedAction:
    schema_version: str
    trace_id: str
    symbol: str
    source: str
    action: str
    confidence: float
    reason: str
    order_params: dict[str, Any]


@dataclass
class RiskDecision:
    schema_version: str
    trace_id: str
    symbol: str
    passed: bool
    risk_level: str
    blocked_reason: str | None
    corrections: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


@dataclass
class ExecutionResult:
    schema_version: str
    trace_id: str
    symbol: str
    action: str
    status: str
    message: str
    fill_price: float | None = None


@dataclass
class PostTradeResult:
    schema_version: str
    trace_id: str
    symbol: str
    notes: list[str] = field(default_factory=list)


@dataclass
class CycleResult:
    schema_version: str
    cycle: int
    trace_id: str
    selected_symbols: list[str]
    action: str
    status: str
    details: dict[str, Any] = field(default_factory=dict)
