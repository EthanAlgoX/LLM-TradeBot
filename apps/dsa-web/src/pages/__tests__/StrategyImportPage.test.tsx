import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StrategyImportPage from "../StrategyImportPage";

const intakeStrategyPackage = vi.fn();
const createConfiguredStrategy = vi.fn();

vi.mock("../../api/strategyWorkspace", () => ({
  strategyWorkspaceApi: {
    intakeStrategyPackage: (...args: unknown[]) => intakeStrategyPackage(...args),
    createConfiguredStrategy: (...args: unknown[]) => createConfiguredStrategy(...args),
  },
}));

const result = {
  strategy: { id: 42, name: "均值回归策略", lifecycleStatus: "draft", revision: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  draft: { id: 88, strategyId: 42, status: "DRAFT", immutable: false, revision: 1, marketScope: {}, decisionPolicy: {}, riskPolicy: {}, memoryPolicy: {}, dataPermissionSnapshot: {}, agents: [], connections: [], createdAt: "2026-01-01" },
  package: { kind: "uploaded_package", fileName: "mean-reversion.zip", sha256: "abc", declaredVersion: "1.0.0", runtime: "python", entrypoint: "strategy:run", executionStatus: "ready", outputContract: "DecisionProposal", configurable: { markets: ["cn", "hk"], timeframes: ["1d", "1w"], runIntervals: ["1d"] }, parameters: [{ name: "lookback_days", type: "integer", default: 20 }], dataRequirements: [{ id: "ohlcv", type: "market.ohlcv", kind: "kline", sourceIds: ["system_market_data"], markets: ["cn"], frequency: "1d", lookback: 120, required: true, usage: "计算均线", onMissing: "fail" }], documentation: "说明", dependencyWarnings: [] },
  warnings: [],
};

describe("StrategyImportPage", () => {
  beforeEach(() => {
    intakeStrategyPackage.mockReset();
    createConfiguredStrategy.mockReset();
    intakeStrategyPackage.mockResolvedValue(result);
    createConfiguredStrategy.mockResolvedValue({
      strategy: { id: 43 },
      draft: { id: 89, strategyId: 43 },
    });
  });

  it("uploads a real zip package and continues to the existing strategy configuration editor", async () => {
    render(<MemoryRouter initialEntries={["/strategies/import"]}><Routes><Route path="/strategies/import" element={<StrategyImportPage />} /><Route path="/strategies/:strategyId/editor" element={<div>策略配置工作台</div>} /></Routes></MemoryRouter>);
    const file = new File(["package"], "mean-reversion.zip", { type: "application/zip" });

    fireEvent.change(screen.getByLabelText("选择策略包"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "上传并检查策略包" }));

    await waitFor(() => expect(intakeStrategyPackage).toHaveBeenCalledWith(file));
    expect(await screen.findByText("策略内核已保存，函数入口可调用")).toBeInTheDocument();
    expect(screen.getByText("DecisionProposal")).toBeInTheDocument();
    expect(screen.getByText("cn / hk")).toBeInTheDocument();
    expect(screen.getByText(/不能读取平台文件、环境密钥或直接访问网络/)).toBeInTheDocument();
    expect(screen.getByText(/system_market_data.*计算均线/)).toBeInTheDocument();

    expect(screen.getByLabelText("完整策略名称")).toHaveValue("均值回归策略 · 运行配置");
    fireEvent.click(screen.getByRole("button", { name: /创建并配置完整策略/ }));
    await waitFor(() => expect(createConfiguredStrategy).toHaveBeenCalledWith(
      88,
      "均值回归策略 · 运行配置",
      expect.stringContaining("均值回归策略"),
    ));
    expect(await screen.findByText("策略配置工作台")).toBeInTheDocument();
  });
});
