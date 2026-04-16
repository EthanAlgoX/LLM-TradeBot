from dataclasses import dataclass

@dataclass
class SignalWeight:
    """信号权重配置
    
    注意: 所有权重应该合计为 1.0 (不包括动态 sentiment)
    优化后配置 (2026-01-07): 基于回测分析进一步优化
    - 增加1h权重，减少短周期噪音
    - 减少prophet权重，更依赖技术指标
    """
    # 趋势信号 (合计 0.45) - 增加长周期权重
    trend_5m: float = 0.03   # 减少5m噪音影响
    trend_15m: float = 0.12  # 略增
    trend_1h: float = 0.30   # 增加1h权重 (核心趋势判断)
    # 震荡信号 (合计 0.20)
    oscillator_5m: float = 0.03  # 减少5m噪音
    oscillator_15m: float = 0.07
    oscillator_1h: float = 0.10  # 增加1h权重
    # Prophet ML 预测权重 - 进一步减少
    prophet: float = 0.05  # 减少ML权重，避免过拟合
    # 情绪信号 (动态权重)
    sentiment: float = 0.25
    # 其他扩展信号（如LLM）
    llm_signal: float = 0.0  # 待整合
