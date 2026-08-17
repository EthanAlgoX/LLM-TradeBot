"""Persistent Agent library and versioned multi-Agent workflow definitions.

This service owns reusable Agent configurations and orchestration graphs.  It
does not execute a workflow and does not own strategy market/data/risk policy.
Published workflow versions are immutable inputs that StrategyVersion may copy
and freeze for the existing research runtime.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import desc, func, select

from src.services.strategy_definition_service import StrategyDefinitionError, StrategyDefinitionService
from src.services.strategy_graph_validator import StrategyGraphValidator
from src.storage import (
    DatabaseManager,
    SimulationAgentConnectionRecord,
    SimulationAgentInstanceRecord,
    SimulationAgentTemplateRecord,
    SimulationAgentTemplateVersionRecord,
    SimulationAgentWorkflowConnectionRecord,
    SimulationAgentWorkflowNodeRecord,
    SimulationAgentWorkflowPublishRequestRecord,
    SimulationAgentWorkflowRecord,
    SimulationAgentWorkflowVersionRecord,
    SimulationStrategyRecord,
    SimulationStrategyVersionRecord,
    utc_naive_now,
)


ALLOWED_AGENT_TYPES = {"SCREENING", "ANALYSIS", "DECISION", "REFLECTION"}


class AgentCenterService:
    """CRUD, optimistic concurrency and publication for Agent Center."""

    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()
        self.validator = StrategyGraphValidator()

    # Agent template library ---------------------------------------------------------
    def list_templates(self, agent_type: Optional[str] = None, query: Optional[str] = None) -> list[dict[str, Any]]:
        with self.db.session_scope() as session:
            self._seed_templates(session)
            statement = select(SimulationAgentTemplateRecord).where(
                SimulationAgentTemplateRecord.archived_at.is_(None),
                SimulationAgentTemplateRecord.agent_type != "INPUT",
            )
            if agent_type:
                statement = statement.where(SimulationAgentTemplateRecord.agent_type == agent_type.upper())
            if query and query.strip():
                pattern = f"%{query.strip()}%"
                statement = statement.where(
                    SimulationAgentTemplateRecord.name.ilike(pattern)
                    | SimulationAgentTemplateRecord.description.ilike(pattern)
                )
            rows = session.execute(statement.order_by(SimulationAgentTemplateRecord.agent_type, SimulationAgentTemplateRecord.name)).scalars().all()
            return [self._template_summary(session, row) for row in rows]

    def get_template(self, template_id: int, version: Optional[int] = None) -> dict[str, Any]:
        with self.db.session_scope() as session:
            self._seed_templates(session)
            template = self._template(session, template_id)
            number = version or template.current_version
            item = session.execute(select(SimulationAgentTemplateVersionRecord).where(
                SimulationAgentTemplateVersionRecord.template_id == template.id,
                SimulationAgentTemplateVersionRecord.version == number,
            )).scalar_one_or_none()
            if not item:
                raise StrategyDefinitionError("AGENT_TEMPLATE_VERSION_NOT_FOUND", "Agent 模板版本不存在。", 404)
            return self._template_detail(template, item)

    def create_template(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = self._required(payload.get("name"), "AGENT_TEMPLATE_NAME_REQUIRED", "Agent 名称不能为空。", 120)
        kind = self._agent_type(payload.get("agentType"))
        with self.db.session_scope() as session:
            self._seed_templates(session)
            if session.execute(select(SimulationAgentTemplateRecord.id).where(SimulationAgentTemplateRecord.name == name)).scalar_one_or_none():
                raise StrategyDefinitionError("AGENT_TEMPLATE_NAME_CONFLICT", "Agent 名称已存在。", 409)
            template = SimulationAgentTemplateRecord(
                template_key=f"custom:{uuid.uuid4().hex}",
                name=name,
                agent_type=kind,
                description=self._text(payload.get("description"), 4000),
                current_version=1,
            )
            session.add(template)
            session.flush()
            version = SimulationAgentTemplateVersionRecord(template_id=template.id, version=1, published_at=utc_naive_now())
            self._assign_template_version(version, payload)
            session.add(version)
            session.flush()
            return self._template_detail(template, version)

    def update_template(self, template_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        with self.db.session_scope() as session:
            template = self._template(session, template_id)
            expected = self._integer(payload.get("currentVersion"))
            if expected != template.current_version:
                raise StrategyDefinitionError("AGENT_TEMPLATE_VERSION_CONFLICT", "该 Agent 已产生新版本，请刷新后再编辑。", 409, {
                    "clientVersion": expected, "serverVersion": template.current_version,
                })
            if "name" in payload:
                name = self._required(payload.get("name"), "AGENT_TEMPLATE_NAME_REQUIRED", "Agent 名称不能为空。", 120)
                duplicate = session.execute(select(SimulationAgentTemplateRecord.id).where(
                    SimulationAgentTemplateRecord.name == name,
                    SimulationAgentTemplateRecord.id != template.id,
                )).scalar_one_or_none()
                if duplicate:
                    raise StrategyDefinitionError("AGENT_TEMPLATE_NAME_CONFLICT", "Agent 名称已存在。", 409)
                template.name = name
            if "description" in payload:
                template.description = self._text(payload.get("description"), 4000)
            if "agentType" in payload:
                template.agent_type = self._agent_type(payload.get("agentType"))
            next_version = template.current_version + 1
            row = SimulationAgentTemplateVersionRecord(template_id=template.id, version=next_version, published_at=utc_naive_now())
            previous = session.execute(select(SimulationAgentTemplateVersionRecord).where(
                SimulationAgentTemplateVersionRecord.template_id == template.id,
                SimulationAgentTemplateVersionRecord.version == template.current_version,
            )).scalar_one()
            merged = {**self._template_version_payload(previous), **payload}
            self._assign_template_version(row, merged)
            session.add(row)
            template.current_version = next_version
            template.updated_at = utc_naive_now()
            session.flush()
            return self._template_detail(template, row)

    def archive_template(self, template_id: int) -> dict[str, Any]:
        with self.db.session_scope() as session:
            template = self._template(session, template_id)
            if template.archived_at is not None:
                return {**self._template_summary(session, template), "archived": True}
            template.archived_at = utc_naive_now()
            template.updated_at = utc_naive_now()
            return {**self._template_summary(session, template), "archived": True}

    # Workflow lifecycle --------------------------------------------------------------
    def list_workflows(self, include_archived: bool = False) -> list[dict[str, Any]]:
        with self.db.session_scope() as session:
            self._seed_templates(session)
            self._seed_starter_workflow(session)
            statement = select(SimulationAgentWorkflowRecord).order_by(desc(SimulationAgentWorkflowRecord.updated_at))
            if not include_archived:
                statement = statement.where(SimulationAgentWorkflowRecord.archived_at.is_(None))
            return [self._workflow_summary(session, row) for row in session.execute(statement).scalars().all()]

    def create_workflow(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = self._required(payload.get("name"), "AGENT_WORKFLOW_NAME_REQUIRED", "工作流名称不能为空。", 120)
        description = self._text(payload.get("description"), 4000)
        source_version_id = self._integer(payload.get("basedOnStrategyVersionId"))
        with self.db.session_scope() as session:
            self._seed_templates(session)
            if session.execute(select(SimulationAgentWorkflowRecord.id).where(SimulationAgentWorkflowRecord.name == name)).scalar_one_or_none():
                raise StrategyDefinitionError("AGENT_WORKFLOW_NAME_CONFLICT", "工作流名称已存在。", 409)
            workflow = SimulationAgentWorkflowRecord(name=name, description=description, lifecycle_status="draft", revision=1)
            session.add(workflow)
            session.flush()
            version = SimulationAgentWorkflowVersionRecord(workflow_id=workflow.id, version=1, status="DRAFT", immutable=False, revision=1)
            session.add(version)
            session.flush()
            if source_version_id:
                source = session.get(SimulationStrategyVersionRecord, source_version_id)
                if not source:
                    raise StrategyDefinitionError("STRATEGY_VERSION_NOT_FOUND", "用于导入的策略版本不存在。", 404)
                self._copy_strategy_graph(session, source, version)
            else:
                self._replace_nodes(session, version, payload.get("agents") or [], payload.get("connections") or [])
            workflow.active_draft_version_id = version.id
            session.flush()
            return {"workflow": self._workflow_summary(session, workflow), "draft": self._workflow_version_detail(session, version)}

    def get_workflow(self, workflow_id: int) -> dict[str, Any]:
        with self.db.get_session() as session:
            workflow = self._workflow(session, workflow_id)
            result = self._workflow_summary(session, workflow)
            rows = session.execute(select(SimulationAgentWorkflowVersionRecord).where(
                SimulationAgentWorkflowVersionRecord.workflow_id == workflow.id,
            ).order_by(desc(SimulationAgentWorkflowVersionRecord.created_at))).scalars().all()
            result["versions"] = [self._workflow_version_summary(session, row) for row in rows]
            return result

    def get_workflow_version(self, version_id: int) -> dict[str, Any]:
        with self.db.get_session() as session:
            return self._workflow_version_detail(session, self._workflow_version(session, version_id))

    def list_published_workflow_versions(self, current_only: bool = True) -> list[dict[str, Any]]:
        with self.db.session_scope() as session:
            self._seed_templates(session)
            self._seed_starter_workflow(session)
            statement = (
                select(SimulationAgentWorkflowVersionRecord, SimulationAgentWorkflowRecord)
                .join(SimulationAgentWorkflowRecord, SimulationAgentWorkflowRecord.id == SimulationAgentWorkflowVersionRecord.workflow_id)
                .where(
                    SimulationAgentWorkflowVersionRecord.status == "PUBLISHED",
                    SimulationAgentWorkflowVersionRecord.immutable.is_(True),
                    SimulationAgentWorkflowRecord.archived_at.is_(None),
                )
            )
            if current_only:
                statement = statement.where(SimulationAgentWorkflowRecord.current_published_version_id == SimulationAgentWorkflowVersionRecord.id)
            rows = session.execute(statement.order_by(SimulationAgentWorkflowRecord.name, desc(SimulationAgentWorkflowVersionRecord.version_number))).all()
            return [{**self._workflow_version_summary(session, version), "workflowName": workflow.name, "workflowDescription": workflow.description} for version, workflow in rows]

    def save_workflow_draft(self, version_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        with self.db.session_scope() as session:
            version = self._editable_workflow_version(session, version_id)
            if payload.get("revision") != version.revision:
                raise StrategyDefinitionError("AGENT_WORKFLOW_VERSION_CONFLICT", "工作流草稿已在其他位置修改，请刷新后重试。", 409, {
                    "clientRevision": payload.get("revision"), "serverRevision": version.revision,
                })
            workflow = self._workflow(session, version.workflow_id)
            metadata = payload.get("workflow") if isinstance(payload.get("workflow"), dict) else {}
            if "name" in metadata:
                name = self._required(metadata.get("name"), "AGENT_WORKFLOW_NAME_REQUIRED", "工作流名称不能为空。", 120)
                duplicate = session.execute(select(SimulationAgentWorkflowRecord.id).where(
                    SimulationAgentWorkflowRecord.name == name,
                    SimulationAgentWorkflowRecord.id != workflow.id,
                )).scalar_one_or_none()
                if duplicate:
                    raise StrategyDefinitionError("AGENT_WORKFLOW_NAME_CONFLICT", "工作流名称已存在。", 409)
                workflow.name = name
            if "description" in metadata:
                workflow.description = self._text(metadata.get("description"), 4000)
            agents, connections = payload.get("agents"), payload.get("connections")
            if not isinstance(agents, list) or not isinstance(connections, list):
                raise StrategyDefinitionError("VALIDATION_SCHEMA_ERROR", "agents 和 connections 必须是数组。")
            self._replace_nodes(session, version, agents, connections)
            version.revision += 1
            version.updated_at = utc_naive_now()
            workflow.revision += 1
            workflow.updated_at = utc_naive_now()
            session.flush()
            validation = self._validate_workflow_session(session, version)
            return {
                "draftId": version.id,
                "revision": version.revision,
                "savedAt": self._iso(version.updated_at),
                "validationSummary": {"errorCount": len(validation["errors"]), "warningCount": len(validation["warnings"])},
                "draft": self._workflow_version_detail(session, version),
            }

    def validate_workflow(self, version_id: int) -> dict[str, Any]:
        with self.db.get_session() as session:
            version = self._workflow_version(session, version_id)
            result = self._validate_workflow_session(session, version)
            return {**result, "workflowVersionId": version.id, "revision": version.revision, "validatedAt": self._iso(utc_naive_now())}

    def publish_workflow(self, version_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        key = self._required(payload.get("idempotencyKey"), "AGENT_WORKFLOW_PUBLISH_KEY_REQUIRED", "发布工作流需要 idempotencyKey。", 128)
        change_log = self._required(payload.get("changeLog"), "AGENT_WORKFLOW_CHANGELOG_REQUIRED", "发布工作流必须填写变更说明。", 4000)
        request_hash = hashlib.sha256(json.dumps({"revision": payload.get("revision"), "changeLog": change_log}, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        with self.db.session_scope() as session:
            existing = session.execute(select(SimulationAgentWorkflowPublishRequestRecord).where(
                SimulationAgentWorkflowPublishRequestRecord.draft_id == version_id,
                SimulationAgentWorkflowPublishRequestRecord.idempotency_key == key,
            )).scalar_one_or_none()
            if existing:
                if existing.request_hash != request_hash:
                    raise StrategyDefinitionError("AGENT_WORKFLOW_PUBLISH_KEY_CONFLICT", "同一幂等键对应了不同发布请求。", 409)
                return self._workflow_version_detail(session, self._workflow_version(session, existing.published_version_id))
            version = self._editable_workflow_version(session, version_id)
            if payload.get("revision") != version.revision:
                raise StrategyDefinitionError("AGENT_WORKFLOW_VERSION_CONFLICT", "工作流草稿已更新，请刷新后重试。", 409)
            validation = self._validate_workflow_session(session, version)
            if validation["errors"]:
                raise StrategyDefinitionError("AGENT_WORKFLOW_VALIDATION_FAILED", "工作流检查未通过。", 409, {"errors": validation["errors"]})
            workflow = self._workflow(session, version.workflow_id)
            next_number = (session.execute(select(func.max(SimulationAgentWorkflowVersionRecord.version_number)).where(
                SimulationAgentWorkflowVersionRecord.workflow_id == workflow.id,
            )).scalar() or 0) + 1
            version.status = "PUBLISHED"
            version.version_number = int(next_number)
            version.immutable = True
            version.change_log = change_log
            version.published_at = utc_naive_now()
            version.revision += 1
            version.updated_at = utc_naive_now()
            workflow.current_published_version_id = version.id
            workflow.active_draft_version_id = None
            workflow.lifecycle_status = "published"
            workflow.revision += 1
            workflow.updated_at = utc_naive_now()
            session.add(SimulationAgentWorkflowPublishRequestRecord(
                draft_id=version.id,
                idempotency_key=key,
                request_hash=request_hash,
                published_version_id=version.id,
            ))
            session.flush()
            return self._workflow_version_detail(session, version)

    def create_workflow_draft(self, workflow_id: int, based_on_version_id: int) -> dict[str, Any]:
        with self.db.session_scope() as session:
            workflow = self._workflow(session, workflow_id)
            if workflow.active_draft_version_id:
                raise StrategyDefinitionError("AGENT_WORKFLOW_ACTIVE_DRAFT_EXISTS", "该工作流已有可编辑草稿。", 409, {"activeDraftId": workflow.active_draft_version_id})
            source = self._workflow_version(session, based_on_version_id)
            if source.workflow_id != workflow.id or source.status != "PUBLISHED":
                raise StrategyDefinitionError("AGENT_WORKFLOW_SOURCE_INVALID", "只能从当前工作流的正式版本创建草稿。", 409)
            next_version = (session.execute(select(func.max(SimulationAgentWorkflowVersionRecord.version)).where(
                SimulationAgentWorkflowVersionRecord.workflow_id == workflow.id,
            )).scalar() or 0) + 1
            draft = SimulationAgentWorkflowVersionRecord(
                workflow_id=workflow.id,
                version=int(next_version),
                status="DRAFT",
                based_on_version_id=source.id,
                immutable=False,
                revision=1,
            )
            session.add(draft)
            session.flush()
            self._copy_workflow_graph(session, source, draft)
            workflow.active_draft_version_id = draft.id
            workflow.lifecycle_status = "draft"
            workflow.revision += 1
            workflow.updated_at = utc_naive_now()
            session.flush()
            return self._workflow_version_detail(session, draft)

    def archive_workflow(self, workflow_id: int) -> dict[str, Any]:
        with self.db.session_scope() as session:
            workflow = self._workflow(session, workflow_id)
            references = session.execute(select(func.count(SimulationStrategyVersionRecord.id)).where(
                SimulationStrategyVersionRecord.agent_workflow_version_id.in_(
                    select(SimulationAgentWorkflowVersionRecord.id).where(SimulationAgentWorkflowVersionRecord.workflow_id == workflow.id)
                )
            )).scalar() or 0
            workflow.archived_at = workflow.archived_at or utc_naive_now()
            workflow.lifecycle_status = "archived"
            workflow.updated_at = utc_naive_now()
            return {"workflowId": workflow.id, "archived": True, "strategyVersionReferenceCount": int(references), "historyRetained": True}

    # Strategy integration ------------------------------------------------------------
    def workflow_snapshot(self, session, workflow_version_id: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        version = self._workflow_version(session, workflow_version_id)
        if version.status != "PUBLISHED" or not version.immutable:
            raise StrategyDefinitionError("AGENT_WORKFLOW_NOT_PUBLISHED", "策略只能选择已发布的 Agent 工作流版本。", 409)
        nodes = session.execute(select(SimulationAgentWorkflowNodeRecord).where(
            SimulationAgentWorkflowNodeRecord.workflow_version_id == version.id,
        ).order_by(SimulationAgentWorkflowNodeRecord.id)).scalars().all()
        connections = session.execute(select(SimulationAgentWorkflowConnectionRecord).where(
            SimulationAgentWorkflowConnectionRecord.workflow_version_id == version.id,
        )).scalars().all()
        # Workflow-node IDs and StrategyVersion agent IDs live in separate
        # tables and can share the same integer. Namespace the client IDs so a
        # workflow switch always replaces the frozen graph instead of being
        # mistaken for an in-place lineage edit.
        node_ids = {node.id: f"workflow-node-{node.id}" for node in nodes}
        node_snapshots = [
            {**self._node_detail(node), "id": node_ids[node.id]}
            for node in nodes
        ]
        connection_snapshots = [
            {
                **self._connection_detail(connection),
                "id": f"workflow-edge-{connection.id}",
                "sourceAgentId": node_ids[connection.source_node_id],
                "targetAgentId": node_ids[connection.target_node_id],
            }
            for connection in connections
        ]
        return node_snapshots, connection_snapshots

    # Helpers ------------------------------------------------------------------------
    def _seed_templates(self, session) -> None:
        StrategyDefinitionService(self.db)._seed_agent_templates(session)

    def _seed_starter_workflow(self, session) -> None:
        templates = {row.agent_type: row for row in session.execute(select(SimulationAgentTemplateRecord).where(
            SimulationAgentTemplateRecord.archived_at.is_(None),
            SimulationAgentTemplateRecord.agent_type.in_(("SCREENING", "ANALYSIS", "DECISION", "REFLECTION")),
        )).scalars().all()}
        if not {"SCREENING", "ANALYSIS", "DECISION", "REFLECTION"}.issubset(templates):
            return
        self._seed_standard_research_workflow(session, templates)
        self._seed_daily_research_workflow(session)
        self._seed_daily_screening_workflow(session)

    def _seed_standard_research_workflow(self, session, templates: dict[str, Any]) -> None:
        if session.execute(select(SimulationAgentWorkflowRecord.id).where(
            SimulationAgentWorkflowRecord.name == "标准多 Agent 研究工作流",
        )).scalar_one_or_none():
            return
        workflow = SimulationAgentWorkflowRecord(
            name="标准多 Agent 研究工作流",
            description="候选筛选 → 证据分析 → 决策提案 → 运行后复盘。仅用于研究，不执行交易。",
            lifecycle_status="published",
            revision=1,
        )
        session.add(workflow)
        session.flush()
        version = SimulationAgentWorkflowVersionRecord(
            workflow_id=workflow.id,
            version=1,
            status="PUBLISHED",
            version_number=1,
            immutable=True,
            revision=1,
            change_log="系统默认工作流",
            published_at=utc_naive_now(),
        )
        session.add(version)
        session.flush()
        nodes: dict[str, SimulationAgentWorkflowNodeRecord] = {}
        for index, kind in enumerate(("SCREENING", "ANALYSIS", "DECISION", "REFLECTION")):
            template = templates[kind]
            tv = session.execute(select(SimulationAgentTemplateVersionRecord).where(
                SimulationAgentTemplateVersionRecord.template_id == template.id,
                SimulationAgentTemplateVersionRecord.version == template.current_version,
            )).scalar_one()
            node = SimulationAgentWorkflowNodeRecord(
                workflow_version_id=version.id,
                lineage_id=uuid.uuid4().hex,
                template_id=template.id,
                template_version=tv.version,
                agent_type=kind,
                name=template.name,
                role=tv.default_role or "",
                system_prompt=tv.default_system_prompt or "",
                prompt_template=tv.default_prompt_template or "",
                model_profile_id="default",
                execution_mode="LLM",
                tool_permissions_json=tv.supported_tools_json,
                data_permissions_json="[]",
                input_schema_json=tv.input_schema_json,
                output_schema_json=tv.output_schema_json,
                timeout_seconds=30,
                max_retries=0,
                required=True,
                failure_policy="STOP_RUN",
                cost_limit=Decimal("0.1"),
                position_x=index * 260,
                position_y=80,
            )
            session.add(node)
            session.flush()
            nodes[kind] = node
        for source, target, kind in (
            ("SCREENING", "ANALYSIS", "DATA_FLOW"),
            ("ANALYSIS", "DECISION", "DATA_FLOW"),
            ("DECISION", "REFLECTION", "POST_RUN_CONTEXT"),
        ):
            session.add(SimulationAgentWorkflowConnectionRecord(
                workflow_version_id=version.id,
                source_node_id=nodes[source].id,
                target_node_id=nodes[target].id,
                connection_type=kind,
                field_mapping_json="{}",
            ))
        workflow.current_published_version_id = version.id
        session.flush()

    def _seed_daily_research_workflow(self, session) -> None:
        """Persist the mature Daily single-stock chain as a reusable workflow.

        The first node represents the deterministic evidence preparation that
        already exists in ``StockAnalysisPipeline``.  The second node owns the
        LLM synthesis step.  Keeping them separate makes the contract visible
        without pretending that every data transformation is an Agent.
        """
        name = "Daily · 单股研究工作流"
        if session.execute(select(SimulationAgentWorkflowRecord.id).where(
            SimulationAgentWorkflowRecord.name == name,
        )).scalar_one_or_none():
            return
        nodes = [
            {
                "key": "evidence",
                "agentType": "ANALYSIS",
                "name": "单股证据准备",
                "role": "围绕运行时指定的一只股票准备带来源和截止时间的研究证据包。",
                "systemPrompt": "仅执行确定性数据准备：行情落库、实时行情、筹码、基本面、技术趋势、新闻情报与市场环境。缺失项必须保留缺失原因，不得生成投资结论。",
                "executionMode": "DETERMINISTIC",
                "toolPermissions": [
                    "daily.fetch_and_save_market_data",
                    "daily.realtime_quote",
                    "daily.chip_distribution",
                    "daily.fundamental_context",
                    "daily.technical_trend",
                    "daily.news_intelligence",
                    "daily.market_context",
                ],
                "dataPermissions": ["kline", "news", "fundamentals", "market_context"],
                "inputSchema": {
                    "type": "object",
                    "required": ["symbol"],
                    "properties": {
                        "symbol": {"type": "string", "description": "本次研究的证券代码"},
                        "market": {"type": "string", "description": "可选市场；未传入时由证券代码识别"},
                        "asOf": {"type": "string", "description": "本次研究的数据截止时间"},
                    },
                },
                "outputSchema": {
                    "type": "object",
                    "required": ["symbol", "evidence", "dataQuality"],
                    "properties": {
                        "symbol": {"type": "string"},
                        "evidence": {"type": "object", "description": "行情、筹码、基本面、趋势、新闻与市场上下文"},
                        "dataQuality": {"type": "object", "description": "来源、截止时间、缺失与降级说明"},
                    },
                },
                "timeoutSeconds": 180,
                "costLimit": "0.100000",
            },
            {
                "key": "report",
                "agentType": "ANALYSIS",
                "name": "单股综合研究报告",
                "role": "只根据上游证据形成结构化、可解释的单股研究报告。",
                "systemPrompt": "你是 Daily 单股研究报告 LLM。只使用上游证据，综合趋势、基本面、新闻、筹码、市场阶段与风险形成报告；证据不足时明确标记 unknown。输出研究观点、评分、操作建议、风险和失效条件，但不得声称已交易或产生收益。",
                "executionMode": "LLM",
                "modelProfileId": "default",
                "toolPermissions": [],
                "dataPermissions": ["upstream_evidence"],
                "inputSchema": {
                    "type": "object",
                    "required": ["symbol", "evidence", "dataQuality"],
                    "properties": {
                        "symbol": {"type": "string"},
                        "evidence": {"type": "object"},
                        "dataQuality": {"type": "object"},
                    },
                },
                "outputSchema": {
                    "type": "object",
                    "required": ["symbol", "summary", "score"],
                    "properties": {
                        "symbol": {"type": "string"},
                        "summary": {"type": "string", "description": "综合研究结论"},
                        "score": {"type": "number", "description": "研究评分"},
                        "operationAdvice": {"type": "string"},
                        "trendPrediction": {"type": "string"},
                        "positiveFactors": {"type": "array", "items": {"type": "string"}},
                        "riskFactors": {"type": "array", "items": {"type": "string"}},
                        "invalidation": {"type": "string"},
                        "evidenceCoverage": {"type": "object"},
                    },
                },
                "timeoutSeconds": 180,
                "costLimit": "1.000000",
            },
        ]
        self._create_system_workflow(
            session,
            name=name,
            description="复现 Daily 成熟单股研究主链：确定性证据准备 → LLM 综合报告。输入股票在运行时指定，输出 ResearchReport，不进入交易运行。",
            nodes=nodes,
            connections=[("evidence", "report", "DATA_FLOW")],
            change_log="系统内置 Daily 单股研究工作流",
        )

    def _seed_daily_screening_workflow(self, session) -> None:
        """Persist Daily's hard-filter/score/rerank screening pipeline."""
        name = "Daily · 选股扫描工作流"
        if session.execute(select(SimulationAgentWorkflowRecord.id).where(
            SimulationAgentWorkflowRecord.name == name,
        )).scalar_one_or_none():
            return
        self._create_system_workflow(
            session,
            name=name,
            description="复现 Daily 成熟选股主链：市场快照 → 硬筛 → 按配置选择日线补充 → 多因子评分 → 候选上下文 → 可选 LLM 重排 → 风险与后分析，输出 CandidateList。",
            nodes=[{
                "key": "screening",
                "agentType": "SCREENING",
                "name": "Daily 选股扫描",
                "role": "在策略市场和筛选参数内执行 Daily 的确定性筛选与可选 LLM 候选重排。",
                "systemPrompt": "先执行全市场快照、硬过滤和多因子评分；仅当筛选配置要求或明确启用时补充历史日线特征。只有配置可用 LLM 时才对确定性候选池重排。LLM 不得新增候选或绕过硬过滤；失败时回退到确定性 screen_score。输出候选、排名依据、风险和数据降级说明。",
                "executionMode": "HYBRID",
                "modelProfileId": "default",
                "toolPermissions": [
                    "screening.market_snapshot",
                    "screening.hard_filter",
                    "screening.daily_enrichment",
                    "screening.factor_score",
                    "screening.candidate_context",
                    "screening.llm_rerank",
                    "screening.risk_overlay",
                    "screening.post_analysis",
                ],
                "dataPermissions": ["market_snapshot", "kline", "news", "fundamentals"],
                "inputSchema": {
                    "type": "object",
                    "required": ["market", "strategy", "maxCandidates"],
                    "properties": {
                        "market": {"type": "string"},
                        "strategy": {"type": "string", "description": "Daily 筛选策略标识"},
                        "maxCandidates": {"type": "integer"},
                        "useLlm": {"type": "boolean"},
                        "postAnalyzers": {"type": "array", "items": {"type": "string"}},
                    },
                },
                "outputSchema": {
                    "type": "object",
                    "required": ["candidates"],
                    "properties": {
                        "candidates": {"type": "array", "items": {"type": "object"}},
                        "snapshotCount": {"type": "integer"},
                        "afterFilterCount": {"type": "integer"},
                        "llmRanked": {"type": "boolean"},
                        "degradation": {"type": "array", "items": {"type": "string"}},
                    },
                },
                "timeoutSeconds": 300,
                "costLimit": "1.000000",
            }],
            connections=[],
            change_log="系统内置 Daily 选股扫描工作流",
        )

    def _create_system_workflow(
        self,
        session,
        *,
        name: str,
        description: str,
        nodes: list[dict[str, Any]],
        connections: list[tuple[str, str, str]],
        change_log: str,
    ) -> None:
        workflow = SimulationAgentWorkflowRecord(
            name=name,
            description=description,
            lifecycle_status="published",
            revision=1,
        )
        session.add(workflow)
        session.flush()
        version = SimulationAgentWorkflowVersionRecord(
            workflow_id=workflow.id,
            version=1,
            status="PUBLISHED",
            version_number=1,
            immutable=True,
            revision=1,
            change_log=change_log,
            published_at=utc_naive_now(),
        )
        session.add(version)
        session.flush()
        records: dict[str, SimulationAgentWorkflowNodeRecord] = {}
        for index, item in enumerate(nodes):
            record = SimulationAgentWorkflowNodeRecord(
                workflow_version_id=version.id,
                lineage_id=f"system-{item['key']}-v1",
                agent_type=str(item["agentType"]),
                name=str(item["name"]),
                role=str(item["role"]),
                system_prompt=str(item["systemPrompt"]),
                prompt_template="",
                model_profile_id=item.get("modelProfileId"),
                execution_mode=str(item["executionMode"]),
                tool_permissions_json=self._dump(item["toolPermissions"]),
                data_permissions_json=self._dump(item["dataPermissions"]),
                input_schema_json=self._dump(item["inputSchema"]),
                output_schema_json=self._dump(item["outputSchema"]),
                timeout_seconds=int(item["timeoutSeconds"]),
                max_retries=0,
                required=True,
                failure_policy="STOP_RUN",
                cost_limit=Decimal(str(item["costLimit"])),
                position_x=index * 300,
                position_y=80,
            )
            session.add(record)
            session.flush()
            records[str(item["key"])] = record
        for source, target, connection_type in connections:
            session.add(SimulationAgentWorkflowConnectionRecord(
                workflow_version_id=version.id,
                source_node_id=records[source].id,
                target_node_id=records[target].id,
                connection_type=connection_type,
                field_mapping_json="{}",
            ))
        workflow.current_published_version_id = version.id
        validation = self._validate_workflow_session(session, version)
        if not validation["valid"]:
            raise StrategyDefinitionError(
                "SYSTEM_WORKFLOW_INVALID",
                f"系统工作流“{name}”未通过校验。",
                500,
                {"errors": validation["errors"]},
            )
        session.flush()

    def _replace_nodes(self, session, version, agents: list[dict[str, Any]], connections: list[dict[str, Any]]) -> None:
        old = {str(row.id): row for row in session.execute(select(SimulationAgentWorkflowNodeRecord).where(
            SimulationAgentWorkflowNodeRecord.workflow_version_id == version.id,
        )).scalars().all()}
        session.query(SimulationAgentWorkflowConnectionRecord).filter(
            SimulationAgentWorkflowConnectionRecord.workflow_version_id == version.id
        ).delete(synchronize_session=False)
        id_map: dict[str, int] = {}
        lineages: set[str] = set()
        for item in agents:
            if not isinstance(item, dict):
                raise StrategyDefinitionError("AGENT_CONFIG_INVALID", "Agent 配置无效。")
            client_id = str(item.get("id") or "")
            lineage = str(item.get("lineageId") or uuid.uuid4().hex)
            if lineage in lineages:
                raise StrategyDefinitionError("AGENT_LINEAGE_CONFLICT", "同一工作流中的 Agent lineage 重复。")
            lineages.add(lineage)
            record = old.pop(client_id, None) if client_id else None
            if record is None:
                record = SimulationAgentWorkflowNodeRecord(workflow_version_id=version.id, lineage_id=lineage, agent_type="ANALYSIS")
                session.add(record)
            elif record.lineage_id != lineage:
                raise StrategyDefinitionError("AGENT_LINEAGE_CONFLICT", "已存在节点的 lineage 不可修改。", 409)
            self._assign_node(record, item)
            session.flush()
            id_map[client_id or str(record.id)] = record.id
        for record in old.values():
            session.delete(record)
        pairs: set[tuple[int, int, str]] = set()
        for item in connections:
            if not isinstance(item, dict):
                raise StrategyDefinitionError("CONNECTION_CONFIG_INVALID", "连接配置无效。")
            source, target = str(item.get("sourceAgentId") or ""), str(item.get("targetAgentId") or "")
            if source not in id_map or target not in id_map:
                raise StrategyDefinitionError("CONNECTION_CROSS_VERSION", "连接必须引用当前工作流草稿中的 Agent。")
            kind = str(item.get("connectionType") or "DATA_FLOW").upper()
            pair = (id_map[source], id_map[target], kind)
            if pair in pairs:
                raise StrategyDefinitionError("CONNECTION_DUPLICATE", "不允许重复连接。", 409)
            pairs.add(pair)
            session.add(SimulationAgentWorkflowConnectionRecord(
                workflow_version_id=version.id,
                source_node_id=pair[0],
                target_node_id=pair[1],
                connection_type=kind,
                condition=self._text(item.get("condition"), 4000),
                field_mapping_json=self._dump(item.get("fieldMapping") or {}),
            ))

    def _assign_node(self, row, item: dict[str, Any]) -> None:
        row.agent_type = self._agent_type(item.get("agentType"))
        row.name = self._required(item.get("name"), "AGENT_CONFIG_INVALID", "Agent 名称不能为空。", 120)
        row.role = self._required(item.get("role"), "AGENT_CONFIG_INVALID", "Agent 职责不能为空。", 4000)
        row.template_id = self._integer(item.get("agentTemplateId"))
        row.template_version = self._integer(item.get("agentTemplateVersion"))
        row.system_prompt = self._text(item.get("systemPrompt"), 30000) or ""
        row.prompt_template = self._text(item.get("promptTemplate"), 30000) or ""
        row.model_profile_id = self._text(item.get("modelProfileId"), 128)
        row.fallback_model_profile_id = self._text(item.get("fallbackModelProfileId"), 128)
        row.execution_mode = str(item.get("executionMode") or "LLM").upper()
        row.tool_permissions_json = self._dump(item.get("toolPermissions") or [])
        row.data_permissions_json = self._dump(item.get("dataPermissions") or [])
        row.input_schema_json = self._dump(item.get("inputSchema") or {})
        row.output_schema_json = self._dump(item.get("outputSchema") or {})
        row.timeout_seconds = int(item.get("timeoutSeconds") or 0)
        row.max_retries = int(item.get("maxRetries") or 0)
        row.required = bool(item.get("required", True))
        row.failure_policy = str(item.get("failurePolicy") or "").upper()
        row.cost_limit = Decimal(str(item.get("costLimit") or "0"))
        row.position_x = int(item.get("positionX") or 0)
        row.position_y = int(item.get("positionY") or 0)

    def _copy_strategy_graph(self, session, source, target) -> None:
        nodes = session.execute(select(SimulationAgentInstanceRecord).where(
            SimulationAgentInstanceRecord.strategy_version_id == source.id,
            SimulationAgentInstanceRecord.agent_type != "INPUT",
        )).scalars().all()
        mapping: dict[int, int] = {}
        for old in nodes:
            node = self._node_from_agent(old, target.id)
            session.add(node)
            session.flush()
            mapping[old.id] = node.id
        for edge in session.execute(select(SimulationAgentConnectionRecord).where(
            SimulationAgentConnectionRecord.strategy_version_id == source.id,
        )).scalars().all():
            if edge.source_agent_id in mapping and edge.target_agent_id in mapping:
                session.add(SimulationAgentWorkflowConnectionRecord(
                    workflow_version_id=target.id,
                    source_node_id=mapping[edge.source_agent_id],
                    target_node_id=mapping[edge.target_agent_id],
                    connection_type=edge.connection_type,
                    condition=edge.condition,
                    field_mapping_json=edge.field_mapping_json,
                ))

    def _copy_workflow_graph(self, session, source, target) -> None:
        nodes = session.execute(select(SimulationAgentWorkflowNodeRecord).where(
            SimulationAgentWorkflowNodeRecord.workflow_version_id == source.id,
        )).scalars().all()
        mapping: dict[int, int] = {}
        for old in nodes:
            node = self._clone_node(old, target.id)
            session.add(node)
            session.flush()
            mapping[old.id] = node.id
        for edge in session.execute(select(SimulationAgentWorkflowConnectionRecord).where(
            SimulationAgentWorkflowConnectionRecord.workflow_version_id == source.id,
        )).scalars().all():
            session.add(SimulationAgentWorkflowConnectionRecord(
                workflow_version_id=target.id,
                source_node_id=mapping[edge.source_node_id],
                target_node_id=mapping[edge.target_node_id],
                connection_type=edge.connection_type,
                condition=edge.condition,
                field_mapping_json=edge.field_mapping_json,
            ))

    def _validate_workflow_session(self, session, version) -> dict[str, Any]:
        nodes = session.execute(select(SimulationAgentWorkflowNodeRecord).where(
            SimulationAgentWorkflowNodeRecord.workflow_version_id == version.id,
        )).scalars().all()
        connections = session.execute(select(SimulationAgentWorkflowConnectionRecord).where(
            SimulationAgentWorkflowConnectionRecord.workflow_version_id == version.id,
        )).scalars().all()
        return self.validator.validate_workflow({
            "agents": [self._node_config(row) for row in nodes],
            "connections": [{
                "id": str(row.id),
                "source_agent_id": str(row.source_node_id),
                "target_agent_id": str(row.target_node_id),
                "connection_type": row.connection_type,
                "field_mapping": self._load(row.field_mapping_json),
            } for row in connections],
        }).as_dict()

    def _workflow_summary(self, session, row) -> dict[str, Any]:
        current = session.get(SimulationAgentWorkflowVersionRecord, row.current_published_version_id) if row.current_published_version_id else None
        draft = session.get(SimulationAgentWorkflowVersionRecord, row.active_draft_version_id) if row.active_draft_version_id else None
        display = draft or current
        counts = self._workflow_counts(session, display.id) if display else (0, 0)
        return {
            "id": row.id,
            "name": row.name,
            "description": row.description,
            "lifecycleStatus": row.lifecycle_status,
            "revision": row.revision,
            "activeDraftVersionId": row.active_draft_version_id,
            "currentPublishedVersionId": row.current_published_version_id,
            "currentPublishedVersionNumber": current.version_number if current else None,
            "agentCount": counts[0],
            "connectionCount": counts[1],
            "archivedAt": self._iso(row.archived_at),
            "createdAt": self._iso(row.created_at),
            "updatedAt": self._iso(row.updated_at),
        }

    def _workflow_version_summary(self, session, row) -> dict[str, Any]:
        counts = self._workflow_counts(session, row.id)
        nodes = session.execute(select(SimulationAgentWorkflowNodeRecord).where(
            SimulationAgentWorkflowNodeRecord.workflow_version_id == row.id,
        )).scalars().all()
        connections = session.execute(select(SimulationAgentWorkflowConnectionRecord).where(
            SimulationAgentWorkflowConnectionRecord.workflow_version_id == row.id,
        )).scalars().all()
        output_contract = self.validator.output_contract(
            [self._node_config(node) for node in nodes],
            [{"source_agent_id": str(edge.source_node_id), "connection_type": edge.connection_type} for edge in connections],
        )
        return {
            "id": row.id,
            "workflowId": row.workflow_id,
            "status": row.status,
            "versionNumber": row.version_number,
            "basedOnVersionId": row.based_on_version_id,
            "changeLog": row.change_log,
            "revision": row.revision,
            "immutable": row.immutable,
            "agentCount": counts[0],
            "connectionCount": counts[1],
            "outputContract": output_contract,
            "createdAt": self._iso(row.created_at),
            "updatedAt": self._iso(row.updated_at),
            "publishedAt": self._iso(row.published_at),
        }

    def _workflow_version_detail(self, session, row) -> dict[str, Any]:
        result = self._workflow_version_summary(session, row)
        nodes = session.execute(select(SimulationAgentWorkflowNodeRecord).where(
            SimulationAgentWorkflowNodeRecord.workflow_version_id == row.id,
        ).order_by(SimulationAgentWorkflowNodeRecord.id)).scalars().all()
        connections = session.execute(select(SimulationAgentWorkflowConnectionRecord).where(
            SimulationAgentWorkflowConnectionRecord.workflow_version_id == row.id,
        )).scalars().all()
        result.update({"agents": [self._node_detail(node) for node in nodes], "connections": [self._connection_detail(connection) for connection in connections]})
        return result

    def _node_config(self, row) -> dict[str, Any]:
        return {
            "id": str(row.id), "type": row.agent_type, "name": row.name, "role": row.role,
            "model_profile_id": row.model_profile_id, "deterministic": row.execution_mode == "DETERMINISTIC",
            "tool_permissions": self._load(row.tool_permissions_json), "data_permissions": self._load(row.data_permissions_json),
            "input_schema": self._load(row.input_schema_json), "output_schema": self._load(row.output_schema_json),
            "timeout_seconds": row.timeout_seconds, "max_retries": row.max_retries, "required": row.required,
            "failure_policy": row.failure_policy, "cost_limit": float(row.cost_limit or 0),
        }

    def _node_detail(self, row) -> dict[str, Any]:
        return {
            "id": str(row.id), "lineageId": row.lineage_id, "agentTemplateId": row.template_id,
            "agentTemplateVersion": row.template_version, "agentType": row.agent_type, "name": row.name,
            "role": row.role, "systemPrompt": row.system_prompt, "promptTemplate": row.prompt_template,
            "modelProfileId": row.model_profile_id, "fallbackModelProfileId": row.fallback_model_profile_id,
            "executionMode": row.execution_mode, "toolPermissions": self._load(row.tool_permissions_json),
            "dataPermissions": self._load(row.data_permissions_json), "inputSchema": self._load(row.input_schema_json),
            "outputSchema": self._load(row.output_schema_json), "timeoutSeconds": row.timeout_seconds,
            "maxRetries": row.max_retries, "required": row.required, "failurePolicy": row.failure_policy,
            "costLimit": str(row.cost_limit), "positionX": row.position_x, "positionY": row.position_y,
        }

    def _connection_detail(self, row) -> dict[str, Any]:
        return {"id": str(row.id), "sourceAgentId": str(row.source_node_id), "targetAgentId": str(row.target_node_id), "connectionType": row.connection_type, "condition": row.condition, "fieldMapping": self._load(row.field_mapping_json)}

    def _node_from_agent(self, row, workflow_version_id: int):
        return SimulationAgentWorkflowNodeRecord(
            workflow_version_id=workflow_version_id, lineage_id=row.lineage_id or uuid.uuid4().hex,
            template_id=row.template_id, template_version=row.template_version, agent_type=row.agent_type,
            name=row.name, role=row.role, system_prompt=row.system_prompt, prompt_template=row.prompt_template,
            model_profile_id=row.model_profile_id, fallback_model_profile_id=row.fallback_model_profile_id,
            execution_mode=row.execution_mode, tool_permissions_json=row.tool_permissions_json,
            data_permissions_json=row.data_permissions_json, input_schema_json=row.input_schema_json,
            output_schema_json=row.output_schema_json, timeout_seconds=row.timeout_seconds,
            max_retries=row.max_retries, required=row.required, failure_policy=row.failure_policy,
            cost_limit=row.cost_limit, position_x=row.position_x, position_y=row.position_y,
        )

    def _clone_node(self, row, workflow_version_id: int):
        return SimulationAgentWorkflowNodeRecord(
            workflow_version_id=workflow_version_id, lineage_id=row.lineage_id,
            template_id=row.template_id, template_version=row.template_version, agent_type=row.agent_type,
            name=row.name, role=row.role, system_prompt=row.system_prompt, prompt_template=row.prompt_template,
            model_profile_id=row.model_profile_id, fallback_model_profile_id=row.fallback_model_profile_id,
            execution_mode=row.execution_mode, tool_permissions_json=row.tool_permissions_json,
            data_permissions_json=row.data_permissions_json, input_schema_json=row.input_schema_json,
            output_schema_json=row.output_schema_json, timeout_seconds=row.timeout_seconds,
            max_retries=row.max_retries, required=row.required, failure_policy=row.failure_policy,
            cost_limit=row.cost_limit, position_x=row.position_x, position_y=row.position_y,
        )

    def _assign_template_version(self, row, payload: dict[str, Any]) -> None:
        row.default_role = self._required(payload.get("defaultRole"), "AGENT_TEMPLATE_ROLE_REQUIRED", "Agent 职责不能为空。", 4000)
        row.default_system_prompt = self._required(payload.get("defaultSystemPrompt"), "AGENT_TEMPLATE_PROMPT_REQUIRED", "System Prompt 不能为空。", 30000)
        row.default_prompt_template = self._text(payload.get("defaultPromptTemplate"), 30000) or ""
        input_schema = self._capability_schema(payload.get("inputSchema"), "Input Schema")
        output_schema = self._capability_schema(payload.get("outputSchema"), "Output Schema")
        row.input_schema_json = self._dump(input_schema)
        row.output_schema_json = self._dump(output_schema)
        row.supported_tools_json = self._dump(self._string_list(payload.get("supportedTools")))
        row.supported_data_types_json = self._dump(self._string_list(payload.get("supportedDataTypes")))

    def _template_version_payload(self, row) -> dict[str, Any]:
        return {"defaultRole": row.default_role, "defaultSystemPrompt": row.default_system_prompt, "defaultPromptTemplate": row.default_prompt_template, "inputSchema": self._load(row.input_schema_json), "outputSchema": self._load(row.output_schema_json), "supportedTools": self._load(row.supported_tools_json), "supportedDataTypes": self._load(row.supported_data_types_json)}

    @staticmethod
    def _capability_schema(value: Any, label: str) -> dict[str, Any]:
        if not isinstance(value, dict) or value.get("type") != "object":
            raise StrategyDefinitionError(
                "AGENT_TEMPLATE_SCHEMA_INVALID",
                f"{label} 必须是 type=object 的 JSON Schema。",
            )
        properties = value.get("properties")
        if not isinstance(properties, dict) or not properties:
            raise StrategyDefinitionError(
                "AGENT_TEMPLATE_SCHEMA_INVALID",
                f"{label} 必须至少定义一个 properties 字段。",
            )
        required = value.get("required")
        if required is not None:
            if not isinstance(required, list) or any(not isinstance(item, str) for item in required):
                raise StrategyDefinitionError(
                    "AGENT_TEMPLATE_SCHEMA_INVALID",
                    f"{label} 的 required 必须是字段名数组。",
                )
            missing = next((item for item in required if item not in properties), None)
            if missing:
                raise StrategyDefinitionError(
                    "AGENT_TEMPLATE_SCHEMA_INVALID",
                    f"{label} 的必填字段“{missing}”未在 properties 中定义。",
                )
        return value

    def _template_summary(self, session, row) -> dict[str, Any]:
        version = session.execute(select(SimulationAgentTemplateVersionRecord).where(
            SimulationAgentTemplateVersionRecord.template_id == row.id,
            SimulationAgentTemplateVersionRecord.version == row.current_version,
        )).scalar_one()
        return {"templateId": row.id, "name": row.name, "description": row.description, "agentType": row.agent_type, "currentVersion": row.current_version, "supportedTools": self._load(version.supported_tools_json), "supportedDataTypes": self._load(version.supported_data_types_json), "archived": bool(row.archived_at), "updatedAt": self._iso(row.updated_at)}

    def _template_detail(self, template, row) -> dict[str, Any]:
        return {**self._template_summary_from_version(template, row), "templateVersion": row.version, "defaultRole": row.default_role, "defaultSystemPrompt": row.default_system_prompt, "defaultPromptTemplate": row.default_prompt_template, "inputSchema": self._load(row.input_schema_json), "outputSchema": self._load(row.output_schema_json), "publishedAt": self._iso(row.published_at)}

    def _template_summary_from_version(self, template, row) -> dict[str, Any]:
        return {"templateId": template.id, "name": template.name, "description": template.description, "agentType": template.agent_type, "currentVersion": template.current_version, "supportedTools": self._load(row.supported_tools_json), "supportedDataTypes": self._load(row.supported_data_types_json), "archived": bool(template.archived_at), "updatedAt": self._iso(template.updated_at)}

    def _workflow_counts(self, session, version_id: int) -> tuple[int, int]:
        agents = session.execute(select(func.count(SimulationAgentWorkflowNodeRecord.id)).where(SimulationAgentWorkflowNodeRecord.workflow_version_id == version_id)).scalar() or 0
        connections = session.execute(select(func.count(SimulationAgentWorkflowConnectionRecord.id)).where(SimulationAgentWorkflowConnectionRecord.workflow_version_id == version_id)).scalar() or 0
        return int(agents), int(connections)

    @staticmethod
    def _required(value: Any, code: str, message: str, maximum: int) -> str:
        text = str(value).strip() if value is not None else ""
        if not text:
            raise StrategyDefinitionError(code, message)
        if len(text) > maximum:
            raise StrategyDefinitionError(code, message)
        return text

    @staticmethod
    def _text(value: Any, maximum: Optional[int] = None) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text[:maximum] if maximum else text

    @staticmethod
    def _integer(value: Any) -> Optional[int]:
        if value in (None, ""):
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _agent_type(value: Any) -> str:
        kind = str(value or "").upper()
        if kind not in ALLOWED_AGENT_TYPES:
            raise StrategyDefinitionError("AGENT_TYPE_INVALID", "Agent 类型必须是选股、分析、决策或反思。")
        return kind

    @staticmethod
    def _string_list(value: Any) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise StrategyDefinitionError("AGENT_TEMPLATE_LIST_INVALID", "工具和数据类型必须是数组。")
        return list(dict.fromkeys(str(item).strip() for item in value if str(item).strip()))

    @staticmethod
    def _dump(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)

    @staticmethod
    def _load(value: Optional[str]) -> Any:
        try:
            return json.loads(value or "{}")
        except (TypeError, ValueError):
            return {}

    @staticmethod
    def _iso(value) -> Optional[str]:
        return value.isoformat() + "Z" if value else None

    @staticmethod
    def _template(session, template_id: int):
        row = session.get(SimulationAgentTemplateRecord, template_id)
        if not row:
            raise StrategyDefinitionError("AGENT_TEMPLATE_NOT_FOUND", "Agent 模板不存在。", 404)
        return row

    @staticmethod
    def _workflow(session, workflow_id: int):
        row = session.get(SimulationAgentWorkflowRecord, workflow_id)
        if not row:
            raise StrategyDefinitionError("AGENT_WORKFLOW_NOT_FOUND", "Agent 工作流不存在。", 404)
        return row

    @staticmethod
    def _workflow_version(session, version_id: int):
        row = session.get(SimulationAgentWorkflowVersionRecord, version_id)
        if not row:
            raise StrategyDefinitionError("AGENT_WORKFLOW_VERSION_NOT_FOUND", "Agent 工作流版本不存在。", 404)
        return row

    def _editable_workflow_version(self, session, version_id: int):
        row = self._workflow_version(session, version_id)
        if row.status != "DRAFT" or row.immutable:
            raise StrategyDefinitionError("AGENT_WORKFLOW_VERSION_IMMUTABLE", "已发布工作流不可直接修改，请创建新草稿。", 409)
        return row
