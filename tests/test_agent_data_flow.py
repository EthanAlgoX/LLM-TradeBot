"""
Integration tests for Multi-Agent Data Flow
Validates proper data format and structure across agents.
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import asyncio
import pandas as pd
import numpy as np
from dataclasses import dataclass, field
from typing import Dict, List
from datetime import datetime


# Mock MarketSnapshot for testing
@dataclass
class MockMarketSnapshot:
    """Mock market snapshot for testing agents"""
    stable_5m: pd.DataFrame
    live_5m: Dict
    stable_15m: pd.DataFrame
    live_15m: Dict
    stable_1h: pd.DataFrame
    live_1h: Dict
    timestamp: datetime
    alignment_ok: bool
    fetch_duration: float
    quant_data: Dict = field(default_factory=dict)
    binance_funding: Dict = field(default_factory=dict)
    binance_oi: Dict = field(default_factory=dict)
    raw_5m: List[Dict] = field(default_factory=list)
    raw_15m: List[Dict] = field(default_factory=list)
    raw_1h: List[Dict] = field(default_factory=list)
    symbol: str = "BTCUSDT"


def create_mock_df(n=100, start_price=100000.0, freq='5T'):
    """Create a realistic mock DataFrame for testing"""
    idx = pd.date_range(end=pd.Timestamp.utcnow().floor('T'), periods=n, freq=freq)
    prices = start_price + np.cumsum(np.random.randn(n) * 100)
    
    df = pd.DataFrame({
        'open': prices,
        'high': prices + np.abs(np.random.randn(n) * 50),
        'low': prices - np.abs(np.random.randn(n) * 50),
        'close': prices + np.random.randn(n) * 20,
        'volume': np.abs(np.random.randn(n) * 1000)
    })
    df.index = idx
    return df


def create_mock_snapshot():
    """Create a complete mock snapshot for testing"""
    return MockMarketSnapshot(
        stable_5m=create_mock_df(100, freq='5T'),
        live_5m={'open': 100000, 'high': 100100, 'low': 99900, 'close': 100050, 'volume': 500},
        stable_15m=create_mock_df(100, freq='15T'),
        live_15m={'open': 100000, 'high': 100100, 'low': 99900, 'close': 100030, 'volume': 1500},
        stable_1h=create_mock_df(100, freq='1H'),
        live_1h={'open': 100000, 'high': 100200, 'low': 99800, 'close': 100080, 'volume': 6000},
        timestamp=datetime.now(),
        alignment_ok=True,
        fetch_duration=0.5,
        quant_data={
            'netflow': {
                'institution': {
                    'future': {'1h': 1000000, '15m': 500000}
                }
            }
        },
        binance_funding={'funding_rate': 0.0001},
        binance_oi={'open_interest': 50000}
    )


class TestOscillatorSubAgentDataFlow:
    """Test oscillator outputs in QuantAnalystAgent"""
    
    def test_oscillator_returns_all_timeframe_scores(self):
        """Verify all 3 timeframe scores are returned"""
        from src.agents.quant_analyst_agent import QuantAnalystAgent

        agent = QuantAnalystAgent()
        snapshot = create_mock_snapshot()
        result = asyncio.run(agent.analyze_all_timeframes(snapshot))
        oscillator = result["oscillator"]

        # Check required keys exist
        assert 'osc_5m_score' in oscillator, "Missing osc_5m_score"
        assert 'osc_15m_score' in oscillator, "Missing osc_15m_score"
        assert 'osc_1h_score' in oscillator, "Missing osc_1h_score"
        assert 'total_osc_score' in oscillator, "Missing total_osc_score"
        
    def test_oscillator_scores_in_valid_range(self):
        """Verify scores are within expected range"""
        from src.agents.quant_analyst_agent import QuantAnalystAgent

        agent = QuantAnalystAgent()
        snapshot = create_mock_snapshot()
        result = asyncio.run(agent.analyze_all_timeframes(snapshot))
        oscillator = result["oscillator"]

        for key in ['osc_5m_score', 'osc_15m_score', 'osc_1h_score', 'total_osc_score']:
            assert -100 <= oscillator[key] <= 100, f"{key} out of range: {oscillator[key]}"


class TestSentimentSubAgentDataFlow:
    """Test sentiment outputs in QuantAnalystAgent"""
    
    def test_sentiment_returns_consistent_structure(self):
        """Verify structure matches other sub-agents"""
        from src.agents.quant_analyst_agent import QuantAnalystAgent

        agent = QuantAnalystAgent()
        snapshot = create_mock_snapshot()
        result = agent._analyze_sentiment(snapshot)
        
        # Check required keys exist (matching other agents)
        assert 'score' in result, "Missing 'score' key"
        assert 'details' in result, "Missing 'details' key"
        assert 'total_sentiment_score' in result, "Missing 'total_sentiment_score' key"
        
    def test_sentiment_score_equals_total(self):
        """Verify score and total_sentiment_score match"""
        from src.agents.quant_analyst_agent import QuantAnalystAgent

        agent = QuantAnalystAgent()
        snapshot = create_mock_snapshot()
        result = agent._analyze_sentiment(snapshot)
        
        assert result['score'] == result['total_sentiment_score']


class TestQuantAnalystAgentIntegration:
    """Test full QuantAnalystAgent integration"""
    
    def test_full_analysis_returns_all_components(self):
        """Verify analyze_all_timeframes returns complete structure"""
        from src.agents.quant_analyst_agent import QuantAnalystAgent
        
        agent = QuantAnalystAgent()
        snapshot = create_mock_snapshot()
        result = asyncio.run(agent.analyze_all_timeframes(snapshot))
        
        # Check top-level keys
        assert 'trend' in result
        assert 'oscillator' in result
        assert 'sentiment' in result
        
        # Check granular scores are accessible
        assert 'trend_1h_score' in result['trend']
        assert 'trend_15m_score' in result['trend']
        assert 'osc_5m_score' in result['oscillator']
        assert 'osc_15m_score' in result['oscillator']
        assert 'osc_1h_score' in result['oscillator']
        assert 'total_sentiment_score' in result['sentiment']


class TestDecisionCoreAgentIntegration:
    """Test DecisionCoreAgent with proper quant_analysis format"""
    
    def test_make_decision_with_correct_format(self):
        """Verify make_decision works with new quant_analysis format"""
        from src.agents.quant_analyst_agent import QuantAnalystAgent
        from src.agents.decision_core.decision_core_agent import DecisionCoreAgent
        
        quant_agent = QuantAnalystAgent()
        decision_agent = DecisionCoreAgent()
        
        snapshot = create_mock_snapshot()
        quant_analysis = asyncio.run(quant_agent.analyze_all_timeframes(snapshot))
        
        # Prepare market_data
        market_data = {
            'df_5m': snapshot.stable_5m,
            'df_15m': snapshot.stable_15m,
            'df_1h': snapshot.stable_1h,
            'current_price': snapshot.live_5m.get('close', 100000)
        }
        
        # Should not raise any KeyError
        vote_result = asyncio.run(
            decision_agent.make_decision(quant_analysis, market_data=market_data)
        )
        
        assert vote_result is not None
        assert hasattr(vote_result, 'action')
        assert hasattr(vote_result, 'confidence')
        assert hasattr(vote_result, 'reason')
        
    def test_generate_reason_no_keyerror(self):
        """Verify _generate_reason doesn't throw KeyError"""
        from src.agents.quant_analyst_agent import QuantAnalystAgent
        from src.agents.decision_core.decision_core_agent import DecisionCoreAgent
        
        quant_agent = QuantAnalystAgent()
        decision_agent = DecisionCoreAgent()
        
        snapshot = create_mock_snapshot()
        quant_analysis = asyncio.run(quant_agent.analyze_all_timeframes(snapshot))
        
        # Directly test _generate_reason
        reason = decision_agent._generate_reason(
            weighted_score=45.5,
            aligned=True,
            alignment_reason="三周期强势多头对齐",
            quant_analysis=quant_analysis,
            regime={'regime': 'trending_up'}
        )
        
        assert isinstance(reason, str)
        assert len(reason) > 0
        print(f"Generated reason: {reason}")
