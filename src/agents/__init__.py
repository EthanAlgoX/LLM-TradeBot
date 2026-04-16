"""
Multi-Agent Trading System

基于异步并发的多Agent交易架构

Core Agents (always enabled):
- DataSyncAgent: Market data fetching
- QuantAnalystAgent: Technical analysis
- RiskAuditAgent: Risk control

Optional Agents (configurable via AgentConfig):
- PredictAgent, ReflectionAgent, RegimeDetectorAgent, etc.
"""

from .agent_config import AgentConfig
from .base_agent import BaseAgent, AgentResult
from .agent_registry import AgentRegistry
from .agent_provider import AgentProvider

from .quant_analyst_agent import QuantAnalystAgent
from .decision_core.decision_core_agent import DecisionCoreAgent, VoteResult, SignalWeight
from .risk_audit_agent import RiskAuditAgent, RiskCheckResult, PositionInfo, RiskLevel

from .multi_period_agent import MultiPeriodParserAgent
from .regime_detector_agent import RegimeDetector

from .predict import PredictResult, PredictAgent
from .data_sync import MarketSnapshot

__all__ = [
    # Framework
    'AgentConfig',
    'AgentProvider',
    'BaseAgent',
    'AgentResult',
    'AgentRegistry',
    # Core Agents
    'QuantAnalystAgent',
    'DecisionCoreAgent',
    'VoteResult',
    'SignalWeight',
    'RiskAuditAgent',
    'RiskCheckResult',
    'PositionInfo',
    'RiskLevel',
    # Optional Agents
    'MultiPeriodParserAgent',
    'RegimeDetector',
    'PredictAgent',
    'PredictResult',
    'MarketSnapshot'
]
