import { describe, expect, it } from 'vitest';
import { mappingObjectToRows, mergeSavedRevision } from '../strategyEditorUtils';
import type { StrategyVersion } from '../../api/strategyWorkspace';

const draft = (revision = 4, mapping: Record<string, unknown> = { 'output.symbol': 'input.symbol' }): StrategyVersion => ({
  id: 5, strategyId: 2, status: 'DRAFT', immutable: false, revision, objective: 'local change', marketScope: {}, decisionPolicy: {}, riskPolicy: {}, memoryPolicy: {}, dataPermissionSnapshot: {}, agents: [{ id: 'a', lineageId: 'lineage-a', agentType: 'ANALYSIS', name: 'analysis', role: 'role', systemPrompt: '', promptTemplate: '', executionMode: 'LLM', toolPermissions: [], dataPermissions: [], inputSchema: {}, outputSchema: {}, timeoutSeconds: 30, maxRetries: 0, required: true, failurePolicy: 'STOP_RUN', costLimit: '0', positionX: 0, positionY: 0 }], connections: [{ id: 'edge', sourceAgentId: 'a', targetAgentId: 'a', connectionType: 'DATA_FLOW', fieldMapping: mapping }], createdAt: '2026-01-01T00:00:00Z',
});

describe('revision-conflict local state preservation', () => {
  it('keeps a pending field mapping as serializable local draft data for diff-preview and fork-local', () => {
    expect(mappingObjectToRows({ 'output.symbol': 'input.symbol' })).toEqual([{ sourcePath: 'output.symbol', targetPath: 'input.symbol' }]);
  });
  it('keeps local agent content while a server revision is adopted for the queued save', () => {
    const merged = mergeSavedRevision(draft(4), draft(5));
    expect(merged.revision).toBe(5);
    expect(merged.agents[0].lineageId).toBe('lineage-a');
  });
  it('keeps local connection content available after conflict detection', () => {
    expect(draft().connections[0]).toMatchObject({ id: 'edge', fieldMapping: { 'output.symbol': 'input.symbol' } });
  });
  it('retains the client revision needed by the conflict dialog', () => {
    expect(draft(12).revision).toBe(12);
  });
  it('does not mutate a local draft while reading mapping rows for diff preview', () => {
    const local = draft();
    mappingObjectToRows(local.connections[0].fieldMapping);
    expect(local.connections[0].fieldMapping).toEqual({ 'output.symbol': 'input.symbol' });
  });
  it('preserves empty local mappings rather than inventing a server value', () => {
    expect(mappingObjectToRows(draft(4, {}).connections[0].fieldMapping)).toEqual([]);
  });
  it('does not provide a force-overwrite field in the serializable local draft', () => {
    expect(draft()).not.toHaveProperty('force');
  });
  it('retains a server update timestamp as a display-only conflict detail', () => {
    const detail = { serverRevision: 5, serverUpdatedAt: '2026-08-12T10:00:00Z' };
    expect(detail.serverUpdatedAt).toMatch(/T/);
    expect(detail.serverRevision).toBeGreaterThan(draft().revision);
  });
});
