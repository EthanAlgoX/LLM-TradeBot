import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { strategyWorkspaceApi } from '../../api/strategyWorkspace';
import StrategyEditorPage from '../StrategyEditorPage';

vi.mock('../../api/strategyWorkspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/strategyWorkspace')>();
  return {
    ...actual,
    strategyWorkspaceApi: {
      getVersion: vi.fn(),
      listAgentTemplates: vi.fn(),
      listPublishedAgentWorkflowVersions: vi.fn(),
      listDataSources: vi.fn(),
      getValidationStatus: vi.fn(),
      getStrategy: vi.fn(),
      getDeletionImpact: vi.fn(),
      deleteStrategy: vi.fn(),
    },
  };
});

const api = vi.mocked(strategyWorkspaceApi);
const draft = {
  id: 11, strategyId: 7, status: 'DRAFT', immutable: false, revision: 2,
  marketScope: {}, decisionPolicy: {}, riskPolicy: { decision_validity: { max: '1d' } },
  memoryPolicy: {}, dataPermissionSnapshot: {}, screeningPolicy: { strategy: 'dual_low', market: 'cn', maxCandidates: 3 },
  agents: [], connections: [], createdAt: '2026-08-16T09:00:00Z',
};

describe('StrategyEditorPage strategy deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getVersion.mockResolvedValue(draft);
    api.listAgentTemplates.mockResolvedValue([]);
    api.listPublishedAgentWorkflowVersions.mockResolvedValue([]);
    api.listDataSources.mockResolvedValue([]);
    api.getValidationStatus.mockResolvedValue({
      strategyVersionId: 11, versionRevision: 2, status: 'not_started',
      latestExperimentId: null, latestCompletedExperimentId: null, validatedAt: null,
    });
    api.getStrategy.mockResolvedValue({
      id: 7, name: '发布候选策略', lifecycleStatus: 'draft', revision: 1,
      activeDraftVersionId: 11, currentPublishedVersionId: null,
      updatedAt: '2026-08-16T09:00:00Z', versions: [draft],
    });
    api.deleteStrategy.mockResolvedValue({
      strategyId: 7, deleted: true, deletedAt: '2026-08-16T10:00:00Z', wasPublished: false,
      terminatedContinuousRuns: 0, cancelledResearchRuns: 0, historyRetained: true,
    });
  });

  it('deletes an unpublished draft from its detail page without confirmation', async () => {
    api.getDeletionImpact.mockResolvedValue({
      strategyId: 7, strategyName: '发布候选策略', hasPublishedVersion: false,
      publishedVersionCount: 0, isRunning: false, activeContinuousRunCount: 0,
      activeResearchRunCount: 0, requiresConfirmation: false,
    });
    render(<MemoryRouter initialEntries={['/strategies/7/editor?versionId=11']}><StrategyEditorPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '删除策略 发布候选策略' }));

    await waitFor(() => expect(api.getDeletionImpact).toHaveBeenCalledWith(7));
    await waitFor(() => expect(api.deleteStrategy).toHaveBeenCalledWith(7, false));
    expect(screen.queryByText('删除已发布策略？')).not.toBeInTheDocument();
  });

  it('requires confirmation when the opened strategy has a published version', async () => {
    api.getVersion.mockResolvedValue({ ...draft, status: 'PUBLISHED', immutable: true, versionNumber: 1 });
    api.getDeletionImpact.mockResolvedValue({
      strategyId: 7, strategyName: '发布候选策略', hasPublishedVersion: true,
      publishedVersionCount: 1, isRunning: false, activeContinuousRunCount: 0,
      activeResearchRunCount: 0, requiresConfirmation: true,
    });
    render(<MemoryRouter initialEntries={['/strategies/7/editor?versionId=11']}><StrategyEditorPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '删除策略 发布候选策略' }));

    expect(await screen.findByText('删除已发布策略？')).toBeInTheDocument();
    expect(screen.getByText(/历史版本、验证和审计记录仍会保留/)).toBeInTheDocument();
    expect(api.deleteStrategy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(api.deleteStrategy).toHaveBeenCalledWith(7, true));
  });

  it('warns that deleting the opened running strategy will terminate research', async () => {
    api.getVersion.mockResolvedValue({ ...draft, status: 'PUBLISHED', immutable: true, versionNumber: 1 });
    api.getDeletionImpact.mockResolvedValue({
      strategyId: 7, strategyName: '发布候选策略', hasPublishedVersion: true,
      publishedVersionCount: 1, isRunning: true, activeContinuousRunCount: 1,
      activeResearchRunCount: 2, requiresConfirmation: true,
    });
    render(<MemoryRouter initialEntries={['/strategies/7/editor?versionId=11']}><StrategyEditorPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '删除策略 发布候选策略' }));

    expect(await screen.findByText('删除正在运行的策略？')).toBeInTheDocument();
    expect(screen.getByText(/删除后将终止持续运行/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '终止运行并删除' })).toBeInTheDocument();
  });
});
