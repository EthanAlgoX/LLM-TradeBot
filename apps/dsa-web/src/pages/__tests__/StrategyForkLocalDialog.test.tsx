import { describe, expect, it } from 'vitest';
import { buildForkLocalRequest } from '../strategyEditorUtils';
import type { StrategyVersion } from '../../api/strategyWorkspace';

const localDraft: StrategyVersion = { id: 10, strategyId: 3, status: 'DRAFT', immutable: false, revision: 12, marketScope: {}, decisionPolicy: {}, riskPolicy: {}, memoryPolicy: {}, dataPermissionSnapshot: {}, agents: [{ id: 'old-agent', lineageId: 'old-lineage', agentType: 'ANALYSIS', name: '分析', role: 'role', systemPrompt: 'private prompt', promptTemplate: '', executionMode: 'LLM', toolPermissions: [], dataPermissions: [], inputSchema: {}, outputSchema: {}, timeoutSeconds: 30, maxRetries: 0, required: true, failurePolicy: 'STOP_RUN', costLimit: '0', positionX: 0, positionY: 0 }], connections: [{ id: 'old-edge', sourceAgentId: 'old-agent', targetAgentId: 'old-agent', connectionType: 'DATA_FLOW', fieldMapping: { score: 'score' } }], createdAt: '2026-01-01T00:00:00Z' };

describe('fork-local naming contract', () => {
  it('uses a clearly distinct default local-copy suffix', () => {
    expect(`${'新闻策略'}—本地副本`).toBe('新闻策略—本地副本');
  });
  it('uses the local revision and full draft in the production fork request', () => {
    const request = buildForkLocalRequest(localDraft, '新闻策略—本地副本', 'key-12345678');
    expect(request).toMatchObject({ baseRevision: 12, localDraft, idempotencyKey: 'key-12345678' });
  });
  it('trims a user-provided fork name without changing local content', () => {
    const request = buildForkLocalRequest(localDraft, '  新策略  ', 'key-12345678');
    expect(request.newStrategyName).toBe('新策略');
    expect(request.localDraft.agents[0].systemPrompt).toBe('private prompt');
  });
  it('does not send ownership or published-state fields in the request envelope', () => {
    const request = buildForkLocalRequest(localDraft, '副本', 'key-12345678');
    expect(request).not.toHaveProperty('ownerId');
    expect(request).not.toHaveProperty('published');
  });
  it('uses the fixed explanation rather than an untrusted client audit actor', () => {
    expect(buildForkLocalRequest(localDraft, '副本', 'key-12345678').newStrategyDescription).toContain('本地未保存版本');
  });
  it('retains agents, connections and mappings for transactional remapping on the server', () => {
    const request = buildForkLocalRequest(localDraft, '副本', 'key-12345678');
    expect(request.localDraft.agents).toHaveLength(1);
    expect(request.localDraft.connections[0].fieldMapping).toEqual({ score: 'score' });
  });
  it('changes only the envelope name across an idempotent retry payload', () => {
    const first = buildForkLocalRequest(localDraft, '副本', 'same-key-123');
    const repeat = buildForkLocalRequest(localDraft, '副本', 'same-key-123');
    expect(repeat).toEqual(first);
  });
});
