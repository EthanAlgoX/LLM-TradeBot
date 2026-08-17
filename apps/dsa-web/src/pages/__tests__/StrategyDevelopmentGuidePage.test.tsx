import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StrategyDevelopmentGuidePage from "../StrategyDevelopmentGuidePage";

const writeText = vi.fn<(value: string) => Promise<void>>();
const listDataSources = vi.fn();

vi.mock("../../api/strategyWorkspace", () => ({
  strategyWorkspaceApi: { listDataSources: (...args: unknown[]) => listDataSources(...args) },
}));

const catalog = [
  { sourceId: "system_market_data", name: "系统行情路由", kind: "kline", connectionKey: "system_market_data", required: true, builtIn: true, selectable: true, availability: "system_managed", selectionMode: "automatic", markets: ["cn", "hk", "us"], description: "按市场选择行情提供方" },
  { sourceId: "system_news", name: "系统新闻路由", kind: "news", connectionKey: "system_news", required: false, builtIn: true, selectable: true, availability: "system_managed", selectionMode: "automatic", markets: ["cn", "hk", "us"], description: "提供新闻证据" },
  { sourceId: "custom:sentiment", name: "自定义舆情", kind: "other", connectionKey: "sentiment_v1", required: false, builtIn: false, selectable: true, availability: "registered", selectionMode: "provider", markets: ["cn"], description: "A 股舆情数据" },
  { sourceId: "provider:pending", name: "待配置基本面", kind: "fundamentals", connectionKey: "pending", required: false, builtIn: true, selectable: false, availability: "unconfigured", selectionMode: "provider", markets: ["us"], description: "连接尚未配置" },
];

describe("StrategyDevelopmentGuidePage", () => {
  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue();
    listDataSources.mockReset();
    listDataSources.mockResolvedValue(catalog);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("copies one self-contained guide that requires strategy code, tests, and a user-facing explanation", async () => {
    render(<MemoryRouter><StrategyDevelopmentGuidePage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "复制动态指南" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const guide = writeText.mock.calls[0][0];
    expect(guide).toContain("我的策略想法");
    expect(guide).toContain("strategy.yaml");
    expect(guide).toContain("STRATEGY.md（策略说明）要求");
    expect(guide).toContain("ResearchReport");
    expect(guide).toContain("CandidateList");
    expect(guide).toContain("DecisionProposal");
    expect(guide).toContain("测试命令和真实结果");
    expect(guide).toContain("不得补造行情");
    expect(guide).toContain("当前数据中心目录快照（动态生成）");
    expect(guide).toContain("sourceId: system_market_data");
    expect(guide).toContain("sourceId: system_news");
    expect(guide).toContain("sourceId: custom:sentiment");
    expect(guide).toContain("[unavailable] sourceId: provider:pending");
    expect(guide).toContain("strategy.yaml 与 STRATEGY.md 中的数据依赖必须一一对应");
    expect(guide).toContain("onMissing: fail");
    expect(guide).toContain("runId、strategyId、strategyVersion");
    expect(guide).toContain("requirements.lock 必须为空或只写注释");
    expect(guide).toContain("ZIP 上传、静态检查和受限函数调用已经可用");
    expect(await screen.findByRole("button", { name: "已复制动态指南" })).toBeInTheDocument();
  });

  it("shows STRATEGY.md and the live data dependency catalog", async () => {
    render(<MemoryRouter><StrategyDevelopmentGuidePage /></MemoryRouter>);

    expect(await screen.findByText(/STRATEGY\.md（策略说明）要求/)).toBeInTheDocument();
    expect(screen.getAllByText(/STRATEGY\.md/).length).toBeGreaterThan(1);
    expect(await screen.findByText("系统行情路由")).toBeInTheDocument();
    expect(screen.getByText("自定义舆情")).toBeInTheDocument();
    expect(screen.getByText("待配置基本面")).toBeInTheDocument();
    expect(screen.getAllByText("可写入策略依赖")).toHaveLength(3);
    expect(screen.getByText("尚不可用")).toBeInTheDocument();
  });

  it("blocks copying when the data catalog cannot be read", async () => {
    listDataSources.mockRejectedValueOnce(new Error("offline"));
    render(<MemoryRouter><StrategyDevelopmentGuidePage /></MemoryRouter>);

    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByRole("button", { name: "复制动态指南" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "复制动态指南" }));
    expect(writeText).not.toHaveBeenCalled();
  });
});
