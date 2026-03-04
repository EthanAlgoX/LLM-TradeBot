from __future__ import annotations

from agents.base import BaseAgent
from contracts import ProposedAction


class OpportunityRankerAgent(BaseAgent):
    name = "opportunity_ranker_agent"

    def select(self, proposals: list[ProposedAction]) -> list[ProposedAction]:
        closes = [p for p in proposals if p.action in {"close_long", "close_short"}]
        opens = [p for p in proposals if p.action in {"open_long", "open_short"}]

        selected: list[ProposedAction] = []
        # execute all close candidates first (risk reduction)
        selected.extend(closes)
        # single best open per cycle
        if opens:
            opens.sort(key=lambda p: p.confidence, reverse=True)
            selected.append(opens[0])
        return selected
