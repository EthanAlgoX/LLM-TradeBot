import { describe, expect, it, vi } from "vitest";
import { isValidAgentConnection } from "../strategyEditorUtils";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StrategyConfigurationPanel } from "../StrategyEditorPage";
import type {
  Agent,
  StrategyDataRequirement,
  StrategyPackageMetadata,
  StrategyVersion,
} from "../../api/strategyWorkspace";

const agent = (id: string, agentType: Agent["agentType"]): Agent => ({
  id,
  lineageId: id,
  agentType,
  name: id,
  role: "",
  systemPrompt: "",
  promptTemplate: "",
  executionMode: "LLM",
  modelProfileId: "default",
  toolPermissions: [],
  dataPermissions: [],
  inputSchema: {},
  outputSchema: {},
  timeoutSeconds: 30,
  maxRetries: 0,
  required: true,
  failurePolicy: "STOP_RUN",
  costLimit: "0",
  positionX: 0,
  positionY: 0,
});

const strategyPackage = (
  dataRequirements: StrategyDataRequirement[],
): StrategyPackageMetadata => ({
  kind: "builtin_python",
  fileName: "strategy.py",
  sha256: "test",
  declaredVersion: "2.1.0",
  runtime: "python3.11",
  entrypoint: "run",
  executionStatus: "ready",
  outputContract: "ResearchReport",
  configurable: { markets: ["cn"], timeframes: ["1d"], runIntervals: ["1d"] },
  parameters: [],
  dataRequirements,
  documentation: "测试内核",
  dependencyWarnings: [],
});

const requirement = (
  overrides: Partial<StrategyDataRequirement>,
): StrategyDataRequirement => ({
  id: "historical_ohlcv",
  type: "historical_ohlcv",
  kind: "kline",
  sourceIds: [],
  markets: ["cn"],
  frequency: "1d",
  lookback: 120,
  required: false,
  usage: "历史日线输入",
  onMissing: "degrade",
  ...overrides,
});

describe("published graph safety rules", () => {
  it("retains the production connection rule used by read-only views without inventing a mutable path", () => {
    expect(
      isValidAgentConnection(
        agent("reflection", "REFLECTION"),
        agent("analysis", "ANALYSIS"),
        "DATA_FLOW",
      ),
    ).toMatch(/反思/);
  });
  it.each(["决策有效期", "最大单资产权重", "决策策略 JSON", "记忆策略 JSON"])(
    "marks %s read-only in a published configuration",
    (label) => {
      const version: StrategyVersion = {
        id: 1,
        strategyId: 1,
        status: "PUBLISHED",
        immutable: true,
        revision: 1,
        marketScope: {},
        decisionPolicy: {},
        riskPolicy: {},
        memoryPolicy: {},
        dataPermissionSnapshot: {},
        agents: [],
        connections: [],
        createdAt: "2026-01-01T00:00:00Z",
      };
      render(
        <MemoryRouter>
          <StrategyConfigurationPanel
            version={version}
            disabled
            onChange={() => undefined}
          />
        </MemoryRouter>,
      );
      expect(screen.getByLabelText(label)).toBeDisabled();
    },
  );

  it("shows versioned data sources as read-only configuration instead of an input Agent", () => {
    const version: StrategyVersion = {
      id: 1,
      strategyId: 1,
      status: "PUBLISHED",
      immutable: true,
      revision: 1,
      marketScope: {},
      decisionPolicy: {},
      riskPolicy: {},
      memoryPolicy: {},
      dataPermissionSnapshot: {
        kline: {
          enabled: true,
          connection: "local_stock_daily",
          timeframe: "1d",
        },
      },
      agents: [],
      connections: [],
      createdAt: "2026-01-01T00:00:00Z",
    };
    render(
      <MemoryRouter>
        <StrategyConfigurationPanel
          version={version}
          disabled
          onChange={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("strategy-data-source-config")).toHaveTextContent(
      "数据不是 Agent",
    );
    expect(screen.getByText("必备")).toBeInTheDocument();
    expect(screen.getByLabelText("K 线与行情连接")).toBeDisabled();
    expect(
      screen.queryByLabelText("数据权限快照 JSON"),
    ).not.toBeInTheDocument();
  });

  it("uses the kernel contract instead of globally forcing K-line data", () => {
    const onChange = vi.fn();
    const version: StrategyVersion = {
      id: 11,
      strategyId: 1,
      status: "DRAFT",
      immutable: false,
      revision: 1,
      marketScope: {},
      decisionPolicy: {},
      riskPolicy: {},
      memoryPolicy: {},
      dataPermissionSnapshot: { kline: { enabled: true } },
      strategyPackage: strategyPackage([
        requirement({ usage: "用于价格背景；缺失时报告明确降级" }),
        requirement({ id: "fundamentals", type: "fundamentals", kind: "fundamentals", usage: "用于补充基本面" }),
        requirement({ id: "news", type: "news", kind: "news", usage: "用于补充事件背景" }),
      ]),
      agents: [],
      connections: [],
      createdAt: "2026-01-01T00:00:00Z",
    };
    render(
      <MemoryRouter>
        <StrategyConfigurationPanel
          version={version}
          disabled={false}
          onChange={onChange}
        />
      </MemoryRouter>,
    );
    const config = within(screen.getByTestId("strategy-data-source-config"));
    expect(config.getByText(/是否必需及缺失时的处理方式由当前内核声明/)).toBeInTheDocument();
    expect(config.queryByText("必备")).not.toBeInTheDocument();
    expect(config.queryByText("其他数据源")).not.toBeInTheDocument();
    fireEvent.click(config.getByLabelText("启用K 线与行情"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        dataPermissionSnapshot: expect.objectContaining({
          kline: expect.objectContaining({ enabled: false }),
        }),
      }),
    );
  });

  it("merges required snapshot and optional daily enhancement into one K-line card", () => {
    const version: StrategyVersion = {
      id: 12,
      strategyId: 2,
      status: "PUBLISHED",
      immutable: true,
      revision: 1,
      marketScope: {},
      decisionPolicy: {},
      riskPolicy: {},
      memoryPolicy: {},
      dataPermissionSnapshot: { kline: { enabled: true } },
      strategyPackage: {
        ...strategyPackage([
          requirement({ id: "market_snapshot", type: "market_snapshot", required: true, onMissing: "fail", usage: "当日市场快照" }),
          requirement({ id: "daily_ohlcv", type: "daily_ohlcv", usage: "历史日线增强" }),
        ]),
        outputContract: "CandidateList",
      },
      agents: [],
      connections: [],
      createdAt: "2026-01-01T00:00:00Z",
    };
    render(
      <MemoryRouter>
        <StrategyConfigurationPanel
          version={version}
          disabled
          onChange={() => undefined}
        />
      </MemoryRouter>,
    );
    const config = within(screen.getByTestId("strategy-data-source-config"));
    expect(config.getAllByText("必备")).toHaveLength(1);
    expect(config.getByText(/当日市场快照（必需）/)).toBeInTheDocument();
    expect(config.getByText(/历史日线增强（可选）/)).toBeInTheDocument();
    expect(config.queryByLabelText("启用K 线与行情")).not.toBeInTheDocument();
  });

  it("explains the auxiliary configuration order and offers a nearby draft action for published versions", () => {
    const onCreateDraft = vi.fn();
    const version: StrategyVersion = {
      id: 1,
      strategyId: 1,
      status: "PUBLISHED",
      immutable: true,
      revision: 1,
      marketScope: {},
      decisionPolicy: {},
      riskPolicy: {},
      memoryPolicy: {},
      dataPermissionSnapshot: {},
      agents: [],
      connections: [],
      createdAt: "2026-01-01T00:00:00Z",
    };
    render(
      <MemoryRouter>
        <StrategyConfigurationPanel
          version={version}
          disabled
          onCreateDraft={onCreateDraft}
          onChange={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "配置完整策略" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1. 输出契约")).toBeInTheDocument();
    expect(screen.getByText("2. 研究对象与股票范围")).toBeInTheDocument();
    expect(screen.getByText("3. 输入数据来源")).toBeInTheDocument();
    expect(screen.getByText("4. 运行参数")).toBeInTheDocument();
    expect(screen.getByText("5. 策略内核")).toBeInTheDocument();
    expect(screen.getByText("6. 决策边界")).toBeInTheDocument();
    expect(screen.getByText("7. 高级策略参数")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("不能直接切换");
    fireEvent.click(screen.getByRole("button", { name: "创建配置草稿后调整" }));
    expect(onCreateDraft).toHaveBeenCalledOnce();
  });

  it("treats the internal implementation as a frozen kernel instead of a workflow selector", () => {
    const onChange = vi.fn();
    const analysis = agent("analysis-1", "ANALYSIS");
    analysis.name = "技术分析 Agent";
    const version: StrategyVersion = {
      id: 8,
      strategyId: 3,
      status: "DRAFT",
      immutable: false,
      revision: 1,
      marketScope: {},
      decisionPolicy: {},
      riskPolicy: {},
      memoryPolicy: {},
      dataPermissionSnapshot: {},
      agents: [analysis],
      connections: [],
      createdAt: "2026-01-01T00:00:00Z",
    };
    render(
      <MemoryRouter>
        <StrategyConfigurationPanel
          version={version}
          disabled={false}
          workflows={[{
            id: 41, workflowId: 6, workflowName: "正式研究工作流", status: "PUBLISHED", versionNumber: 2,
            revision: 3, immutable: true, outputContract: "DecisionProposal", agentCount: 1, connectionCount: 0, agents: [], connections: [],
            createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z",
          }]}
          onChange={onChange}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText("执行工作流")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /能力中心/ })).not.toBeInTheDocument();
    expect(screen.getByText("历史内嵌策略内核")).toBeInTheDocument();
    expect(screen.getByText("1 个内部步骤 · 0 条依赖")).toBeInTheDocument();
    expect(screen.getByText(/输出契约由策略包决定/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows runtime single-stock scope and a non-trading output boundary for report strategies", () => {
    const version: StrategyVersion = {
      id: 13, strategyId: 4, status: "DRAFT", immutable: false, revision: 1,
      strategyPurpose: "research_report", outputContract: "ResearchReport",
      marketScope: { universeMode: "runtime_symbol" }, decisionPolicy: {}, riskPolicy: {}, memoryPolicy: {}, dataPermissionSnapshot: {},
      agents: [agent("analysis", "ANALYSIS")], connections: [], createdAt: "2026-01-01T00:00:00Z",
    };
    render(<MemoryRouter><StrategyConfigurationPanel version={version} disabled={false} onChange={() => undefined} /></MemoryRouter>);
    expect(screen.getByLabelText("股票池来源")).toHaveValue("runtime_symbol");
    expect(screen.getByText(/每次从单股研究页启动时选择一只股票/)).toBeInTheDocument();
    expect(screen.getByText("6. 产出边界")).toBeInTheDocument();
    expect(screen.queryByLabelText("最大单资产权重")).not.toBeInTheDocument();
  });

  it("starts with three usable defaults and persists an alternate K-line connection", () => {
    const onChange = vi.fn();
    const version: StrategyVersion = {
      id: 1,
      strategyId: 1,
      status: "DRAFT",
      immutable: false,
      revision: 1,
      marketScope: {},
      decisionPolicy: {},
      riskPolicy: {},
      memoryPolicy: {},
      dataPermissionSnapshot: {},
      agents: [],
      connections: [],
      createdAt: "2026-01-01T00:00:00Z",
    };
    render(
      <MemoryRouter>
        <StrategyConfigurationPanel
          version={version}
          disabled={false}
          onChange={onChange}
        />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("启用新闻与资讯")).toBeChecked();
    expect(screen.getByLabelText("启用基本面")).toBeChecked();
    fireEvent.change(screen.getByLabelText("K 线与行情连接"), {
      target: { value: "local_stock_daily" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        dataPermissionSnapshot: expect.objectContaining({
          schemaVersion: 2,
          kline: expect.objectContaining({
            enabled: true,
            connection: "local_stock_daily",
            timeframe: "1d",
          }),
        }),
      }),
    );
  });

  it("shows dynamic screening controls only for a dynamic universe", () => {
    const onChange = vi.fn();
    const version: StrategyVersion = {
      id: 1,
      strategyId: 1,
      status: "DRAFT",
      immutable: false,
      revision: 1,
      marketScope: {},
      decisionPolicy: {},
      riskPolicy: {},
      memoryPolicy: {},
      dataPermissionSnapshot: {},
      agents: [],
      connections: [],
      createdAt: "2026-01-01T00:00:00Z",
    };
    render(
      <MemoryRouter>
        <StrategyConfigurationPanel
          version={version}
          disabled={false}
          onChange={onChange}
        />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("选股策略")).toBeEnabled();
    expect(screen.getByLabelText("每批研究候选数")).toBeEnabled();
    expect(screen.queryByLabelText("策略固定股票代码")).not.toBeInTheDocument();
    expect(
      screen.getByText(/动态候选只负责缩小范围/),
    ).toBeInTheDocument();
  });

  it("separates automatic routing from configured providers and freezes the selected provider", () => {
    const onChange = vi.fn();
    const version: StrategyVersion = {
      id: 1,
      strategyId: 1,
      status: "DRAFT",
      immutable: false,
      revision: 1,
      marketScope: {},
      decisionPolicy: {},
      riskPolicy: {},
      memoryPolicy: {},
      dataPermissionSnapshot: {},
      agents: [],
      connections: [],
      createdAt: "2026-01-01T00:00:00Z",
    };
    const dataSources = [
      {
        sourceId: "system_market_data",
        name: "系统自动选择",
        kind: "kline" as const,
        connectionKey: "system_market_data",
        required: true,
        builtIn: true,
        selectable: true,
        availability: "system_managed" as const,
        selectionMode: "automatic" as const,
        description: "自动切换",
      },
      {
        sourceId: "kline:akshare",
        name: "AkShare 行情",
        kind: "kline" as const,
        connectionKey: "kline:akshare",
        required: false,
        builtIn: true,
        selectable: true,
        availability: "configured" as const,
        selectionMode: "provider" as const,
        description: "指定 AkShare",
        markets: ["cn", "hk"],
      },
      {
        sourceId: "kline:tushare",
        name: "Tushare 行情",
        kind: "kline" as const,
        connectionKey: "kline:tushare",
        required: false,
        builtIn: true,
        selectable: false,
        availability: "unconfigured" as const,
        selectionMode: "provider" as const,
        description: "需要 Token",
      },
      {
        sourceId: "system_news",
        name: "系统自动选择",
        kind: "news" as const,
        connectionKey: "system_news",
        required: false,
        builtIn: true,
        selectable: true,
        availability: "system_managed" as const,
        selectionMode: "automatic" as const,
      },
      {
        sourceId: "system_fundamentals",
        name: "按市场自动选择",
        kind: "fundamentals" as const,
        connectionKey: "system_fundamentals",
        required: false,
        builtIn: true,
        selectable: true,
        availability: "system_managed" as const,
        selectionMode: "automatic" as const,
      },
    ];
    render(
      <MemoryRouter>
        <StrategyConfigurationPanel
          version={version}
          disabled={false}
          dataSources={dataSources}
          onChange={onChange}
        />
      </MemoryRouter>,
    );
    const select = screen.getByLabelText("K 线与行情连接");
    expect(
      screen.getByRole("group", { name: "指定提供方" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Tushare 行情 · 未配置" }),
    ).toBeDisabled();
    fireEvent.change(select, { target: { value: "kline:akshare" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        dataPermissionSnapshot: expect.objectContaining({
          kline: expect.objectContaining({ connection: "kline:akshare" }),
        }),
      }),
    );
  });

  it("selects a custom catalog item through the extensible other-source control", () => {
    const onChange = vi.fn();
    const version: StrategyVersion = {
      id: 1,
      strategyId: 1,
      status: "DRAFT",
      immutable: false,
      revision: 1,
      marketScope: {},
      decisionPolicy: {},
      riskPolicy: {},
      memoryPolicy: {},
      dataPermissionSnapshot: {},
      agents: [],
      connections: [],
      createdAt: "2026-01-01T00:00:00Z",
    };
    render(
      <MemoryRouter>
        <StrategyConfigurationPanel
          version={version}
          disabled={false}
          dataSources={[
            {
              id: 9,
              sourceId: "custom:industry",
              name: "行业景气度",
              kind: "other",
              connectionKey: "industry_cycle_v1",
              required: false,
              builtIn: false,
              selectable: true,
              availability: "registered",
            },
          ]}
          onChange={onChange}
        />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("添加其他数据源"), {
      target: { value: "custom:industry" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        dataPermissionSnapshot: expect.objectContaining({
          schemaVersion: 2,
          other: { enabled: true, sourceIds: ["custom:industry"] },
        }),
      }),
    );
  });

  it("filters sources by strategy market and reconciles incompatible inputs when the market changes", () => {
    const onChange = vi.fn();
    const version: StrategyVersion = {
      id: 1,
      strategyId: 1,
      status: "DRAFT",
      immutable: false,
      revision: 1,
      screeningPolicy: { strategy: "dual_low", market: "cn", maxCandidates: 3 },
      marketScope: { universeMode: "fixed", symbols: ["600519"] },
      decisionPolicy: {},
      riskPolicy: {},
      memoryPolicy: {},
      dataPermissionSnapshot: {
        kline: { enabled: true, connection: "kline:cn-only", timeframe: "1d" },
        other: { enabled: true, sourceIds: ["custom:cn", "custom:hk"] },
      },
      agents: [],
      connections: [],
      createdAt: "2026-01-01T00:00:00Z",
    };
    const dataSources = [
      { sourceId: "system_market_data", name: "系统自动选择", kind: "kline" as const, connectionKey: "system_market_data", required: true, builtIn: true, selectable: true, availability: "system_managed" as const, selectionMode: "automatic" as const, markets: ["cn", "hk", "us"] },
      { sourceId: "kline:cn-only", name: "A 股专用行情", kind: "kline" as const, connectionKey: "kline:cn-only", required: false, builtIn: false, selectable: true, availability: "registered" as const, selectionMode: "provider" as const, markets: ["cn"] },
      { sourceId: "kline:hk-only", name: "港股专用行情", kind: "kline" as const, connectionKey: "kline:hk-only", required: false, builtIn: false, selectable: true, availability: "registered" as const, selectionMode: "provider" as const, markets: ["hk"] },
      { sourceId: "system_news", name: "系统自动选择", kind: "news" as const, connectionKey: "system_news", required: false, builtIn: true, selectable: true, availability: "system_managed" as const, selectionMode: "automatic" as const, markets: ["cn", "hk", "us"] },
      { sourceId: "system_fundamentals", name: "按市场自动选择", kind: "fundamentals" as const, connectionKey: "system_fundamentals", required: false, builtIn: true, selectable: true, availability: "system_managed" as const, selectionMode: "automatic" as const, markets: ["cn", "hk", "us"] },
      { sourceId: "custom:cn", name: "A 股舆情", kind: "other" as const, connectionKey: "cn_sentiment", required: false, builtIn: false, selectable: true, availability: "registered" as const, selectionMode: "provider" as const, markets: ["cn"] },
      { sourceId: "custom:hk", name: "港股舆情", kind: "other" as const, connectionKey: "hk_sentiment", required: false, builtIn: false, selectable: true, availability: "registered" as const, selectionMode: "provider" as const, markets: ["hk"] },
      { sourceId: "custom:cn-extra", name: "A 股行业库", kind: "other" as const, connectionKey: "cn_industry", required: false, builtIn: false, selectable: true, availability: "registered" as const, selectionMode: "provider" as const, markets: ["cn"] },
      { sourceId: "custom:hk-extra", name: "港股行业库", kind: "other" as const, connectionKey: "hk_industry", required: false, builtIn: false, selectable: true, availability: "registered" as const, selectionMode: "provider" as const, markets: ["hk"] },
    ];
    render(
      <MemoryRouter>
        <StrategyConfigurationPanel
          version={version}
          disabled={false}
          dataSources={dataSources}
          onChange={onChange}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("option", { name: "A 股专用行情" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "港股专用行情" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /A 股行业库/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /港股行业库/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("选股市场"), { target: { value: "hk" } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        screeningPolicy: expect.objectContaining({ market: "hk" }),
        marketScope: expect.objectContaining({ symbols: [] }),
        dataPermissionSnapshot: expect.objectContaining({
          kline: expect.objectContaining({ connection: "system_market_data" }),
          other: { enabled: true, sourceIds: ["custom:hk"] },
        }),
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("港股已应用");
    expect(screen.getByRole("status")).toHaveTextContent("已清空原市场的固定股票代码");
  });
});
