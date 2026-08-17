from __future__ import annotations

import os
import tempfile
import unittest

from sqlalchemy import select

from src.services.agent_center_service import AgentCenterService
from src.services.strategy_definition_service import StrategyDefinitionError, StrategyDefinitionService
from src.storage import (
    DatabaseManager,
    SimulationAgentTemplateVersionRecord,
)


class AgentCenterServiceTest(unittest.TestCase):
    def setUp(self):
        self.path = tempfile.mktemp(suffix=".sqlite")
        DatabaseManager.reset_instance()
        self.db = DatabaseManager(f"sqlite:///{self.path}")
        self.service = AgentCenterService(self.db)

    def tearDown(self):
        DatabaseManager.reset_instance()
        if os.path.exists(self.path):
            os.unlink(self.path)

    def _published_workflow(self, output_contract: str) -> dict:
        for workflow in self.service.list_workflows():
            version = self.service.get_workflow_version(workflow["currentPublishedVersionId"])
            if version["outputContract"] == output_contract:
                return workflow
        self.fail(f"missing published workflow for {output_contract}")

    def test_default_library_and_workflow_are_database_backed_and_valid(self):
        templates = self.service.list_templates()
        self.assertEqual(
            {"SCREENING", "ANALYSIS", "DECISION", "REFLECTION"},
            {item["agentType"] for item in templates},
        )
        workflows = self.service.list_workflows()
        self.assertEqual(len(workflows), 3)
        self.assertEqual(
            {
                "标准多 Agent 研究工作流",
                "Daily · 单股研究工作流",
                "Daily · 选股扫描工作流",
            },
            {item["name"] for item in workflows},
        )
        versions = {
            workflow["name"]: self.service.get_workflow_version(workflow["currentPublishedVersionId"])
            for workflow in workflows
        }
        self.assertEqual(versions["标准多 Agent 研究工作流"]["outputContract"], "DecisionProposal")
        self.assertEqual(versions["Daily · 单股研究工作流"]["outputContract"], "ResearchReport")
        self.assertEqual(versions["Daily · 选股扫描工作流"]["outputContract"], "CandidateList")
        self.assertEqual(len(versions["标准多 Agent 研究工作流"]["agents"]), 4)
        self.assertEqual(len(versions["Daily · 单股研究工作流"]["agents"]), 2)
        self.assertEqual(len(versions["Daily · 选股扫描工作流"]["agents"]), 1)
        for version in versions.values():
            self.assertEqual(version["status"], "PUBLISHED")
            self.assertTrue(version["immutable"])
            self.assertTrue(self.service.validate_workflow(version["id"])["valid"])

        research_nodes = versions["Daily · 单股研究工作流"]["agents"]
        self.assertEqual([node["executionMode"] for node in research_nodes], ["DETERMINISTIC", "LLM"])
        self.assertIn("daily.technical_trend", research_nodes[0]["toolPermissions"])
        screening = versions["Daily · 选股扫描工作流"]["agents"][0]
        self.assertEqual(screening["executionMode"], "HYBRID")
        self.assertIn("screening.hard_filter", screening["toolPermissions"])
        self.assertIn("screening.llm_rerank", screening["toolPermissions"])

    def test_analysis_only_workflow_publishes_a_research_report_contract(self):
        starter = self._published_workflow("DecisionProposal")
        source = self.service.get_workflow_version(starter["currentPublishedVersionId"])
        analysis = next(item for item in source["agents"] if item["agentType"] == "ANALYSIS")
        created = self.service.create_workflow({"name": "单股研究报告工作流"})
        saved = self.service.save_workflow_draft(created["draft"]["id"], {
            "revision": created["draft"]["revision"],
            "workflow": {"name": "单股研究报告工作流", "description": "仅输出研究报告"},
            "agents": [analysis],
            "connections": [],
        })
        self.assertTrue(self.service.validate_workflow(saved["draftId"])["valid"])
        published = self.service.publish_workflow(saved["draftId"], {
            "revision": saved["revision"],
            "changeLog": "发布研究报告契约",
            "idempotencyKey": "research-report-workflow",
        })
        self.assertEqual(published["outputContract"], "ResearchReport")

    def test_template_update_creates_an_immutable_new_version_and_detects_conflict(self):
        created = self.service.create_template({
            "name": "量价分析 Agent",
            "description": "测试模板版本链路",
            "agentType": "ANALYSIS",
            "defaultRole": "分析量价结构",
            "defaultSystemPrompt": "只根据输入证据分析量价结构。",
            "inputSchema": {"type": "object", "properties": {"bars": {"type": "array"}}, "required": ["bars"]},
            "outputSchema": {"type": "object", "properties": {"summary": {"type": "string"}}, "required": ["summary"]},
            "supportedTools": ["daily-bars"],
        })
        updated = self.service.update_template(created["templateId"], {
            "currentVersion": 1,
            "defaultSystemPrompt": "只根据冻结输入分析量价结构，不得编造。",
        })
        self.assertEqual(updated["templateVersion"], 2)
        self.assertEqual(self.service.get_template(created["templateId"], 1)["defaultSystemPrompt"], "只根据输入证据分析量价结构。")
        with self.assertRaises(StrategyDefinitionError) as conflict:
            self.service.update_template(created["templateId"], {
                "currentVersion": 1,
                "defaultRole": "过期页面的修改",
            })
        self.assertEqual(conflict.exception.code, "AGENT_TEMPLATE_VERSION_CONFLICT")
        with self.db.get_session() as session:
            versions = session.execute(select(SimulationAgentTemplateVersionRecord).where(
                SimulationAgentTemplateVersionRecord.template_id == created["templateId"]
            )).scalars().all()
        self.assertEqual({row.version for row in versions}, {1, 2})

    def test_template_requires_explicit_input_and_output_contracts(self):
        with self.assertRaises(StrategyDefinitionError) as invalid:
            self.service.create_template({
                "name": "缺少契约的 LLM",
                "agentType": "ANALYSIS",
                "defaultRole": "分析输入",
                "defaultSystemPrompt": "只根据输入分析。",
                "inputSchema": {"type": "object", "properties": {}},
                "outputSchema": {"type": "object", "properties": {"summary": {"type": "string"}}},
            })
        self.assertEqual(invalid.exception.code, "AGENT_TEMPLATE_SCHEMA_INVALID")

    def test_workflow_draft_save_validate_publish_and_copy(self):
        starter = self._published_workflow("DecisionProposal")
        source = self.service.get_workflow_version(starter["currentPublishedVersionId"])
        created = self.service.create_workflow({"name": "行业轮动研究工作流"})
        saved = self.service.save_workflow_draft(created["draft"]["id"], {
            "revision": created["draft"]["revision"],
            "workflow": {"name": "行业轮动研究工作流", "description": "真实持久化工作流"},
            "agents": source["agents"],
            "connections": source["connections"],
        })
        checked = self.service.validate_workflow(saved["draftId"])
        self.assertTrue(checked["valid"])
        published = self.service.publish_workflow(saved["draftId"], {
            "revision": saved["revision"],
            "changeLog": "首次发布",
            "idempotencyKey": "workflow-publish-1",
        })
        self.assertEqual(published["versionNumber"], 1)
        repeated = self.service.publish_workflow(saved["draftId"], {
            "revision": saved["revision"],
            "changeLog": "首次发布",
            "idempotencyKey": "workflow-publish-1",
        })
        self.assertEqual(repeated["id"], published["id"])
        with self.assertRaises(StrategyDefinitionError) as immutable:
            self.service.save_workflow_draft(published["id"], {
                "revision": published["revision"], "agents": [], "connections": [],
            })
        self.assertEqual(immutable.exception.code, "AGENT_WORKFLOW_VERSION_IMMUTABLE")
        draft = self.service.create_workflow_draft(created["workflow"]["id"], published["id"])
        self.assertEqual(draft["basedOnVersionId"], published["id"])
        self.assertEqual(len(draft["agents"]), len(published["agents"]))
        self.assertNotEqual(draft["agents"][0]["id"], published["agents"][0]["id"])
        self.assertEqual(draft["agents"][0]["lineageId"], published["agents"][0]["lineageId"])

    def test_strategy_freezes_authoritative_published_workflow_snapshot(self):
        workflow = self._published_workflow("DecisionProposal")
        workflow_version = self.service.get_workflow_version(workflow["currentPublishedVersionId"])
        strategy_service = StrategyDefinitionService(self.db)
        created = strategy_service.create_strategy({"name": "工作流绑定策略"})
        draft = created["draft"]
        saved = strategy_service.save_draft(draft["id"], {
            "revision": draft["revision"],
            "strategy": {"name": "工作流绑定策略"},
            "version": {
                "agentWorkflowVersionId": workflow_version["id"],
                "riskPolicy": {"decision_validity": {"max": "1d"}},
                "dataPermissionSnapshot": {"kline": {"enabled": True, "connection": "system_market_data"}},
            },
            # A forged client graph must not replace the published workflow.
            "agents": [],
            "connections": [],
        })
        frozen = saved["draft"]
        self.assertEqual(frozen["agentWorkflowVersionId"], workflow_version["id"])
        self.assertEqual([item["agentType"] for item in frozen["agents"]], [item["agentType"] for item in workflow_version["agents"]])
        self.assertEqual(len(frozen["connections"]), len(workflow_version["connections"]))
        self.assertTrue(strategy_service.validate(frozen["id"])["valid"])

    def test_archiving_workflow_retains_referenced_strategy_history(self):
        workflow = self._published_workflow("DecisionProposal")
        workflow_version = self.service.get_workflow_version(workflow["currentPublishedVersionId"])
        strategy_service = StrategyDefinitionService(self.db)
        created = strategy_service.create_strategy({"name": "归档引用策略"})
        strategy_service.save_draft(created["draft"]["id"], {
            "revision": created["draft"]["revision"],
            "strategy": {"name": "归档引用策略"},
            "version": {"agentWorkflowVersionId": workflow_version["id"]},
            "agents": [], "connections": [],
        })
        archived = self.service.archive_workflow(workflow["id"])
        self.assertTrue(archived["archived"])
        self.assertEqual(archived["strategyVersionReferenceCount"], 1)
        self.assertTrue(archived["historyRetained"])
        self.assertEqual(self.service.get_workflow_version(workflow_version["id"])["status"], "PUBLISHED")


if __name__ == "__main__":
    unittest.main()
