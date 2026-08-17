import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { strategyWorkspaceApi } from "../../api/strategyWorkspace";
import StrategyLibraryPage from "../StrategyLibraryPage";

vi.mock("../../api/strategyWorkspace", () => ({
  strategyWorkspaceApi: {
    listStrategies: vi.fn(),
    createConfiguredStrategy: vi.fn(),
  },
}));

const api = vi.mocked(strategyWorkspaceApi);
const dailyResearch = {
  id: 1,
  name: "单股研究策略",
  description: "成熟单股研究链",
  lifecycleStatus: "published",
  revision: 1,
  activeDraftVersionId: null,
  currentPublishedVersionId: 10,
  currentPublishedVersionNumber: 1,
  currentStrategyPurpose: "research_report" as const,
  currentOutputContract: "ResearchReport" as const,
  currentObjective: "汇集真实行情与研究证据，生成带引用和风险说明的综合研究报告。",
  productRole: "kernel" as const,
  kernelVersionId: 10,
  kernelRuntime: "python",
  kernelEntrypoint: "src.strategy_kernels.single_stock_research:run",
  kernelExecutionStatus: "ready" as const,
  kernelDataRequirements: [{ id: "historical_ohlcv", type: "market.ohlcv", kind: "kline" as const, sourceIds: ["system_market_data"], markets: ["cn"], frequency: "1d", lookback: 120, required: true, usage: "计算技术证据", onMissing: "fail" as const }],
  isBuiltIn: true,
  sourceSystem: "daily_stock_analysis",
  updatedAt: "2026-08-16T09:00:00Z",
};
const dailyScreening = {
  ...dailyResearch,
  id: 2,
  name: "多因子选股策略",
  description: "成熟选股链",
  currentPublishedVersionId: 20,
  currentStrategyPurpose: "candidate_screening" as const,
  currentOutputContract: "CandidateList" as const,
  currentObjective: "通过硬筛、因子评分与可选 LLM 重排生成候选清单。",
  kernelDataRequirements: [
    { id: "market_snapshot", type: "market.snapshot", kind: "kline" as const, sourceIds: ["system_market_data"], markets: ["cn"], frequency: "latest", lookback: "current_session", required: true, usage: "构建候选池", onMissing: "fail" as const },
    { id: "daily_ohlcv", type: "market.ohlcv", kind: "kline" as const, sourceIds: ["system_market_data"], markets: ["cn"], frequency: "1d", lookback: 120, required: false, usage: "可选日线增强", onMissing: "degrade" as const },
  ],
};
const dailyTrading = {
  ...dailyResearch,
  id: 3,
  name: "研究决策基线",
  description: "研究决策，不执行订单",
  currentPublishedVersionId: 30,
  currentStrategyPurpose: "trading_decision" as const,
  currentOutputContract: "DecisionProposal" as const,
  currentObjective: "形成可回测的研究决策提案，但不执行订单。",
};
const draft = {
  id: 7,
  name: "我的研究策略",
  description: "尚未发布",
  lifecycleStatus: "draft",
  revision: 1,
  activeDraftVersionId: 11,
  currentPublishedVersionId: null,
  currentPublishedVersionNumber: null,
  currentStrategyPurpose: "research_report" as const,
  currentOutputContract: "ResearchReport" as const,
  productRole: "configured" as const,
  isBuiltIn: false,
  updatedAt: "2026-08-16T09:00:00Z",
};
const configuredResearch = {
  ...dailyResearch,
  id: 11,
  name: "单股研究 · A股配置",
  productRole: "configured" as const,
  kernelVersionId: 10,
  isBuiltIn: false,
  currentPublishedVersionId: 110,
};
const configuredScreening = {
  ...dailyScreening,
  id: 12,
  name: "多因子选股 · A股配置",
  productRole: "configured" as const,
  kernelVersionId: 20,
  isBuiltIn: false,
  currentPublishedVersionId: 120,
};
const configuredTrading = {
  ...dailyTrading,
  id: 13,
  name: "研究决策 · A股日线配置",
  productRole: "configured" as const,
  kernelVersionId: 30,
  isBuiltIn: false,
  currentPublishedVersionId: 130,
  backtestReadiness: {
    ready: true,
    code: "fixed_universe_ready",
    message: "已冻结 2 只股票，可直接运行正式回放。",
    symbolCount: 2,
  },
};

describe("StrategyLibraryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listStrategies.mockResolvedValue([
      dailyResearch,
      dailyScreening,
      dailyTrading,
      configuredResearch,
      configuredScreening,
      configuredTrading,
      draft,
    ]);
  });

  it("separates reusable kernels from complete configured strategies and routes only configured versions", async () => {
    render(<MemoryRouter><StrategyLibraryPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "策略内核" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "完整策略" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Daily 默认策略" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "我的策略" })).not.toBeInTheDocument();
    expect(screen.getByText("单股研究策略")).toBeInTheDocument();
    expect(screen.getByText("多因子选股策略")).toBeInTheDocument();
    expect(screen.getByText("研究决策基线")).toBeInTheDocument();
    expect(screen.getByText("我的研究策略")).toBeInTheDocument();
    expect(screen.getAllByText("汇集真实行情与研究证据，生成带引用和风险说明的综合研究报告。").length).toBeGreaterThan(0);
    expect(screen.getAllByText("通过硬筛、因子评分与可选 LLM 重排生成候选清单。").length).toBeGreaterThan(0);
    expect(screen.getAllByText("形成可回测的研究决策提案，但不执行订单。").length).toBeGreaterThan(0);
    expect(screen.queryByText("来自 Daily Stock")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开单股研究" })).toHaveAttribute(
      "href",
      "/stock-research?strategyId=11&versionId=110",
    );
    expect(screen.getByRole("link", { name: "打开选股扫描" })).toHaveAttribute(
      "href",
      "/screening?strategyId=12&versionId=120",
    );
    expect(screen.getByRole("link", { name: "开始回测" })).toHaveAttribute(
      "href",
      "/backtests?strategyId=13&versionId=130",
    );
    expect(screen.getByText("回测就绪")).toBeInTheDocument();
    expect(screen.getByText("已冻结 2 只股票，可直接运行正式回放。")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "创建运行配置" })).toHaveLength(3);
    expect(screen.getAllByText("函数可调用")).toHaveLength(3);
    expect(screen.getAllByText(/system_market_data/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("市场快照，必需，来源 system_market_data")).toBeInTheDocument();
    expect(screen.getByLabelText("历史日线增强，可选，来源 system_market_data")).toBeInTheDocument();
    expect(screen.queryByLabelText("行情 / K 线，必需，来源 system_market_data")).not.toBeInTheDocument();
  });

  it("does not promise a direct formal replay for a dynamic-universe strategy", async () => {
    api.listStrategies.mockResolvedValue([
      {
        ...configuredTrading,
        backtestReadiness: {
          ready: false,
          code: "point_in_time_universe_required",
          message: "动态选股版本需先接入历史时点股票池，当前仅可做指定股票诊断。",
        },
      },
    ]);

    render(<MemoryRouter><StrategyLibraryPage /></MemoryRouter>);

    expect(await screen.findByText("需准备历史股票池")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看回测准备" })).toHaveAttribute(
      "href",
      "/backtests?strategyId=13&versionId=130",
    );
    expect(screen.queryByRole("link", { name: "开始回测" })).not.toBeInTheDocument();
  });

  it("does not expose capability-center or blank-workflow creation actions", async () => {
    render(<MemoryRouter><StrategyLibraryPage /></MemoryRouter>);
    await screen.findByText("单股研究策略");

    expect(screen.queryByRole("link", { name: /能力中心/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /创建空白策略/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "上传策略包" })).toHaveAttribute("href", "/strategies/import");
    expect(screen.getByText(/受限 Python 子进程调用/)).toBeInTheDocument();
  });

  it("makes the purpose of every kernel and configured strategy immediately identifiable", async () => {
    render(<MemoryRouter><StrategyLibraryPage /></MemoryRouter>);
    await screen.findByText("单股研究策略");

    expect(screen.getAllByLabelText("单股研究类型")).toHaveLength(3);
    expect(screen.getAllByLabelText("选股类型")).toHaveLength(2);
    expect(screen.getAllByLabelText("交易策略类型")).toHaveLength(2);
    expect(screen.queryByText("策略用途")).not.toBeInTheDocument();
    expect(screen.queryByText("输入一只股票，输出带证据与风险说明的研究报告")).not.toBeInTheDocument();
    expect(screen.queryByText("扫描市场或指定范围，输出排序后的候选股票清单")).not.toBeInTheDocument();
    expect(screen.queryByText("生成可回测的交易研究提案，当前不会自动下单")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选股扫描" })).toBeInTheDocument();
  });

  it("creates an independent configuration draft from a selected kernel", async () => {
    api.createConfiguredStrategy.mockResolvedValue({
      strategy: { ...draft, id: 99, name: "单股研究策略 · 运行配置" },
      draft: { id: 199, strategyId: 99 },
    } as never);
    render(<MemoryRouter><StrategyLibraryPage /></MemoryRouter>);

    await screen.findByText("单股研究策略");
    fireEvent.click(screen.getAllByRole("button", { name: "创建运行配置" })[0]);
    expect(screen.getByLabelText("完整策略名称")).toHaveValue("单股研究策略 · 运行配置");
    fireEvent.click(screen.getByRole("button", { name: "进入策略配置" }));
    expect(api.createConfiguredStrategy).toHaveBeenCalledWith(
      10,
      "单股研究策略 · 运行配置",
      expect.stringContaining("单股研究策略"),
    );
    expect(screen.getByRole("link", { name: "继续策略配置" })).toHaveAttribute("href", "/strategies/7/editor?versionId=11");
  });

  it("filters the unified list by strategy output type", async () => {
    render(<MemoryRouter><StrategyLibraryPage /></MemoryRouter>);
    await screen.findByText("单股研究策略");
    fireEvent.click(screen.getByRole("button", { name: "交易决策" }));
    expect(screen.getByText("研究决策 · A股日线配置")).toBeInTheDocument();
    expect(screen.queryByText("单股研究 · A股配置")).not.toBeInTheDocument();
    expect(screen.queryByText("多因子选股 · A股配置")).not.toBeInTheDocument();
  });
});
