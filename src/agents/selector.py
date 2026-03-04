from __future__ import annotations

import random
from datetime import datetime, timezone

from config import RuntimeConfig
from contracts import RankedSymbol, UniverseSet, SCHEMA_V2
from state import RuntimeState
from agents.base import BaseAgent
from providers.ranking import MarketRankProvider, MockMarketRankProvider


class UnifiedSelectorAgent(BaseAgent):
    name = "unified_selector_agent"

    def __init__(self, cfg: RuntimeConfig, provider: MarketRankProvider | None = None) -> None:
        self.cfg = cfg
        self.provider = provider or MockMarketRankProvider()

    def _ai500_score(self, symbol: str, cycle: int) -> float:
        rng = random.Random(f"ai500:{symbol}:{cycle // 3}")
        # Simulate volume ranking score (0..100)
        return 35.0 + rng.random() * 65.0

    def _feedback_score(self, symbol: str, state: RuntimeState) -> float:
        recent = [t.pnl for t in state.trades[-20:] if t.symbol == symbol]
        if not recent:
            return 50.0
        avg = sum(recent) / len(recent)
        return max(0.0, min(100.0, 50.0 + avg / 10.0))

    def select(self, *, trace_id: str, state: RuntimeState) -> UniverseSet:
        candidates = list(self.cfg.ai500_candidates)
        market_rank = self.provider.snapshot(candidates, state.cycle)

        rows: list[RankedSymbol] = []
        for symbol in candidates:
            ai500_score = self._ai500_score(symbol, state.cycle)
            mr = market_rank[symbol]
            feedback = self._feedback_score(symbol, state)
            score = (
                self.cfg.selector.ai500_weight * ai500_score
                + self.cfg.selector.market_rank_weight * mr.score
                + self.cfg.selector.feedback_weight * feedback
            )
            rows.append(
                RankedSymbol(
                    symbol=symbol,
                    rank=0,
                    score=round(score, 2),
                    ai500_score=round(ai500_score, 2),
                    market_rank_score=round(mr.score, 2),
                    feedback_score=round(feedback, 2),
                    why=[
                        f"AI500 volume score={ai500_score:.1f}",
                        f"MarketRank score={mr.score:.1f}",
                        mr.reason,
                    ],
                )
            )

        rows.sort(key=lambda r: r.score, reverse=True)
        top = rows[: self.cfg.selector.top_n]
        for idx, row in enumerate(top, start=1):
            row.rank = idx

        return UniverseSet(
            schema_version=SCHEMA_V2,
            trace_id=trace_id,
            generated_at=datetime.now(timezone.utc).isoformat(),
            top_symbols=top,
            fallback_source="none",
        )
