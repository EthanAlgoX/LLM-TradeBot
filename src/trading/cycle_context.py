import pandas as pd

from dataclasses import dataclass
from typing import Optional, Dict, Any

from src.agents import (
    MarketSnapshot,
    PredictResult,
    VoteResult,
    PositionInfo
)

@dataclass
class CycleContext:
    """Per-cycle immutable context used across trading stages."""
    run_id: str
    cycle_id: Optional[str]
    snapshot_id: str
    cycle_num: int
    symbol: str
    analyze_only: bool
    market_snapshot: Optional[MarketSnapshot] = None
    processed_dfs: Optional[Dict[str, pd.DataFrame]] = None
    current_price: Optional[Any] = None
    current_position_info: Optional[Dict[str, Any]] = None
    quant_analysis: Optional[Dict[str, Any]] = None
    predict_result: Optional[PredictResult] = None
    reflection_text: Optional[str] = None
    regime_result: Optional[Dict[str, Any]] = None
    four_layer_result: Optional[Dict[str, Any]] = None
    trend_1h: Optional[str] = None
    vote_result: Optional[VoteResult] = None,
    order_params: Optional[Dict[str, Any]] = None
    account_balance: Optional[float] = None
    current_position: Optional[PositionInfo] = None
