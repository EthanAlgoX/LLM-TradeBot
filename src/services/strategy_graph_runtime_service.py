"""Minimal, auditable executor for immutable strategy-definition graphs.

This is intentionally a manual research runner: it executes the published
Agent graph with the configured prompts and records an immutable result.  It
does not create orders, fills, positions, evidence, or any trading outcome.
"""

from __future__ import annotations

import json
import time
from typing import Any, Callable, Optional

from sqlalchemy import select

from src.agent.llm_adapter import LLMToolAdapter
from src.storage import (
    DatabaseManager,
    SimulationAgentConnectionRecord,
    SimulationAgentInstanceRecord,
    SimulationRunRecord,
    SimulationStrategyVersionRecord,
    utc_naive_now,
    persist_llm_usage,
)
from src.llm.usage import should_persist_usage_telemetry


class StrategyGraphRunError(ValueError):
    pass


class StrategyGraphRuntimeService:
    """Execute one already-created run against its immutable published graph."""

    def __init__(self, db_manager: Optional[DatabaseManager] = None, adapter_factory: Optional[Callable[[], LLMToolAdapter]] = None):
        self.db = db_manager or DatabaseManager.get_instance()
        self._adapter_factory = adapter_factory or LLMToolAdapter

    def execute(self, run_id: int) -> dict[str, Any]:
        snapshot = self._start(run_id)
        input_snapshot = snapshot["input"]
        outputs: dict[int, Any] = {}
        agent_runs: list[dict[str, Any]] = snapshot["agentRuns"]
        adapter: Optional[LLMToolAdapter] = None
        active_event: Optional[dict[str, Any]] = None

        try:
            for index, agent in enumerate(snapshot["agents"]):
                if self._is_cancelled(run_id):
                    return {"id": run_id, "status": "cancelled"}
                started = time.monotonic()
                active_event = agent_runs[index]
                active_event["status"] = "running"
                active_event["output"] = {"message": "正在执行此 Agent。"}
                self._checkpoint(run_id, agent_runs, active_event.get("agentId"))
                upstream = self._upstream_payload(agent.id, snapshot["connections"], outputs)
                if agent.agent_type == "INPUT":
                    output: Any = {"input": input_snapshot, "upstream": upstream}
                    active_event.update(self._agent_event(agent, "completed", output, started))
                    outputs[agent.id] = output
                    self._checkpoint(run_id, agent_runs)
                    active_event = None
                    continue

                adapter = adapter or self._adapter_factory()
                response = adapter.call_text([
                    {"role": "system", "content": self._system_message(agent)},
                    {"role": "user", "content": self._user_message(input_snapshot, upstream)},
                ], max_tokens=1200, timeout=max(1, int(agent.timeout_seconds or 30)))
                content = str(getattr(response, "content", "") or "")
                provider = str(getattr(response, "provider", "") or "")
                if provider == "error":
                    raise StrategyGraphRunError(content or "LLM runtime is not configured")
                usage = getattr(response, "usage", None)
                model = str(getattr(response, "model", "") or provider or "unknown")
                if should_persist_usage_telemetry(usage):
                    persist_llm_usage(
                        usage,
                        model,
                        call_type="strategy_run",
                        stock_code=str(input_snapshot.get("stock_code") or "") or None,
                        strategy_id=snapshot["strategyId"],
                        strategy_version_id=snapshot["strategyVersionId"],
                        strategy_run_id=run_id,
                        usage_scope="research_run",
                    )
                output = {"content": content, "provider": provider, "model": getattr(response, "model", None)}
                outputs[agent.id] = output
                active_event.update(self._agent_event(agent, "completed", output, started))
                self._checkpoint(run_id, agent_runs)
                active_event = None
            return self._finish(run_id, "completed", {"agentRuns": agent_runs, "finalOutput": self._final_output(snapshot["agents"], outputs)}, None)
        except Exception as exc:
            if active_event is not None:
                failed_agent = next((item for item in snapshot["agents"] if str(item.id) == str(active_event.get("agentId"))), snapshot["agents"][-1])
                active_event.update(self._agent_event(failed_agent, "failed", {"message": str(exc)[:2000]}, time.monotonic()))
                self._checkpoint(run_id, agent_runs)
            elif snapshot["agents"]:
                failed_agent = next((item for item in snapshot["agents"] if item.id not in outputs), snapshot["agents"][-1])
                agent_runs.append(self._agent_event(failed_agent, "failed", {"message": str(exc)[:2000]}, time.monotonic()))
            return self._finish(run_id, "failed", {"agentRuns": agent_runs}, str(exc)[:2000])

    def _start(self, run_id: int) -> dict[str, Any]:
        with self.db.session_scope() as session:
            run = session.get(SimulationRunRecord, run_id)
            if not run:
                raise StrategyGraphRunError("运行记录不存在。")
            if run.status not in {"queued", "failed"}:
                raise StrategyGraphRunError("只有等待或失败的运行可以启动。")
            version = session.get(SimulationStrategyVersionRecord, run.strategy_version_id)
            if not version or version.status != "PUBLISHED" or not version.immutable:
                raise StrategyGraphRunError("只能执行不可修改的正式策略版本。")
            agents = session.execute(select(SimulationAgentInstanceRecord).where(
                SimulationAgentInstanceRecord.strategy_version_id == version.id
            ).order_by(SimulationAgentInstanceRecord.id)).scalars().all()
            connections = session.execute(select(SimulationAgentConnectionRecord).where(
                SimulationAgentConnectionRecord.strategy_version_id == version.id
            )).scalars().all()
            if not agents:
                raise StrategyGraphRunError("正式策略版本没有可执行 Agent。")
            run.status = "running"; run.started_at = utc_naive_now(); run.error_message = None
            ordered_agents = self._ordered_agents(agents, connections)
            queued_events = [self._agent_event(agent, "queued", None, time.monotonic()) for agent in ordered_agents]
            run.result_snapshot_json = json.dumps({"agentRuns": queued_events, "phase": "agent_research"}, ensure_ascii=False, sort_keys=True, default=str)
            # The graph is executed after this transaction commits.  Detach the
            # already-loaded immutable records so SQLAlchemy cannot lazily read
            # mutable database state halfway through a run.
            session.flush()
            session.expunge_all()
            frozen_input = self._load(run.input_snapshot_json)
            frozen_input.setdefault("data_source_config", self._load(version.data_permission_snapshot_json))
            return {
                "input": frozen_input,
                "agents": ordered_agents,
                "connections": connections,
                "agentRuns": queued_events,
                "strategyId": version.strategy_id,
                "strategyVersionId": version.id,
            }

    def _checkpoint(self, run_id: int, agent_runs: list[dict[str, Any]], active_agent_id: Optional[str] = None) -> None:
        """Persist only lifecycle metadata while the immutable graph is running.

        This lets the Run Center show the current Agent without waiting for a
        long model call to finish.  Prompt text is never copied into progress.
        """
        with self.db.session_scope() as session:
            run = session.get(SimulationRunRecord, run_id)
            if not run or run.status != "running":
                return
            snapshot: dict[str, Any] = {"agentRuns": agent_runs, "phase": "agent_research"}
            if active_agent_id:
                snapshot["activeAgentId"] = str(active_agent_id)
            run.result_snapshot_json = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, default=str)

    def _finish(self, run_id: int, status: str, result: dict[str, Any], error: Optional[str]) -> dict[str, Any]:
        with self.db.session_scope() as session:
            run = session.get(SimulationRunRecord, run_id)
            if not run:
                raise StrategyGraphRunError("运行记录不存在。")
            if run.status == "cancelled":
                return {"id": run.id, "status": run.status}
            run.status = status; run.completed_at = utc_naive_now(); run.error_message = error
            run.result_snapshot_json = json.dumps(result, ensure_ascii=False, sort_keys=True, default=str)
            return {"id": run.id, "status": run.status}

    def _is_cancelled(self, run_id: int) -> bool:
        with self.db.get_session() as session:
            return session.execute(
                select(SimulationRunRecord.status).where(SimulationRunRecord.id == run_id)
            ).scalar_one_or_none() == "cancelled"

    @staticmethod
    def _ordered_agents(agents: list[SimulationAgentInstanceRecord], connections: list[SimulationAgentConnectionRecord]) -> list[SimulationAgentInstanceRecord]:
        # POST_RUN_CONTEXT is not part of the current decision DAG.  Reflection
        # agents must run only after every DATA_FLOW agent has produced its
        # frozen output, otherwise a reflection can be scheduled before the
        # decision it is supposed to review.
        primary_agents = [agent for agent in agents if agent.agent_type != "REFLECTION"]
        reflection_agents = [agent for agent in agents if agent.agent_type == "REFLECTION"]
        by_id = {agent.id: agent for agent in primary_agents}
        incoming = {agent.id: 0 for agent in primary_agents}
        children: dict[int, list[int]] = {agent.id: [] for agent in primary_agents}
        for edge in connections:
            if edge.connection_type == "POST_RUN_CONTEXT" or edge.source_agent_id not in by_id or edge.target_agent_id not in by_id:
                continue
            incoming[edge.target_agent_id] += 1; children[edge.source_agent_id].append(edge.target_agent_id)
        ready = sorted(agent.id for agent in primary_agents if incoming[agent.id] == 0)
        ordered: list[SimulationAgentInstanceRecord] = []
        while ready:
            current = ready.pop(0); ordered.append(by_id[current])
            for child in sorted(children[current]):
                incoming[child] -= 1
                if incoming[child] == 0: ready.append(child)
        # The published graph validator prevents cycles; retain a deterministic
        # order for legacy data, then append reflections as the final phase.
        primary = ordered if len(ordered) == len(primary_agents) else sorted(primary_agents, key=lambda item: item.id)
        return primary + sorted(reflection_agents, key=lambda item: item.id)

    @staticmethod
    def _upstream_payload(agent_id: int, connections: list[SimulationAgentConnectionRecord], outputs: dict[int, Any]) -> list[dict[str, Any]]:
        return [{"connectionType": edge.connection_type, "fieldMapping": StrategyGraphRuntimeService._load(edge.field_mapping_json), "output": outputs[edge.source_agent_id]}
                for edge in connections if edge.target_agent_id == agent_id and edge.source_agent_id in outputs]

    @staticmethod
    def _system_message(agent: SimulationAgentInstanceRecord) -> str:
        return "\n\n".join(part for part in [agent.system_prompt.strip(), agent.prompt_template.strip(), f"你的角色：{agent.role}", "只输出研究结论；不得下单、不得声称已经交易或产生收益。"] if part)

    @staticmethod
    def _user_message(input_snapshot: dict[str, Any], upstream: list[dict[str, Any]]) -> str:
        return "本次已冻结的运行输入：\n" + json.dumps(input_snapshot, ensure_ascii=False) + "\n\n上游 Agent 输出：\n" + json.dumps(upstream, ensure_ascii=False, default=str)[:24000]

    @staticmethod
    def _agent_event(agent: SimulationAgentInstanceRecord, status: str, output: Any, started: float) -> dict[str, Any]:
        return {"agentId": str(agent.id), "lineageId": agent.lineage_id, "agentName": agent.name, "agentType": agent.agent_type, "status": status, "durationMs": round((time.monotonic() - started) * 1000), "output": output}

    @staticmethod
    def _final_output(agents: list[SimulationAgentInstanceRecord], outputs: dict[int, Any]) -> Any:
        decision = next((agent for agent in reversed(agents) if agent.agent_type == "DECISION" and agent.id in outputs), None)
        return outputs.get(decision.id) if decision else next(reversed(outputs.values()), None)

    @staticmethod
    def _load(value: str | None) -> dict[str, Any]:
        try:
            loaded = json.loads(value or "{}")
        except (TypeError, ValueError):
            return {}
        return loaded if isinstance(loaded, dict) else {}
