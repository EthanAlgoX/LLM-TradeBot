"""
Agent Configuration Module
===========================

Provides centralized configuration for optional agents.
Core agents (DataSyncAgent, QuantAnalystAgent, RiskAuditAgent) are always enabled.
"""

from dataclasses import dataclass, field
from typing import Dict, Optional, Any


@dataclass
class AgentConfig:
    """
    Configuration for optional agents.
    
    Core agents are always enabled and not configurable:
    - DataSyncAgent: Market data fetching
    - QuantAnalystAgent: Technical analysis
    - RiskAuditAgent: Risk control
    
    Optional agents can be enabled/disabled via config.
    """
    
    # ML/AI Prediction Layer
    predict_agent: bool = True              # PredictAgent: ML probability prediction
    ai_prediction_filter_agent: bool = True  # AIPredictionFilterAgent: AI veto mechanism
    
    # Market Analysis
    regime_detector_agent: bool = True       # RegimeDetectorAgent: Market state detection
    position_analyzer_agent: bool = False    # PositionAnalyzerAgent: Price position analysis
    
    # Trigger Detection
    trigger_detector_agent: bool = True      # TriggerDetectorAgent: 5m pattern detection
    
    # LLM Semantic Analysis (expensive, disabled by default)
    trend_agent_llm: bool = False            # TrendAgentLLM: 1h trend LLM analysis
    setup_agent_llm: bool = False            # SetupAgentLLM: 15m setup LLM analysis
    trigger_agent_llm: bool = False          # TriggerAgentLLM: 5m trigger LLM analysis
    
    # Local Semantic Analysis (no LLM)
    trend_agent_local: bool = True           # TrendAgent: 1h trend rule-based analysis
    setup_agent_local: bool = True           # SetupAgent: 15m setup rule-based analysis
    trigger_agent_local: bool = True         # TriggerAgent: 5m trigger rule-based analysis
    
    # Trading Retrospection
    reflection_agent_llm: bool = False       # ReflectionAgentLLM: Trade reflection via LLM
    reflection_agent_local: bool = True      # ReflectionAgent: Rule-based reflection
    
    # Symbol Selection
    symbol_selector_agent: bool = False      # SymbolSelectorAgent: AUTO3 selection
    
    def __post_init__(self):
        """Validate dependencies between agents"""
        # AIPredictionFilterAgent requires PredictAgent
        if self.ai_prediction_filter_agent and not self.predict_agent:
            self.ai_prediction_filter_agent = False
    
    @classmethod
    def from_dict(cls, config: Dict[str, Any]) -> 'AgentConfig':
        """
        Create AgentConfig from a dictionary (e.g., from config.yaml)
        
        Environment variables take priority over config values.
        Use AGENT_<NAME>=true/false to override, e.g., AGENT_PREDICT_AGENT=false
        
        Args:
            config: Dictionary with agent enable/disable settings
            
        Returns:
            AgentConfig instance
        """
        import os
        agents_config = config.get('agents', {})

        def get_value_optional(key: str) -> Optional[bool]:
            """Get value from env var (priority) or config or None if unset"""
            env_key = f"AGENT_{key.upper()}"
            env_val = os.environ.get(env_key)
            if env_val is not None:
                return env_val.lower() in ('true', '1', 'yes', 'on')
            if key in agents_config:
                return agents_config.get(key)
            return None

        def resolve_flag(key: str, default: bool) -> bool:
            val = get_value_optional(key)
            if val is None:
                return default
            return bool(val)

        def resolve_llm_flag(new_key: str, legacy_key: str, default: bool) -> bool:
            val = get_value_optional(new_key)
            if val is not None:
                return bool(val)
            legacy_val = get_value_optional(legacy_key)
            if legacy_val is not None:
                return bool(legacy_val)
            return default
        
        # Map config keys to dataclass fields
        return cls(
            predict_agent=resolve_flag('predict_agent', True),
            ai_prediction_filter_agent=resolve_flag('ai_prediction_filter_agent', True),
            regime_detector_agent=resolve_flag('regime_detector_agent', True),
            position_analyzer_agent=resolve_flag('position_analyzer_agent', False),
            trigger_detector_agent=resolve_flag('trigger_detector_agent', True),
            trend_agent_llm=resolve_llm_flag('trend_agent_llm', 'trend_agent', False),
            setup_agent_llm=resolve_llm_flag('setup_agent_llm', 'setup_agent', False),
            trigger_agent_llm=resolve_llm_flag('trigger_agent_llm', 'trigger_agent', False),
            trend_agent_local=resolve_flag('trend_agent_local', True),
            setup_agent_local=resolve_flag('setup_agent_local', True),
            trigger_agent_local=resolve_flag('trigger_agent_local', True),
            reflection_agent_llm=resolve_llm_flag('reflection_agent_llm', 'reflection_agent', False),
            reflection_agent_local=resolve_flag('reflection_agent_local', True),
            symbol_selector_agent=resolve_flag('symbol_selector_agent', False),
        )
    
    def is_enabled(self, agent_name: str) -> bool:
        """
        Check if an agent is enabled by name.
        
        Args:
            agent_name: Agent name (e.g., 'predict_agent', 'regime_detector_agent')
            
        Returns:
            True if enabled, False otherwise
        """
        # Convert CamelCase to snake_case if needed
        if not agent_name.endswith('_agent') and any(c.isupper() for c in agent_name):
            name = ''.join(['_' + c.lower() if c.isupper() else c for c in agent_name]).lstrip('_')
        else:
            name = agent_name
            
        return getattr(self, name, False)
    
    def get_enabled_agents(self) -> Dict[str, bool]:
        """Get dictionary of all agent enabled states"""
        return {
            'predict_agent': self.predict_agent,
            'ai_prediction_filter_agent': self.ai_prediction_filter_agent,
            'regime_detector_agent': self.regime_detector_agent,
            'position_analyzer_agent': self.position_analyzer_agent,
            'trigger_detector_agent': self.trigger_detector_agent,
            'trend_agent_llm': self.trend_agent_llm,
            'setup_agent_llm': self.setup_agent_llm,
            'trigger_agent_llm': self.trigger_agent_llm,
            'trend_agent_local': self.trend_agent_local,
            'setup_agent_local': self.setup_agent_local,
            'trigger_agent_local': self.trigger_agent_local,
            'reflection_agent_llm': self.reflection_agent_llm,
            'reflection_agent_local': self.reflection_agent_local,
            'symbol_selector_agent': self.symbol_selector_agent,
        }
    
    def __str__(self) -> str:
        enabled = [k for k, v in self.get_enabled_agents().items() if v]
        disabled = [k for k, v in self.get_enabled_agents().items() if not v]
        return f"AgentConfig(enabled={enabled}, disabled={disabled})"
