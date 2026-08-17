"""Authoritative static validation for persisted multi-Agent strategy graphs.

The validator deliberately operates on JSON-serialisable strategy snapshots so
the exact same rules can be run before a draft is published and before a Run
is created.  It does not execute models or access market data.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Iterable


DATA_FLOW = "DATA_FLOW"
POST_RUN_CONTEXT = "POST_RUN_CONTEXT"
VALID_TYPES = {"INPUT", "SCREENING", "ANALYSIS", "DECISION", "REFLECTION"}
STRATEGY_PURPOSES = {"research_report", "candidate_screening", "trading_decision"}
PURPOSE_OUTPUT_CONTRACT = {
    "research_report": "ResearchReport",
    "candidate_screening": "CandidateList",
    "trading_decision": "DecisionProposal",
}
ALLOWED_DATA_FLOW = {
    ("INPUT", "ANALYSIS"),
    ("INPUT", "DECISION"),
    ("SCREENING", "ANALYSIS"),
    ("SCREENING", "DECISION"),
    ("ANALYSIS", "ANALYSIS"),
    ("ANALYSIS", "DECISION"),
    ("DECISION", "DECISION"),
}


@dataclass(frozen=True)
class GraphIssue:
    code: str
    message: str
    agent_ids: list[str] = field(default_factory=list)
    connection_ids: list[str] = field(default_factory=list)
    field_path: str | None = None
    suggestion: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class GraphValidationResult:
    errors: list[GraphIssue] = field(default_factory=list)
    warnings: list[GraphIssue] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return not self.errors

    def as_dict(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "errors": [issue.as_dict() for issue in self.errors],
            "warnings": [issue.as_dict() for issue in self.warnings],
        }


class StrategyGraphValidator:
    """Validate agent topology and the minimum configuration contract."""

    def validate(self, config: dict[str, Any]) -> GraphValidationResult:
        result = GraphValidationResult()
        agents = self._items(config.get("agents"))
        connections = self._items(config.get("connections"))
        agent_by_id: dict[str, dict[str, Any]] = {}
        seen_agent_ids: set[str] = set()
        for agent in agents:
            agent_id = self._text(agent.get("id"))
            if not agent_id:
                result.errors.append(GraphIssue("AGENT_ID_MISSING", "Agent 缺少 ID。"))
                continue
            if agent_id in seen_agent_ids:
                result.errors.append(GraphIssue("AGENT_ID_DUPLICATE", "Agent ID 重复。", [agent_id]))
                continue
            seen_agent_ids.add(agent_id)
            agent_by_id[agent_id] = agent
            self._validate_agent_config(agent, result)

        purpose = self._text(config.get("strategy_purpose") or "trading_decision").lower()
        if purpose not in STRATEGY_PURPOSES:
            result.errors.append(GraphIssue(
                "STRATEGY_PURPOSE_INVALID",
                "策略产出目标无效，请重新选择研究报告、选股结果或交易决策。",
                field_path="strategyPurpose",
            ))
            purpose = "trading_decision"
        if config.get("workflow_reference_required") and not config.get("agent_workflow_version_id"):
            result.errors.append(GraphIssue(
                "AGENT_WORKFLOW_VERSION_REQUIRED",
                "策略草稿缺少可执行内核；请从默认策略复制完整版本。旧内嵌节点快照只能用于历史只读兼容。",
                field_path="agentWorkflowVersionId",
            ))
        self._validate_required_types(agent_by_id, result, purpose)
        self._validate_data_sources(config, agent_by_id, result)
        final_decision_id = self._final_decision(config, agent_by_id, result) if purpose == "trading_decision" else None
        edges = self._validate_connections(connections, agent_by_id, result)
        self._validate_data_flow(edges, agent_by_id, result, final_decision_id)
        actual_contract = self.output_contract(agents, connections)
        expected_contract = PURPOSE_OUTPUT_CONTRACT[purpose]
        if actual_contract != expected_contract:
            result.errors.append(GraphIssue(
                "WORKFLOW_OUTPUT_CONTRACT_MISMATCH",
                f"当前策略内核输出 {actual_contract}，不能满足声明的 {expected_contract} 契约。请复制同类型默认策略或重新生成策略包。",
                field_path="agentWorkflowVersionId",
            ))
        if purpose == "trading_decision" and not any(self._agent_type(agent) == "REFLECTION" for agent in agent_by_id.values()):
            result.warnings.append(GraphIssue("NO_REFLECTION_AGENT", "当前策略未配置反思 Agent，这不会阻止发布。"))
        if purpose == "trading_decision" and not config.get("risk_policy"):
            result.errors.append(GraphIssue("RISK_POLICY_MISSING", "策略未配置硬性风险规则。"))
        elif purpose == "trading_decision" and not config.get("risk_policy", {}).get("decision_validity"):
            result.errors.append(GraphIssue("DECISION_VALIDITY_RULE_MISSING", "风险策略缺少决策有效期规则。", field_path="riskPolicy.decisionValidity"))
        market_scope = config.get("market_scope") if isinstance(config.get("market_scope"), dict) else {}
        if str(market_scope.get("universeMode") or "").lower() == "fixed":
            symbols = market_scope.get("symbols")
            if not isinstance(symbols, list) or not any(self._text(item) for item in symbols):
                result.errors.append(GraphIssue(
                    "FIXED_UNIVERSE_SYMBOLS_MISSING",
                    "策略选择了固定股票池，但尚未填写股票代码。",
                    field_path="marketScope.symbols",
                ))
        return result

    def validate_workflow(self, config: dict[str, Any]) -> GraphValidationResult:
        """Validate an Agent workflow without strategy-level data/risk policy.

        A workflow owns reusable Agent orchestration only.  Market scope,
        concrete data connections and hard risk policy are selected by the
        StrategyVersion that consumes a published workflow.
        """
        agents = self._items(config.get("agents"))
        connections = self._items(config.get("connections"))
        contract = self.output_contract(agents, connections)
        purpose = next((key for key, value in PURPOSE_OUTPUT_CONTRACT.items() if value == contract), "trading_decision")
        return self.validate({
            **config,
            "strategy_purpose": purpose,
            "workflow_reference_required": False,
            "market_scope": {},
            "data_sources": {
                "kline": {"enabled": True, "connection": "strategy-owned"},
            },
            "risk_policy": {"decision_validity": {"max": "strategy-owned"}},
        })

    @staticmethod
    def _items(value: Any) -> list[dict[str, Any]]:
        return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []

    @staticmethod
    def _text(value: Any) -> str:
        return str(value).strip() if value is not None else ""

    def _agent_type(self, agent: dict[str, Any]) -> str:
        return self._text(agent.get("type")).upper()

    def _validate_agent_config(self, agent: dict[str, Any], result: GraphValidationResult) -> None:
        agent_id = self._text(agent.get("id"))
        kind = self._agent_type(agent)
        if kind not in VALID_TYPES:
            result.errors.append(GraphIssue("AGENT_TYPE_INVALID", "Agent 类型无效。", [agent_id]))
        for key, code, label in (
            ("name", "AGENT_NAME_MISSING", "名称"),
            ("role", "AGENT_ROLE_MISSING", "职责"),
            ("failure_policy", "AGENT_FAILURE_POLICY_MISSING", "失败策略"),
            ("tool_permissions", "AGENT_TOOL_PERMISSION_MISSING", "工具权限"),
        ):
            if key == "tool_permissions":
                if not isinstance(agent.get(key), list):
                    result.errors.append(GraphIssue(code, f"Agent 缺少{label}。", [agent_id], field_path="toolPermissions"))
                continue
            if not self._text(agent.get(key)):
                result.errors.append(GraphIssue(code, f"Agent 缺少{label}。", [agent_id]))
        self._validate_capability_schema(agent.get("input_schema"), "输入", "AGENT_INPUT_SCHEMA_INVALID", agent_id, result)
        self._validate_capability_schema(agent.get("output_schema"), "输出", "AGENT_OUTPUT_SCHEMA_INVALID", agent_id, result)
        deterministic = bool(agent.get("deterministic"))
        if not deterministic and not self._text(agent.get("model_profile_id")):
            result.errors.append(GraphIssue("AGENT_MODEL_MISSING", "Agent 未配置模型。", [agent_id]))
        if not isinstance(agent.get("data_permissions"), list):
            result.errors.append(GraphIssue("AGENT_DATA_PERMISSION_MISSING", "Agent 未配置数据权限。", [agent_id]))
        retries = agent.get("max_retries")
        if not isinstance(retries, int) or retries < 0 or retries > 10:
            result.errors.append(GraphIssue("AGENT_RETRY_INVALID", "Agent 重试次数必须在 0 到 10 之间。", [agent_id]))
        timeout = agent.get("timeout_seconds")
        if not isinstance(timeout, int) or timeout <= 0 or timeout > 3600:
            result.errors.append(GraphIssue("AGENT_TIMEOUT_INVALID", "Agent 超时设置无效。", [agent_id]))
        cost_limit = agent.get("cost_limit")
        if not isinstance(cost_limit, (int, float)) or cost_limit <= 0:
            result.errors.append(GraphIssue("AGENT_COST_LIMIT_INVALID", "Agent 必须设置正的单次成本上限。", [agent_id]))

    @staticmethod
    def _validate_capability_schema(
        schema: Any,
        label: str,
        code: str,
        agent_id: str,
        result: GraphValidationResult,
    ) -> None:
        field_path = "inputSchema" if label == "输入" else "outputSchema"
        if not isinstance(schema, dict) or schema.get("type") != "object":
            result.errors.append(GraphIssue(
                code,
                f"Agent {label}契约必须是 type=object 的 JSON Schema。",
                [agent_id],
                field_path=field_path,
            ))
            return
        properties = schema.get("properties")
        if not isinstance(properties, dict) or not properties:
            result.errors.append(GraphIssue(
                code,
                f"Agent {label}契约必须至少定义一个字段。",
                [agent_id],
                field_path=field_path,
            ))
            return
        required = schema.get("required")
        if required is None:
            return
        if not isinstance(required, list) or any(not isinstance(item, str) for item in required):
            result.errors.append(GraphIssue(code, f"Agent {label}契约的 required 必须是字段名数组。", [agent_id], field_path=field_path))
            return
        missing = next((item for item in required if item not in properties), None)
        if missing:
            result.errors.append(GraphIssue(code, f"Agent {label}契约的必填字段“{missing}”未定义。", [agent_id], field_path=field_path))

    def _final_decision(self, config: dict[str, Any], agents: dict[str, dict[str, Any]], result: GraphValidationResult) -> str | None:
        decisions = [agent_id for agent_id, agent in agents.items() if self._agent_type(agent) == "DECISION"]
        explicit = self._text(config.get("final_decision_agent_id"))
        if explicit:
            if explicit not in decisions:
                result.errors.append(GraphIssue("FINAL_DECISION_INVALID", "指定的最终决策 Agent 不存在或类型错误。", [explicit]))
                return None
            return explicit
        marked = [agent_id for agent_id in decisions if agents[agent_id].get("is_final_decision")]
        if len(marked) == 1:
            return marked[0]
        if len(decisions) == 1:
            return decisions[0]
        if len(decisions) > 1:
            result.errors.append(GraphIssue("FINAL_DECISION_AMBIGUOUS", "存在多个决策 Agent，请明确指定最终决策 Agent。", decisions))
        return None

    def _validate_required_types(self, agents: dict[str, dict[str, Any]], result: GraphValidationResult, purpose: str) -> None:
        types = {self._agent_type(agent) for agent in agents.values()}
        requirements = {
            "research_report": (("ANALYSIS", "ANALYSIS_AGENT_MISSING", "研究报告策略至少需要一个分析 Agent。"),),
            "candidate_screening": (("SCREENING", "SCREENING_AGENT_MISSING", "选股策略至少需要一个选股 Agent。"),),
            "trading_decision": (
                ("ANALYSIS", "ANALYSIS_AGENT_MISSING", "交易决策策略至少需要一个分析 Agent。"),
                ("DECISION", "DECISION_AGENT_MISSING", "交易决策策略至少需要一个决策 Agent。"),
            ),
        }
        for kind, code, message in requirements[purpose]:
            if kind not in types:
                result.errors.append(GraphIssue(code, message))

    @classmethod
    def output_contract(cls, agents: Iterable[dict[str, Any]], connections: Iterable[dict[str, Any]]) -> str:
        """Derive the public workflow result from its terminal DATA_FLOW node."""
        items = [agent for agent in agents if isinstance(agent, dict)]
        outgoing = {
            cls._text_static(edge.get("source_agent_id") or edge.get("sourceAgentId"))
            for edge in connections
            if isinstance(edge, dict)
            and cls._text_static(edge.get("connection_type") or edge.get("connectionType") or DATA_FLOW).upper() == DATA_FLOW
        }
        terminal_types = {
            cls._text_static(agent.get("type") or agent.get("agentType")).upper()
            for agent in items
            if cls._text_static(agent.get("id")) not in outgoing
            and cls._text_static(agent.get("type") or agent.get("agentType")).upper() != "REFLECTION"
        }
        if "DECISION" in terminal_types:
            return "DecisionProposal"
        if terminal_types == {"SCREENING"}:
            return "CandidateList"
        if terminal_types == {"ANALYSIS"}:
            return "ResearchReport"
        return "UnknownOutput"

    @staticmethod
    def _text_static(value: Any) -> str:
        return str(value).strip() if value is not None else ""

    def _validate_data_sources(self, config: dict[str, Any], agents: dict[str, dict[str, Any]], result: GraphValidationResult) -> None:
        # Immutable legacy versions can still contain a deterministic INPUT
        # node. New graphs receive their frozen input directly from versioned
        # data-source configuration instead of modelling data as an Agent.
        if any(self._agent_type(agent) == "INPUT" for agent in agents.values()):
            return
        data_sources = config.get("data_sources") if isinstance(config.get("data_sources"), dict) else {}
        enabled: list[dict[str, Any]] = []
        for kind in ("kline", "news", "fundamentals"):
            source = data_sources.get(kind) if isinstance(data_sources.get(kind), dict) else {}
            if source.get("enabled") is not True:
                continue
            enabled.append(source)
            if not self._text(source.get("connection")):
                result.errors.append(GraphIssue(
                    "DATA_SOURCE_CONNECTION_MISSING",
                    f"已启用的 {kind} 数据尚未选择连接。",
                    field_path=f"dataPermissionSnapshot.{kind}.connection",
                ))
        other = data_sources.get("other") if isinstance(data_sources.get("other"), dict) else {}
        other_ids = other.get("sourceIds") if isinstance(other.get("sourceIds"), list) else []
        if other.get("enabled") is True:
            if not any(self._text(item) for item in other_ids):
                result.errors.append(GraphIssue(
                    "OTHER_DATA_SOURCE_REQUIRED",
                    "已启用“其他数据源”，但尚未选择目录中的来源。",
                    field_path="dataPermissionSnapshot.other.sourceIds",
                ))
            else:
                enabled.append(other)
        if not enabled:
            result.errors.append(GraphIssue(
                "DATA_SOURCE_CONFIG_MISSING",
                "策略尚未启用任何数据来源。请在策略配置中连接 K 线、新闻或其他研究数据。",
                field_path="dataPermissionSnapshot",
            ))
        kline = data_sources.get("kline") if isinstance(data_sources.get("kline"), dict) else {}
        if kline.get("enabled") is not True:
            result.errors.append(GraphIssue(
                "KLINE_SOURCE_REQUIRED",
                "K 线是策略选股、检查和历史回放的必备数据来源，不能关闭。",
                field_path="dataPermissionSnapshot.kline",
            ))

    def _validate_connections(self, connections: Iterable[dict[str, Any]], agents: dict[str, dict[str, Any]], result: GraphValidationResult) -> list[dict[str, Any]]:
        seen_ids: set[str] = set()
        seen_pairs: set[tuple[str, str, str]] = set()
        valid: list[dict[str, Any]] = []
        for connection in connections:
            connection_id = self._text(connection.get("id"))
            source = self._text(connection.get("source_agent_id"))
            target = self._text(connection.get("target_agent_id"))
            kind = self._text(connection.get("connection_type") or DATA_FLOW).upper()
            if not connection_id or connection_id in seen_ids:
                result.errors.append(GraphIssue("CONNECTION_ID_DUPLICATE", "Connection ID 缺失或重复。", connection_ids=[connection_id] if connection_id else []))
                continue
            seen_ids.add(connection_id)
            if source not in agents or target not in agents:
                result.errors.append(GraphIssue("CONNECTION_AGENT_NOT_FOUND", "连接引用了不存在的 Agent。", [identifier for identifier in (source, target) if identifier], [connection_id]))
                continue
            if source == target:
                result.errors.append(GraphIssue("CONNECTION_SELF_LOOP", "不允许 Agent 自连接。", [source], [connection_id]))
                continue
            if kind not in {DATA_FLOW, POST_RUN_CONTEXT}:
                result.errors.append(GraphIssue("CONNECTION_TYPE_INVALID", "连接类型无效。", [source, target], [connection_id]))
                continue
            pair = (source, target, kind)
            if pair in seen_pairs:
                result.errors.append(GraphIssue("CONNECTION_DUPLICATE", "不允许重复连接。", [source, target], [connection_id]))
                continue
            seen_pairs.add(pair)
            valid.append({**connection, "connection_type": kind})
        return valid

    def _validate_data_flow(self, edges: list[dict[str, Any]], agents: dict[str, dict[str, Any]], result: GraphValidationResult, final_decision_id: str | None) -> None:
        graph: dict[str, list[tuple[str, str]]] = {agent_id: [] for agent_id in agents}
        reverse: dict[str, int] = {agent_id: 0 for agent_id in agents}
        for edge in edges:
            source, target = self._text(edge.get("source_agent_id")), self._text(edge.get("target_agent_id"))
            edge_id, kind = self._text(edge.get("id")), edge["connection_type"]
            source_kind, target_kind = self._agent_type(agents[source]), self._agent_type(agents[target])
            if kind == POST_RUN_CONTEXT:
                if target_kind != "REFLECTION":
                    result.errors.append(GraphIssue("POST_RUN_TARGET_INVALID", "POST_RUN_CONTEXT 只能传入反思 Agent。", [source, target], [edge_id]))
                else:
                    # A reflection node is intentionally outside the same-run
                    # DATA_FLOW DAG. Its legitimate POST_RUN_CONTEXT input still
                    # satisfies the required-agent connectivity invariant.
                    reverse[target] += 1
                continue
            if source_kind == "REFLECTION":
                result.errors.append(GraphIssue("REFLECTION_DATA_FLOW_FORBIDDEN", "反思 Agent 不能回连同一次运行的数据流。", [source, target], [edge_id]))
                continue
            if source_kind == "INPUT" and target_kind == "DECISION" and not agents[target].get("accepts_direct_evidence"):
                result.errors.append(GraphIssue("INPUT_TO_DECISION_NOT_ALLOWED", "该决策 Agent 未授权直接接收证据。", [source, target], [edge_id]))
                continue
            if (source_kind, target_kind) not in ALLOWED_DATA_FLOW:
                result.errors.append(GraphIssue("AGENT_CONNECTION_FORBIDDEN", "该 Agent 类型连接不被允许。", [source, target], [edge_id]))
                continue
            graph[source].append((target, edge_id)); reverse[target] += 1
        self._detect_cycle(graph, result)
        input_ids = {agent_id for agent_id, agent in agents.items() if self._agent_type(agent) == "INPUT"}
        screening_roots = {agent_id for agent_id, agent in agents.items() if self._agent_type(agent) == "SCREENING" and reverse[agent_id] == 0}
        analysis_roots = {agent_id for agent_id, agent in agents.items() if self._agent_type(agent) == "ANALYSIS" and reverse[agent_id] == 0}
        starts = input_ids or screening_roots or analysis_roots
        decision_ids = {final_decision_id} if final_decision_id else {agent_id for agent_id, agent in agents.items() if self._agent_type(agent) == "DECISION"}
        reachable = self._reachable(graph, starts)
        if decision_ids and not (reachable & decision_ids):
            result.errors.append(GraphIssue("DECISION_UNREACHABLE", "数据来源或分析 Agent 无法到达最终决策 Agent。", sorted(starts | decision_ids)))
        for agent_id, agent in agents.items():
            root_types = {"INPUT"} if input_ids else ({"SCREENING"} if screening_roots else {"ANALYSIS"})
            if agent.get("required") and self._agent_type(agent) not in root_types and reverse[agent_id] == 0:
                result.errors.append(GraphIssue("REQUIRED_AGENT_ISOLATED", "关键 Agent 没有上游输入。", [agent_id]))

    def _detect_cycle(self, graph: dict[str, list[tuple[str, str]]], result: GraphValidationResult) -> None:
        visited: set[str] = set(); active: set[str] = set(); trail: list[str] = []; edge_trail: list[str] = []
        def visit(node: str) -> bool:
            visited.add(node); active.add(node); trail.append(node)
            for target, edge_id in graph[node]:
                if target in active:
                    start = trail.index(target)
                    result.errors.append(GraphIssue("GRAPH_CYCLE", "策略运行图中存在循环连接。", trail[start:] + [target], edge_trail[start:] + [edge_id]))
                    return True
                if target not in visited:
                    edge_trail.append(edge_id)
                    if visit(target): return True
                    edge_trail.pop()
            active.remove(node); trail.pop(); return False
        for node in graph:
            if node not in visited and visit(node): return

    @staticmethod
    def _reachable(graph: dict[str, list[tuple[str, str]]], starts: set[str]) -> set[str]:
        seen = set(starts); stack = list(starts)
        while stack:
            node = stack.pop()
            for target, _ in graph[node]:
                if target not in seen: seen.add(target); stack.append(target)
        return seen
