import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { analysisApi } from '../../../api/analysis';
import { screeningApi } from '../../../api/screening';
import { StrategyTaskRunHistory } from '../StrategyTaskRunHistory';
import type { SelectedProductStrategy } from '../StrategyProductSelector';

vi.mock('../../../api/analysis', () => ({
  analysisApi: { getTasks: vi.fn() },
}));
vi.mock('../../../api/screening', () => ({
  screeningApi: { getHistory: vi.fn() },
}));

const selection = {
  summary: { id: 32, name: 'Daily 单股研究', lifecycleStatus: 'ACTIVE', revision: 1, updatedAt: '2026-08-18T08:00:00Z' },
  version: { id: 57, strategyId: 32, status: 'PUBLISHED', versionNumber: 3 },
} as SelectedProductStrategy;

describe('StrategyTaskRunHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(analysisApi.getTasks).mockResolvedValue({
      total: 3,
      pending: 0,
      processing: 0,
      tasks: [
        {
          taskId: 'research-match-123456', stockCode: '600519', stockName: '贵州茅台', status: 'completed', progress: 100,
          reportType: 'detailed', strategyVersionId: 57, createdAt: '2026-08-18T10:00:00Z', startedAt: '2026-08-18T10:00:01Z', completedAt: '2026-08-18T10:01:00Z',
        },
        {
          taskId: 'other-version', stockCode: '000001', stockName: '平安银行', status: 'completed', progress: 100,
          reportType: 'detailed', strategyVersionId: 99, createdAt: '2026-08-18T09:00:00Z',
        },
        {
          taskId: 'screening-task', stockCode: 'screening_screen', stockName: '双低选股 / cn', status: 'completed', progress: 100,
          reportType: 'screening_screen', strategyVersionId: 57, createdAt: '2026-08-18T08:00:00Z',
        },
      ],
    });
    vi.mocked(screeningApi.getHistory).mockResolvedValue({
      enabled: true,
      runCount: 1,
      runs: [{
        runId: 'persisted-screening-run', strategy: '双低选股', market: 'cn', candidateCount: 3,
        strategyVersionId: 57, submittedAt: '2026-08-18T08:00:00Z', startedAt: '2026-08-18T08:00:01Z', completedAt: '2026-08-18T08:01:00Z',
      }],
    });
  });

  it('shows only real single-stock runs bound to the selected strategy version', async () => {
    render(<StrategyTaskRunHistory selection={selection} kind="research_report" />);

    const history = await screen.findByRole('region', { name: '运行记录' });
    expect(within(history).getByText('Daily 单股研究 · 正式版本 V3')).toBeInTheDocument();
    expect(within(history).getByText('600519 · 贵州茅台')).toBeInTheDocument();
    expect(within(history).queryByText(/平安银行|双低选股/)).not.toBeInTheDocument();
    expect(analysisApi.getTasks).toHaveBeenCalledWith({ limit: 100, strategyVersionId: 57 });
    expect(within(history).getByText(/^提交$/).parentElement).toHaveTextContent('2026/08/18');
    expect(within(history).getByText(/^开始$/).parentElement).toHaveTextContent('2026/08/18');
    expect(within(history).getByText(/^完成$/).parentElement).toHaveTextContent('2026/08/18');
  });

  it('keeps candidate-screening records separate from research reports', async () => {
    render(<StrategyTaskRunHistory selection={selection} kind="candidate_screening" />);

    const history = await screen.findByRole('region', { name: '运行记录' });
    expect(within(history).getByText('双低选股 / cn')).toBeInTheDocument();
    expect(within(history).queryByText(/贵州茅台/)).not.toBeInTheDocument();
    expect(screeningApi.getHistory).toHaveBeenCalledWith({ limit: 100, strategyVersionId: 57 });
  });
});
