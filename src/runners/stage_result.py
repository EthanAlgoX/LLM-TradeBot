from dataclasses import dataclass, field
from typing import Dict, Optional, Any

@dataclass
class StageResult:
    """Standard stage return envelope for early-return or payload."""
    early_result: Optional[Dict[str, Any]] = None
    payload: Dict[str, Any] = field(default_factory=dict)