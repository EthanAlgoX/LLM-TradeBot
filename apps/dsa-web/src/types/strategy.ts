export type AgentType = 'input' | 'analysis' | 'decision' | 'reflection';

export type StrategyLifecycleStatus =
  | 'draft'
  | 'needs_testing'
  | 'historical_validation'
  | 'historical_validation_passed'
  | 'historical_validation_failed'
  | 'simulation_observing'
  | 'human_reference_ready'
  | 'validation_expired'
  | 'paused'
  | 'invalid'
  | 'archived';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'risk_terminated' | 'data_terminated' | 'cancelled';
export type StrategyEnvironment = 'historical_backtest' | 'paper_simulation' | 'human_reference';
export type DecisionAction = 'BUY' | 'SELL' | 'HOLD' | 'REDUCE' | 'WATCH';

export interface AgentTemplate {
  id: string;
  name: string;
  type: AgentType;
  description: string;
  templateVersion: string;
  supportedDataTypes: string[];
  supportedTools: string[];
  inputSchema: string;
  outputSchema: string;
}

export interface AgentInstance {
  id: string;
  strategyVersionId: string;
  templateId: string;
  templateVersion: string;
  type: AgentType;
  name: string;
  role: string;
  systemPrompt: string;
  modelProfile: string;
  fallbackModel?: string;
  dataPermissions: string[];
  required: boolean;
  failurePolicy: 'stop' | 'degrade' | 'skip';
  timeoutSeconds: number;
  retries: number;
  costLimit: number;
}

export interface AgentConnection {
  id: string;
  sourceAgentId: string;
  targetAgentId: string;
  condition?: string;
  mapping: string;
}

export interface StrategyVersion {
  id: string;
  strategyId: string;
  versionNumber: string;
  status: 'draft' | 'published';
  objective: string;
  marketScope: string;
  timeHorizon: string;
  agentInstances: AgentInstance[];
  agentConnections: AgentConnection[];
  decisionPolicy: 'fixed_weight' | 'confidence_weighted' | 'final_agent_synthesis';
  riskPolicy: string;
  experienceSetVersion: string;
  createdAt: string;
  publishedAt?: string;
  immutable: boolean;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  lifecycleStatus: StrategyLifecycleStatus;
  currentPublishedVersionId?: string;
  latestRunStatus?: RunStatus;
  lastValidatedAt?: string;
  lastRunAt?: string;
  dataHealth: 'healthy' | 'degraded' | 'not_connected';
  riskStatus: 'normal' | 'attention' | 'blocked';
  agentCount: number;
  source: 'official_template' | 'personal';
  createdAt: string;
  updatedAt: string;
}

export interface Evidence {
  id: string;
  sourceType: string;
  eventTime?: string;
  publishedAt?: string;
  receivedAt?: string;
  readAt?: string;
  contentSummary: string;
  qualityStatus: 'healthy' | 'delayed' | 'missing' | 'not_connected';
  impactStatus: 'available' | 'passed_to_agent' | 'cited' | 'used_in_decision' | 'measured';
}

export interface DecisionProposal {
  id: string;
  runId: string;
  action: DecisionAction;
  targetWeight: number;
  confidence: number;
  validUntil: string;
  summary: string;
  analysisIds: string[];
  memoryIds: string[];
  riskFlags: string[];
  invalidationConditions: string[];
  status: 'pending_review' | 'approved' | 'rejected' | 'expired';
}

export interface StrategyRun {
  id: string;
  strategyVersionId: string;
  environment: StrategyEnvironment;
  status: RunStatus;
  startedAt?: string;
  endedAt?: string;
  dataSnapshotId?: string;
  experienceSetVersion: string;
  totalCost?: number;
  errorSummary?: string;
  finalDecisionProposalId?: string;
}

export interface CandidateExperience {
  id: string;
  strategyId: string;
  sourceRunId: string;
  observation: string;
  hypothesis: string;
  candidateLesson: string;
  confidence: number;
  status: 'candidate' | 'validating' | 'validated' | 'rejected' | 'expired';
}
