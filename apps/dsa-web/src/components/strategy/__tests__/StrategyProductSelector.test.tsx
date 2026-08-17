import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { strategyWorkspaceApi, type StrategyVersion } from '../../../api/strategyWorkspace';
import { StrategyProductSelector } from '../StrategyProductSelector';

const reportVersion: StrategyVersion = {
  id: 21,
  strategyId: 11,
  status: 'PUBLISHED',
  versionNumber: 3,
  strategyPurpose: 'research_report',
  outputContract: 'ResearchReport',
  agentWorkflowVersionId: 9,
  immutable: true,
  revision: 4,
  marketScope: { universeMode: 'runtime_symbol' },
  decisionPolicy: {},
  riskPolicy: {},
  memoryPolicy: {},
  dataPermissionSnapshot: { kline: { enabled: true }, news: { enabled: true } },
  screeningPolicy: { market: 'cn', strategy: 'dual_low', maxCandidates: 3 },
  strategyPackage: {
    kind: 'builtin_python', fileName: 'builtin', sha256: 'abc', declaredVersion: '1.0.0', runtime: 'python',
    entrypoint: 'src.strategy_kernels.single_stock_research:run', executionStatus: 'ready', outputContract: 'ResearchReport',
    configurable: { markets: ['cn'], timeframes: ['1d'], runIntervals: ['1d'] }, parameters: [], dataRequirements: [],
    documentation: '正式内核', dependencyWarnings: [],
  },
  agents: [],
  connections: [],
  createdAt: '2026-08-01T00:00:00Z',
  publishedAt: '2026-08-02T00:00:00Z',
};

describe('StrategyProductSelector', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/stock-research');
    vi.spyOn(strategyWorkspaceApi, 'listStrategies').mockResolvedValue([
      {
        id: 11,
        name: '质量研究报告',
        lifecycleStatus: 'published',
        revision: 2,
        currentPublishedVersionId: 21,
        currentPublishedVersionNumber: 3,
        currentStrategyPurpose: 'research_report',
        currentOutputContract: 'ResearchReport',
        kernelExecutionStatus: 'ready',
        updatedAt: '2026-08-02T00:00:00Z',
      },
      {
        id: 12,
        name: '趋势交易策略',
        lifecycleStatus: 'published',
        revision: 2,
        currentPublishedVersionId: 22,
        currentPublishedVersionNumber: 1,
        currentStrategyPurpose: 'trading_decision',
        currentOutputContract: 'DecisionProposal',
        kernelExecutionStatus: 'ready',
        updatedAt: '2026-08-02T00:00:00Z',
      },
    ]);
    vi.spyOn(strategyWorkspaceApi, 'getVersion').mockResolvedValue(reportVersion);
  });

  afterEach(() => vi.restoreAllMocks());

  it('lists only compatible published strategies and persists the selected ids in the URL', async () => {
    const onChange = vi.fn();
    render(<StrategyProductSelector purpose="research_report" onChange={onChange} />);

    const select = await screen.findByRole('combobox', { name: '单股研究策略' });
    expect(screen.getByRole('option', { name: '质量研究报告 · V3' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /趋势交易策略/ })).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: '21' } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ version: reportVersion })));
    expect(strategyWorkspaceApi.getVersion).toHaveBeenCalledWith(21);
    expect(window.location.search).toContain('strategyId=11');
    expect(window.location.search).toContain('versionId=21');
    expect(screen.getByText('ResearchReport')).toBeInTheDocument();
    expect(screen.getByText('A 股 · K 线 + 新闻')).toBeInTheDocument();
  });

  it('keeps the frozen published version selectable while a newer draft is being edited', async () => {
    vi.mocked(strategyWorkspaceApi.listStrategies).mockResolvedValue([
      {
        id: 11,
        name: '质量研究报告',
        lifecycleStatus: 'draft',
        revision: 3,
        activeDraftVersionId: 23,
        currentPublishedVersionId: 21,
        currentPublishedVersionNumber: 3,
        currentStrategyPurpose: 'research_report',
        currentOutputContract: 'ResearchReport',
        kernelExecutionStatus: 'ready',
        updatedAt: '2026-08-03T00:00:00Z',
      },
    ]);

    render(<StrategyProductSelector purpose="research_report" onChange={() => undefined} />);

    expect(await screen.findByRole('option', { name: '质量研究报告 · V3' })).toBeInTheDocument();
  });

  it('shows a real empty state when no compatible strategy has been published', async () => {
    vi.mocked(strategyWorkspaceApi.listStrategies).mockResolvedValue([]);
    render(<StrategyProductSelector purpose="candidate_screening" onChange={() => undefined} />);

    expect(await screen.findByText('策略中心还没有正式发布的选股策略。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /前往策略中心配置/ })).toHaveAttribute('href', '/strategies');
    expect(strategyWorkspaceApi.getVersion).not.toHaveBeenCalled();
  });

  it('does not offer legacy configured versions without a callable kernel', async () => {
    vi.mocked(strategyWorkspaceApi.listStrategies).mockResolvedValue([{
      id: 15,
      name: '旧版研究配置',
      lifecycleStatus: 'published',
      revision: 1,
      currentPublishedVersionId: 25,
      currentPublishedVersionNumber: 1,
      currentStrategyPurpose: 'research_report',
      currentOutputContract: 'ResearchReport',
      kernelExecutionStatus: null,
      updatedAt: '2026-08-02T00:00:00Z',
    }]);

    render(<StrategyProductSelector purpose="research_report" onChange={() => undefined} />);

    expect(await screen.findByText('策略中心还没有正式发布的单股研究策略。')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /旧版研究配置/ })).not.toBeInTheDocument();
  });

  it('opens a historical published version from a strategy-center deep link', async () => {
    const historicalVersion = { ...reportVersion, id: 20, versionNumber: 2 };
    window.history.replaceState({}, '', '/stock-research?strategyId=11&versionId=20');
    vi.mocked(strategyWorkspaceApi.getVersion).mockResolvedValue(historicalVersion);
    const onChange = vi.fn();

    render(<StrategyProductSelector purpose="research_report" onChange={onChange} />);

    await waitFor(() => expect(strategyWorkspaceApi.getVersion).toHaveBeenCalledWith(20));
    expect(await screen.findByRole('option', { name: '质量研究报告 · V2' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '单股研究策略' })).toHaveValue('20');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ version: historicalVersion }));
  });

  it('rejects a deep link whose strategy and version identities do not match', async () => {
    window.history.replaceState({}, '', '/stock-research?strategyId=12&versionId=21');
    const onChange = vi.fn();

    render(<StrategyProductSelector purpose="research_report" onChange={onChange} />);

    expect(await screen.findByText('无法读取这个正式策略版本，请回到策略中心检查版本状态。')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
