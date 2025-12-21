"""
Tests for PredictAgent
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest
import asyncio
import numpy as np
from src.agents.predict_agent import PredictAgent, PredictResult


class TestPredictResult:
    """Test PredictResult dataclass"""
    
    def test_signal_strong_bullish(self):
        result = PredictResult(
            probability_up=0.70,
            probability_down=0.30,
            confidence=0.8,
            horizon='15m',
            factors={},
            model_type='rule_based'
        )
        assert result.signal == 'strong_bullish'
    
    def test_signal_strong_bearish(self):
        result = PredictResult(
            probability_up=0.25,
            probability_down=0.75,
            confidence=0.8,
            horizon='15m',
            factors={},
            model_type='rule_based'
        )
        assert result.signal == 'strong_bearish'
    
    def test_signal_neutral(self):
        result = PredictResult(
            probability_up=0.50,
            probability_down=0.50,
            confidence=0.5,
            horizon='15m',
            factors={},
            model_type='rule_based'
        )
        assert result.signal == 'neutral'
    
    def test_to_dict(self):
        result = PredictResult(
            probability_up=0.60,
            probability_down=0.40,
            confidence=0.7,
            horizon='15m',
            factors={'trend': 0.1},
            model_type='rule_based'
        )
        d = result.to_dict()
        assert 'probability_up' in d
        assert 'signal' in d
        assert d['probability_up'] == 0.60


class TestPredictAgentPreprocessing:
    """Test feature preprocessing"""
    
    def test_handles_missing_values(self):
        agent = PredictAgent()
        features = {'rsi': None, 'volume_ratio': np.nan}
        clean = agent._preprocess_features(features)
        
        assert clean['rsi'] == 50.0  # default RSI
        assert clean['volume_ratio'] == 1.0  # default volume ratio
    
    def test_handles_inf_values(self):
        agent = PredictAgent()
        features = {'rsi': np.inf, 'bb_position': -np.inf}
        clean = agent._preprocess_features(features)
        
        assert clean['rsi'] == 100.0
        assert clean['bb_position'] == -100.0


class TestPredictAgentPrediction:
    """Test prediction logic"""
    
    def test_bullish_prediction(self):
        agent = PredictAgent()
        features = {
            'trend_confirmation_score': 2.5,
            'rsi': 30,
            'bb_position': 15,
            'ema_cross_strength': 0.8,
            'volume_ratio': 1.6,
        }
        
        result = asyncio.run(agent.predict(features))
        
        assert result.probability_up > 0.6
        assert result.signal in ['bullish', 'strong_bullish']
    
    def test_bearish_prediction(self):
        agent = PredictAgent()
        features = {
            'trend_confirmation_score': -2.5,
            'rsi': 75,
            'bb_position': 85,
            'ema_cross_strength': -0.8,
        }
        
        result = asyncio.run(agent.predict(features))
        
        assert result.probability_down > 0.6
        assert result.signal in ['bearish', 'strong_bearish']
    
    def test_probability_bounds(self):
        agent = PredictAgent()
        
        # Extreme bullish
        features = {
            'trend_confirmation_score': 3,
            'rsi': 20,
            'bb_position': 5,
            'ema_cross_strength': 1.0,
            'volume_ratio': 2.0,
        }
        result = asyncio.run(agent.predict(features))
        
        assert 0.0 <= result.probability_up <= 1.0
        assert 0.0 <= result.probability_down <= 1.0
        assert abs(result.probability_up + result.probability_down - 1.0) < 0.01


class TestPredictAgentStatistics:
    """Test statistics tracking"""
    
    def test_history_tracking(self):
        agent = PredictAgent()
        
        for i in range(5):
            asyncio.run(agent.predict({'rsi': 50}))
        
        stats = agent.get_statistics()
        assert stats['total_predictions'] == 5


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
