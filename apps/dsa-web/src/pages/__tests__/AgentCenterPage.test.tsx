import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { strategyWorkspaceApi, type AgentWorkflowVersion } from "../../api/strategyWorkspace";
import AgentCenterPage from "../AgentCenterPage";

vi.mock("../../api/strategyWorkspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/strategyWorkspace")>();
  return {
    ...actual,
    strategyWorkspaceApi: {
      ...actual.strategyWorkspaceApi,
      listAgentTemplates: vi.fn(),
      getAgentTemplate: vi.fn(),
      createAgentTemplate: vi.fn(),
      updateAgentTemplate: vi.fn(),
      archiveAgentTemplate: vi.fn(),
      listAgentWorkflows: vi.fn(),
      getAgentWorkflowVersion: vi.fn(),
      saveAgentWorkflowDraft: vi.fn(),
      validateAgentWorkflow: vi.fn(),
      publishAgentWorkflow: vi.fn(),
      createAgentWorkflow: vi.fn(),
      createAgentWorkflowDraft: vi.fn(),
    },
  };
});

const api = vi.mocked(strategyWorkspaceApi);
const version: AgentWorkflowVersion = {
  id: 31,
  workflowId: 7,
  status: "DRAFT",
  immutable: false,
  revision: 1,
  agentCount: 2,
  connectionCount: 1,
  agents: [
    {
      id: "analysis",
      lineageId: "analysis",
      agentType: "ANALYSIS",
      name: "新闻分析 Agent",
      role: "读取证据并形成摘要",
      systemPrompt: "真实 Prompt",
      promptTemplate: "",
      modelProfileId: "default",
      executionMode: "LLM",
      toolPermissions: [],
      dataPermissions: [],
      inputSchema: {},
      outputSchema: {},
      timeoutSeconds: 30,
      maxRetries: 0,
      required: true,
      failurePolicy: "STOP_RUN",
      costLimit: "0.1",
      positionX: 0,
      positionY: 0,
    },
    {
      id: "decision",
      lineageId: "decision",
      agentType: "DECISION",
      name: "综合决策 Agent",
      role: "生成研究提案",
      systemPrompt: "真实 Prompt",
      promptTemplate: "",
      modelProfileId: "default",
      executionMode: "LLM",
      toolPermissions: [],
      dataPermissions: [],
      inputSchema: {},
      outputSchema: {},
      timeoutSeconds: 30,
      maxRetries: 0,
      required: true,
      failurePolicy: "STOP_RUN",
      costLimit: "0.1",
      positionX: 260,
      positionY: 0,
    },
  ],
  connections: [{ id: "edge", sourceAgentId: "analysis", targetAgentId: "decision", connectionType: "DATA_FLOW", fieldMapping: {} }],
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-15T00:00:00Z",
};

describe("CapabilityCenterPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.listAgentTemplates.mockResolvedValue([
      { templateId: 1, name: "候选筛选 Agent", description: "候选排序", agentType: "SCREENING", currentVersion: 2, supportedTools: [], supportedDataTypes: ["kline"], archived: false, updatedAt: "2026-08-15T00:00:00Z" },
      { templateId: 2, name: "新闻分析 Agent", description: "分析新闻事件", agentType: "ANALYSIS", currentVersion: 2, supportedTools: ["news_search"], supportedDataTypes: ["news"], archived: false, updatedAt: "2026-08-15T00:00:00Z" },
      { templateId: 3, name: "综合决策 Agent", description: "形成研究提案", agentType: "DECISION", currentVersion: 2, supportedTools: [], supportedDataTypes: ["analysis"], archived: false, updatedAt: "2026-08-15T00:00:00Z" },
      { templateId: 4, name: "复盘 Agent", description: "审阅决策过程", agentType: "REFLECTION", currentVersion: 2, supportedTools: [], supportedDataTypes: ["decision"], archived: false, updatedAt: "2026-08-15T00:00:00Z" },
    ]);
    api.getAgentTemplate.mockImplementation(async (templateId) => ({ templateId, name: templateId === 2 ? "新闻分析 Agent" : templateId === 1 ? "候选筛选 Agent" : templateId === 3 ? "综合决策 Agent" : "复盘 Agent", description: "数据库 LLM 能力", agentType: templateId === 1 ? "SCREENING" : templateId === 3 ? "DECISION" : templateId === 4 ? "REFLECTION" : "ANALYSIS", currentVersion: 2, templateVersion: 2, supportedTools: templateId === 2 ? ["news_search"] : [], supportedDataTypes: ["news"], archived: false, updatedAt: "2026-08-15T00:00:00Z", defaultRole: "读取证据并形成摘要", defaultSystemPrompt: "只依据真实新闻证据", defaultPromptTemplate: "", inputSchema: { type: "object", title: "ResearchContext", properties: { symbol: { type: "string" } }, required: ["symbol"] }, outputSchema: { type: "object", title: "ResearchDraft", properties: { summary: { type: "string" } }, required: ["summary"] } }));
    api.updateAgentTemplate.mockResolvedValue({ templateId: 2, name: "新闻分析 Agent", description: "数据库 LLM 能力", agentType: "ANALYSIS", currentVersion: 3, templateVersion: 3, supportedTools: ["news_search"], supportedDataTypes: ["news"], archived: false, updatedAt: "2026-08-16T00:00:00Z", defaultRole: "读取证据并形成摘要", defaultSystemPrompt: "更新后的真实 Prompt", defaultPromptTemplate: "", inputSchema: { type: "object", title: "ResearchContext", properties: { symbol: { type: "string" } }, required: ["symbol"] }, outputSchema: { type: "object", title: "ResearchDraft", properties: { summary: { type: "string" } }, required: ["summary"] } });
    api.listAgentWorkflows.mockResolvedValue([{ id: 7, name: "趋势突破多 Agent 工作流", description: "真实数据库工作流", lifecycleStatus: "draft", revision: 2, activeDraftVersionId: 31, currentPublishedVersionId: 30, currentPublishedVersionNumber: 1, agentCount: 2, connectionCount: 1, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-15T00:00:00Z" }]);
    api.getAgentWorkflowVersion.mockResolvedValue(version);
    api.saveAgentWorkflowDraft.mockImplementation(async (draft) => ({ draft: { ...draft, revision: draft.revision + 1 }, revision: draft.revision + 1 }));
    api.validateAgentWorkflow.mockResolvedValue({ valid: true, workflowVersionId: 31, revision: 2, validatedAt: "2026-08-16T00:00:00Z", errors: [], warnings: [] });
  });

  it("makes the atom-to-workflow-to-product contract visible before editing", async () => {
    render(<MemoryRouter initialEntries={["/agents"]}><AgentCenterPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "能力中心" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "内部自由组合，外部稳定调用" })).toBeInTheDocument();
    expect(screen.getAllByText("原子能力").length).toBeGreaterThan(0);
    expect(screen.getByText("工作流版本")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /能力库/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /工作流/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /流程编排/ })).not.toBeInTheDocument();
  });

  it("shows independent deterministic, rating and LLM capabilities with typed contracts", async () => {
    render(<MemoryRouter initialEntries={["/agents"]}><AgentCenterPage /></MemoryRouter>);

    const categories = await screen.findByRole("navigation", { name: "能力分类" });
    expect(within(categories).getByRole("button", { name: /确定性工具/ })).toBeInTheDocument();
    fireEvent.click(within(categories).getByRole("button", { name: /评级模块/ }));
    fireEvent.click(screen.getByRole("button", { name: /技术趋势评级/ }));
    expect(screen.getByRole("heading", { name: "技术趋势评级" })).toBeInTheDocument();
    expect(screen.getByText("RatingCard")).toBeInTheDocument();
    expect(screen.getByText(/score: 0–100/)).toBeInTheDocument();
    expect(screen.getByText("LLM 可编辑 · 其他能力待持久化")).toBeInTheDocument();
    expect(api.saveAgentWorkflowDraft).not.toHaveBeenCalled();
  });

  it("presents single-stock research and screening as reusable workflow blueprints", async () => {
    render(<MemoryRouter initialEntries={["/agents?tab=workflows"]}><AgentCenterPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "工作流只负责串起能力" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /单股票分析工作流/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("ResearchReport").length).toBeGreaterThan(0);
    expect(screen.getByText(/不绑定股票、真实数据源、运行时间/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /选股工作流/ }));
    expect(screen.getByText("CandidateList")).toBeInTheDocument();
    expect(screen.getByText("资格硬过滤")).toBeInTheDocument();
    expect(screen.getByText(/完整 Daily Stock 扫描还需要策略中心绑定市场、数据和运行计划/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /交易决策工作流/ }));
    expect(screen.getByText("提案规则校验")).toBeInTheDocument();
    expect(screen.queryByText("风险护栏")).not.toBeInTheDocument();
    expect(screen.getByText(/策略中心负责把它与市场、数据、标的和风险边界组装成完整策略/)).toBeInTheDocument();
  });

  it("loads real persisted workflows in the library and opens the composer", async () => {
    render(<MemoryRouter initialEntries={["/agents?tab=workflows"]}><AgentCenterPage /></MemoryRouter>);

    const workflow = await screen.findByRole("button", { name: /趋势突破多 Agent 工作流/ });
    expect(workflow).toHaveTextContent("真实数据库工作流");
    fireEvent.click(workflow);
    expect(await screen.findByRole("heading", { name: "工作流编辑器" })).toBeInTheDocument();
    expect(screen.getByLabelText("流程编排画布")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /返回工作流/ }));
    expect(await screen.findByRole("heading", { name: "工作流只负责串起能力" })).toBeInTheDocument();
  });

  it("saves compatible workflow node edits through the real workflow API", async () => {
    render(<MemoryRouter initialEntries={["/agents?tab=workflows&view=editor&workflowVersionId=31"]}><AgentCenterPage /></MemoryRouter>);

    expect(await screen.findByTestId("workflow-agent-decision")).toHaveTextContent("综合决策 Agent");
    fireEvent.click(screen.getByTestId("workflow-agent-analysis"));
    fireEvent.change(screen.getByLabelText("工作流节点名称"), { target: { value: "新闻分析节点 · 已持久化" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(api.saveAgentWorkflowDraft).toHaveBeenCalledOnce());
    expect(api.saveAgentWorkflowDraft.mock.calls[0][0].agents[0].name).toBe("新闻分析节点 · 已持久化");
  });

  it("keeps validation feedback after saving a dirty compatible workflow", async () => {
    render(<MemoryRouter initialEntries={["/agents?tab=workflows&view=editor&workflowVersionId=31"]}><AgentCenterPage /></MemoryRouter>);

    await screen.findByTestId("workflow-agent-analysis");
    fireEvent.click(screen.getByTestId("workflow-agent-analysis"));
    fireEvent.change(screen.getByLabelText("工作流节点名称"), { target: { value: "待检查节点" } });
    fireEvent.click(screen.getByRole("button", { name: "检查工作流" }));
    await waitFor(() => expect(api.validateAgentWorkflow).toHaveBeenCalledWith(31));
    expect(screen.getByRole("status")).toHaveTextContent("工作流检查已通过");
  });

  it("edits real LLM capabilities inline without leaving the capability library", async () => {
    render(<MemoryRouter initialEntries={["/agents?tab=capabilities"]}><AgentCenterPage /></MemoryRouter>);

    const capabilityCategories = await screen.findByRole("navigation", { name: "能力分类" });
    fireEvent.click(within(capabilityCategories).getByRole("button", { name: /LLM 调用/ }));
    expect(await screen.findByText("候选筛选 LLM")).toBeInTheDocument();
    expect(screen.getByText("综合决策 LLM")).toBeInTheDocument();
    expect(screen.getByText("复盘 LLM")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /新闻分析 LLM/ }));
    expect(await screen.findByText("只依据真实新闻证据")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "直接编辑" }));
    expect(screen.getByLabelText("LLM 能力名称")).toBeEnabled();
    expect(screen.getByLabelText("LLM Input Schema")).toHaveTextContent("ResearchContext");
    expect(api.listAgentTemplates).toHaveBeenCalledOnce();
    expect(api.getAgentTemplate).toHaveBeenCalledWith(2);
  });

  it("requires valid input and output contracts before creating an LLM capability", async () => {
    render(<MemoryRouter initialEntries={["/agents?tab=capabilities"]}><AgentCenterPage /></MemoryRouter>);
    await screen.findByRole("navigation", { name: "能力分类" });
    fireEvent.click(screen.getByRole("button", { name: /新增 LLM/ }));
    fireEvent.change(screen.getByLabelText("LLM 能力名称"), { target: { value: "估值分析 LLM" } });
    fireEvent.change(screen.getByLabelText("LLM 推理职责"), { target: { value: "分析估值证据" } });
    fireEvent.change(screen.getByLabelText("LLM System Prompt"), { target: { value: "仅依据输入证据" } });
    fireEvent.change(screen.getByLabelText("LLM Input Schema"), { target: { value: '{"type":"object","properties":{}}' } });
    fireEvent.click(screen.getByRole("button", { name: "创建 LLM 能力" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Input Schema必须至少定义一个 properties 字段");
    expect(api.createAgentTemplate).not.toHaveBeenCalled();
  });

  it("saves an inline LLM edit as a new version with both schemas", async () => {
    render(<MemoryRouter initialEntries={["/agents?tab=capabilities"]}><AgentCenterPage /></MemoryRouter>);
    const capabilityCategories = await screen.findByRole("navigation", { name: "能力分类" });
    fireEvent.click(within(capabilityCategories).getByRole("button", { name: /LLM 调用/ }));
    fireEvent.click(screen.getByRole("button", { name: /新闻分析 LLM/ }));
    await screen.findByText("只依据真实新闻证据");
    fireEvent.click(screen.getByRole("button", { name: "直接编辑" }));
    fireEvent.change(screen.getByLabelText("LLM System Prompt"), { target: { value: "更新后的真实 Prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "保存为新版本" }));
    await waitFor(() => expect(api.updateAgentTemplate).toHaveBeenCalledOnce());
    expect(api.updateAgentTemplate).toHaveBeenCalledWith(2, expect.objectContaining({
      currentVersion: 2,
      defaultSystemPrompt: "更新后的真实 Prompt",
      inputSchema: expect.objectContaining({ title: "ResearchContext" }),
      outputSchema: expect.objectContaining({ title: "ResearchDraft" }),
    }));
  });

  it("shows a recoverable API error without inventing persisted workflows", async () => {
    api.listAgentWorkflows.mockRejectedValueOnce(new Error("offline"));
    render(<MemoryRouter initialEntries={["/agents"]}><AgentCenterPage /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取 LLM 配置或工作流");
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(api.listAgentWorkflows).toHaveBeenCalledTimes(2));
  });
});
