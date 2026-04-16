from typing import Dict, List, Optional
from dataclasses import dataclass

from .risk_level import RiskLevel

@dataclass
class RiskCheckResult:
    """风控检查结果"""
    passed: bool  # 是否通过
    risk_level: RiskLevel
    blocked_reason: Optional[str] = None  # 拦截原因（如果未通过）
    corrections: Optional[Dict] = None  # 自动修正内容
    warnings: List[str] = None  # 警告信息
