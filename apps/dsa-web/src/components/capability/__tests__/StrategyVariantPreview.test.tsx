import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { strategyWorkspaceApi } from "../../../api/strategyWorkspace";
import { StrategyVariantPreview } from "../StrategyVariantPreview";

vi.mock("../../../api/strategyWorkspace", () => ({
  strategyWorkspaceApi: {
    listValidationComparisonCandidates: vi.fn(),
    compareValidationExperiments: vi.fn(),
  },
}));

const api = vi.mocked(strategyWorkspaceApi);
const config = {
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  initialCapital: 1_000_000,
  commissionRate: 0.0003,
  minimumCommission: 5,
  slippageRate: 0.001,
  executionRule: "next_open" as const,
  rebalanceFrequency: "weekly" as const,
  market: "cn" as const,
  universeMode: "strategy" as const,
  experimentPurpose: "validation" as const,
  maxPositions: 3,
  maxUniverseSize: 50,
  symbols: ["600519", "000001"],
};
const candidate = (id: number, versionId: number, versionNumber: number) => ({
  id,
  strategyId: 7,
  strategyName: "研究决策基线",
  strategyVersionId: versionId,
  versionNumber,
  versionStatus: "PUBLISHED",
  versionRevision: 1,
  status: "completed" as const,
  engineVersion: "strategy-validation-v2",
  config,
  barCount: 240,
  inputSnapshotHash: `hash-${id}`,
  integrityStatus: "verified" as const,
  completedAt: `2026-08-${10 + id}T10:00:00Z`,
});

const comparison = {
  strategyId: 7,
  strategyName: "研究决策基线",
  baseline: { experimentId: 21, strategyVersionId: 11, versionNumber: 1, versionStatus: "PUBLISHED", completedAt: "2026-08-15T10:00:00Z", inputSnapshotHash: "same", symbolCount: 2, metrics: { initialCapital: 1_000_000, finalEquity: 1_080_000, cumulativeReturn: 0.08, annualizedReturn: 0.08, maxDrawdown: -0.03, annualizedVolatility: 0.12, sharpeRatio: 0.71, tradeCount: 8, closedTradeCount: 3, winRate: 0.667, turnover: 1.4 } },
  target: { experimentId: 22, strategyVersionId: 12, versionNumber: 2, versionStatus: "PUBLISHED", completedAt: "2026-08-16T10:00:00Z", inputSnapshotHash: "same", symbolCount: 2, metrics: { initialCapital: 1_000_000, finalEquity: 1_120_000, cumulativeReturn: 0.12, annualizedReturn: 0.12, maxDrawdown: -0.025, annualizedVolatility: 0.11, sharpeRatio: 1.02, tradeCount: 10, closedTradeCount: 4, winRate: 0.75, turnover: 1.6 } },
  metrics: [
    { key: "cumulativeReturn", label: "累计收益", format: "percent" as const, preference: "higher" as const, baselineValue: 0.08, targetValue: 0.12, delta: 0.04 },
    { key: "maxDrawdown", label: "最大回撤", format: "percent" as const, preference: "higher" as const, baselineValue: -0.03, targetValue: -0.025, delta: 0.005 },
  ],
  comparisonBasis: { startDate: "2025-01-01", endDate: "2025-12-31", actualReplayStartDate: "2025-01-02", actualReplayEndDate: "2025-12-31", market: "cn", engineVersion: "strategy-validation-v2", methodology: "historical_ohlcv_policy_replay", snapshotMode: "exact_snapshot" as const, sameUniverse: true, baselineSources: ["test"], targetSources: ["test"], costAssumptions: { initialCapital: 1_000_000, commissionRate: 0.0003, minimumCommission: 5, slippageRate: 0.001 }, executionAssumptions: { executionRule: "next_open", rebalanceFrequency: "weekly", maxPositions: 3, maxUniverseSize: 50 } },
};

describe("StrategyVariantPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listValidationComparisonCandidates.mockResolvedValue([
      candidate(21, 11, 1),
      candidate(22, 12, 2),
    ]);
    api.compareValidationExperiments.mockResolvedValue(comparison);
  });

  it("loads real completed records and renders backend-computed differences", async () => {
    render(<StrategyVariantPreview strategyId={7} currentVersionId={11} />);
    expect(await screen.findByText("2 个可比较版本")).toBeInTheDocument();
    expect(api.listValidationComparisonCandidates).toHaveBeenCalledWith(7);
    fireEvent.click(screen.getByRole("button", { name: "比较两个版本" }));
    await waitFor(() => expect(api.compareValidationExperiments).toHaveBeenCalledWith(21, 22));
    expect(await screen.findByText("比较口径已通过后端校验")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /累计收益/ })).toHaveTextContent("8%");
    expect(screen.getByRole("row", { name: /累计收益/ })).toHaveTextContent("12%");
    expect(screen.getByRole("row", { name: /累计收益/ })).toHaveTextContent("+4%");
    expect(screen.getByText("完全相同的冻结行情快照")).toBeInTheDocument();
  });

  it("shows an honest empty state and no fabricated metrics", async () => {
    api.listValidationComparisonCandidates.mockResolvedValue([]);
    render(<StrategyVariantPreview strategyId={7} currentVersionId={11} />);
    expect(await screen.findByText("还没有可用于版本对比的正式回放。")).toBeInTheDocument();
    expect(screen.queryByText("累计收益")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "比较两个版本" })).not.toBeInTheDocument();
  });

  it("surfaces backend comparability errors instead of calculating in the browser", async () => {
    api.compareValidationExperiments.mockRejectedValue(new Error("mismatch"));
    render(<StrategyVariantPreview strategyId={7} currentVersionId={11} />);
    await screen.findByText("2 个可比较版本");
    fireEvent.click(screen.getByRole("button", { name: "比较两个版本" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法完成版本对比，请稍后重试");
    expect(screen.queryByText("累计收益")).not.toBeInTheDocument();
  });
});
