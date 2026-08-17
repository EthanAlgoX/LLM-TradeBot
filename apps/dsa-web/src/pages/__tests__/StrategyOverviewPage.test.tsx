import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { strategyWorkspaceApi } from "../../api/strategyWorkspace";
import StrategyOverviewPage from "../StrategyOverviewPage";

vi.mock("../../api/strategyWorkspace", () => ({
  strategyWorkspaceApi: {
    listStrategies: vi.fn(),
    listAutomaticRuns: vi.fn(),
    listContinuousRuns: vi.fn(),
    listDataSources: vi.fn(),
    getValidationStatus: vi.fn(),
  },
}));

const api = vi.mocked(strategyWorkspaceApi);

describe("StrategyOverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listStrategies.mockResolvedValue([
      {
        id: 7,
        name: "趋势交易策略",
        lifecycleStatus: "ACTIVE",
        revision: 2,
        currentPublishedVersionId: 11,
        currentPublishedVersionNumber: 2,
        currentStrategyPurpose: "trading_decision",
        currentOutputContract: "DecisionProposal",
        updatedAt: "2026-08-16T10:00:00Z",
      },
      {
        id: 8,
        name: "单股研究策略",
        lifecycleStatus: "ACTIVE",
        revision: 1,
        currentPublishedVersionId: 22,
        currentPublishedVersionNumber: 1,
        currentStrategyPurpose: "research_report",
        currentOutputContract: "ResearchReport",
        updatedAt: "2026-08-15T10:00:00Z",
      },
      {
        id: 9,
        name: "待接入策略",
        lifecycleStatus: "ACTIVE",
        revision: 1,
        activeDraftVersionId: 31,
        updatedAt: "2026-08-14T10:00:00Z",
      },
    ]);
    api.listAutomaticRuns.mockResolvedValue([
      {
        id: 18,
        strategyId: 7,
        strategyName: "趋势交易策略",
        strategyVersionId: 11,
        versionNumber: 2,
        status: "running",
        screeningPolicy: { strategy: "volume_breakout", market: "cn", maxCandidates: 3 },
        candidateCount: 0,
        candidates: [],
        screening: {},
        createdAt: "2026-08-16T11:00:00Z",
        updatedAt: "2026-08-16T11:00:00Z",
      },
      {
        id: 17,
        strategyId: 7,
        strategyName: "趋势交易策略",
        strategyVersionId: 11,
        versionNumber: 2,
        status: "failed",
        screeningPolicy: { strategy: "volume_breakout", market: "cn", maxCandidates: 3 },
        candidateCount: 0,
        candidates: [],
        screening: {},
        createdAt: "2026-08-15T11:00:00Z",
        updatedAt: "2026-08-15T11:00:00Z",
      },
    ]);
    api.listContinuousRuns.mockResolvedValue([
      {
        id: 4,
        strategyVersionId: 11,
        status: "running",
        intervalSeconds: 900,
        createdAt: "2026-08-16T10:00:00Z",
        updatedAt: "2026-08-16T10:00:00Z",
      },
    ]);
    api.listDataSources.mockResolvedValue([
      { sourceId: "system_market_data", name: "系统行情", kind: "kline", connectionKey: "market", required: true, builtIn: true, selectable: true, availability: "system_managed" },
      { sourceId: "system_news", name: "系统新闻", kind: "news", connectionKey: "news", required: false, builtIn: true, selectable: true, availability: "system_managed" },
      { sourceId: "news:tavily", name: "Tavily", kind: "news", connectionKey: "tavily", required: false, builtIn: true, selectable: false, availability: "unconfigured" },
    ]);
    api.getValidationStatus.mockResolvedValue({
      strategyVersionId: 11,
      versionRevision: 2,
      status: "not_started",
    });
  });

  it("summarizes real strategy, validation, run, and data-source state", async () => {
    render(<MemoryRouter><StrategyOverviewPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "策略首页" })).toBeInTheDocument();
    await waitFor(() => expect(api.getValidationStatus).toHaveBeenCalledWith(11));
    expect(api.getValidationStatus).toHaveBeenCalledTimes(1);

    expect(within(screen.getByText("策略总数").parentElement!).getByText("3")).toBeInTheDocument();
    expect(within(screen.getByText("待历史验证").parentElement!).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByText("活跃运行").parentElement!).getByText("2")).toBeInTheDocument();
    expect(within(screen.getByText("可用数据源").parentElement!).getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1 个运行批次失败或部分失败")).toBeInTheDocument();
    expect(screen.getByText("1 个数据连接尚未配置")).toBeInTheDocument();
  });

  it("does not invent trading performance on the operational home page", async () => {
    render(<MemoryRouter><StrategyOverviewPage /></MemoryRouter>);
    expect((await screen.findAllByText("趋势交易策略 · V2")).length).toBeGreaterThan(0);

    expect(screen.queryByText(/夏普|累计收益|胜率|最大回撤/)).not.toBeInTheDocument();
    expect(screen.getByText(/不展示推测收益或虚构 KPI/)).toBeInTheDocument();
  });
});
