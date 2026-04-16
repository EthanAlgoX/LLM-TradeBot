from enum import Enum

class RiskLevel(Enum):
    """风险等级"""
    SAFE = "safe"
    WARNING = "warning"
    DANGER = "danger"
    FATAL = "fatal"