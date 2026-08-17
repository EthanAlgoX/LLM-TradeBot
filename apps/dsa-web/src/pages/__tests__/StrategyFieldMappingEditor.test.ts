import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { checkFieldCompatibility, flattenSchemaFields, mappingObjectToRows, mappingRowsToObject } from '../strategyEditorUtils';
import { FieldMappingEditor } from '../StrategyEditorPage';
import type { Agent } from '../../api/strategyWorkspace';

const agent = (id: string, inputSchema: Record<string, unknown>, outputSchema: Record<string, unknown>): Agent => ({ id, lineageId: id, agentType: 'ANALYSIS', name: id, role: 'role', systemPrompt: '', promptTemplate: '', executionMode: 'LLM', modelProfileId: 'default', toolPermissions: [], dataPermissions: [], inputSchema, outputSchema, timeoutSeconds: 30, maxRetries: 0, required: true, failurePolicy: 'STOP_RUN', costLimit: '0.1', positionX: 0, positionY: 0 });
const source = agent('source', {}, { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string', description: '代码' }, score: { type: 'number' } } });
const target = agent('target', { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string' }, score: { type: 'number' } } }, {});
const MappingHarness = ({ onChange }: { onChange: (mapping: Record<string, unknown>) => void }) => {
  const [mapping, setMapping] = useState<Record<string, unknown>>({});
  return createElement(FieldMappingEditor, { source, target, mapping, disabled: false, onChange: value => { setMapping(value); onChange(value); } });
};

describe('Strategy field mapping production helpers', () => {
  const schema = { type: 'object', required: ['summary'], properties: { summary: { type: 'string', description: 'Summary' }, metrics: { type: 'object', required: ['score'], properties: { score: { type: 'integer' } } }, tags: { type: 'array', items: { type: 'string' } } } };
  it('flattens top-level and nested schema fields with required metadata', () => {
    expect(flattenSchemaFields(schema, '', ['summary'])).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'summary', required: true, description: 'Summary' }),
      expect.objectContaining({ path: 'metrics.score', type: 'integer', required: true }),
      expect.objectContaining({ path: 'tags', type: 'array' }),
    ]));
  });
  it('round-trips the persisted source-to-target mapping contract', () => {
    const mapping = { 'metrics.score': 'score', summary: 'summary' };
    expect(mappingRowsToObject(mappingObjectToRows(mapping))).toEqual(mapping);
  });
  it('reports compatible, incompatible, nullable and unknown choices explicitly', () => {
    expect(checkFieldCompatibility({ path: 'a', label: 'a', type: 'integer', required: false }, { path: 'b', label: 'b', type: 'number', required: false }).state).toBe('ok');
    expect(checkFieldCompatibility({ path: 'a', label: 'a', type: 'string', required: false }, { path: 'b', label: 'b', type: 'number', required: false }).state).toBe('error');
    expect(checkFieldCompatibility({ path: 'a', label: 'a', type: 'string|null', required: false }, { path: 'b', label: 'b', type: 'string', required: true }).state).toBe('warn');
    expect(checkFieldCompatibility({ path: 'a', label: 'a', type: 'unknown', required: false }, { path: 'b', label: 'b', type: 'object', required: false }).state).toBe('unknown');
  });

  it('uses production schema selectors to persist a source-to-target mapping', () => {
    const onChange = vi.fn();
    render(createElement(MappingHarness, { onChange }));
    fireEvent.click(screen.getByRole('button', { name: '添加字段映射' }));
    fireEvent.change(screen.getByLabelText('上游字段 1'), { target: { value: 'symbol' } });
    fireEvent.change(screen.getByLabelText('下游字段 1'), { target: { value: 'symbol' } });
    expect(onChange).toHaveBeenLastCalledWith({ symbol: 'symbol' });
  });

  it('offers schema-aware automatic matching through the production component', () => {
    const onChange = vi.fn();
    render(createElement(FieldMappingEditor, { source, target, mapping: {}, disabled: false, onChange }));
    fireEvent.click(screen.getByRole('button', { name: '自动匹配同名字段' }));
    expect(onChange).toHaveBeenCalledWith({ symbol: 'symbol', score: 'score' });
  });

  it('disables selectors and editing controls for a published version', () => {
    render(createElement(FieldMappingEditor, { source, target, mapping: { symbol: 'symbol' }, disabled: true, onChange: vi.fn() }));
    expect(screen.getByLabelText('上游字段 1')).toBeDisabled();
    expect(screen.queryByRole('button', { name: '添加字段映射' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('删除字段映射 1')).not.toBeInTheDocument();
  });
  it.each([
    ['string', 'string', 'ok'], ['integer', 'integer', 'ok'], ['integer', 'number', 'ok'],
    ['number', 'number', 'ok'], ['boolean', 'boolean', 'ok'], ['string', 'number', 'error'],
    ['object', 'string', 'error'], ['array', 'string', 'error'], ['unknown', 'string', 'unknown'],
  ])('classifies %s to %s mapping as %s', (sourceType, targetType, state) => {
    expect(checkFieldCompatibility({ path: 'source', label: 'source', type: sourceType, required: false }, { path: 'target', label: 'target', type: targetType, required: false }).state).toBe(state);
  });
  it('keeps a pending mapping row editable until both paths are selected', () => {
    render(createElement(MappingHarness, { onChange: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '添加字段映射' }));
    expect(screen.getByTestId('field-mapping-row-0')).toBeInTheDocument();
    expect(screen.getByLabelText('上游字段 1')).toHaveValue('');
  });
  it('removes a selected mapping through the production delete control', () => {
    const onChange = vi.fn();
    render(createElement(FieldMappingEditor, { source, target, mapping: { symbol: 'symbol' }, disabled: false, onChange }));
    fireEvent.click(screen.getByLabelText('删除字段映射 1'));
    expect(onChange).toHaveBeenLastCalledWith({});
  });
});
