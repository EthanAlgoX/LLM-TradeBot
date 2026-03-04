from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from tradebot.agents import (
    ContextAgent,
    DataAgent,
    DecisionRouterAgent,
    ExecutionAgent,
    ExecutionPlannerAgent,
    FusionAgent,
    OpportunityRankerAgent,
    PostTradeAgent,
    PredictionAgent,
    RiskAuditAgent,
    SemanticAgent,
    SignalAgent,
    UnifiedSelectorAgent,
)
from tradebot.config import RuntimeConfig
from tradebot.contracts import CycleResult, ProposedAction, SCHEMA_V2
from tradebot.events import EventBus
from tradebot.providers import build_execution_provider, build_market_data_provider, build_market_rank_provider
from tradebot.state import RuntimeState


class MultiAgentTradeBot:
    """V2 multi-agent pipeline implementation for TradeBot."""

    def __init__(self, cfg: RuntimeConfig | None = None, state: RuntimeState | None = None) -> None:
        self.cfg = cfg or RuntimeConfig()
        self.state = state or RuntimeState(cash=self.cfg.initial_cash)
        self.bus = EventBus()

        rank_provider = build_market_rank_provider(self.cfg)
        data_provider = build_market_data_provider(self.cfg)
        execution_provider = build_execution_provider(self.cfg)

        self.selector = UnifiedSelectorAgent(self.cfg, provider=rank_provider)
        self.data_agent = DataAgent(provider=data_provider)
        self.signal_agent = SignalAgent()
        self.pred_agent = PredictionAgent()
        self.ctx_agent = ContextAgent()
        self.semantic_agent = SemanticAgent()
        self.fusion_agent = FusionAgent()
        self.decision_agent = DecisionRouterAgent(self.cfg)
        self.portfolio_agent = OpportunityRankerAgent()
        self.risk_agent = RiskAuditAgent(self.cfg)
        self.exec_planner = ExecutionPlannerAgent()
        self.exec_agent = ExecutionAgent(provider=execution_provider)
        self.post_trade_agent = PostTradeAgent()

    async def _analyze_symbol(self, *, trace_id: str, symbol: str, rank: int) -> ProposedAction:
        self.bus.emit(trace_id=trace_id, stage="data", phase="start", agent=self.data_agent.name, data={"symbol": symbol})
        snapshot = self.data_agent.fetch(trace_id=trace_id, symbol=symbol, state=self.state)
        self.bus.emit(trace_id=trace_id, stage="data", phase="end", agent=self.data_agent.name, data={"symbol": symbol, "price": snapshot.price})

        self.bus.emit(trace_id=trace_id, stage="analysis", phase="start", agent="analysis_fanout", data={"symbol": symbol})
        signal = await asyncio.to_thread(self.signal_agent.analyze, trace_id=trace_id, snapshot=snapshot)
        pred, ctx, sem = await asyncio.gather(
            asyncio.to_thread(self.pred_agent.predict, trace_id=trace_id, snapshot=snapshot, signal=signal),
            asyncio.to_thread(self.ctx_agent.build, trace_id=trace_id, symbol=symbol, rank=rank, state=self.state),
            asyncio.to_thread(self.semantic_agent.summarize, trace_id=trace_id, snapshot=snapshot, signal=signal),
        )
        consensus = self.fusion_agent.fuse(trace_id=trace_id, symbol=symbol, signal=signal, prediction=pred, context=ctx, semantic=sem)
        proposal = self.decision_agent.route(trace_id=trace_id, consensus=consensus, price=snapshot.price, state=self.state)
        self.bus.emit(
            trace_id=trace_id,
            stage="analysis",
            phase="end",
            agent="analysis_fanout",
            data={"symbol": symbol, "action": proposal.action, "confidence": proposal.confidence},
        )
        return proposal

    async def run_cycle(self) -> CycleResult:
        self.state.cycle += 1
        trace_id = f"cycle:{self.state.cycle}:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

        self.bus.emit(trace_id=trace_id, stage="selector", phase="start", agent=self.selector.name)
        universe = self.selector.select(trace_id=trace_id, state=self.state)
        selected_symbols = [s.symbol for s in universe.top_symbols]
        rank_map = {s.symbol: s.rank for s in universe.top_symbols}
        self.bus.emit(trace_id=trace_id, stage="selector", phase="end", agent=self.selector.name, data={"top_n": len(selected_symbols)})

        proposals = await asyncio.gather(
            *[self._analyze_symbol(trace_id=trace_id, symbol=symbol, rank=rank_map.get(symbol, 999)) for symbol in selected_symbols]
        )

        self.bus.emit(trace_id=trace_id, stage="portfolio", phase="start", agent=self.portfolio_agent.name)
        selected_actions = self.portfolio_agent.select(list(proposals))
        self.bus.emit(trace_id=trace_id, stage="portfolio", phase="end", agent=self.portfolio_agent.name, data={"selected": len(selected_actions)})

        executed: list[dict[str, Any]] = []
        blocked: list[dict[str, Any]] = []

        for proposal in selected_actions:
            self.bus.emit(trace_id=trace_id, stage="risk", phase="start", agent=self.risk_agent.name, data={"symbol": proposal.symbol})
            risk = self.risk_agent.audit(trace_id=trace_id, proposal=proposal, state=self.state)
            self.bus.emit(trace_id=trace_id, stage="risk", phase="end", agent=self.risk_agent.name, data={"symbol": proposal.symbol, "passed": risk.passed})

            if not risk.passed:
                blocked.append({"symbol": proposal.symbol, "action": proposal.action, "reason": risk.blocked_reason})
                continue

            planned = self.exec_planner.plan(proposal, risk, self.cfg, self.state)
            self.bus.emit(trace_id=trace_id, stage="execution", phase="start", agent=self.exec_agent.name, data={"symbol": proposal.symbol, "action": planned.action})
            result = self.exec_agent.execute(trace_id=trace_id, planned=planned, state=self.state)
            self.bus.emit(trace_id=trace_id, stage="execution", phase="end", agent=self.exec_agent.name, data={"symbol": proposal.symbol, "status": result.status})
            executed.append({"symbol": result.symbol, "action": result.action, "status": result.status, "message": result.message})

        self.bus.emit(trace_id=trace_id, stage="post_trade", phase="start", agent=self.post_trade_agent.name)
        post = self.post_trade_agent.run(trace_id=trace_id, symbol="_system", state=self.state)
        self.bus.emit(trace_id=trace_id, stage="post_trade", phase="end", agent=self.post_trade_agent.name, data={"notes": len(post.notes)})

        status = "success" if executed else ("blocked" if blocked else "wait")
        action = executed[0]["action"] if executed else (selected_actions[0].action if selected_actions else "wait")

        return CycleResult(
            schema_version=SCHEMA_V2,
            cycle=self.state.cycle,
            trace_id=trace_id,
            selected_symbols=selected_symbols,
            action=action,
            status=status,
            details={
                "executed": executed,
                "blocked": blocked,
                "open_positions": list(self.state.positions.keys()),
                "cash": self.state.cash,
                "post_trade_notes": post.notes,
            },
        )
