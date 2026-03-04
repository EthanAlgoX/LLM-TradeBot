from __future__ import annotations

import asyncio
from dataclasses import asdict
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
from tradebot.providers.data import MarketDataProvider
from tradebot.providers.execution import ExecutionProvider
from tradebot.providers.ranking import MarketRankProvider
from tradebot.storage import SQLiteStateStore
from tradebot.state import RuntimeState


class MultiAgentTradeBot:
    """V2 multi-agent pipeline implementation for TradeBot."""

    def __init__(
        self,
        cfg: RuntimeConfig | None = None,
        state: RuntimeState | None = None,
        state_store: SQLiteStateStore | None = None,
        market_data_provider: MarketDataProvider | None = None,
        market_rank_provider: MarketRankProvider | None = None,
        execution_provider: ExecutionProvider | None = None,
        reset_state: bool = False,
    ) -> None:
        self.cfg = cfg or RuntimeConfig()
        self.state_store = state_store
        if self.state_store is None and self.cfg.persistence_enabled:
            self.state_store = SQLiteStateStore(self.cfg.persistence_path)
        if self.state_store is not None and reset_state:
            self.state_store.reset()

        if state is not None:
            self.state = state
        elif self.state_store is not None:
            self.state = self.state_store.load_runtime_state(initial_cash=self.cfg.initial_cash)
        else:
            self.state = RuntimeState(cash=self.cfg.initial_cash)
        self.bus = EventBus()

        rank_provider = market_rank_provider or build_market_rank_provider(self.cfg)
        data_provider = market_data_provider or build_market_data_provider(self.cfg)
        exec_provider = execution_provider or build_execution_provider(self.cfg)

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
        self.exec_agent = ExecutionAgent(provider=exec_provider)
        self.post_trade_agent = PostTradeAgent()

    @staticmethod
    def _to_payload(obj: Any) -> dict[str, Any]:
        return asdict(obj)

    async def _analyze_symbol(self, *, trace_id: str, symbol: str, rank: int) -> ProposedAction:
        self.bus.emit(trace_id=trace_id, stage="data", phase="start", agent=self.data_agent.name, data={"symbol": symbol})
        snapshot = self.data_agent.fetch(trace_id=trace_id, symbol=symbol, state=self.state)
        self.bus.emit(
            trace_id=trace_id,
            stage="data",
            phase="end",
            agent=self.data_agent.name,
            data={"symbol": symbol, "snapshot": self._to_payload(snapshot)},
        )

        self.bus.emit(
            trace_id=trace_id,
            stage="analysis",
            phase="start",
            agent="analysis_fanout",
            data={"symbol": symbol, "input": {"snapshot": self._to_payload(snapshot), "rank": rank}},
        )
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
            data={
                "symbol": symbol,
                "output": {
                    "signal": self._to_payload(signal),
                    "prediction": self._to_payload(pred),
                    "context": self._to_payload(ctx),
                    "semantic": self._to_payload(sem),
                    "consensus": self._to_payload(consensus),
                    "proposal": self._to_payload(proposal),
                },
            },
        )
        return proposal

    async def run_cycle(self) -> CycleResult:
        events_start = len(self.bus.events)
        self.state.cycle += 1
        trace_id = f"cycle:{self.state.cycle}:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

        self.bus.emit(trace_id=trace_id, stage="selector", phase="start", agent=self.selector.name)
        universe = self.selector.select(trace_id=trace_id, state=self.state)
        selected_symbols = [s.symbol for s in universe.top_symbols]
        rank_map = {s.symbol: s.rank for s in universe.top_symbols}
        self.bus.emit(
            trace_id=trace_id,
            stage="selector",
            phase="end",
            agent=self.selector.name,
            data={
                "top_n": len(selected_symbols),
                "selected_symbols": selected_symbols,
                "universe": self._to_payload(universe),
            },
        )

        proposals = await asyncio.gather(
            *[self._analyze_symbol(trace_id=trace_id, symbol=symbol, rank=rank_map.get(symbol, 999)) for symbol in selected_symbols]
        )

        self.bus.emit(
            trace_id=trace_id,
            stage="portfolio",
            phase="start",
            agent=self.portfolio_agent.name,
            data={"proposals": [self._to_payload(p) for p in proposals]},
        )
        selected_actions = self.portfolio_agent.select(list(proposals))
        self.bus.emit(
            trace_id=trace_id,
            stage="portfolio",
            phase="end",
            agent=self.portfolio_agent.name,
            data={"selected": len(selected_actions), "selected_actions": [self._to_payload(p) for p in selected_actions]},
        )

        executed: list[dict[str, Any]] = []
        blocked: list[dict[str, Any]] = []

        for proposal in selected_actions:
            self.bus.emit(
                trace_id=trace_id,
                stage="risk",
                phase="start",
                agent=self.risk_agent.name,
                data={"proposal": self._to_payload(proposal)},
            )
            risk = self.risk_agent.audit(trace_id=trace_id, proposal=proposal, state=self.state)
            self.bus.emit(
                trace_id=trace_id,
                stage="risk",
                phase="end",
                agent=self.risk_agent.name,
                data={"risk_decision": self._to_payload(risk)},
            )

            if not risk.passed:
                blocked.append({"symbol": proposal.symbol, "action": proposal.action, "reason": risk.blocked_reason})
                continue

            planned = self.exec_planner.plan(proposal, risk, self.cfg, self.state)
            self.bus.emit(
                trace_id=trace_id,
                stage="execution",
                phase="start",
                agent=self.exec_agent.name,
                data={"planned_action": self._to_payload(planned)},
            )
            result = self.exec_agent.execute(trace_id=trace_id, planned=planned, state=self.state)
            self.bus.emit(
                trace_id=trace_id,
                stage="execution",
                phase="end",
                agent=self.exec_agent.name,
                data={"execution_result": self._to_payload(result)},
            )
            executed.append({"symbol": result.symbol, "action": result.action, "status": result.status, "message": result.message})

        self.bus.emit(
            trace_id=trace_id,
            stage="post_trade",
            phase="start",
            agent=self.post_trade_agent.name,
            data={
                "input": {
                    "cash": self.state.cash,
                    "open_positions": list(self.state.positions.keys()),
                    "reflection_hint": self.state.reflection_hint,
                }
            },
        )
        post = self.post_trade_agent.run(trace_id=trace_id, symbol="_system", state=self.state)
        self.bus.emit(
            trace_id=trace_id,
            stage="post_trade",
            phase="end",
            agent=self.post_trade_agent.name,
            data={"output": self._to_payload(post), "reflection_hint": self.state.reflection_hint},
        )

        status = "success" if executed else ("blocked" if blocked else "wait")
        action = executed[0]["action"] if executed else (selected_actions[0].action if selected_actions else "wait")

        result = CycleResult(
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
        if self.state_store is not None:
            cycle_events = self.bus.events[events_start:]
            self.state_store.persist(state=self.state, cycle_result=result, events=cycle_events)
        return result
