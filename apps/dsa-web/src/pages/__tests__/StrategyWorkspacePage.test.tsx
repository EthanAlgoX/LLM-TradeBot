import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StrategyWorkspacePage from '../StrategyWorkspacePage';
import { strategyWorkspaceApi } from '../../api/strategyWorkspace';

vi.mock('../../api/strategyWorkspace', () => ({
  strategyWorkspaceApi: { getStrategy: vi.fn(), diff: vi.fn(), getValidationStatus: vi.fn() },
}));

const api = vi.mocked(strategyWorkspaceApi);
const published = {
  id: 11, strategyId: 7, status: 'PUBLISHED', versionNumber: 1, immutable: true, revision: 2,
  strategyPurpose: 'research_report' as const, outputContract: 'ResearchReport' as const,
  objective: '汇集真实行情与研究证据，生成可追溯的单股研究报告。',
  marketScope: {}, decisionPolicy: {}, riskPolicy: {}, memoryPolicy: {}, dataPermissionSnapshot: {},
  agents: [], connections: [], createdAt: '2026-08-14T09:00:00Z', publishedAt: '2026-08-15T09:00:00Z',
};

describe('StrategyWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getStrategy.mockResolvedValue({
      id: 7, name: '趋势突破多 Agent 研究策略', lifecycleStatus: 'ACTIVE', revision: 2,
      currentPublishedVersionId: 11, currentPublishedVersionNumber: 1, updatedAt: '2026-08-15T09:00:00Z',
      currentStrategyPurpose: 'research_report', currentOutputContract: 'ResearchReport',
      versions: [published],
    });
    api.diff.mockResolvedValue({ summary: {}, changes: [] });
    api.getValidationStatus.mockResolvedValue({ strategyVersionId: 11, versionRevision: 2, status: 'not_started', latestExperimentId: null, latestCompletedExperimentId: null, validatedAt: null });
  });

  it('carries a published research strategy and version IDs to its product entry', async () => {
    render(<MemoryRouter initialEntries={['/strategies/7']}><Routes><Route path="/strategies/:strategyId" element={<StrategyWorkspacePage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('link', { name: '查看单股研究工具' })).toHaveAttribute('href', '/stock-research?strategyId=7&versionId=11');
    expect(screen.getByRole('heading', { name: '策略说明' })).toBeInTheDocument();
    expect(screen.getByText('汇集真实行情与研究证据，生成可追溯的单股研究报告。')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '重新回测研究' })).not.toBeInTheDocument();
  });

  it('does not promise a runnable formal replay for a dynamic-universe version', async () => {
    const tradingVersion = {
      ...published,
      strategyPurpose: 'trading_decision' as const,
      outputContract: 'DecisionProposal' as const,
      marketScope: { universeMode: 'screening', symbols: [] },
      screeningPolicy: { strategy: 'dual_low', market: 'cn', maxCandidates: 3 },
    };
    api.getStrategy.mockResolvedValue({
      id: 7, name: '动态研究决策', lifecycleStatus: 'published', revision: 2,
      currentPublishedVersionId: 11, currentPublishedVersionNumber: 1, updatedAt: '2026-08-15T09:00:00Z',
      currentStrategyPurpose: 'trading_decision', currentOutputContract: 'DecisionProposal',
      versions: [tradingVersion],
    });
    render(<MemoryRouter initialEntries={['/strategies/7']}><Routes><Route path="/strategies/:strategyId" element={<StrategyWorkspacePage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('link', { name: '打开验证中心' })).toHaveAttribute(
      'href',
      '/backtests?strategyId=7&versionId=11',
    );
    expect(screen.queryByRole('link', { name: '重新回测研究' })).not.toBeInTheDocument();
    expect(screen.getByText(/正式回放需先接入历史时点股票池/)).toBeInTheDocument();
  });

  it('keeps the direct replay action for a frozen fixed-stock universe', async () => {
    const tradingVersion = {
      ...published,
      strategyPurpose: 'trading_decision' as const,
      outputContract: 'DecisionProposal' as const,
      marketScope: { universeMode: 'fixed', symbols: ['600519'] },
    };
    api.getStrategy.mockResolvedValue({
      id: 7, name: '固定股票决策', lifecycleStatus: 'published', revision: 2,
      currentPublishedVersionId: 11, currentPublishedVersionNumber: 1, updatedAt: '2026-08-15T09:00:00Z',
      currentStrategyPurpose: 'trading_decision', currentOutputContract: 'DecisionProposal',
      versions: [tradingVersion],
    });
    render(<MemoryRouter initialEntries={['/strategies/7']}><Routes><Route path="/strategies/:strategyId" element={<StrategyWorkspacePage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('link', { name: '重新回测研究' })).toHaveAttribute(
      'href',
      '/backtests?strategyId=7&versionId=11',
    );
  });

  it('keeps strategy versions visible when validation status is temporarily unavailable', async () => {
    api.getValidationStatus.mockRejectedValueOnce(new Error('validation unavailable'));
    const tradingVersion = {
      ...published,
      strategyPurpose: 'trading_decision' as const,
      outputContract: 'DecisionProposal' as const,
      marketScope: { universeMode: 'fixed', symbols: ['600519'] },
    };
    api.getStrategy.mockResolvedValue({
      id: 7, name: '状态降级策略', lifecycleStatus: 'published', revision: 2,
      currentPublishedVersionId: 11, currentPublishedVersionNumber: 1, updatedAt: '2026-08-15T09:00:00Z',
      currentStrategyPurpose: 'trading_decision', currentOutputContract: 'DecisionProposal',
      versions: [tradingVersion],
    });
    render(<MemoryRouter initialEntries={['/strategies/7']}><Routes><Route path="/strategies/:strategyId" element={<StrategyWorkspacePage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('策略版本已读取，但部分验证状态暂时不可用；版本与配置入口仍可正常查看。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看策略配置' })).toBeInTheDocument();
    expect(screen.queryByText('无法读取策略版本。')).not.toBeInTheDocument();
  });
});
