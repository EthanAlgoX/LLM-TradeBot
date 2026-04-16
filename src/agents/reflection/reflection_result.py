from dataclasses import dataclass
from typing import Dict, List

@dataclass
class ReflectionResult:
    """Result from trading reflection analysis"""
    reflection_id: str
    trades_analyzed: int
    timestamp: str
    summary: str
    patterns: Dict[str, List[str]]
    recommendations: List[str]
    confidence_calibration: str
    market_insights: str
    raw_response: Dict = None
    
    def to_prompt_text(self) -> str:
        """Format reflection for inclusion in Decision Agent prompt"""
        lines = [
            f"**Summary**: {self.summary}",
            "",
            "**Winning Patterns**:",
        ]
        for pattern in self.patterns.get('winning_conditions', [])[:3]:
            lines.append(f"  - {pattern}")
        
        lines.append("")
        lines.append("**Losing Patterns**:")
        for pattern in self.patterns.get('losing_conditions', [])[:3]:
            lines.append(f"  - {pattern}")
        
        lines.append("")
        lines.append("**Recommendations**:")
        for rec in self.recommendations[:3]:
            lines.append(f"  - {rec}")
        
        lines.append("")
        lines.append(f"**Confidence Calibration**: {self.confidence_calibration}")
        
        return "\n".join(lines)