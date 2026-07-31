export type SemanticPipelineExecutionViewState =
  | "loading"
  | "stale"
  | "semantic_ready"
  | "decision_context_ready"
  | "decision_context_unavailable"
  | "unavailable";

export function deriveSemanticPipelineExecutionViewState(input: {
  loading?: boolean;
  unavailable?: boolean;
  lifecycleStatus?: Exclude<SemanticPipelineExecutionViewState, "loading" | "unavailable">;
}): SemanticPipelineExecutionViewState {
  if (input.loading) return "loading";
  if (input.unavailable || !input.lifecycleStatus) return "unavailable";
  return input.lifecycleStatus;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

export function renderSemanticPipelineExecutionSummary(input: {
  locale: "zh-CN" | "en-US";
  lifecycleStatus: Exclude<SemanticPipelineExecutionViewState, "loading" | "unavailable">;
  observationCount: number;
  assessmentCount: number;
  issueCodes: readonly string[];
}): string {
  const zh = input.locale === "zh-CN";
  const title = zh ? "注册语义输入执行" : "Registered semantic input execution";
  const boundary = zh
    ? "只读语义产物，未应用到决策或运行时"
    : "Read-only semantic artifacts, not applied to Decision or Runtime";
  return `<section class="semantic-execution-summary" data-state="${input.lifecycleStatus}">
    <header><strong>${title}</strong><mark>${input.lifecycleStatus.toUpperCase()}</mark></header>
    <dl><div><dt>${zh ? "观察产物" : "Observations"}</dt><dd>${input.observationCount}</dd></div><div><dt>${zh ? "分析产物" : "Assessments"}</dt><dd>${input.assessmentCount}</dd></div></dl>
    ${input.issueCodes.map((code) => `<code>${escapeHtml(code)}</code>`).join("")}
    <p>${boundary} · decisionContextApplied=false · runtimeApplied=false</p>
  </section>`;
}
