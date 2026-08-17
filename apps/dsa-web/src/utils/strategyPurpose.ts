import type {
  Agent,
  AgentWorkflowVersion,
  Connection,
  StrategyOutputContract,
  StrategyPurpose,
} from "../api/strategyWorkspace";

export const STRATEGY_PURPOSES: Array<{
  id: StrategyPurpose;
  label: string;
  shortLabel: string;
  output: Exclude<StrategyOutputContract, "UnknownOutput">;
  description: string;
  destination: string;
}> = [
  {
    id: "research_report",
    label: "单股研究报告",
    shortLabel: "研究报告",
    output: "ResearchReport",
    description: "围绕一只股票汇总证据并形成可解释报告，不产生交易动作。",
    destination: "单股研究",
  },
  {
    id: "candidate_screening",
    label: "选股结果",
    shortLabel: "选股策略",
    output: "CandidateList",
    description: "从市场或指定范围中筛出候选并说明排序依据，不进入交易执行。",
    destination: "选股扫描",
  },
  {
    id: "trading_decision",
    label: "交易研究决策",
    shortLabel: "交易策略",
    output: "DecisionProposal",
    description: "形成可回测的研究决策提案；当前仍不会生成订单或自动交易。",
    destination: "验证中心 / 运行中心",
  },
];

export function purposeDefinition(purpose?: StrategyPurpose) {
  return (
    STRATEGY_PURPOSES.find((item) => item.id === purpose) ||
    STRATEGY_PURPOSES[2]
  );
}

export function inferWorkflowOutputContract(
  agents: Agent[] = [],
  connections: Connection[] = [],
): StrategyOutputContract {
  const outgoing = new Set(
    connections
      .filter((edge) => edge.connectionType === "DATA_FLOW")
      .map((edge) => edge.sourceAgentId),
  );
  const terminals = new Set(
    agents
      .filter(
        (agent) =>
          agent.agentType !== "REFLECTION" && !outgoing.has(agent.id),
      )
      .map((agent) => agent.agentType),
  );
  if (terminals.has("DECISION")) return "DecisionProposal";
  if (terminals.size === 1 && terminals.has("SCREENING")) return "CandidateList";
  if (terminals.size === 1 && terminals.has("ANALYSIS")) return "ResearchReport";
  return "UnknownOutput";
}

export function workflowOutputContract(
  workflow?: AgentWorkflowVersion,
): StrategyOutputContract {
  return (
    workflow?.outputContract ||
    inferWorkflowOutputContract(workflow?.agents, workflow?.connections)
  );
}

export function isWorkflowCompatible(
  workflow: AgentWorkflowVersion,
  purpose: StrategyPurpose,
) {
  const contract = workflowOutputContract(workflow);
  return contract === purposeDefinition(purpose).output;
}
