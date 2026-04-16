from typing import Dict
from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class PredictResult:
    """预测结果"""
    probability_up: float      # 0.0 - 1.0: 价格上涨概率
    probability_down: float    # 0.0 - 1.0: 价格下跌概率
    confidence: float          # 0.0 - 1.0: 预测置信度
    horizon: str               # 预测时间范围 (e.g., '5m', '15m', '1h')
    factors: Dict[str, float]  # 因子贡献分解
    model_type: str            # 'rule_based' 或 'ml_model'
    timestamp: datetime = field(default_factory=datetime.now)
    
    @property
    def signal(self) -> str:
        """基于概率生成信号"""
        if self.probability_up > 0.65:
            return 'strong_bullish'
        elif self.probability_up > 0.55:
            return 'bullish'
        elif self.probability_down > 0.65:
            return 'strong_bearish'
        elif self.probability_down > 0.55:
            return 'bearish'
        else:
            return 'neutral'
    
    def to_dict(self) -> Dict:
        """转换为字典"""
        return {
            'probability_up': self.probability_up,
            'probability_down': self.probability_down,
            'confidence': self.confidence,
            'horizon': self.horizon,
            'signal': self.signal,
            'factors': self.factors,
            'model_type': self.model_type,
            'timestamp': self.timestamp.isoformat()
        }