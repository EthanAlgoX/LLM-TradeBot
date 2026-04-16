"""
AI Prediction Filter (Layer 2 of Four-Layer Strategy)

Purpose:
- Acts as hard filter when AI confidence > threshold
- Detects trend-AI divergences
- Prevents counter-trend entries
- Boosts confidence on perfect resonance

Key Logic:
- AI Veto: Blocks trade if AI predicts opposite direction with high confidence
- Confidence Boost: Increases confidence when AI confirms trend
- Low Confidence: Falls back to technical analysis when AI uncertain
"""

from typing import Dict
from src.agents.predict import PredictResult
from src.utils.logger import log


class AIPredictionFilter:
    """
    AI 30min Prediction Filter
    
    Acts as second layer in four-layer trading strategy.
    Prevents entries against predicted short-term moves.
    """
    
    def __init__(self, 
                 veto_threshold: float = 0.40,  # Specification: 40% (Hard Veto)
                 low_confidence_threshold: float = 0.40):  # Specification: <40% = Reference Only
        """
        Initialize AI prediction filter
        
        Args:
            veto_threshold: Confidence threshold for hard veto (40% per spec)
            low_confidence_threshold: Below this, AI is reference only (40% per spec)
        """
        self.veto_threshold = veto_threshold
        self.low_confidence_threshold = low_confidence_threshold
    
    def check_divergence(self, 
                        trend_1h: str,
                        ai_prediction: PredictResult) -> Dict:
        """
        Check for trend-AI divergence and apply filter logic
        
        Args:
            trend_1h: '1h trend direction ('long', 'short', 'neutral')
            ai_prediction: PredictResult from PredictAgent
            
        Returns:
            {
                'allow_trade': bool,           # Whether to allow trade
                'reason': str,                 # Explanation
                'confidence_boost': float,     # -50 to +20
                'ai_veto': bool,              # Hard veto flag
                'ai_signal': str,             # 'bullish' or 'bearish'
                'ai_confidence': float        # 0-1
            }
        """
        # Extract AI signal
        prob_up = ai_prediction.probability_up
        ai_signal = 'bullish' if prob_up > 0.5 else 'bearish'
        ai_conf = ai_prediction.confidence
        
        log.info(f"🤖 AI Filter Check: Trend={trend_1h}, AI={ai_signal} ({prob_up:.1%}), Conf={ai_conf:.1%}")
        
        # Scenario 1: Low AI Confidence - Use Technical Only
        if ai_conf < self.low_confidence_threshold:
            return {
                'allow_trade': True,
                'reason': f'AI confidence low ({ai_conf:.0%}), use technical analysis only',
                'confidence_boost': 0,
                'ai_veto': False,
                'ai_signal': ai_signal,
                'ai_confidence': ai_conf
            }
        
        # Scenario 2: Perfect Resonance - Boost Confidence
        if (trend_1h == 'long' and ai_signal == 'bullish') or \
           (trend_1h == 'short' and ai_signal == 'bearish'):
            log.info(f"✅ Perfect Trend-AI Resonance: {trend_1h.upper()} + AI {ai_signal.upper()}")
            return {
                'allow_trade': True,
                'reason': f'Perfect resonance: {trend_1h} trend + AI {ai_signal} ({ai_conf:.0%})',
                'confidence_boost': +20,
                'ai_veto': False,
                'ai_signal': ai_signal,
                'ai_confidence': ai_conf
            }
        
        # Scenario 3: Divergence with High Confidence - HARD VETO
        if ai_conf > self.veto_threshold:
            log.warning(f"🚫 AI VETO: Trend={trend_1h} but AI predicts {ai_signal} with {ai_conf:.0%} confidence")
            return {
                'allow_trade': False,
                'reason': f'AI veto: predicts {ai_signal} against {trend_1h} trend (conf {ai_conf:.0%})',
                'confidence_boost': -50,
                'ai_veto': True,
                'ai_signal': ai_signal,
                'ai_confidence': ai_conf
            }
        
        # Scenario 4: Divergence with Medium Confidence - Warning
        log.warning(f"⚠️ AI-Trend Divergence: {trend_1h} vs {ai_signal}, but confidence only {ai_conf:.0%}")
        return {
            'allow_trade': True,
            'reason': f'AI-trend divergence ({ai_conf:.0%}), proceed with caution',
            'confidence_boost': -10,
            'ai_veto': False,
            'ai_signal': ai_signal,
            'ai_confidence': ai_conf
        }
    
    def get_resonance_quality(self, 
                             trend_1h: str,
                             ai_prediction: PredictResult) -> str:
        """
        Get human-readable resonance quality
        
        Returns:
            'perfect' | 'divergence' | 'neutral' | 'uncertain'
        """
        result = self.check_divergence(trend_1h, ai_prediction)
        
        if result['ai_confidence'] < self.low_confidence_threshold:
            return 'uncertain'
        elif result['confidence_boost'] > 10:
            return 'perfect'
        elif result['ai_veto']:
            return 'divergence'
        else:
            return 'neutral'
