# -*- coding: utf-8 -*-
"""Persistence service for the strategy-lab simulation foundation.

The service intentionally records requests only.  Agent execution, paper
orders and performance calculation are later phases, so this module never
reads or writes portfolio, alert, backtest or broker state.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import desc, func, select

from src.storage import (
    DatabaseManager,
    SimulationRunRecord,
    SimulationStrategyRecord,
    SimulationStrategyVersionRecord,
    utc_naive_now,
)


class SimulationStrategyNotFoundError(ValueError):
    """Raised when a strategy or immutable version is absent."""


class SimulationStrategyService:
    _MAX_CONFIG_BYTES = 65536
    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()

    def create_strategy(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValueError("Strategy name is required")
        description = self._optional_text(payload.get("description"), 4000)
        label = self._optional_text(payload.get("version_label"), 120)
        config = self._json_object(payload.get("config"), "config")
        with self.db.session_scope() as session:
            exists = session.execute(
                select(SimulationStrategyRecord.id).where(SimulationStrategyRecord.name == name)
            ).scalar_one_or_none()
            if exists is not None:
                raise ValueError("Strategy name already exists")
            row = SimulationStrategyRecord(name=name, description=description)
            session.add(row)
            session.flush()
            version = SimulationStrategyVersionRecord(
                strategy_id=row.id, version=1, label=label, config_json=self._dump(config)
            )
            session.add(version)
            session.flush()
            return self._serialize_strategy(row, version)

    def list_strategies(self) -> List[Dict[str, Any]]:
        with self.db.get_session() as session:
            rows = session.execute(
                select(SimulationStrategyRecord).order_by(desc(SimulationStrategyRecord.updated_at))
            ).scalars().all()
            return [self._serialize_strategy(row, self._latest_version(session, row.id)) for row in rows]

    def list_templates(self) -> List[Dict[str, Any]]:
        template_path = Path(__file__).with_name("simulation_templates.json")
        try:
            templates = json.loads(template_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise RuntimeError("Simulation template catalog is unavailable") from exc
        if not isinstance(templates, list):
            raise RuntimeError("Simulation template catalog is invalid")
        return [item for item in templates if isinstance(item, dict)]

    def get_strategy(self, strategy_id: int) -> Dict[str, Any]:
        with self.db.get_session() as session:
            row = session.get(SimulationStrategyRecord, strategy_id)
            if row is None:
                raise SimulationStrategyNotFoundError("Simulation strategy not found")
            return self._serialize_strategy(row, self._latest_version(session, strategy_id))

    def update_strategy(self, strategy_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self.db.session_scope() as session:
            row = session.get(SimulationStrategyRecord, strategy_id)
            if row is None:
                raise SimulationStrategyNotFoundError("Simulation strategy not found")
            if "name" in payload and payload["name"] is not None:
                name = str(payload["name"]).strip()
                if not name:
                    raise ValueError("Strategy name is required")
                duplicate = session.execute(select(SimulationStrategyRecord.id).where(SimulationStrategyRecord.name == name, SimulationStrategyRecord.id != strategy_id)).scalar_one_or_none()
                if duplicate is not None:
                    raise ValueError("Strategy name already exists")
                row.name = name
            if "description" in payload:
                row.description = self._optional_text(payload.get("description"), 4000)
            if "enabled" in payload and payload["enabled"] is not None:
                row.enabled = bool(payload["enabled"])
            row.updated_at = utc_naive_now()
            session.flush()
            return self._serialize_strategy(row, self._latest_version(session, strategy_id))

    def list_versions(self, strategy_id: int) -> List[Dict[str, Any]]:
        with self.db.get_session() as session:
            if session.get(SimulationStrategyRecord, strategy_id) is None:
                raise SimulationStrategyNotFoundError("Simulation strategy not found")
            rows = session.execute(select(SimulationStrategyVersionRecord).where(SimulationStrategyVersionRecord.strategy_id == strategy_id).order_by(desc(SimulationStrategyVersionRecord.version))).scalars().all()
            return [self._serialize_version(row) for row in rows]

    def get_version(self, strategy_id: int, version_id: int) -> Dict[str, Any]:
        with self.db.get_session() as session:
            row = session.get(SimulationStrategyVersionRecord, version_id)
            if row is None or row.strategy_id != strategy_id:
                raise SimulationStrategyNotFoundError("Simulation strategy version not found")
            return self._serialize_version(row)

    def create_version(self, strategy_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        config = self._json_object(payload.get("config"), "config")
        label = self._optional_text(payload.get("label"), 120)
        with self.db.session_scope() as session:
            strategy = session.get(SimulationStrategyRecord, strategy_id)
            if strategy is None:
                raise SimulationStrategyNotFoundError("Simulation strategy not found")
            current = session.execute(
                select(func.max(SimulationStrategyVersionRecord.version)).where(
                    SimulationStrategyVersionRecord.strategy_id == strategy_id
                )
            ).scalar() or 0
            row = SimulationStrategyVersionRecord(
                strategy_id=strategy_id, version=int(current) + 1, label=label, config_json=self._dump(config)
            )
            strategy.updated_at = utc_naive_now()
            session.add(row)
            session.flush()
            return self._serialize_version(row)

    def create_run(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        version_id = int(payload["strategy_version_id"])
        mode = str(payload.get("execution_mode") or "preview")
        if mode not in {"preview", "paper"}:
            raise ValueError("execution_mode must be preview or paper")
        input_snapshot = self._json_object(payload.get("input_snapshot"), "input_snapshot")
        with self.db.session_scope() as session:
            version = session.get(SimulationStrategyVersionRecord, version_id)
            if version is None:
                raise SimulationStrategyNotFoundError("Simulation strategy version not found")
            row = SimulationRunRecord(
                strategy_version_id=version_id,
                status="queued",
                execution_mode=mode,
                input_snapshot_json=self._dump(input_snapshot),
            )
            session.add(row)
            session.flush()
            return self._serialize_run(row)

    def list_runs(self, strategy_version_id: Optional[int] = None, limit: int = 20) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 100))
        with self.db.get_session() as session:
            statement = select(SimulationRunRecord).order_by(
                desc(SimulationRunRecord.created_at), desc(SimulationRunRecord.id)
            ).limit(safe_limit)
            if strategy_version_id is not None:
                statement = statement.where(SimulationRunRecord.strategy_version_id == strategy_version_id)
            rows = session.execute(statement).scalars().all()
            return [self._serialize_run(row) for row in rows]

    def get_run(self, run_id: int) -> Dict[str, Any]:
        with self.db.get_session() as session:
            row = session.get(SimulationRunRecord, run_id)
            if row is None:
                raise SimulationStrategyNotFoundError("Simulation run not found")
            return self._serialize_run(row)

    def execute_run(self, run_id: int) -> Dict[str, Any]:
        """Persist an honest preflight result until the orchestrator adapter is wired.

        P4 must never turn an incomplete UI preview into a fictional completed
        run. This state machine records the exact failed prerequisite and leaves
        the original input/version snapshots immutable for a later retry.
        """
        with self.db.session_scope() as session:
            row = session.get(SimulationRunRecord, run_id)
            if row is None:
                raise SimulationStrategyNotFoundError("Simulation run not found")
            if row.status not in {"queued", "failed"}:
                raise ValueError("Only queued or failed simulation runs can be executed")
            input_snapshot = self._load(row.input_snapshot_json)
            now = utc_naive_now()
            row.status = "running"
            row.started_at = now
            events = [{"stage": "input", "status": "completed", "timestamp": now.isoformat(), "message": "Strategy version and input snapshot frozen for execution."}]
            stock_code = str(input_snapshot.get("stock_code") or "").strip()
            if not stock_code:
                message = "Execution needs a stock_code input before AgentOrchestrator can run; select a target or use a screening candidate."
                events.extend([
                    {"stage": "analysis", "status": "failed", "timestamp": now.isoformat(), "message": message},
                    {"stage": "screening", "status": "skipped", "timestamp": now.isoformat(), "message": "Skipped because no executable target was supplied."},
                    {"stage": "risk", "status": "skipped", "timestamp": now.isoformat(), "message": "Skipped because analysis did not start."},
                    {"stage": "decision", "status": "skipped", "timestamp": now.isoformat(), "message": "No simulated order is created in P4."},
                    {"stage": "reflection", "status": "skipped", "timestamp": now.isoformat(), "message": "No execution evidence available for reflection."},
                ])
                row.status = "failed"; row.error_message = message; row.completed_at = now
                row.result_snapshot_json = self._dump({"events": events, "preflight": "missing_stock_code"})
                session.flush()
                return self._serialize_run(row)
            version = session.get(SimulationStrategyVersionRecord, row.strategy_version_id)
            config = self._load(version.config_json) if version else {}
            try:
                from src.agent.factory import build_agent_executor
                executor = build_agent_executor(skills=config.get("skill_ids") or config.get("specialists"))
                requested_mode = config.get("orchestrator_mode")
                if requested_mode and hasattr(executor, "mode"):
                    executor.mode = requested_mode
                result = executor.run(
                    f"执行模拟策略版本，对 {stock_code} 进行研究与模拟决策；不得创建真实订单。",
                    {"stock_code": stock_code, "skills": config.get("skill_ids") or config.get("specialists") or [], "report_language": "zh"},
                )
                content = str(getattr(result, "content", ""))[:12000]
                success = bool(getattr(result, "success", False))
                events.extend([
                    {"stage": "analysis", "status": "completed" if success else "failed", "timestamp": utc_naive_now().isoformat(), "message": "AgentOrchestrator returned a result."},
                    {"stage": "screening", "status": "completed" if success else "skipped", "timestamp": utc_naive_now().isoformat(), "message": "Candidate evidence is contained in the orchestrator result."},
                    {"stage": "risk", "status": "completed" if success else "skipped", "timestamp": utc_naive_now().isoformat(), "message": "Risk stage follows the selected orchestrator mode."},
                    {"stage": "decision", "status": "completed" if success else "skipped", "timestamp": utc_naive_now().isoformat(), "message": "Decision is research-only; no paper or real order was created."},
                    {"stage": "reflection", "status": "skipped", "timestamp": utc_naive_now().isoformat(), "message": "Reflection requires P5 execution evidence."},
                ])
                row.status = "completed" if success else "failed"; row.error_message = None if success else str(getattr(result, "error", "Agent run failed"))[:2000]
                row.completed_at = utc_naive_now(); row.result_snapshot_json = self._dump({"events": events, "stock_code": stock_code, "agent_result": {"success": success, "content": content}})
            except Exception as exc:
                message = f"Agent runtime failed: {exc}"
                events.append({"stage": "analysis", "status": "failed", "timestamp": utc_naive_now().isoformat(), "message": message[:2000]})
                row.status = "failed"; row.error_message = message[:2000]; row.completed_at = utc_naive_now(); row.result_snapshot_json = self._dump({"events": events, "stock_code": stock_code})
            session.flush()
            return self._serialize_run(row)

    def _latest_version(self, session, strategy_id: int) -> Optional[SimulationStrategyVersionRecord]:
        return session.execute(
            select(SimulationStrategyVersionRecord)
            .where(SimulationStrategyVersionRecord.strategy_id == strategy_id)
            .order_by(desc(SimulationStrategyVersionRecord.version))
            .limit(1)
        ).scalar_one_or_none()

    @staticmethod
    def _serialize_strategy(row: SimulationStrategyRecord, version: Optional[SimulationStrategyVersionRecord]) -> Dict[str, Any]:
        return {
            "id": row.id, "name": row.name, "description": row.description, "enabled": row.enabled,
            "created_at": row.created_at, "updated_at": row.updated_at,
            "latest_version": SimulationStrategyService._serialize_version(version) if version else None,
        }

    @staticmethod
    def _serialize_version(row: SimulationStrategyVersionRecord) -> Dict[str, Any]:
        return {
            "id": row.id, "strategy_id": row.strategy_id, "version": row.version,
            "label": row.label, "config": SimulationStrategyService._load(row.config_json),
            "created_at": row.created_at,
        }

    @staticmethod
    def _serialize_run(row: SimulationRunRecord) -> Dict[str, Any]:
        return {
            "id": row.id, "strategy_version_id": row.strategy_version_id, "status": row.status,
            "execution_mode": row.execution_mode, "input_snapshot": SimulationStrategyService._load(row.input_snapshot_json),
            "result_snapshot": SimulationStrategyService._load(row.result_snapshot_json) if row.result_snapshot_json else None,
            "error_message": row.error_message, "started_at": row.started_at, "completed_at": row.completed_at,
            "created_at": row.created_at, "updated_at": row.updated_at,
        }

    @staticmethod
    def _json_object(value: Any, field: str) -> Dict[str, Any]:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise ValueError(f"{field} must be an object")
        try:
            encoded = json.dumps(value, ensure_ascii=False, sort_keys=True)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{field} must be JSON serializable") from exc
        if len(encoded.encode("utf-8")) > SimulationStrategyService._MAX_CONFIG_BYTES:
            raise ValueError(f"{field} exceeds {SimulationStrategyService._MAX_CONFIG_BYTES} bytes")
        return value

    @staticmethod
    def _optional_text(value: Any, limit: int) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        if len(text) > limit:
            raise ValueError(f"text exceeds {limit} characters")
        return text or None

    @staticmethod
    def _dump(value: Dict[str, Any]) -> str:
        return json.dumps(value, ensure_ascii=False, sort_keys=True)

    @staticmethod
    def _load(value: str) -> Dict[str, Any]:
        try:
            parsed = json.loads(value or "{}")
        except (TypeError, ValueError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
