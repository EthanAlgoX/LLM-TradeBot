import type { Agent, Connection, StrategyVersion } from '../api/strategyWorkspace';

export type SchemaField = {
  path: string;
  label: string;
  type: string;
  required: boolean;
  description?: string;
};

export type MappingRow = { sourcePath: string; targetPath: string };

export function flattenSchemaFields(
  schema: Record<string, unknown> | undefined,
  prefix = '',
  required: string[] = [],
  depth = 0,
): SchemaField[] {
  if (!schema || typeof schema !== 'object' || depth > 4) return [];
  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties as Record<string, Record<string, unknown>>
    : {};
  return Object.entries(properties).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const rawType = value.type;
    const type = Array.isArray(rawType) ? rawType.join('|') : String(rawType || (value.enum ? 'enum' : 'unknown'));
    const childRequired = Array.isArray(value.required) ? value.required.map(String) : [];
    return [{
      path,
      label: key,
      type,
      required: required.includes(key),
      description: typeof value.description === 'string' ? value.description : undefined,
    }, ...flattenSchemaFields(value, path, childRequired, depth + 1)];
  });
}

export function mappingObjectToRows(mapping: Record<string, unknown> | undefined): MappingRow[] {
  return Object.entries(mapping ?? {})
    .filter((pair): pair is [string, string] => typeof pair[0] === 'string' && typeof pair[1] === 'string')
    .map(([sourcePath, targetPath]) => ({ sourcePath, targetPath }));
}

export function mappingRowsToObject(rows: MappingRow[]): Record<string, string> {
  return Object.fromEntries(rows.filter(row => row.sourcePath && row.targetPath).map(row => [row.sourcePath, row.targetPath]));
}

export function checkFieldCompatibility(source?: SchemaField, target?: SchemaField): { label: string; state: 'ok' | 'warn' | 'error' | 'unknown' } {
  if (!source || !target) return { label: '待选择', state: 'unknown' };
  if (source.type.includes('null') && !target.type.includes('null')) return { label: '可能为空', state: 'warn' };
  if (source.type === target.type || (source.type === 'integer' && target.type === 'number') || (source.type === 'enum' && target.type === 'string')) return { label: '兼容', state: 'ok' };
  if (source.type === 'unknown' || target.type === 'unknown') return { label: '无法确定', state: 'unknown' };
  return { label: '类型不兼容', state: 'error' };
}

export function inferConnectionType(_source: Agent, target: Agent): Connection['connectionType'] {
  return target.agentType === 'REFLECTION' ? 'POST_RUN_CONTEXT' : 'DATA_FLOW';
}

export function isValidAgentConnection(source: Agent, target: Agent, type: Connection['connectionType']): string {
  if (source.id === target.id) return '不能连接到自身。';
  if (source.agentType === 'REFLECTION' && type === 'DATA_FLOW') return '反思 Agent 只能使用运行后上下文。';
  if (target.agentType === 'INPUT' || (source.agentType === 'DECISION' && target.agentType === 'ANALYSIS')) return '这两个 Agent 类型不能按当前方向连接。';
  if (source.agentType === 'INPUT' && target.agentType === 'DECISION') return '输入 Agent 不能直接连接决策 Agent。';
  return '';
}

export function findDuplicateConnection(connections: Connection[], candidate: Pick<Connection, 'sourceAgentId' | 'targetAgentId' | 'connectionType'>): boolean {
  return connections.some(connection => connection.sourceAgentId === candidate.sourceAgentId
    && connection.targetAgentId === candidate.targetAgentId
    && connection.connectionType === candidate.connectionType);
}

export function mergeSavedRevision(localDraft: StrategyVersion, savedDraft: StrategyVersion): StrategyVersion {
  return { ...localDraft, revision: savedDraft.revision };
}

/** Build the only client payload accepted by the conflict-local fork endpoint. */
export function buildForkLocalRequest(
  localDraft: StrategyVersion,
  newStrategyName: string,
  idempotencyKey: string,
): { baseRevision: number; newStrategyName: string; newStrategyDescription: string; localDraft: StrategyVersion; idempotencyKey: string } {
  return {
    baseRevision: localDraft.revision,
    newStrategyName: newStrategyName.trim(),
    newStrategyDescription: '由 revision 冲突中的本地未保存版本创建。',
    localDraft,
    idempotencyKey,
  };
}

export function versionCompareDefaults(
  versions: StrategyVersion[],
  fromVersion?: number | null,
  toVersion?: number | null,
): { from?: number; to?: number } {
  const draft = versions.find(version => version.status === 'DRAFT');
  const published = versions
    .filter(version => version.status === 'PUBLISHED')
    .sort((left, right) => (left.versionNumber || 0) - (right.versionNumber || 0));
  return {
    from: fromVersion || draft?.basedOnVersionId || published.at(-2)?.id || published.at(-1)?.id,
    to: toVersion || draft?.id || published.at(-1)?.id,
  };
}

export function versionCompareSearch(from: number, to: number): string {
  return new URLSearchParams({ fromVersion: String(from), toVersion: String(to) }).toString();
}
