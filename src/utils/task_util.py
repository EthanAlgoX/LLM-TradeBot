import time
import asyncio

from typing import Optional

from src.utils.logger import log
from src.server.state import global_state
from src.trading import CycleContext

from src.agents.runtime_events import emit_global_runtime_event

async def run_task_with_timeout(
    context: CycleContext,
    *,
    agent_name: str,
    timeout_seconds: float,
    task_factory,
    fallback=None,
    log_errors: bool = True
):
    """
    Execute one async task with timeout and standardized runtime events.
    """
    emit_global_runtime_event(
        context,
        stream="lifecycle",
        agent=agent_name,
        phase="start",
        data={"timeout_seconds": timeout_seconds}
    )
    started = time.time()
    try:
        result = await asyncio.wait_for(task_factory(), timeout=timeout_seconds)
        duration_ms = int((time.time() - started) * 1000)
        emit_global_runtime_event(
            context,
            stream="lifecycle",
            agent=agent_name,
            phase="end",
            data={"status": "ok", "duration_ms": duration_ms}
        )
        return result
    except asyncio.TimeoutError:
        duration_ms = int((time.time() - started) * 1000)
        msg = f"⏱️ {agent_name} timeout after {timeout_seconds:.1f}s, degraded fallback used"
        if log_errors:
            log.warning(msg)
        global_state.add_agent_message(agent_name, msg, level="warning")
        emit_global_runtime_event(
            context,
            stream="error",
            agent=agent_name,
            phase="timeout",
            data={"status": "timeout", "duration_ms": duration_ms, "timeout_seconds": timeout_seconds}
        )
        return fallback
    except Exception as e:
        duration_ms = int((time.time() - started) * 1000)
        if log_errors:
            log.error(f"❌ {agent_name} failed: {e}")
        emit_global_runtime_event(
            context,
            stream="error",
            agent=agent_name,
            phase="error",
            data={"status": "error", "duration_ms": duration_ms, "error": str(e)}
        )
        return fallback