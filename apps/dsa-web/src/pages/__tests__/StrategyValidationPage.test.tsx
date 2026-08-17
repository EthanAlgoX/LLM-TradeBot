import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StrategyValidationPage from '../StrategyValidationPage';
import { strategyWorkspaceApi } from '../../api/strategyWorkspace';

vi.mock('../../api/strategyWorkspace', () => ({
  strategyWorkspaceApi: {
    getStrategy: vi.fn(), getVersion: vi.fn(), listRunnableVersions: vi.fn(),
    listValidationExperiments: vi.fn(), getValidationStatus: vi.fn(),
    createValidationExperiment: vi.fn(), executeValidationExperiment: vi.fn(),
    listValidationComparisonCandidates: vi.fn(), compareValidationExperiments: vi.fn(),
  },
}));

const api = vi.mocked(strategyWorkspaceApi);
const strategy = {
  id: 7, name: '趋势突破多 Agent 研究策略', description: '自动选股到复盘的研究策略',
  lifecycleStatus: 'ACTIVE', revision: 4, currentPublishedVersionId: 11, currentPublishedVersionNumber: 1,
  updatedAt: '2026-08-15T09:00:00Z',
};
const version = {
  id: 11, strategyId: 7, status: 'PUBLISHED', versionNumber: 1, immutable: true, revision: 4,
  marketScope: { universeMode: 'fixed', symbols: ['600519', '000001'] }, decisionPolicy: {}, riskPolicy: {}, memoryPolicy: {}, dataPermissionSnapshot: {},
  agents: [], connections: [], createdAt: '2026-08-14T09:00:00Z', publishedAt: '2026-08-15T09:00:00Z',
};
const validationStatus = { strategyVersionId: 11, versionRevision: 4, status: 'not_started' as const, latestExperimentId: null, latestCompletedExperimentId: null, validatedAt: null };
const completedExperiment = {
  id: 21, strategyId: 7, strategyName: strategy.name, strategyVersionId: 11, versionNumber: 1,
  versionStatus: 'PUBLISHED', versionRevision: 4, status: 'completed' as const,
  engineVersion: 'strategy-validation-v2', barCount: 240, integrityStatus: 'verified' as const, errorMessage: null,
  config: { startDate: '2025-01-01', endDate: '2025-12-31', initialCapital: 1000000, commissionRate: 0.0003, minimumCommission: 5, slippageRate: 0.001, executionRule: 'next_open' as const, rebalanceFrequency: 'weekly' as const, market: 'cn' as const, universeMode: 'strategy' as const, experimentPurpose: 'validation' as const, maxPositions: 3, maxUniverseSize: 50, symbols: ['600519', '000001'] },
  result: { engineVersion: 'strategy-validation-v2', methodology: 'historical_ohlcv_policy_replay', conclusion: 'observational' as const, metrics: { initialCapital: 1000000, finalEquity: 1080000, cumulativeReturn: 0.08, annualizedReturn: 0.08, maxDrawdown: -0.03, annualizedVolatility: 0.12, sharpeRatio: 0.71, tradeCount: 8, closedTradeCount: 3, winRate: 0.667, turnover: 1.4 }, equityCurve: [{ date: '2025-01-01', equity: 1000000, cash: 1000000, positionCount: 0 }, { date: '2025-12-31', equity: 1080000, cash: 100000, positionCount: 2 }], trades: [{ code: '600519', side: 'buy' as const, quantity: 100, signalDate: '2025-01-02', executionDate: '2025-01-03', rawPrice: 100, fillPrice: 100.1, grossAmount: 10010, commission: 3, slippageCost: 10, realizedPnl: null }], finalPositions: [], marketSnapshot: { sha256: 'abc123', barCount: 240, symbolCount: 2, sources: ['test'], firstDate: '2024-10-01', lastDate: '2025-12-31' }, dataQuality: { complete: true, requestedStartDate: '2025-01-01', requestedEndDate: '2025-12-31', actualReplayStartDate: '2025-01-02', actualReplayEndDate: '2025-12-31', symbols: [{ requestedSymbol: '600519', resolvedSymbol: '600519', lookbackBars: 21, replayBars: 219, minimumReplayBars: 184, complete: true }] }, strategyReplay: { screeningPolicy: 'dual_low', rebalanceFrequency: 'weekly', executionRule: 'next_open', maxPositions: 3, universeMode: 'strategy', experimentPurpose: 'validation' as const }, limitations: ['仅使用冻结的本地日线。'] },
  createdAt: '2026-08-15T10:00:00Z', startedAt: '2026-08-15T10:00:00.500Z', completedAt: '2026-08-15T10:00:01Z',
};

describe('StrategyValidationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getStrategy.mockResolvedValue({ ...strategy, versions: [version] });
    api.getVersion.mockResolvedValue(version);
    api.listRunnableVersions.mockResolvedValue([]);
    api.listValidationExperiments.mockResolvedValue([]);
    api.getValidationStatus.mockResolvedValue(validationStatus);
    api.listValidationComparisonCandidates.mockResolvedValue([]);
    api.createValidationExperiment.mockResolvedValue({ ...completedExperiment, status: 'queued', result: null });
    api.executeValidationExperiment.mockResolvedValue(completedExperiment);
  });

  it('uses real strategy and published-version API data from the URL context', async () => {
    render(<MemoryRouter initialEntries={['/backtests?strategyId=7&versionId=11']}><StrategyValidationPage /></MemoryRouter>);
    expect(await screen.findByText('趋势突破多 Agent 研究策略 · 已发布版本 V1')).toBeInTheDocument();
    expect(api.getStrategy).toHaveBeenCalledWith(7);
    expect(api.getVersion).toHaveBeenCalledWith(11);
    expect(api.listValidationExperiments).toHaveBeenCalledWith(11);
    expect(screen.getByRole('link', { name: /在运行中心打开/ })).toHaveAttribute('href', '/runs?strategyId=7&versionId=11');
  });

  it('keeps the real strategy version visible when only the validation-record API fails', async () => {
    api.listValidationExperiments.mockRejectedValueOnce(new Error('validation endpoint not found'));
    render(<MemoryRouter initialEntries={['/backtests?strategyId=7&versionId=11']}><StrategyValidationPage /></MemoryRouter>);
    expect(await screen.findByText('趋势突破多 Agent 研究策略 · 已发布版本 V1')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('策略版本已读取，但验证记录接口暂时不可用');
    expect(screen.getByRole('button', { name: '刷新重试' })).toBeInTheDocument();
    expect(screen.queryByText('无法读取这个策略版本或验证记录。')).not.toBeInTheDocument();
  });

  it('lists real published versions without URL parameters and carries their IDs into research', async () => {
    api.listRunnableVersions.mockResolvedValue([{ strategyId: 7, strategyName: '趋势突破多 Agent 研究策略', strategyDescription: '自动选股到复盘的研究策略', versionId: 11, versionNumber: 1, publishedAt: '2026-08-15T09:00:00Z', agentCount: 4, connectionCount: 3 }]);
    render(<MemoryRouter initialEntries={['/backtests']}><StrategyValidationPage /></MemoryRouter>);
    expect(screen.getByText('选择一个可验证的策略版本')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '验证中心' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /前往策略中心/ })).toHaveAttribute('href', '/strategies');
    expect(await screen.findByText('趋势突破多 Agent 研究策略 · 正式版本 V1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /重新研究/ })).toHaveAttribute('href', '/backtests?strategyId=7&versionId=11');
    expect(api.listRunnableVersions).toHaveBeenCalledTimes(1);
    expect(api.getStrategy).not.toHaveBeenCalled();
  });

  it('shows an honest empty state without fabricated performance metrics', async () => {
    render(<MemoryRouter initialEntries={['/backtests?strategyId=7&versionId=11']}><StrategyValidationPage /></MemoryRouter>);
    await screen.findByText('此版本尚未产生策略级历史验证记录。');
    expect(screen.getByLabelText('初始资金')).toBeEnabled();
    expect(screen.queryByText('累计收益')).not.toBeInTheDocument();
    expect(screen.queryByText(/夏普比率|期末权益/)).not.toBeInTheDocument();
    await waitFor(() => expect(api.getVersion).toHaveBeenCalledTimes(1));
  });

  it('shows the real strategy version and run times for every validation experiment', async () => {
    api.listValidationExperiments.mockResolvedValue([completedExperiment]);
    render(<MemoryRouter initialEntries={['/backtests?strategyId=7&versionId=11']}><StrategyValidationPage /></MemoryRouter>);
    expect(await screen.findByText(`${strategy.name} · V1`)).toBeInTheDocument();
    expect(screen.getByText(/提交 .*开始 .*完成/)).toBeInTheDocument();
  });

  it('creates and executes a real validation experiment from enabled configuration', async () => {
    api.getValidationStatus.mockResolvedValueOnce(validationStatus).mockResolvedValueOnce({ ...validationStatus, status: 'completed', latestExperimentId: 21, latestCompletedExperimentId: 21 });
    render(<MemoryRouter initialEntries={['/backtests?strategyId=7&versionId=11']}><StrategyValidationPage /></MemoryRouter>);
    await screen.findByText('此版本尚未产生策略级历史验证记录。');
    fireEvent.click(screen.getByRole('button', { name: '运行正式策略回放' }));
    await waitFor(() => expect(api.createValidationExperiment).toHaveBeenCalledWith(11, expect.objectContaining({ experimentPurpose: 'validation', universeMode: 'strategy', symbols: [], minimumCommission: 5, executionRule: 'next_open' })));
    expect(api.executeValidationExperiment).toHaveBeenCalledWith(21);
    expect(await screen.findByText('累计收益')).toBeInTheDocument();
    expect(screen.getAllByText('+8%')).toHaveLength(2);
    expect(screen.getByText('实验 #21 · 正式回放结果')).toBeInTheDocument();
  });

  it('locks formal validation to the StrategyVersion universe without requiring a stock code', async () => {
    render(<MemoryRouter initialEntries={['/backtests?strategyId=7&versionId=11']}><StrategyValidationPage /></MemoryRouter>);
    await screen.findByText('此版本尚未产生策略级历史验证记录。');
    expect(screen.getByText(/600519、000001/)).toBeInTheDocument();
    expect(screen.getByText('来自 StrategyVersion · 不可覆盖')).toBeInTheDocument();
    expect(screen.queryByLabelText('诊断股票代码')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '运行正式策略回放' }));
    await waitFor(() => expect(api.createValidationExperiment).toHaveBeenCalledWith(11, expect.objectContaining({ experimentPurpose: 'validation', universeMode: 'strategy', symbols: [] })));
  });

  it('blocks unsupported dynamic-universe replay before submission and offers truthful recovery paths', async () => {
    api.getVersion.mockResolvedValue({
      ...version,
      marketScope: { universeMode: 'screening', symbols: [] },
      screeningPolicy: { strategy: 'dual_low', market: 'cn', maxCandidates: 3 },
    });
    render(<MemoryRouter initialEntries={['/backtests?strategyId=7&versionId=11']}><StrategyValidationPage /></MemoryRouter>);
    expect(await screen.findByText('当前版本暂不能运行正式回放')).toBeInTheDocument();
    expect(screen.getByText(/不会用今天的股票名单代替历史数据/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '正式回放暂不可用' })).toBeDisabled();
    expect(screen.getByRole('link', { name: '前往策略中心配置固定股票池' })).toHaveAttribute(
      'href',
      '/strategies/7/editor?versionId=11',
    );
    expect(api.createValidationExperiment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '改做指定股票诊断' }));
    expect(screen.getByLabelText('诊断股票代码')).toBeInTheDocument();
  });

  it('keeps specified-stock diagnostics separate and requires explicit symbols', async () => {
    render(<MemoryRouter initialEntries={['/backtests?strategyId=7&versionId=11']}><StrategyValidationPage /></MemoryRouter>);
    await screen.findByText('此版本尚未产生策略级历史验证记录。');
    fireEvent.click(screen.getByRole('button', { name: '创建诊断实验' }));
    expect(screen.getByLabelText('诊断股票代码')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '运行股票诊断' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请为诊断实验填写至少一个临时股票代码');
    expect(api.createValidationExperiment).not.toHaveBeenCalled();
    expect(api.executeValidationExperiment).not.toHaveBeenCalled();
  });

  it('submits an explicit diagnostic purpose without changing the formal universe', async () => {
    const diagnosticExperiment = {
      ...completedExperiment,
      config: { ...completedExperiment.config, universeMode: 'override' as const, experimentPurpose: 'diagnostic' as const, symbols: ['600519'] },
      result: { ...completedExperiment.result, strategyReplay: { ...completedExperiment.result.strategyReplay, universeMode: 'experiment_override', experimentPurpose: 'diagnostic' as const } },
    };
    api.createValidationExperiment.mockResolvedValue({ ...diagnosticExperiment, status: 'queued', result: null });
    api.executeValidationExperiment.mockResolvedValue(diagnosticExperiment);
    render(<MemoryRouter initialEntries={['/backtests?strategyId=7&versionId=11']}><StrategyValidationPage /></MemoryRouter>);
    await screen.findByText('此版本尚未产生策略级历史验证记录。');
    fireEvent.click(screen.getByRole('button', { name: '创建诊断实验' }));
    fireEvent.change(screen.getByLabelText('诊断股票代码'), { target: { value: '600519' } });
    fireEvent.click(screen.getByRole('button', { name: '运行股票诊断' }));
    await waitFor(() => expect(api.createValidationExperiment).toHaveBeenCalledWith(11, expect.objectContaining({ experimentPurpose: 'diagnostic', universeMode: 'override', symbols: ['600519'] })));
    expect(await screen.findByText('这是指定股票诊断，不是正式策略验证。')).toBeInTheDocument();
    expect(screen.getByText('实验 #21 · 股票诊断结果')).toBeInTheDocument();
  });

  it('keeps legacy experiments for audit but hides their untrusted performance', async () => {
    const legacyExperiment = {
      ...completedExperiment,
      id: 2,
      engineVersion: 'strategy-validation-v1',
      integrityStatus: 'legacy_unverified' as const,
      barCount: 41,
      result: {
        ...completedExperiment.result,
        dataQuality: undefined,
        marketSnapshot: { ...completedExperiment.result.marketSnapshot, barCount: 41, firstDate: '2026-06-11', lastDate: '2026-08-07' },
      },
    };
    api.listValidationExperiments.mockResolvedValue([legacyExperiment]);
    render(<MemoryRouter initialEntries={['/backtests?strategyId=7&versionId=11']}><StrategyValidationPage /></MemoryRouter>);
    expect(await screen.findByText('实验 #2 是旧版未校验记录')).toBeInTheDocument();
    expect(screen.getByText('旧版未校验')).toBeInTheDocument();
    expect(screen.getByText(/页面不展示它过去计算的收益/)).toBeInTheDocument();
    expect(screen.queryByText('累计收益')).not.toBeInTheDocument();
    expect(screen.queryByText(/夏普比率|期末权益/)).not.toBeInTheDocument();
  });

  it('supports a draft as a pre-publication validation candidate', async () => {
    api.getVersion.mockResolvedValue({ ...version, status: 'DRAFT', immutable: false, publishedAt: null });
    render(<MemoryRouter initialEntries={['/backtests?strategyId=7&versionId=11']}><StrategyValidationPage /></MemoryRouter>);
    expect(await screen.findByText('趋势突破多 Agent 研究策略 · 发布候选草稿')).toBeInTheDocument();
    expect(screen.getByText('未开始')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回正式发布' })).toHaveAttribute('href', '/strategies/7/editor?versionId=11');
    expect(screen.queryByRole('link', { name: /在运行中心打开/ })).not.toBeInTheDocument();
  });
});
