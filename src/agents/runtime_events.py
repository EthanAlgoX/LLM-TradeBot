"""
Runtime event helpers for multi-agent orchestration.

Provides lightweight per-run sequence numbering so frontend/ops can
reconstruct agent lifecycle and failure order deterministically.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Dict, Optional

from src.trading import CycleContext

from src.server.state import global_state

_seq_lock = threading.RLock()
_seq_by_run: Dict[str, int] = {}
_MAX_TRACKED_RUNS = 2000


def _next_seq(run_id: str) -> int:
    with _seq_lock:
        if len(_seq_by_run) > _MAX_TRACKED_RUNS:
            # Bounded memory: drop counters when the map grows too large.
            _seq_by_run.clear()
        current = _seq_by_run.get(run_id, 0) + 1
        _seq_by_run[run_id] = current
        return current


def emit_runtime_event(
    *,
    shared_state: Any,
    run_id: str,
    stream: str,
    agent: str,
    phase: str,
    symbol: Optional[str] = None,
    cycle_id: Optional[str] = None,
    data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Create and publish a runtime event to shared state.
    """
    normalized_run_id = (run_id or "unknown").strip() or "unknown"
    event = {
        "run_id": normalized_run_id,
        "seq": _next_seq(normalized_run_id),
        "ts": int(time.time() * 1000),
        "stream": stream,
        "agent": agent,
        "phase": phase,
        "symbol": symbol,
        "cycle_id": cycle_id,
        "data": data or {},
    }
    try:
        shared_state.add_agent_event(event)
    except Exception:
        # Events are best-effort and must not break trading loop.
        pass
    return event


def emit_global_runtime_event(
    context: CycleContext,
    *,
    stream: str,
    agent: str,
    phase: str,
    data: Optional[Dict[str, Any]] = None
) -> None:
    emit_runtime_event(
        shared_state=global_state,
        run_id=context.run_id,
        stream=stream,
        agent=agent,
        phase=phase,
        symbol=context.symbol,
        cycle_id=context.cycle_id,
        data=data or {}
    )
    
def emit_cycle_pipeline_end(context: CycleContext, *, result: Dict[str, Any]) -> None:
    """Emit cycle_pipeline end event using normalized result payload."""
    emit_global_runtime_event(
        context,
        stream="lifecycle",
        agent="cycle_pipeline",
        phase="end",
        data={"status": result.get('status'), "action": result.get('action')}
    )
