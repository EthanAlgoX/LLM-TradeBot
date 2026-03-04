from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass
class RuntimeEvent:
    trace_id: str
    stage: str
    phase: str
    agent: str
    data: dict[str, Any]
    ts: str


class EventBus:
    def __init__(self) -> None:
        self.events: list[RuntimeEvent] = []

    def emit(self, *, trace_id: str, stage: str, phase: str, agent: str, data: dict[str, Any] | None = None) -> None:
        self.events.append(
            RuntimeEvent(
                trace_id=trace_id,
                stage=stage,
                phase=phase,
                agent=agent,
                data=data or {},
                ts=datetime.now(timezone.utc).isoformat(),
            )
        )
