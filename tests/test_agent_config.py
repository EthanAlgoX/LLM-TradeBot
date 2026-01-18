"""
Unit tests for Agent Configuration Module
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest
from src.agents.agent_config import AgentConfig


class TestAgentConfigDefaults:
    """Test AgentConfig default values"""
    
    def test_default_enabled_agents(self):
        """Test that correct agents are enabled by default"""
        config = AgentConfig()
        
        # Should be enabled by default
        assert config.predict_agent is True
        assert config.ai_prediction_filter_agent is True
        assert config.regime_detector_agent is True
        assert config.reflection_agent_llm is False
        assert config.reflection_agent_local is True
        assert config.trigger_detector_agent is True
        
    def test_default_disabled_agents(self):
        """Test that correct agents are disabled by default"""
        config = AgentConfig()
        
        # Should be disabled by default
        assert config.trend_agent_llm is False
        assert config.setup_agent_llm is False
        assert config.trigger_agent_llm is False
        assert config.trend_agent_local is True
        assert config.setup_agent_local is True
        assert config.trigger_agent_local is True
        assert config.position_analyzer_agent is False
        assert config.symbol_selector_agent is False


class TestAgentConfigFromDict:
    """Test AgentConfig.from_dict() loading"""
    
    def test_empty_config(self):
        """Empty config should use defaults"""
        config = AgentConfig.from_dict({})
        assert config.predict_agent is True
        assert config.trend_agent_llm is False
        assert config.trend_agent_local is True
    
    def test_partial_config(self):
        """Partial config should override only specified values"""
        config = AgentConfig.from_dict({
            'agents': {
                'predict_agent': False,
                'trend_agent': True
            }
        })
        
        assert config.predict_agent is False
        assert config.trend_agent_llm is True
        # Others should use defaults
        assert config.reflection_agent_llm is False
        assert config.reflection_agent_local is True
        assert config.trigger_agent_llm is False
    
    def test_full_config(self):
        """Full config should override all values"""
        config = AgentConfig.from_dict({
            'agents': {
                'predict_agent': False,
                'ai_prediction_filter_agent': False,
                'regime_detector_agent': False,
                'position_analyzer_agent': True,
                'trigger_detector_agent': False,
                'trend_agent_llm': True,
                'setup_agent_llm': True,
                'trigger_agent_llm': True,
                'reflection_agent_llm': False,
                'trend_agent_local': True,
                'setup_agent_local': False,
                'trigger_agent_local': True,
                'reflection_agent_local': True,
                'symbol_selector_agent': True
            }
        })
        
        assert config.predict_agent is False
        assert config.ai_prediction_filter_agent is False
        assert config.regime_detector_agent is False
        assert config.position_analyzer_agent is True
        assert config.trigger_detector_agent is False
        assert config.trend_agent_llm is True
        assert config.setup_agent_llm is True
        assert config.trigger_agent_llm is True
        assert config.reflection_agent_llm is False
        assert config.trend_agent_local is True
        assert config.setup_agent_local is False
        assert config.trigger_agent_local is True
        assert config.reflection_agent_local is True
        assert config.symbol_selector_agent is True


class TestAgentConfigDependencies:
    """Test agent dependency validation"""
    
    def test_ai_filter_requires_predict(self):
        """AIPredictionFilterAgent should be disabled if PredictAgent is disabled"""
        config = AgentConfig(
            predict_agent=False,
            ai_prediction_filter_agent=True
        )
        
        # Should be auto-disabled due to dependency
        assert config.ai_prediction_filter_agent is False
    
    def test_ai_filter_enabled_with_predict(self):
        """AIPredictionFilterAgent should be enabled if PredictAgent is enabled"""
        config = AgentConfig(
            predict_agent=True,
            ai_prediction_filter_agent=True
        )
        
        assert config.ai_prediction_filter_agent is True


class TestAgentConfigIsEnabled:
    """Test is_enabled() method"""
    
    def test_is_enabled_snake_case(self):
        """Test is_enabled with snake_case names"""
        config = AgentConfig(predict_agent=True, trend_agent_llm=False)
        
        assert config.is_enabled('predict_agent') is True
        assert config.is_enabled('trend_agent_llm') is False
        assert config.is_enabled('TrendAgentLLM') is False
    
    def test_is_enabled_unknown_agent(self):
        """Test is_enabled with unknown agent returns False"""
        config = AgentConfig()
        
        assert config.is_enabled('unknown_agent') is False


class TestAgentConfigGetEnabledAgents:
    """Test get_enabled_agents() method"""
    
    def test_get_enabled_agents_dict(self):
        """Test get_enabled_agents returns correct dict"""
        config = AgentConfig()
        enabled = config.get_enabled_agents()
        
        assert isinstance(enabled, dict)
        assert 'predict_agent' in enabled
        assert 'trend_agent_llm' in enabled
        assert len(enabled) == 14  # Total number of optional agents


class TestAgentConfigStr:
    """Test __str__() representation"""
    
    def test_str_representation(self):
        """Test string representation shows enabled/disabled lists"""
        config = AgentConfig()
        result = str(config)
        
        assert 'AgentConfig' in result
        assert 'enabled=' in result
        assert 'disabled=' in result


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
