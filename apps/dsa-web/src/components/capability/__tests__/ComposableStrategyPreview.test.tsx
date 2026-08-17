import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { StrategyVersion } from "../../../api/strategyWorkspace";
import { ComposableStrategyPreview } from "../ComposableStrategyPreview";

const version: StrategyVersion = {
  id: 17,
  strategyId: 9,
  status: "DRAFT",
  immutable: false,
  revision: 3,
  marketScope: { universeMode: "fixed", symbols: ["600519", "000001"] },
  screeningPolicy: { strategy: "dual_low", market: "cn", maxCandidates: 3 },
  decisionPolicy: {},
  riskPolicy: { max_asset_weight: 0.2 },
  memoryPolicy: {},
  dataPermissionSnapshot: {
    kline: { enabled: true, connection: "system_market_data" },
    news: { enabled: true, connection: "system_news" },
  },
  agents: [],
  connections: [],
  createdAt: "2026-08-16T00:00:00Z",
};

describe("strategy assembly overview", () => {
  it("shows only persisted StrategyVersion assembly layers", () => {
    render(
      <MemoryRouter>
        <ComposableStrategyPreview version={version} />
      </MemoryRouter>,
    );

    expect(screen.getByText("600519、000001")).toBeInTheDocument();
    expect(screen.getByText("K 线 · 新闻")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "完整策略组成" })).toBeInTheDocument();
    expect(screen.getByText("独立运行配置")).toBeInTheDocument();
    expect(screen.getByText("内部实现已冻结")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /工作流/ })).not.toBeInTheDocument();
    expect(screen.queryByText("MA / RSI 特征计算")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /保存组合/ })).not.toBeInTheDocument();
    expect(screen.getByText(/修改配置不会改写内核实现/)).toBeInTheDocument();
  });
});
