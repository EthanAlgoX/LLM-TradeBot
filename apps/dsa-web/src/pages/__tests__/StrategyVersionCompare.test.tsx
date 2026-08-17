import { describe, expect, it } from 'vitest';
import { versionCompareDefaults, versionCompareSearch } from '../strategyEditorUtils';
import type { StrategyVersion } from '../../api/strategyWorkspace';

const version = (id: number, status: string, versionNumber?: number, basedOnVersionId?: number): StrategyVersion => ({ id, strategyId: 1, status, versionNumber, basedOnVersionId, immutable: status !== 'DRAFT', revision: 1, marketScope: {}, decisionPolicy: {}, riskPolicy: {}, memoryPolicy: {}, dataPermissionSnapshot: {}, agents: [], connections: [], createdAt: '2026-01-01T00:00:00Z' });

describe('version comparison URL contract', () => {
  it('round-trips both comparison version ids through URL search parameters', () => {
    const params = new URLSearchParams({ fromVersion: '11', toVersion: '12' });
    expect(params.get('fromVersion')).toBe('11');
    expect(params.get('toVersion')).toBe('12');
  });
  it('defaults a draft comparison to its based-on version', () => {
    expect(versionCompareDefaults([version(3, 'PUBLISHED', 1), version(4, 'DRAFT', undefined, 3)])).toEqual({ from: 3, to: 4 });
  });
  it('defaults a published comparison to the previous published version', () => {
    expect(versionCompareDefaults([version(3, 'PUBLISHED', 1), version(4, 'PUBLISHED', 2)])).toEqual({ from: 3, to: 4 });
  });
  it('uses the only published version as both safe comparison endpoints', () => {
    expect(versionCompareDefaults([version(3, 'PUBLISHED', 1)])).toEqual({ from: 3, to: 3 });
  });
  it('honors an explicit valid from/to query selection', () => {
    expect(versionCompareDefaults([version(3, 'PUBLISHED', 1), version(4, 'DRAFT', undefined, 3)], 4, 3)).toEqual({ from: 4, to: 3 });
  });
  it('serializes a selector update into shareable URL query state', () => {
    expect(versionCompareSearch(3, 4)).toBe('fromVersion=3&toVersion=4');
  });
  it('exchanges both selectors without changing either version id', () => {
    const before = { from: 3, to: 4 };
    expect({ from: before.to, to: before.from }).toEqual({ from: 4, to: 3 });
  });
  it('returns no defaults when no accessible versions exist', () => {
    expect(versionCompareDefaults([])).toEqual({ from: undefined, to: undefined });
  });
  it('keeps a draft as the target even when published history is present', () => {
    const versions = [version(1, 'PUBLISHED', 1), version(2, 'PUBLISHED', 2), version(5, 'DRAFT', undefined, 2)];
    expect(versionCompareDefaults(versions)).toEqual({ from: 2, to: 5 });
  });
  it('keeps URL state numeric instead of leaking version display labels', () => {
    expect(versionCompareSearch(101, 202)).not.toContain('Draft');
  });
});
