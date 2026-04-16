"""
Reflection Agent - The Philosopher
===================================

Trading retrospection agent that analyzes every 10 completed trades
and provides actionable insights to improve future decisions.
"""

from typing import Dict, List, Optional
from abc import ABC, abstractmethod

from .reflection_result import ReflectionResult

class ReflectionAgent(ABC):
    def __init__(self):
        self.reflection_count = 0

    @abstractmethod
    def should_reflect(self, total_trades: int) -> bool:
        pass

    @abstractmethod
    async def generate_reflection(self, trades: List[Dict]) -> Optional[ReflectionResult]:
        pass

    @abstractmethod
    def get_latest_reflection(self) -> Optional[str]:
        pass

    def get_user_prompt(self, trades: List[Dict]) -> Optional[str]:
        return None

    def get_system_prompt(self) -> Optional[str]:
        return None

