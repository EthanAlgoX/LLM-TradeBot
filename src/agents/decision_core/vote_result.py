from typing import Dict, Optional
from dataclasses import dataclass

@dataclass
class VoteResult:
    """投票结果"""
    action: str  # 'open_long', 'open_short', 'close_long', 'close_short', 'wait/hold'
    confidence: float  # 0-100
    weighted_score: float  # -100 ~ +100
    vote_details: Dict[str, float]  # 各信号的贡献分
    multi_period_aligned: bool  # 多周期是否一致
    reason: str  # 决策原因
    regime: Optional[Dict] = None      # 市场状态信息
    position: Optional[Dict] = None    # 价格位置信息
    trade_params: Optional[Dict] = None # 动态交易参数 (stop_loss, take_profit, leverage, etc.)
    traps: Optional[Dict] = None # 市场陷阱信息 (User Experience Logic)
