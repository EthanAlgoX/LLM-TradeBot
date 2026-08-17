from src.services.strategy_graph_validator import StrategyGraphValidator


def agent(identifier: str, kind: str, **changes):
    item = {"id": identifier, "type": kind, "name": identifier, "role": "test", "input_schema": {"type": "object", "properties": {"input": {"type": "string"}}}, "output_schema": {"type": "object", "properties": {"output": {"type": "string"}}}, "model_profile_id": "test-model", "tool_permissions": [], "data_permissions": [], "failure_policy": "STOP_RUN", "timeout_seconds": 30, "max_retries": 1, "cost_limit": 1, "required": True}
    item.update(changes)
    return item


def valid_config():
    return {"risk_policy": {"max_asset_weight": 0.2, "decision_validity": {"max": "1d"}}, "data_sources": {"schemaVersion": 1, "kline": {"enabled": True, "connection": "system_market_data"}}, "agents": [agent("analysis", "ANALYSIS"), agent("decision", "DECISION")], "connections": [{"id": "analysis-decision", "source_agent_id": "analysis", "target_agent_id": "decision", "connection_type": "DATA_FLOW"}]}


def test_valid_minimum_graph_is_publishable():
    result = StrategyGraphValidator().validate(valid_config())
    assert result.valid
    assert [warning.code for warning in result.warnings] == ["NO_REFLECTION_AGENT"]


def test_report_and_screening_strategies_use_their_own_terminal_contracts():
    report = {
        "strategy_purpose": "research_report",
        "risk_policy": {},
        "data_sources": valid_config()["data_sources"],
        "agents": [agent("analysis", "ANALYSIS")],
        "connections": [],
    }
    screening = {
        "strategy_purpose": "candidate_screening",
        "risk_policy": {},
        "data_sources": valid_config()["data_sources"],
        "agents": [agent("screening", "SCREENING")],
        "connections": [],
    }
    assert StrategyGraphValidator().validate(report).valid
    assert StrategyGraphValidator().validate(screening).valid


def test_strategy_purpose_rejects_an_incompatible_workflow_output():
    config = valid_config()
    config["strategy_purpose"] = "research_report"
    result = StrategyGraphValidator().validate(config)
    mismatch = next(issue for issue in result.errors if issue.code == "WORKFLOW_OUTPUT_CONTRACT_MISMATCH")
    assert mismatch.field_path == "agentWorkflowVersionId"
    assert "DecisionProposal" in mismatch.message
    assert "ResearchReport" in mismatch.message


def test_new_strategy_draft_requires_a_published_workflow_reference():
    config = valid_config()
    config["workflow_reference_required"] = True
    result = StrategyGraphValidator().validate(config)
    issue = next(item for item in result.errors if item.code == "AGENT_WORKFLOW_VERSION_REQUIRED")
    assert issue.field_path == "agentWorkflowVersionId"

    config["agent_workflow_version_id"] = 7
    assert "AGENT_WORKFLOW_VERSION_REQUIRED" not in {
        item.code for item in StrategyGraphValidator().validate(config).errors
    }


def test_optional_screening_agent_can_be_the_workflow_root():
    config = valid_config()
    config["agents"].insert(0, agent("screening", "SCREENING"))
    config["connections"].insert(0, {
        "id": "screening-analysis",
        "source_agent_id": "screening",
        "target_agent_id": "analysis",
        "connection_type": "DATA_FLOW",
    })
    assert StrategyGraphValidator().validate(config).valid


def test_cycle_and_missing_types_are_rejected():
    config = valid_config()
    config["connections"].append({"id": "decision-analysis", "source_agent_id": "decision", "target_agent_id": "analysis", "connection_type": "DATA_FLOW"})
    result = StrategyGraphValidator().validate(config)
    assert {issue.code for issue in result.errors} >= {"AGENT_CONNECTION_FORBIDDEN"}


def test_reflection_cannot_return_to_same_run_data_flow():
    config = valid_config()
    config["agents"].append(agent("reflection", "REFLECTION", required=False))
    config["connections"].append({"id": "reflection-analysis", "source_agent_id": "reflection", "target_agent_id": "analysis", "connection_type": "DATA_FLOW"})
    result = StrategyGraphValidator().validate(config)
    assert "REFLECTION_DATA_FLOW_FORBIDDEN" in {issue.code for issue in result.errors}


def test_post_run_context_satisfies_required_reflection_connectivity():
    config = valid_config()
    config["agents"].append(agent("reflection", "REFLECTION"))
    config["connections"].append({"id": "decision-reflection", "source_agent_id": "decision", "target_agent_id": "reflection", "connection_type": "POST_RUN_CONTEXT"})
    result = StrategyGraphValidator().validate(config)
    assert "REQUIRED_AGENT_ISOLATED" not in {issue.code for issue in result.errors}
    assert result.valid


def test_missing_model_and_invalid_retry_are_rejected():
    config = valid_config()
    config["agents"][1].pop("model_profile_id")
    config["agents"][1]["max_retries"] = 99
    result = StrategyGraphValidator().validate(config)
    assert {issue.code for issue in result.errors} >= {"AGENT_MODEL_MISSING", "AGENT_RETRY_INVALID"}


def test_missing_capability_contract_fields_are_rejected():
    config = valid_config()
    config["agents"][0]["input_schema"] = {"type": "object", "properties": {}}
    config["agents"][1]["output_schema"] = {"type": "array"}
    result = StrategyGraphValidator().validate(config)
    assert {issue.code for issue in result.errors} >= {
        "AGENT_INPUT_SCHEMA_INVALID",
        "AGENT_OUTPUT_SCHEMA_INVALID",
    }


def test_fixed_strategy_universe_requires_codes_before_publish():
    config = valid_config()
    config["market_scope"] = {"universeMode": "fixed", "symbols": []}
    result = StrategyGraphValidator().validate(config)
    issue = next(item for item in result.errors if item.code == "FIXED_UNIVERSE_SYMBOLS_MISSING")
    assert issue.field_path == "marketScope.symbols"


def test_new_graph_requires_a_configured_data_source():
    config = valid_config()
    config["data_sources"] = {}
    result = StrategyGraphValidator().validate(config)
    assert "DATA_SOURCE_CONFIG_MISSING" in {issue.code for issue in result.errors}


def test_enabled_data_source_requires_a_connection():
    config = valid_config()
    config["data_sources"] = {"kline": {"enabled": True}}
    result = StrategyGraphValidator().validate(config)
    assert "DATA_SOURCE_CONNECTION_MISSING" in {issue.code for issue in result.errors}


def test_legacy_input_agent_graph_remains_compatible_without_data_config():
    config = valid_config()
    config["data_sources"] = {}
    config["agents"].insert(0, agent("input", "INPUT", deterministic=True))
    config["connections"].insert(0, {"id": "input-analysis", "source_agent_id": "input", "target_agent_id": "analysis", "connection_type": "DATA_FLOW"})
    result = StrategyGraphValidator().validate(config)
    assert result.valid
