import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StrategyEditorPage from "../StrategyEditorPage";
import { strategyWorkspaceApi } from "../../api/strategyWorkspace";

vi.mock("../../api/strategyWorkspace", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../api/strategyWorkspace")>();
  return {
    ...actual,
    strategyWorkspaceApi: {
      getVersion: vi.fn(),
      listAgentTemplates: vi.fn(),
      listPublishedAgentWorkflowVersions: vi.fn(),
      listDataSources: vi.fn(),
      getValidationStatus: vi.fn(),
      getStrategy: vi.fn(),
      validate: vi.fn(),
      publish: vi.fn(),
      saveDraft: vi.fn(),
      getAgentTemplate: vi.fn(),
      createDraft: vi.fn(),
      diff: vi.fn(),
      diffPreview: vi.fn(),
      forkLocal: vi.fn(),
    },
  };
});

const api = vi.mocked(strategyWorkspaceApi);
const draft = {
  id: 11,
  strategyId: 7,
  status: "DRAFT",
  immutable: false,
  revision: 4,
  marketScope: {},
  decisionPolicy: {},
  riskPolicy: { decision_validity: { max: "1d" } },
  memoryPolicy: {},
  dataPermissionSnapshot: {},
  screeningPolicy: { strategy: "dual_low", market: "cn", maxCandidates: 3 },
  agents: [],
  connections: [],
  createdAt: "2026-08-14T09:00:00Z",
};

describe("strategy check, optional backtest, and formal publish flow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getVersion.mockResolvedValue({ ...draft });
    api.listAgentTemplates.mockResolvedValue([]);
    api.listPublishedAgentWorkflowVersions.mockResolvedValue([]);
    api.listDataSources.mockResolvedValue([]);
    api.getStrategy.mockResolvedValue({
      id: 7,
      name: "发布候选策略",
      lifecycleStatus: "draft",
      revision: 1,
      updatedAt: "2026-08-14T09:00:00Z",
      versions: [{ ...draft }],
    });
    api.getValidationStatus.mockResolvedValue({
      strategyVersionId: 11,
      versionRevision: 4,
      status: "not_started",
      latestExperimentId: null,
      latestCompletedExperimentId: null,
      validatedAt: null,
    });
    api.validate.mockResolvedValue({
      valid: true,
      versionId: 11,
      revision: 4,
      validatedAt: "2026-08-15T00:00:00Z",
      errors: [],
      warnings: [],
    });
  });

  it("opens backtest after the Agent graph check and allows publishing without an experiment", async () => {
    api.getVersion
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({
        ...draft,
        status: "PUBLISHED",
        immutable: true,
        versionNumber: 1,
      });
    api.publish.mockResolvedValue({ publishedVersionId: 11, versionNumber: 1 });
    render(
      <MemoryRouter initialEntries={["/strategies/7/editor?versionId=11"]}>
        <StrategyEditorPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("button", { name: /打开验证中心/ }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /正式发布/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "检查策略" }));
    const backtestLink = await screen.findByRole("link", { name: /打开验证中心/ });
    expect(backtestLink).toHaveAttribute(
      "href",
      "/backtests?strategyId=7&versionId=11",
    );
    fireEvent.click(screen.getByRole("button", { name: /正式发布/ }));

    const dialog = await screen.findByRole("dialog", { name: "发布策略版本" });
    expect(
      within(dialog).getByText(
        "尚未完成可信历史回放（可选），你仍可正式发布。",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "打开验证中心（可选）" }),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByPlaceholderText("填写版本变更说明"), {
      target: { value: "未回测也可发布" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "正式发布" }));

    await waitFor(() =>
      expect(api.publish).toHaveBeenCalledWith(
        11,
        4,
        "未回测也可发布",
        [],
        undefined,
      ),
    );
  });

  it("passes the matching experiment ID to formal publish", async () => {
    api.getValidationStatus.mockResolvedValue({
      strategyVersionId: 11,
      versionRevision: 4,
      status: "completed",
      latestExperimentId: 99,
      latestCompletedExperimentId: 99,
      completedAt: "2026-08-15T00:00:00Z",
      validatedAt: null,
    });
    api.getVersion
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({
        ...draft,
        status: "PUBLISHED",
        immutable: true,
        versionNumber: 1,
      });
    api.publish.mockResolvedValue({ publishedVersionId: 11, versionNumber: 1 });
    render(
      <MemoryRouter initialEntries={["/strategies/7/editor?versionId=11"]}>
        <StrategyEditorPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "检查策略" }));
    await screen.findByRole("link", { name: /打开验证中心/ });
    fireEvent.click(screen.getByRole("button", { name: /正式发布/ }));
    const dialog = await screen.findByRole("dialog", { name: "发布策略版本" });
    expect(
      within(dialog).getByText(
        "观察性历史回放已完成 · 实验 #99；不等于完整 Agent 策略已验证通过。",
      ),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByPlaceholderText("填写版本变更说明"), {
      target: { value: "验证后正式发布" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "正式发布" }));
    await waitFor(() =>
      expect(api.publish).toHaveBeenCalledWith(11, 4, "验证后正式发布", [], 99),
    );
  });

  it("moves Agent templates and graph editing out of the strategy page", async () => {
    api.listAgentTemplates.mockResolvedValue([
      {
        templateId: 1,
        name: "行情输入 Agent",
        agentType: "INPUT",
        currentVersion: 2,
        supportedTools: [],
        supportedDataTypes: [],
        archived: false,
        updatedAt: "2026-08-15T00:00:00Z",
      },
      {
        templateId: 2,
        name: "新闻分析 Agent",
        agentType: "ANALYSIS",
        currentVersion: 2,
        supportedTools: [],
        supportedDataTypes: [],
        archived: false,
        updatedAt: "2026-08-15T00:00:00Z",
      },
    ]);
    render(
      <MemoryRouter initialEntries={["/strategies/7/editor?versionId=11"]}>
        <StrategyEditorPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: "配置完整策略" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("行情输入 Agent")).not.toBeInTheDocument();
    expect(screen.queryByText("新闻分析 Agent")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("搜索 Agent 模板")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "策略 Agent 配置" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /能力中心/ })).not.toBeInTheDocument();
    expect(screen.getByText("4. 运行参数")).toBeInTheDocument();
    expect(screen.getByText("5. 策略内核")).toBeInTheDocument();
  });
});
