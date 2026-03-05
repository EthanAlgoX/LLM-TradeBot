from __future__ import annotations

from agents.base import BaseAgent
from config import RuntimeConfig
from contracts import PostTradeResult, SCHEMA_V2
from state import RuntimeState


class PositionMonitorAgent(BaseAgent):
    name = "position_monitor_agent"

    def evaluate(self, state: RuntimeState) -> list[str]:
        notes: list[str] = []
        for symbol, pos in state.positions.items():
            held = state.cycle - pos.opened_cycle
            if held >= 8:
                notes.append(f"{symbol} held {held} cycles, monitor for forced exit")
        return notes


class ReflectionWriterAgent(BaseAgent):
    name = "reflection_writer_agent"

    def reflect(self, state: RuntimeState) -> str:
        recent = [t.pnl for t in state.trades[-8:] if t.pnl != 0]
        if not recent:
            return "no reflection yet"
        avg = sum(recent) / len(recent)
        consecutive_losses = 0
        for pnl in reversed(recent):
            if pnl < 0:
                consecutive_losses += 1
            else:
                break
        if consecutive_losses >= 3:
            return f"recent pnl negative: {consecutive_losses} consecutive losses, reduce leverage and require stronger confirmation"
        if avg < 0:
            return "recent pnl negative: reduce leverage and require stronger confirmation"
        return "recent pnl positive: keep discipline, avoid overtrading"


class PostTradeAgent(BaseAgent):
    name = "post_trade_agent"

    def __init__(self, cfg: RuntimeConfig | None = None) -> None:
        self.cfg = cfg
        self.monitor = PositionMonitorAgent()
        self.reflector = ReflectionWriterAgent()

    def run(self, *, trace_id: str, symbol: str, state: RuntimeState) -> PostTradeResult:
        notes = self.monitor.evaluate(state)
        state.reflection_hint = self.reflector.reflect(state)
        notes.append(f"reflection: {state.reflection_hint}")

        # Per-symbol cooldown: set cooldown on symbols that just had a losing close
        cooldown_cycles = 3
        if self.cfg is not None:
            cooldown_cycles = self.cfg.decision.symbol_cooldown_cycles
        close_actions = {"close_long", "close_short"}
        for t in state.trades:
            if t.cycle == state.cycle and t.action in close_actions and t.pnl < 0:
                state.set_cooldown(t.symbol, state.cycle + cooldown_cycles)
                notes.append(f"cooldown set: {t.symbol} for {cooldown_cycles} cycles after loss")

        return PostTradeResult(schema_version=SCHEMA_V2, trace_id=trace_id, symbol=symbol, notes=notes)
