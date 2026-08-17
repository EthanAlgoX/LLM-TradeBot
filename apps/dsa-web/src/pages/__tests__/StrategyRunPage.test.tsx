import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StrategyRunPage from '../StrategyRunPage';
import { strategyWorkspaceApi } from '../../api/strategyWorkspace';

vi.mock('../../api/strategyWorkspace', () => ({
  strategyWorkspaceApi: {
    listRunnableVersions: vi.fn(),
    listAutomaticRuns: vi.fn(),
    getPublishedRun: vi.fn(),
    createAutomaticRun: vi.fn(),
    listContinuousRuns: vi.fn(),
    startContinuousRun: vi.fn(),
    pauseContinuousRun: vi.fn(),
    terminateContinuousRun: vi.fn(),
  },
}));

const api = vi.mocked(strategyWorkspaceApi);
const version = {
  strategyId: 7,
  strategyName: '均值回归策略',
  strategyDescription: 'test',
  versionId: 11,
  versionNumber: 2,
  publishedAt: null,
  agentCount: 3,
  connectionCount: 2,
  validationStatus: 'not_started' as const,
  latestValidationExperimentId: null,
  validatedAt: null,
  strategyPurpose: 'trading_decision' as const,
  outputContract: 'DecisionProposal' as const,
  kernelRuntime: 'python',
  kernelEntrypoint: 'strategy:run',
  kernelExecutionStatus: 'ready',
  market: 'cn',
  timeHorizon: '1d',
};

const completedBatch = {
  id: 18,
  strategyId: 7,
  strategyName: '均值回归策略',
  strategyVersionId: 11,
  versionNumber: 2,
  status: 'completed' as const,
  screeningPolicy: { strategy: 'fixed', market: 'cn', maxCandidates: 3 },
  candidateCount: 1,
  candidates: [{
    runId: 44,
    code: '600519',
    name: '贵州茅台',
    screenScore: 91,
    status: 'completed' as const,
    // Old records can still contain compatibility events. They must not leak
    // into the black-box run-center interface.
    agentProgress: [
      { agentId: 'analysis', agentName: '新闻分析 Agent', agentType: 'ANALYSIS', status: 'completed' },
      { agentId: 'decision', agentName: '综合决策 Agent', agentType: 'DECISION', status: 'completed' },
    ],
  }],
  screening: {},
  createdAt: '2026-08-14T10:00:00Z',
  startedAt: '2026-08-14T10:00:01Z',
  completedAt: '2026-08-14T10:01:00Z',
  updatedAt: '2026-08-14T10:01:00Z',
  outputContract: 'DecisionProposal' as const,
  kernelRuntime: 'python',
};

function renderPage(entry = '/runs') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/runs" element={<StrategyRunPage />} />
        <Route path="/runs/:runId" element={<StrategyRunPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StrategyRunPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listRunnableVersions.mockResolvedValue([version]);
    api.listAutomaticRuns.mockResolvedValue([]);
    api.listContinuousRuns.mockResolvedValue([]);
  });

  it('starts a complete black-box strategy without asking for a stock or Agent setting', async () => {
    api.createAutomaticRun.mockResolvedValue({ ...completedBatch, status: 'queued', candidateCount: 0, candidates: [] });
    renderPage();

    expect(await screen.findByRole('heading', { name: '完整策略运行控制' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /均值回归策略/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('股票代码')).not.toBeInTheDocument();
    expect(screen.getByText(/纯规则策略可直接运行/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '运行一次' }));
    await waitFor(() => expect(api.createAutomaticRun).toHaveBeenCalledWith(11));
    expect(await screen.findByText('运行批次 #18')).toBeInTheDocument();
  });

  it('starts, pauses, and terminates continuous kernel execution', async () => {
    api.startContinuousRun.mockResolvedValue({ id: 23, strategyVersionId: 11, status: 'running', intervalSeconds: 900, lastBatchId: null, nextRunAt: '2026-08-14T10:15:00Z', lastStartedAt: '2026-08-14T10:00:01Z', lastCompletedAt: null, createdAt: '2026-08-14T10:00:00Z', updatedAt: '2026-08-14T10:00:00Z' });
    api.pauseContinuousRun.mockResolvedValue({ id: 23, strategyVersionId: 11, status: 'paused', intervalSeconds: 900, lastBatchId: null, createdAt: '2026-08-14T10:00:00Z', updatedAt: '2026-08-14T10:00:00Z' });
    api.terminateContinuousRun.mockResolvedValue({ id: 23, strategyVersionId: 11, status: 'terminated', intervalSeconds: 900, lastBatchId: null, createdAt: '2026-08-14T10:00:00Z', updatedAt: '2026-08-14T10:00:00Z' });
    renderPage();

    await screen.findByRole('heading', { name: '完整策略运行控制' });
    fireEvent.click(screen.getByRole('button', { name: '持续运行' }));
    await waitFor(() => expect(api.startContinuousRun).toHaveBeenCalledWith(11, 900));
    expect(await screen.findByRole('region', { name: '持续运行记录' })).toHaveTextContent('均值回归策略');
    expect(screen.getByText('创建时间')).toBeInTheDocument();
    expect(screen.getByText('最近开始')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '暂停运行' }));
    await waitFor(() => expect(api.pauseContinuousRun).toHaveBeenCalledWith(23));
    fireEvent.click(screen.getByRole('button', { name: '终止运行' }));
    await waitFor(() => expect(api.terminateContinuousRun).toHaveBeenCalledWith(23));
  });

  it('shows only strategy boundaries even when old records contain per-Agent progress', async () => {
    api.listAutomaticRuns.mockResolvedValue([completedBatch]);
    renderPage();

    expect(await screen.findByTestId('execution-boundary')).toBeInTheDocument();
    expect(screen.getByText('冻结运行配置')).toBeInTheDocument();
    expect(screen.getByText('调用策略内核')).toBeInTheDocument();
    expect(screen.getByText('校验并保存输出')).toBeInTheDocument();
    expect(screen.getByText('提交时间')).toBeInTheDocument();
    expect(screen.getByText('开始时间')).toBeInTheDocument();
    expect(screen.getByText('完成时间')).toBeInTheDocument();
    expect(screen.queryByText('新闻分析 Agent')).not.toBeInTheDocument();
    expect(screen.queryByText('综合决策 Agent')).not.toBeInTheDocument();
    expect(screen.queryByText(/Agent 执行轨迹/)).not.toBeInTheDocument();
  });

  it('extracts the terminal output from a compatibility record without exposing its internal graph', async () => {
    api.listAutomaticRuns.mockResolvedValue([completedBatch]);
    api.getPublishedRun.mockResolvedValue({
      id: 44,
      strategyId: 7,
      strategyName: '均值回归策略',
      strategyVersionId: 11,
      versionNumber: 2,
      status: 'completed',
      executionMode: 'preview',
      inputSnapshot: { stock_code: '600519' },
      resultSnapshot: { agentRuns: [{ agentId: 'decision', agentName: '综合决策 Agent', agentType: 'DECISION', status: 'completed', output: { content: '保持观察，等待风险条件确认。' } }] },
      createdAt: '2026-08-14T10:00:00Z',
      updatedAt: '2026-08-14T10:01:00Z',
      outputContract: 'DecisionProposal',
      kernelRuntime: 'python',
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '查看 600519 策略输出' }));
    expect(await screen.findByTestId('candidate-run-drawer')).toBeInTheDocument();
    expect(screen.getByText('保持观察，等待风险条件确认。')).toBeInTheDocument();
    expect(screen.queryByText('综合决策 Agent')).not.toBeInTheDocument();
    expect(screen.getByText(/内部规则、工具或模型步骤保持封装/)).toBeInTheDocument();
  });

  it('renders a direct uploaded-kernel result through its declared output contract', async () => {
    api.getPublishedRun.mockResolvedValue({
      id: 44,
      strategyId: 7,
      strategyName: '均值回归策略',
      strategyVersionId: 11,
      versionNumber: 2,
      status: 'completed',
      executionMode: 'preview',
      inputSnapshot: { stock_code: '600519' },
      resultSnapshot: { status: 'success', contract: 'DecisionProposal', action: 'hold', confidence: 0.68 },
      createdAt: '2026-08-14T10:00:00Z',
      updatedAt: '2026-08-14T10:01:00Z',
      outputContract: 'DecisionProposal',
      kernelRuntime: 'python',
    });
    renderPage('/runs/44');

    expect(await screen.findByRole('heading', { name: '策略标准输出' })).toBeInTheDocument();
    expect(screen.getByText(/"action": "hold"/)).toBeInTheDocument();
    expect(screen.queryByText(/Agent/)).not.toBeInTheDocument();
  });

  it('keeps validation separate from strategy execution', async () => {
    renderPage('/runs?strategyId=7&versionId=11');
    await screen.findByRole('heading', { name: '完整策略运行控制' });
    expect(screen.getByText('该版本尚无可信的策略级历史回放；研究运行不代表策略已经验证有效。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看验证' })).toHaveAttribute('href', '/backtests?strategyId=7&versionId=11');
  });

  it('keeps returned complete strategies visible when one run-history API fails', async () => {
    api.listAutomaticRuns.mockRejectedValueOnce(new Error('run history unavailable'));
    renderPage();

    expect(await screen.findByRole('option', { name: /均值回归策略/ })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('部分运行数据暂时无法读取');
  });
});
