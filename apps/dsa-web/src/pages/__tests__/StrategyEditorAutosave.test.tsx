import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mergeSavedRevision } from '../strategyEditorUtils';
import type { StrategyVersion } from '../../api/strategyWorkspace';
import { StrategyConfigurationPanel, StrategyValidationSummary } from '../StrategyEditorPage';

const version = (revision: number, name = 'local'): StrategyVersion => ({ id: 1, strategyId: 1, status: 'DRAFT', immutable: false, revision, marketScope: {}, decisionPolicy: {}, riskPolicy: {}, memoryPolicy: {}, dataPermissionSnapshot: {}, agents: [], connections: [], createdAt: '2026-01-01T00:00:00Z', objective: name });

describe('strategy editor autosave queue', () => {
  it('keeps a later local edit while adopting the server revision for the follow-up save', () => {
    const queued = mergeSavedRevision(version(1, 'later local edit'), version(2, 'saved first edit'));
    expect(queued.revision).toBe(2);
    expect(queued.objective).toBe('later local edit');
  });

  it('updates the persisted risk-policy contract from the production configuration panel', () => {
    const onChange = vi.fn();
    render(<StrategyConfigurationPanel version={version(1)} disabled={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('决策有效期'), { target: { value: '1d' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ riskPolicy: { decision_validity: { max: '1d' } } }));
  });

  it('keeps policy inputs read-only for published versions', () => {
    render(<StrategyConfigurationPanel version={version(1)} disabled onChange={vi.fn()} />);
    expect(screen.getByLabelText('决策有效期')).toBeDisabled();
    expect(screen.getByLabelText('决策策略 JSON')).toHaveAttribute('readonly');
  });
  it('updates maximum asset weight without changing unrelated policy values', () => {
    const onChange = vi.fn();
    render(<StrategyConfigurationPanel version={{ ...version(1), riskPolicy: { decision_validity: { max: '1d' } } }} disabled={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('最大单资产权重'), { target: { value: '0.2' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ riskPolicy: { decision_validity: { max: '1d' }, max_asset_weight: 0.2 } }));
  });
  it('stores a fixed stock universe inside the strategy version', () => {
    const onChange = vi.fn();
    const { rerender } = render(<StrategyConfigurationPanel version={version(1)} disabled={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('股票池来源'), { target: { value: 'fixed' } });
    const fixedVersion = { ...version(1), marketScope: { universeMode: 'fixed', symbols: [] } };
    rerender(<StrategyConfigurationPanel version={fixedVersion} disabled={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('策略固定股票代码'), { target: { value: '600519, 000001' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ marketScope: { universeMode: 'fixed', symbols: ['600519', '000001'] } }));
  });
  it('rejects malformed policy JSON without emitting a partial change', () => {
    const onChange = vi.fn(); render(<StrategyConfigurationPanel version={version(1)} disabled={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('决策策略 JSON'), { target: { value: '{' } });
    expect(screen.getByText('请输入有效的 JSON 对象后再保存。')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows an explicit success state when strategy validation passes', () => {
    render(<StrategyValidationSummary validation={{
      valid: true, versionId: 1, revision: 1, validatedAt: '2026-08-16T10:00:00Z',
      errors: [], warnings: [],
    }} />);
    expect(screen.getByRole('status')).toHaveTextContent('策略检查已通过');
    expect(screen.getByRole('status')).toHaveTextContent('可以选择运行回测，也可以直接正式发布');
  });
});
