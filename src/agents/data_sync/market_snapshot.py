"""
数据先知 (The Oracle) Agent

职责：
1. 异步并发请求多周期K线数据
2. 拆分 stable/live 双视图
3. 时间对齐验证

优化点：
- 并发IO，节省60%时间
- 双视图数据，解决滞后问题
"""

import pandas as pd
from datetime import datetime
from typing import Dict, List
from dataclasses import dataclass, field

@dataclass
class MarketSnapshot:
    """
    市场快照（双视图结构）
    
    stable_view: iloc[:-1] 已完成的K线，用于计算历史指标
    live_view: iloc[-1] 当前未完成的K线，包含最新价格
    """
    # 5m 数据
    stable_5m: pd.DataFrame  # 已完成K线
    live_5m: Dict            # 最新K线
    
    # 15m 数据
    stable_15m: pd.DataFrame
    live_15m: Dict
    
    # 1h 数据
    stable_1h: pd.DataFrame
    live_1h: Dict
    
    # 元数据
    timestamp: datetime
    alignment_ok: bool       # 时间对齐状态
    fetch_duration: float    # 获取耗时（秒）
    
    # 对外量化深度数据 (Netflow, OI)
    quant_data: Dict = field(default_factory=dict)
    
    # Binance 原生数据 (Native Data)
    binance_funding: Dict = field(default_factory=dict)
    binance_oi: Dict = field(default_factory=dict)
    
    # 原始数据（可选，用于调试）
    raw_5m: List[Dict] = field(default_factory=list)
    raw_15m: List[Dict] = field(default_factory=list)
    raw_1h: List[Dict] = field(default_factory=list)
    
    # 🔧 FIX: Added symbol for pipeline tracking (must come after fields with defaults)
    symbol: str = "UNKNOWN"
