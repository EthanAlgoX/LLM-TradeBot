import apiClient from './index';

export type SimulationStrategyVersion = {
  id: number;
  version: number;
};

export type SimulationStrategy = {
  id: number;
  name: string;
  latest_version: SimulationStrategyVersion | null;
};

export type SimulationRun = {
  id: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  strategy_version_id: number;
  created_at: string;
  error_message?: string | null;
  result_snapshot?: { events?: Array<{ stage: string; status: string; message: string }> } | null;
};

export type SimulationTemplate = {
  id: string;
  name: string;
  description: string;
  screening_strategy_id: string;
  skill_ids: string[];
  orchestrator_mode: 'quick' | 'standard' | 'full' | 'specialist';
  recommended_sources: string[];
  risk_rules: Record<string, unknown>;
  position_rules: Record<string, unknown>;
  agent_prompts: Record<string, string>;
  source_files: string[];
};
export type SimulationAccount = { id: number; name: string; currency: string; initial_cash: number; cash_balance: number; status: string; created_at: string };
export type SimulationPaperOrder = { id: number; simulation_run_id: number; strategy_version_id: number; stock_code: string; side: string; quantity: number; status: string; reject_reason?: string | null; created_at: string };

export const simulationApi = {
  async createAccount(payload: { name: string; initial_cash: number; currency: string }): Promise<SimulationAccount> {
    const { data } = await apiClient.post<SimulationAccount>('/api/v1/simulation/accounts', payload);
    return data;
  },
  async listAccounts(): Promise<SimulationAccount[]> { const { data } = await apiClient.get<{ items: SimulationAccount[] }>('/api/v1/simulation/accounts'); return data.items; },
  async listAccountOrders(accountId: number): Promise<SimulationPaperOrder[]> { const { data } = await apiClient.get<{ items: SimulationPaperOrder[] }>(`/api/v1/simulation/accounts/${accountId}/orders`); return data.items; },
  async preparePaperExecution(accountId: number, runId: number): Promise<{ order_id: number; status: string; idempotent: boolean; reason?: string }> { const { data } = await apiClient.post('/api/v1/simulation/paper-executions', { account_id: accountId, run_id: runId }); return data; },
  async listTemplates(): Promise<SimulationTemplate[]> {
    const { data } = await apiClient.get<{ items: SimulationTemplate[] }>('/api/v1/simulation/templates');
    return data.items;
  },
  async listStrategies(): Promise<SimulationStrategy[]> {
    const { data } = await apiClient.get<{ items: SimulationStrategy[] }>('/api/v1/simulation/strategies');
    return data.items;
  },
  async createStrategy(payload: { name: string; description: string; config: Record<string, unknown>; version_label: string }): Promise<SimulationStrategy> {
    const { data } = await apiClient.post<SimulationStrategy>('/api/v1/simulation/strategies', payload);
    return data;
  },
  async createVersion(strategyId: number, payload: { label: string; config: Record<string, unknown> }): Promise<SimulationStrategyVersion> {
    const { data } = await apiClient.post<SimulationStrategyVersion>(`/api/v1/simulation/strategies/${strategyId}/versions`, payload);
    return data;
  },
  async updateStrategy(strategyId: number, payload: { name?: string; description?: string }): Promise<SimulationStrategy> {
    const { data } = await apiClient.patch<SimulationStrategy>(`/api/v1/simulation/strategies/${strategyId}`, payload);
    return data;
  },
  async createRun(payload: { strategy_version_id: number; execution_mode: 'preview'; input_snapshot: Record<string, unknown> }): Promise<SimulationRun> {
    const { data } = await apiClient.post<SimulationRun>('/api/v1/simulation/runs', payload);
    return data;
  },
  async listRuns(): Promise<SimulationRun[]> {
    const { data } = await apiClient.get<{ items: SimulationRun[] }>('/api/v1/simulation/runs', { params: { limit: 5 } });
    return data.items;
  },
  async executeRun(runId: number): Promise<SimulationRun> {
    const { data } = await apiClient.post<{ item: SimulationRun }>(`/api/v1/simulation/runs/${runId}/execute`);
    return data.item;
  },
};
