"""Trusted black-box adapter for the built-in research-decision strategy."""

from __future__ import annotations

from typing import Any


def run(context: dict[str, Any]) -> dict[str, Any]:
    runtime = context.get("_runtime") if isinstance(context.get("_runtime"), dict) else {}
    run_id = runtime.get("publishedRunId")
    db = runtime.get("database")
    if not run_id or db is None:
        return {
            "status": "failed",
            "contract": "DecisionProposal",
            "reasonCode": "PUBLISHED_RUN_CONTEXT_REQUIRED",
            "message": "研究决策内核必须由完整策略运行记录调用。",
            "missingInputs": ["publishedRunId"],
            "dataCoverage": context.get("dataCoverage") or {},
            "warnings": [],
        }
    from src.services.strategy_definition_service import StrategyDefinitionService
    from src.services.strategy_graph_runtime_service import StrategyGraphRuntimeService

    StrategyGraphRuntimeService(db).execute(int(run_id))
    detail = StrategyDefinitionService(db).get_published_run(int(run_id))
    snapshot = detail.get("resultSnapshot") if isinstance(detail.get("resultSnapshot"), dict) else {}
    historical_steps = snapshot.get("agentRuns") if isinstance(snapshot.get("agentRuns"), list) else []
    terminal_output: Any = None
    for step in reversed(historical_steps):
        if isinstance(step, dict) and step.get("output") is not None:
            terminal_output = step.get("output")
            break
    if terminal_output is None:
        terminal_output = snapshot.get("result", snapshot)
    result = terminal_output if isinstance(terminal_output, dict) else {"output": terminal_output}
    return {
        "status": "success" if detail.get("status") == "completed" else "failed",
        "contract": "DecisionProposal",
        "strategyId": context.get("strategyId"),
        "strategyVersion": context.get("strategyVersion"),
        "asOf": context.get("asOf"),
        # The compatibility graph is an implementation detail. Its node names,
        # prompts and progress never cross the strategy-kernel contract.
        "result": result,
        "dataCoverage": context.get("dataCoverage") or {},
        "warnings": context.get("warnings") or [],
        "evidenceRefs": [],
    }
