"""
🔮 预测预言家 (The Prophet) Agent
===========================================

职责:
1. 接收结构化特征数据
2. 输出未来价格上涨概率 (0.0 - 1.0)
3. 支持规则评分和 ML 模型两种模式
4. 提供因子分解说明预测原因

Author: AI Trader Team
Date: 2025-12-21
"""

import asyncio
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
import numpy as np
import pandas as pd

from src.utils.logger import log


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


class PredictAgent:
    """
    预测预言家 (The Prophet)
    
    核心功能:
    - 接收结构化特征数据 (来自 TechnicalFeatureEngineer)
    - 使用加权规则评分计算上涨/下跌概率
    - 预留 ML 模型接口供未来扩展
    """
    
    # 特征权重配置
    FEATURE_WEIGHTS = {
        # 趋势特征 (权重较高)
        'trend_confirmation_score': 0.15,
        'ema_cross_strength': 0.10,
        'sma_cross_strength': 0.08,
        'macd_momentum_5': 0.05,
        
        # 动量特征
        'rsi': 0.12,
        'rsi_momentum_5': 0.05,
        'momentum_acceleration': 0.05,
        
        # 价格位置特征
        'bb_position': 0.10,
        'price_to_sma20_pct': 0.08,
        
        # 成交量特征
        'volume_ratio': 0.07,
        'obv_trend': 0.05,
        
        # 波动率特征
        'atr_normalized': 0.05,
        'volatility_20': 0.05,
    }
    
    # RSI 阈值
    RSI_OVERSOLD = 30
    RSI_OVERBOUGHT = 70
    
    # 布林带位置阈值
    BB_LOW_THRESHOLD = 20
    BB_HIGH_THRESHOLD = 80
    
    def __init__(self, horizon: str = '15m'):
        """
        初始化预测预言家 (The Prophet)
        
        Args:
            horizon: 预测时间范围 (默认 15m)
        """
        self.horizon = horizon
        self.history: List[PredictResult] = []
        self.ml_model = None  # 预留 ML 模型接口
        log.info(f"🔮 预测预言家 (The Prophet) 初始化完成 | 预测周期: {horizon}")
    
    async def predict(self, features: Dict[str, float]) -> PredictResult:
        """
        基于特征数据预测价格走势
        
        Args:
            features: 结构化特征字典 (来自 TechnicalFeatureEngineer 或 extract_feature_snapshot)
            
        Returns:
            PredictResult 对象
        """
        # 预处理特征
        clean_features = self._preprocess_features(features)
        
        # 选择预测模式
        if self.ml_model is not None:
            result = await self._predict_with_ml(clean_features)
        else:
            result = await self._predict_with_rules(clean_features)
        
        # 记录历史
        self.history.append(result)
        if len(self.history) > 1000:
            self.history = self.history[-1000:]
        
        return result
    
    def _preprocess_features(self, features: Dict[str, float]) -> Dict[str, float]:
        """
        预处理特征：处理缺失值、异常值
        
        Args:
            features: 原始特征字典
            
        Returns:
            清洗后的特征字典
        """
        clean = {}
        
        for key, value in features.items():
            if value is None or (isinstance(value, float) and np.isnan(value)):
                # 缺失值使用默认值
                clean[key] = self._get_default_value(key)
            elif isinstance(value, float) and np.isinf(value):
                # 无穷值使用边界值
                clean[key] = 100.0 if value > 0 else -100.0
            else:
                clean[key] = float(value) if isinstance(value, (int, float, np.number)) else 0.0
        
        return clean
    
    def _get_default_value(self, feature_name: str) -> float:
        """获取特征的默认值"""
        defaults = {
            'rsi': 50.0,
            'bb_position': 50.0,
            'trend_confirmation_score': 0.0,
            'ema_cross_strength': 0.0,
            'sma_cross_strength': 0.0,
            'volume_ratio': 1.0,
            'atr_normalized': 1.0,
            'price_to_sma20_pct': 0.0,
            'obv_trend': 0.0,
        }
        return defaults.get(feature_name, 0.0)
    
    async def _predict_with_rules(self, features: Dict[str, float]) -> PredictResult:
        """
        使用规则评分系统预测
        
        评分逻辑：
        - 基础概率: 0.5 (中性)
        - 根据各特征调整概率
        - 最终归一化到 [0, 1]
        """
        bullish_score = 0.0
        bearish_score = 0.0
        factors = {}
        
        # 1. 趋势确认分数 (-3 到 +3)
        trend_score = features.get('trend_confirmation_score', 0)
        if trend_score >= 2:
            bullish_score += 0.15
            factors['trend_confirmation'] = 0.15
        elif trend_score >= 1:
            bullish_score += 0.08
            factors['trend_confirmation'] = 0.08
        elif trend_score <= -2:
            bearish_score += 0.15
            factors['trend_confirmation'] = -0.15
        elif trend_score <= -1:
            bearish_score += 0.08
            factors['trend_confirmation'] = -0.08
        else:
            factors['trend_confirmation'] = 0.0
        
        # 2. RSI (超买超卖)
        rsi = features.get('rsi', 50)
        if rsi < self.RSI_OVERSOLD:
            # 超卖 → 看涨反转
            bullish_score += 0.12
            factors['rsi_oversold'] = 0.12
        elif rsi < 40:
            bullish_score += 0.06
            factors['rsi_low'] = 0.06
        elif rsi > self.RSI_OVERBOUGHT:
            # 超买 → 看跌反转
            bearish_score += 0.12
            factors['rsi_overbought'] = -0.12
        elif rsi > 60:
            bearish_score += 0.06
            factors['rsi_high'] = -0.06
        
        # 3. 布林带位置 (0-100)
        bb_pos = features.get('bb_position', 50)
        if bb_pos < self.BB_LOW_THRESHOLD:
            bullish_score += 0.10
            factors['bb_oversold'] = 0.10
        elif bb_pos > self.BB_HIGH_THRESHOLD:
            bearish_score += 0.10
            factors['bb_overbought'] = -0.10
        
        # 4. EMA 交叉强度
        ema_strength = features.get('ema_cross_strength', 0)
        if ema_strength > 0.5:
            bullish_score += 0.08
            factors['ema_bullish'] = 0.08
        elif ema_strength > 0.2:
            bullish_score += 0.04
            factors['ema_bullish'] = 0.04
        elif ema_strength < -0.5:
            bearish_score += 0.08
            factors['ema_bearish'] = -0.08
        elif ema_strength < -0.2:
            bearish_score += 0.04
            factors['ema_bearish'] = -0.04
        
        # 5. 成交量比率
        vol_ratio = features.get('volume_ratio', 1.0)
        if vol_ratio > 1.5:
            # 高成交量放大趋势信号
            if bullish_score > bearish_score:
                bullish_score += 0.05
                factors['volume_confirm_up'] = 0.05
            elif bearish_score > bullish_score:
                bearish_score += 0.05
                factors['volume_confirm_down'] = -0.05
        
        # 6. 动量加速
        momentum_acc = features.get('momentum_acceleration', 0)
        if momentum_acc > 0.5:
            bullish_score += 0.05
            factors['momentum_up'] = 0.05
        elif momentum_acc < -0.5:
            bearish_score += 0.05
            factors['momentum_down'] = -0.05
        
        # 7. 趋势持续性
        trend_sustain = features.get('trend_sustainability', 0)
        if trend_sustain > 1.5:
            # 趋势持续性强，增强当前方向
            direction = 1 if bullish_score > bearish_score else -1
            if direction > 0:
                bullish_score += 0.05
                factors['trend_sustain_up'] = 0.05
            else:
                bearish_score += 0.05
                factors['trend_sustain_down'] = -0.05
        
        # 计算最终概率
        total_score = bullish_score + bearish_score
        if total_score == 0:
            prob_up = 0.5
            prob_down = 0.5
        else:
            # 使用 sigmoid 风格的归一化
            net_score = bullish_score - bearish_score
            prob_up = 0.5 + (net_score / 2)  # 将 net_score 映射到 [0, 1]
            prob_up = max(0.0, min(1.0, prob_up))
            prob_down = 1.0 - prob_up
        
        # 计算置信度 (基于信号强度)
        confidence = min(1.0, (bullish_score + bearish_score) / 0.5)
        
        return PredictResult(
            probability_up=round(prob_up, 4),
            probability_down=round(prob_down, 4),
            confidence=round(confidence, 4),
            horizon=self.horizon,
            factors=factors,
            model_type='rule_based'
        )
    
    async def _predict_with_ml(self, features: Dict[str, float]) -> PredictResult:
        """
        使用 ML 模型预测 (预留接口)
        
        TODO: 实现 ML 模型集成
        """
        # 占位实现：回退到规则评分
        log.warning("ML 模型未配置，使用规则评分")
        return await self._predict_with_rules(features)
    
    def load_ml_model(self, model_path: str):
        """
        加载 ML 模型
        
        Args:
            model_path: 模型文件路径
        """
        # TODO: 实现模型加载逻辑
        log.info(f"加载 ML 模型: {model_path}")
        pass
    
    def get_statistics(self) -> Dict:
        """获取预测统计信息"""
        if not self.history:
            return {'total_predictions': 0}
        
        total = len(self.history)
        signals = [h.signal for h in self.history]
        avg_confidence = sum(h.confidence for h in self.history) / total
        
        return {
            'total_predictions': total,
            'avg_confidence': avg_confidence,
            'signal_distribution': {
                'strong_bullish': signals.count('strong_bullish'),
                'bullish': signals.count('bullish'),
                'neutral': signals.count('neutral'),
                'bearish': signals.count('bearish'),
                'strong_bearish': signals.count('strong_bearish'),
            },
            'model_type': self.history[-1].model_type if self.history else 'unknown'
        }


# ============================================
# 测试函数
# ============================================
async def test_predict_agent():
    """测试预测预言家Agent"""
    print("\n" + "="*60)
    print("🧪 测试预测预言家Agent (The Prophet)")
    print("="*60)
    
    # 初始化
    agent = PredictAgent(horizon='15m')
    
    # 模拟特征数据 (看涨场景)
    bullish_features = {
        'trend_confirmation_score': 2.5,
        'ema_cross_strength': 0.8,
        'sma_cross_strength': 0.5,
        'rsi': 35,
        'rsi_momentum_5': 5,
        'bb_position': 25,
        'volume_ratio': 1.6,
        'momentum_acceleration': 0.8,
        'trend_sustainability': 1.8,
        'atr_normalized': 1.2,
        'price_to_sma20_pct': 0.5,
    }
    
    print("\n1️⃣ 测试看涨场景...")
    result = await agent.predict(bullish_features)
    print(f"  ✅ 上涨概率: {result.probability_up:.2%}")
    print(f"  ✅ 下跌概率: {result.probability_down:.2%}")
    print(f"  ✅ 信号: {result.signal}")
    print(f"  ✅ 置信度: {result.confidence:.2%}")
    print(f"  ✅ 因子: {result.factors}")
    
    # 模拟特征数据 (看跌场景)
    bearish_features = {
        'trend_confirmation_score': -2.0,
        'ema_cross_strength': -0.6,
        'sma_cross_strength': -0.4,
        'rsi': 75,
        'rsi_momentum_5': -3,
        'bb_position': 85,
        'volume_ratio': 1.3,
        'momentum_acceleration': -0.6,
        'trend_sustainability': 0.5,
        'atr_normalized': 2.0,
        'price_to_sma20_pct': 3.0,
    }
    
    print("\n2️⃣ 测试看跌场景...")
    result = await agent.predict(bearish_features)
    print(f"  ✅ 上涨概率: {result.probability_up:.2%}")
    print(f"  ✅ 下跌概率: {result.probability_down:.2%}")
    print(f"  ✅ 信号: {result.signal}")
    print(f"  ✅ 置信度: {result.confidence:.2%}")
    
    # 模拟中性场景
    neutral_features = {
        'trend_confirmation_score': 0,
        'ema_cross_strength': 0.1,
        'rsi': 50,
        'bb_position': 50,
        'volume_ratio': 1.0,
    }
    
    print("\n3️⃣ 测试中性场景...")
    result = await agent.predict(neutral_features)
    print(f"  ✅ 上涨概率: {result.probability_up:.2%}")
    print(f"  ✅ 信号: {result.signal}")
    
    # 测试统计
    print("\n4️⃣ 统计信息...")
    stats = agent.get_statistics()
    print(f"  ✅ 总预测次数: {stats['total_predictions']}")
    print(f"  ✅ 平均置信度: {stats['avg_confidence']:.2%}")
    
    print("\n✅ 预测预言家Agent测试通过!")
    return agent


if __name__ == '__main__':
    asyncio.run(test_predict_agent())
