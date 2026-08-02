/**
 * LOOP-026 page-memory state. This module never reads storage or invokes a
 * Runtime. Refreshing the Web shell deliberately restores these samples.
 */

export const strategyAppStatuses = [
  "Draft",
  "Needs Configuration",
  "Validated",
  "Experimenting",
  "Paper Eligible",
  "Paper Running",
  "Shadow Observed",
  "Archived",
] as const;

export type StrategyAppStatus = (typeof strategyAppStatuses)[number];
export type PreviewOrigin = "SAMPLE" | "PROTOTYPE";

export interface StrategyApp {
  id: string;
  name: string;
  version: string;
  market: string;
  status: StrategyAppStatus;
  origin: PreviewOrigin;
  proposalId?: string;
}

export interface StrategyAppPreviewState {
  apps: readonly StrategyApp[];
  selectedScenarioId: string;
  selectedProposalId: string;
  selectedAppId: string;
  createdCount: number;
  workbenchExchanges: readonly WorkbenchExchange[];
  nextWorkbenchExchange: number;
}

export interface WorkbenchExchange {
  id: number;
  scenarioId: string;
  proposalId: string;
  prompt?: string;
}

export interface SimulationStartIntent {
  accepted: boolean;
  reason: "CAPACITY_AVAILABLE" | "SIMULATION_CAPACITY_REACHED";
  runtimeCall: "none";
}

const initialApps: readonly StrategyApp[] = [
  {
    id: "sample-hk-quality",
    name: "HK Quality Trend",
    version: "v0.3",
    market: "Hong Kong equities",
    status: "Experimenting",
    origin: "SAMPLE",
  },
  {
    id: "sample-us-earnings",
    name: "US Earnings Event",
    version: "v0.2",
    market: "US equities",
    status: "Paper Running",
    origin: "SAMPLE",
  },
  {
    id: "sample-crypto-trend",
    name: "Crypto Trend Guard",
    version: "v0.4",
    market: "Crypto perpetuals",
    status: "Shadow Observed",
    origin: "SAMPLE",
  },
  {
    id: "sample-value-research",
    name: "Value Research Basket",
    version: "v0.1",
    market: "US equities",
    status: "Needs Configuration",
    origin: "SAMPLE",
  },
  {
    id: "sample-dividend-archive",
    name: "Dividend Quality",
    version: "v0.1",
    market: "Hong Kong equities",
    status: "Archived",
    origin: "SAMPLE",
  },
];

export function createInitialStrategyAppPreviewState(): StrategyAppPreviewState {
  return {
    apps: initialApps,
    selectedScenarioId: "hk-low-risk",
    selectedProposalId: "hk-quality-trend",
    selectedAppId: initialApps[0]!.id,
    createdCount: 0,
    workbenchExchanges: [{ id: 1, scenarioId: "hk-low-risk", proposalId: "hk-quality-trend" }],
    nextWorkbenchExchange: 2,
  };
}

export function selectPreviewScenario(
  state: StrategyAppPreviewState,
  scenarioId: string,
  proposalId: string,
): StrategyAppPreviewState {
  return { ...state, selectedScenarioId: scenarioId, selectedProposalId: proposalId };
}

export function appendWorkbenchExchange(
  state: StrategyAppPreviewState,
  exchange: Omit<WorkbenchExchange, "id">,
): StrategyAppPreviewState {
  return {
    ...state,
    selectedScenarioId: exchange.scenarioId,
    selectedProposalId: exchange.proposalId,
    workbenchExchanges: [
      ...state.workbenchExchanges,
      { ...exchange, id: state.nextWorkbenchExchange },
    ].slice(-4),
    nextWorkbenchExchange: state.nextWorkbenchExchange + 1,
  };
}

export function selectPreviewProposal(
  state: StrategyAppPreviewState,
  proposalId: string,
): StrategyAppPreviewState {
  return { ...state, selectedProposalId: proposalId };
}

export function selectPreviewApp(
  state: StrategyAppPreviewState,
  appId: string,
): StrategyAppPreviewState {
  return { ...state, selectedAppId: appId };
}

export function createPrototypeStrategyApp(
  state: StrategyAppPreviewState,
  proposal: Pick<StrategyApp, "name" | "market"> & { id: string },
): StrategyAppPreviewState {
  const createdCount = state.createdCount + 1;
  const app: StrategyApp = {
    id: `prototype-${proposal.id}-${createdCount}`,
    name: proposal.name,
    version: "v0.1-prototype",
    market: proposal.market,
    status: "Draft",
    origin: "PROTOTYPE",
    proposalId: proposal.id,
  };
  return {
    ...state,
    apps: [app, ...state.apps],
    selectedAppId: app.id,
    createdCount,
  };
}

export function activeSimulationCount(state: StrategyAppPreviewState): number {
  return state.apps.filter((app) => app.status === "Paper Running").length;
}

/** A UI guard only. It intentionally has no Runtime callback or side effect. */
export function requestSimulationStart(
  state: StrategyAppPreviewState,
  maximumSlots = 3,
): SimulationStartIntent {
  return activeSimulationCount(state) >= maximumSlots
    ? { accepted: false, reason: "SIMULATION_CAPACITY_REACHED", runtimeCall: "none" }
    : { accepted: true, reason: "CAPACITY_AVAILABLE", runtimeCall: "none" };
}

export function previewBoundaryLabel(origin: PreviewOrigin): string {
  return origin === "PROTOTYPE" ? "PROTOTYPE · PAGE MEMORY" : "SAMPLE · NOT CONNECTED";
}
