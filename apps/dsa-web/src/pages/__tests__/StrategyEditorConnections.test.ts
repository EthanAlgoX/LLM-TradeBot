import { describe, expect, it } from 'vitest';
import { findDuplicateConnection, inferConnectionType, isValidAgentConnection } from '../strategyEditorUtils';
import type { Agent, Connection } from '../../api/strategyWorkspace';

const agent = (id: string, agentType: Agent['agentType']): Agent => ({ id, lineageId: `${id}-lineage`, agentType, name: id, role: 'role', systemPrompt: '', promptTemplate: '', executionMode: agentType === 'INPUT' ? 'DETERMINISTIC' : 'LLM', modelProfileId: agentType === 'INPUT' ? null : 'default', toolPermissions: [], dataPermissions: [], inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, timeoutSeconds: 30, maxRetries: 1, required: true, failurePolicy: 'STOP_RUN', costLimit: '0.1', positionX: 0, positionY: 0 });

describe('Strategy editor connection rules', () => {
  const input = agent('input', 'INPUT'); const analysis = agent('analysis', 'ANALYSIS'); const decision = agent('decision', 'DECISION'); const reflection = agent('reflection', 'REFLECTION');
  it('infers persistent connection types from production agent types', () => {
    expect(inferConnectionType(input, analysis)).toBe('DATA_FLOW');
    expect(inferConnectionType(analysis, decision)).toBe('DATA_FLOW');
    expect(inferConnectionType(decision, reflection)).toBe('POST_RUN_CONTEXT');
  });
  it('rejects self links and prohibited reverse/reflection flows', () => {
    expect(isValidAgentConnection(input, input, 'DATA_FLOW')).toContain('自身');
    expect(isValidAgentConnection(reflection, analysis, 'DATA_FLOW')).toContain('反思');
    expect(isValidAgentConnection(decision, input, 'DATA_FLOW')).toContain('不能');
    expect(isValidAgentConnection(input, decision, 'DATA_FLOW')).toContain('不能');
  });
  it('detects an exact duplicate before the production save payload is created', () => {
    const connections: Connection[] = [{ id: 'edge-1', sourceAgentId: input.id, targetAgentId: analysis.id, connectionType: 'DATA_FLOW', fieldMapping: {} }];
    expect(findDuplicateConnection(connections, { sourceAgentId: input.id, targetAgentId: analysis.id, connectionType: 'DATA_FLOW' })).toBe(true);
    expect(findDuplicateConnection(connections, { sourceAgentId: analysis.id, targetAgentId: decision.id, connectionType: 'DATA_FLOW' })).toBe(false);
  });
  it.each([
    [input, analysis, 'DATA_FLOW', null], [analysis, analysis, 'DATA_FLOW', '自身'],
    [analysis, decision, 'DATA_FLOW', null], [decision, reflection, 'POST_RUN_CONTEXT', null],
    [reflection, input, 'DATA_FLOW', '反思'], [decision, input, 'DATA_FLOW', '不能'],
    [input, decision, 'DATA_FLOW', '不能'], [analysis, input, 'DATA_FLOW', '不能'],
  ] as const)('applies production connection policy for %s → %s', (source, target, type, expected) => {
    const result = isValidAgentConnection(source, target, type);
    if (expected) expect(result).toContain(expected);
    else expect(result).toBe('');
  });
  it('treats a different connection type as a distinct persisted edge', () => {
    const connections: Connection[] = [{ id: 'edge-1', sourceAgentId: input.id, targetAgentId: analysis.id, connectionType: 'DATA_FLOW', fieldMapping: {} }];
    expect(findDuplicateConnection(connections, { sourceAgentId: input.id, targetAgentId: analysis.id, connectionType: 'POST_RUN_CONTEXT' })).toBe(false);
  });
});
