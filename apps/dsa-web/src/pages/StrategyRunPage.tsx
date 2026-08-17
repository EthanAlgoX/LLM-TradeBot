import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  Code2,
  Database,
  FileOutput,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  StopCircle,
  XCircle,
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AppPage, Card, Drawer, PageHeader } from "../components/common";
import { StrategyLifecycleNav } from "../components/strategy/StrategyLifecycleNav";
import {
  strategyWorkspaceApi,
  type AutomaticStrategyRunBatch,
  type ContinuousStrategyRunControl,
  type PublishedStrategyRun,
  type RunnableStrategyVersion,
} from "../api/strategyWorkspace";

const formatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const statusLabel: Record<PublishedStrategyRun["status"], string> = {
  queued: "等待执行",
  running: "执行中",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};

const statusTone: Record<PublishedStrategyRun["status"], string> = {
  queued: "text-secondary-text",
  running: "text-primary",
  completed: "text-success",
  failed: "text-danger",
  cancelled: "text-muted-text",
};

const batchStatusLabel: Record<AutomaticStrategyRunBatch["status"], string> = {
  queued: "等待准备输入",
  running: "正在执行策略",
  completed: "策略运行完成",
  completed_with_failures: "部分标的执行失败",
  failed: "运行失败",
  cancelled: "已取消",
};

const continuousStatus: Record<ContinuousStrategyRunControl["status"], string> = {
  running: "持续运行中",
  paused: "已暂停",
  terminated: "已终止",
};

type Candidate = AutomaticStrategyRunBatch["candidates"][number];
type BoundaryStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type StrategyOutput = string | Record<string, unknown> | unknown[];

const scoreFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

function formatScore(value?: number | null) {
  return typeof value === "number" ? scoreFormatter.format(value) : "—";
}

function formatRunTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatter.format(date);
}

function normalizeBoundaryStatus(status: string): BoundaryStatus {
  if (status === "running" || status === "completed" || status === "failed" || status === "cancelled") return status;
  return "queued";
}

function ProgressIcon({ status, className = "h-4 w-4" }: { status: string; className?: string }) {
  if (status === "completed") return <CheckCircle2 className={`${className} text-success`} aria-hidden="true" />;
  if (status === "failed") return <XCircle className={`${className} text-danger`} aria-hidden="true" />;
  if (status === "running") return <CircleDot className={`${className} text-primary`} aria-hidden="true" />;
  return <Clock3 className={`${className} text-secondary-text`} aria-hidden="true" />;
}

function outputFromValue(value: unknown): StrategyOutput | null {
  if (typeof value === "string" && value.trim()) return value;
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  for (const key of ["content", "message", "summary", "decision", "report"]) {
    if (typeof record[key] === "string" && String(record[key]).trim()) return String(record[key]);
  }
  return record;
}

function extractStrategyOutput(snapshot?: Record<string, unknown> | null): StrategyOutput | null {
  if (!snapshot) return null;
  const direct = outputFromValue(snapshot.finalOutput ?? snapshot.output ?? snapshot.result);
  if (direct) return direct;

  // Older published versions may still persist compatibility executor events.
  // Only the terminal output crosses the product boundary; internal nodes do not.
  const compatibilityEvents = Array.isArray(snapshot.agentRuns) ? snapshot.agentRuns : [];
  for (const rawEvent of [...compatibilityEvents].reverse()) {
    if (!rawEvent || typeof rawEvent !== "object") continue;
    const event = rawEvent as Record<string, unknown>;
    const result = outputFromValue(event.output);
    if (result) return result;
  }

  if (typeof snapshot.contract === "string" || typeof snapshot.status === "string") {
    return snapshot;
  }
  return null;
}

function StrategyOutputView({ output }: { output: StrategyOutput | null }) {
  if (!output) {
    return (
      <div className="rounded-[10px] border border-dashed border-border px-4 py-7 text-sm leading-6 text-secondary-text">
        策略尚未返回标准化输出。运行完成后，这里只展示该策略公开的输出契约，不展示内核内部实现。
      </div>
    );
  }
  if (typeof output === "string") {
    return <p className="whitespace-pre-wrap break-words rounded-[10px] border border-border/70 bg-base/35 p-4 text-sm leading-6 text-secondary-text">{output}</p>;
  }
  return (
    <pre className="max-h-[30rem] overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-border/70 bg-base/35 p-4 text-xs leading-6 text-secondary-text">
      {JSON.stringify(output, null, 2)}
    </pre>
  );
}

function batchBoundaryPhases(batch: AutomaticStrategyRunBatch) {
  const hasCandidates = batch.candidates.length > 0;
  const activeCandidates = batch.candidates.some((candidate) => candidate.status === "queued" || candidate.status === "running");
  const completedCandidates = batch.candidates.filter((candidate) => candidate.status === "completed").length;
  const failedCandidates = batch.candidates.filter((candidate) => candidate.status === "failed" || candidate.status === "cancelled").length;
  const batchTerminal = batch.status === "completed" || batch.status === "completed_with_failures";

  return [
    { name: "冻结运行配置", detail: `StrategyVersion #${batch.strategyVersionId}`, status: "completed" as BoundaryStatus },
    {
      name: "准备策略输入",
      detail: hasCandidates ? `${batch.candidateCount} 个标的已冻结` : "等待数据与股票范围解析",
      status: normalizeBoundaryStatus(batch.status === "queued" ? "queued" : hasCandidates ? "completed" : batch.status),
    },
    {
      name: "调用策略内核",
      detail: hasCandidates ? `${completedCandidates} 完成 · ${failedCandidates} 失败` : "等待输入",
      status: batch.status === "failed" ? "failed" as const : activeCandidates ? "running" as const : batchTerminal ? "completed" as const : "queued" as const,
    },
    {
      name: "校验并保存输出",
      detail: batch.outputContract ?? "DecisionProposal",
      status: batch.status === "failed" ? "failed" as const : batchTerminal ? "completed" as const : completedCandidates > 0 ? "running" as const : "queued" as const,
    },
  ];
}

function runBoundaryPhases(run: PublishedStrategyRun) {
  const output = extractStrategyOutput(run.resultSnapshot);
  return [
    { name: "冻结运行配置", detail: `StrategyVersion #${run.strategyVersionId}`, status: "completed" as BoundaryStatus },
    { name: "准备策略输入", detail: "输入快照已保存", status: "completed" as BoundaryStatus },
    { name: "调用策略内核", detail: run.kernelRuntime ?? "兼容执行器", status: normalizeBoundaryStatus(run.status) },
    {
      name: "校验并保存输出",
      detail: run.outputContract ?? "DecisionProposal",
      status: run.status === "failed" ? "failed" as const : output ? "completed" as const : run.status === "running" ? "running" as const : "queued" as const,
    },
  ];
}

function ExecutionBoundary({ phases, label }: { phases: ReturnType<typeof batchBoundaryPhases>; label: string }) {
  return (
    <ol className="grid overflow-hidden rounded-[10px] border border-border/70 bg-border/70 md:grid-cols-4" aria-label={label} data-testid="execution-boundary">
      {phases.map((phase) => (
        <li key={phase.name} className="bg-card px-4 py-4">
          <div className="flex items-center gap-2">
            <ProgressIcon status={phase.status} />
            <p className="text-sm font-medium text-foreground">{phase.name}</p>
          </div>
          <p className="mt-2 text-xs leading-5 text-secondary-text">{phase.detail}</p>
        </li>
      ))}
    </ol>
  );
}

function CandidateRunDrawer({
  batch,
  candidate,
  run,
  loading,
  error,
  onClose,
}: {
  batch: AutomaticStrategyRunBatch | null;
  candidate: Candidate | null;
  run: PublishedStrategyRun | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  const output = extractStrategyOutput(run?.resultSnapshot);
  return (
    <Drawer
      isOpen={Boolean(candidate)}
      onClose={onClose}
      title={candidate ? `${candidate.code}${candidate.name ? ` · ${candidate.name}` : ""}` : "策略运行结果"}
      width="max-w-3xl"
      zIndex={80}
    >
      {candidate ? (
        <div className="space-y-7" data-testid="candidate-run-drawer">
          <section aria-labelledby="candidate-run-context">
            <h3 id="candidate-run-context" className="text-base font-semibold text-foreground">运行边界</h3>
            <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-border/70 bg-border/70 sm:grid-cols-4">
              <div className="bg-card p-3"><dt className="text-xs text-muted-text">完整策略</dt><dd className="mt-1 text-sm font-medium text-foreground">{batch?.strategyName ?? "—"}</dd></div>
              <div className="bg-card p-3"><dt className="text-xs text-muted-text">正式版本</dt><dd className="mt-1 text-sm font-medium text-foreground">V{batch?.versionNumber ?? "—"}</dd></div>
              <div className="bg-card p-3"><dt className="text-xs text-muted-text">内核状态</dt><dd className={`mt-1 text-sm font-medium ${statusTone[candidate.status]}`}>{statusLabel[candidate.status]}</dd></div>
              <div className="bg-card p-3"><dt className="text-xs text-muted-text">输出契约</dt><dd className="mt-1 text-sm font-medium text-foreground">{batch?.outputContract ?? "DecisionProposal"}</dd></div>
            </dl>
          </section>

          <section aria-labelledby="candidate-input-heading">
            <h3 id="candidate-input-heading" className="text-base font-semibold text-foreground">本次冻结输入</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[10px] border border-border/70 px-4 py-3"><p className="text-xs text-muted-text">标的</p><p className="mt-1 text-sm font-medium text-foreground">{candidate.code}{candidate.name ? ` · ${candidate.name}` : ""}</p></div>
              <div className="rounded-[10px] border border-border/70 px-4 py-3"><p className="text-xs text-muted-text">筛选分数</p><p className="mt-1 text-sm font-medium text-foreground">{formatScore(candidate.screenScore)}</p></div>
            </div>
            <p className="mt-3 text-xs leading-5 text-secondary-text">当前接口尚未保存逐条入选和排除证据，因此这里只展示真实返回的标的与分数，不推测筛选原因。</p>
          </section>

          <section aria-labelledby="candidate-output-heading">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h3 id="candidate-output-heading" className="text-base font-semibold text-foreground">策略标准输出</h3><p className="mt-1 text-sm text-secondary-text">只读取完整策略公开结果，内部规则、工具或模型步骤保持封装。</p></div>
              {loading ? <span className="text-xs text-primary">正在读取结果…</span> : null}
            </div>
            {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
            <div className="mt-4"><StrategyOutputView output={output} /></div>
          </section>

          <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
            <Link className="btn-primary inline-flex items-center gap-2" to={`/runs/${candidate.runId}`}>查看完整运行记录 <ArrowRight className="h-4 w-4" /></Link>
            <Link className="btn-secondary inline-flex items-center gap-2" to="/stock-research" state={{ stockCode: candidate.code, stockName: candidate.name }}>在单股研究中打开 <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

function BatchWorkspace({
  batches,
  selectedBatchId,
  onSelectBatch,
  onOpenCandidate,
}: {
  batches: AutomaticStrategyRunBatch[];
  selectedBatchId: number | null;
  onSelectBatch: (batchId: number) => void;
  onOpenCandidate: (batch: AutomaticStrategyRunBatch, candidate: Candidate) => void;
}) {
  const selectedBatch = batches.find((batch) => batch.id === selectedBatchId) ?? batches[0] ?? null;
  return (
    <section aria-labelledby="run-workspace-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="run-workspace-heading" className="text-lg font-semibold text-foreground">运行记录</h2>
          <p className="mt-1 text-sm leading-6 text-secondary-text">按完整策略版本查看输入、内核执行状态和标准输出。策略内部实现保持黑盒。</p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs text-secondary-text"><Database className="h-4 w-4" />仅展示已保存数据</span>
      </div>

      {selectedBatch ? (
        <div className="mt-4 grid overflow-hidden rounded-[12px] border border-border/70 bg-card xl:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="border-b border-border/70 bg-base/35 p-3 xl:border-b-0 xl:border-r" aria-label="运行批次列表">
            <p className="px-2 py-2 text-xs font-medium text-secondary-text">最近运行批次</p>
            <div className="mt-1 space-y-1">
              {batches.map((batch) => (
                <button
                  key={batch.id}
                  type="button"
                  onClick={() => onSelectBatch(batch.id)}
                  aria-current={batch.id === selectedBatch.id ? "true" : undefined}
                  className={`w-full rounded-[9px] border px-3 py-3 text-left transition-colors ${batch.id === selectedBatch.id ? "border-primary/30 bg-primary/10" : "border-transparent hover:border-border hover:bg-hover/50"}`}
                >
                  <div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-medium text-foreground">运行批次 #{batch.id}</p><ProgressIcon status={batch.status === "completed_with_failures" ? "failed" : batch.status} /></div>
                  <p className="mt-1 truncate text-xs text-secondary-text">{batch.strategyName} · V{batch.versionNumber ?? "—"}</p>
                  <p className="mt-2 text-xs text-muted-text">{batch.candidateCount} 个标的 · {batchStatusLabel[batch.status]}</p>
                  <p className="mt-1 text-[11px] tabular-nums text-muted-text">开始 {formatRunTime(batch.startedAt ?? batch.createdAt)}</p>
                </button>
              ))}
            </div>
          </aside>

          <div className="min-w-0 p-5 lg:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-5">
              <div>
                <p className="text-base font-semibold text-foreground">{selectedBatch.strategyName} · V{selectedBatch.versionNumber ?? "—"}</p>
                <p className="mt-1 text-xs text-secondary-text">{selectedBatch.screeningPolicy.market.toUpperCase()} · {selectedBatch.outputContract ?? "DecisionProposal"} · {selectedBatch.kernelRuntime ?? "兼容内核"}</p>
              </div>
              <span role="status" aria-live="polite" className={`text-sm font-medium ${selectedBatch.status === "failed" || selectedBatch.status === "completed_with_failures" ? "text-danger" : selectedBatch.status === "running" ? "text-primary" : selectedBatch.status === "completed" ? "text-success" : "text-secondary-text"}`}>{batchStatusLabel[selectedBatch.status]}</span>
            </div>

            <dl className="mt-4 grid gap-px overflow-hidden rounded-[10px] border border-border/70 bg-border/70 text-xs sm:grid-cols-3">
              <div className="bg-card px-3 py-2.5"><dt className="text-muted-text">提交时间</dt><dd className="mt-1 tabular-nums text-foreground">{formatRunTime(selectedBatch.createdAt)}</dd></div>
              <div className="bg-card px-3 py-2.5"><dt className="text-muted-text">开始时间</dt><dd className="mt-1 tabular-nums text-foreground">{formatRunTime(selectedBatch.startedAt)}</dd></div>
              <div className="bg-card px-3 py-2.5"><dt className="text-muted-text">完成时间</dt><dd className="mt-1 tabular-nums text-foreground">{formatRunTime(selectedBatch.completedAt)}</dd></div>
            </dl>

            <div className="mt-5"><ExecutionBoundary phases={batchBoundaryPhases(selectedBatch)} label={`运行批次 #${selectedBatch.id} 的执行边界`} /></div>
            {selectedBatch.errorMessage ? <p role="alert" className="mt-4 rounded-[10px] border border-danger/25 bg-danger/5 px-4 py-3 text-sm leading-6 text-danger">{selectedBatch.errorMessage}</p> : null}

            <div className="mt-7">
              <div className="flex items-end justify-between gap-3"><div><h3 className="text-base font-semibold text-foreground">标的运行结果</h3><p className="mt-1 text-sm text-secondary-text">每个标的调用同一个冻结策略内核。</p></div><span className="text-xs text-muted-text">{selectedBatch.candidates.length} 条</span></div>
              {selectedBatch.candidates.length ? (
                <div className="mt-4 overflow-x-auto rounded-[10px] border border-border/70">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-base/55 text-xs text-secondary-text"><tr><th className="px-4 py-3 font-medium">标的</th><th className="px-4 py-3 font-medium">筛选分数</th><th className="px-4 py-3 font-medium">策略内核</th><th className="px-4 py-3 font-medium">输出契约</th><th className="px-4 py-3 text-right font-medium">操作</th></tr></thead>
                    <tbody className="divide-y divide-border/65">
                      {selectedBatch.candidates.map((candidate) => (
                        <tr key={candidate.runId} className="hover:bg-hover/45">
                          <td className="px-4 py-3"><p className="font-medium text-foreground">{candidate.code}</p><p className="text-xs text-secondary-text">{candidate.name || "—"}</p></td>
                          <td className="px-4 py-3 font-mono tabular-nums text-foreground">{formatScore(candidate.screenScore)}</td>
                          <td className="px-4 py-3"><span className={`inline-flex items-center gap-2 text-xs font-medium ${statusTone[candidate.status]}`}><ProgressIcon status={candidate.status} />{statusLabel[candidate.status]}</span></td>
                          <td className="px-4 py-3 text-xs text-secondary-text">{selectedBatch.outputContract ?? "DecisionProposal"}</td>
                          <td className="px-4 py-3 text-right"><button type="button" onClick={() => onOpenCandidate(selectedBatch, candidate)} className="text-sm font-medium text-primary hover:underline" aria-label={`查看 ${candidate.code} 策略输出`}>查看输出</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-4 rounded-[10px] border border-dashed border-border px-5 py-8 text-center"><p className="text-sm font-medium text-foreground">尚未生成标的运行记录</p><p className="mt-1 text-sm text-secondary-text">数据和股票范围解析完成后，系统会冻结输入并调用策略内核。</p></div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <Card variant="bordered" padding="lg" className="mt-4"><div className="grid place-items-center py-10 text-center"><Code2 className="h-6 w-6 text-muted-text" aria-hidden="true" /><p className="mt-4 font-medium text-foreground">还没有策略运行记录</p><p className="mt-1 max-w-xl text-sm leading-6 text-secondary-text">选择一个完整策略并运行后，这里会展示黑盒输入、执行状态和标准输出。</p></div></Card>
      )}
    </section>
  );
}

function RunDetails({ run: initialRun }: { run: PublishedStrategyRun }) {
  const [run, setRun] = useState(initialRun);
  const [refreshError, setRefreshError] = useState("");
  const active = run.status === "queued" || run.status === "running";
  const stockCode = String(run.inputSnapshot.stock_code ?? run.inputSnapshot.stockCode ?? "—");
  const output = extractStrategyOutput(run.resultSnapshot);

  useEffect(() => { setRun(initialRun); }, [initialRun]);
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => {
      void strategyWorkspaceApi.getPublishedRun(run.id)
        .then((next) => { setRun(next); setRefreshError(""); })
        .catch(() => setRefreshError("运行状态刷新失败，系统会继续重试。"));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [active, run.id]);

  return (
    <AppPage className="space-y-6">
      <PageHeader eyebrow="Strategy run" title={`${run.strategyName} · 运行 #${run.id}`} description={`正式版本 V${run.versionNumber ?? "—"} · ${statusLabel[run.status]}`} actions={<Link to="/runs" className="btn-secondary">返回运行中心</Link>} />
      <ExecutionBoundary phases={runBoundaryPhases(run)} label={`运行 #${run.id} 的执行边界`} />

      <section className="grid gap-5 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
        <Card variant="bordered" padding="lg">
          <h2 className="text-base font-semibold text-foreground">冻结输入</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4 border-b border-border/60 pb-3"><dt className="text-secondary-text">标的</dt><dd className="font-medium text-foreground">{stockCode}</dd></div>
            <div className="flex justify-between gap-4 border-b border-border/60 pb-3"><dt className="text-secondary-text">策略版本</dt><dd className="font-medium text-foreground">#{run.strategyVersionId}</dd></div>
            <div className="flex justify-between gap-4 border-b border-border/60 pb-3"><dt className="text-secondary-text">内核运行时</dt><dd className="font-medium text-foreground">{run.kernelRuntime ?? "兼容内核"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-secondary-text">输出契约</dt><dd className="font-medium text-foreground">{run.outputContract ?? "DecisionProposal"}</dd></div>
          </dl>
          <p role="status" aria-live="polite" className={`mt-5 text-sm font-medium ${statusTone[run.status]}`}>{statusLabel[run.status]}{active ? " · 每 2 秒刷新" : ""}</p>
          <dl className="mt-4 grid gap-2 border-t border-border/60 pt-4 text-xs text-secondary-text">
            <div className="flex justify-between gap-4"><dt>提交时间</dt><dd className="tabular-nums text-foreground">{formatRunTime(run.createdAt)}</dd></div>
            <div className="flex justify-between gap-4"><dt>开始时间</dt><dd className="tabular-nums text-foreground">{formatRunTime(run.startedAt)}</dd></div>
            <div className="flex justify-between gap-4"><dt>完成时间</dt><dd className="tabular-nums text-foreground">{formatRunTime(run.completedAt)}</dd></div>
          </dl>
          {run.errorMessage ? <p role="alert" className="mt-4 text-sm leading-6 text-danger">{run.errorMessage}</p> : null}
          {refreshError ? <p role="alert" className="mt-3 text-sm text-warning">{refreshError}</p> : null}
        </Card>

        <section aria-labelledby="run-output-heading">
          <div className="flex items-end justify-between gap-3"><div><h2 id="run-output-heading" className="text-lg font-semibold text-foreground">策略标准输出</h2><p className="mt-1 text-sm text-secondary-text">运行中心只展示输入输出边界和执行状态，不展示内核内部编排。</p></div>{active ? <span className="inline-flex items-center gap-2 text-sm text-primary"><RotateCw className="h-4 w-4 animate-spin" aria-hidden="true" />实时刷新</span> : null}</div>
          <div className="mt-4"><StrategyOutputView output={output} /></div>
        </section>
      </section>

      <div className="flex flex-wrap gap-3">{stockCode !== "—" ? <Link className="btn-secondary inline-flex items-center gap-2" to="/stock-research" state={{ stockCode }}>在单股研究中打开 <ArrowRight className="h-4 w-4" /></Link> : null}</div>
      <Card variant="gradient" padding="lg"><ShieldAlert className="h-5 w-5 text-warning" aria-hidden="true" /><p className="mt-3 font-medium text-foreground">这是研究运行，不是交易执行</p><p className="mt-1 text-sm leading-6 text-secondary-text">当前没有订单、成交、持仓、费用或收益账本；策略输出不会被显示为真实交易结果。</p></Card>
    </AppPage>
  );
}

const StrategyRunPage: React.FC = () => {
  const { runId } = useParams();
  const [searchParams] = useSearchParams();
  const requestedVersionId = searchParams.get("versionId");
  const [versions, setVersions] = useState<RunnableStrategyVersion[]>([]);
  const [automaticRuns, setAutomaticRuns] = useState<AutomaticStrategyRunBatch[]>([]);
  const [continuousRuns, setContinuousRuns] = useState<ContinuousStrategyRunControl[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingAutomatic, setStartingAutomatic] = useState(false);
  const [updatingControl, setUpdatingControl] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState("900");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<PublishedStrategyRun | null>(null);
  const [drawerBatch, setDrawerBatch] = useState<AutomaticStrategyRunBatch | null>(null);
  const [drawerCandidate, setDrawerCandidate] = useState<Candidate | null>(null);
  const [drawerRun, setDrawerRun] = useState<PublishedStrategyRun | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      strategyWorkspaceApi.listRunnableVersions(),
      strategyWorkspaceApi.listAutomaticRuns(),
      strategyWorkspaceApi.listContinuousRuns(),
    ]);
    const [runnableResult, automaticResult, controlsResult] = results;
    const runnable = runnableResult.status === "fulfilled" ? runnableResult.value : null;
    const automatic = automaticResult.status === "fulfilled" ? automaticResult.value : null;
    if (runnable) setVersions(runnable);
    if (automatic) {
      setAutomaticRuns(automatic);
      setSelectedBatchId((current) => automatic.some((batch) => batch.id === current) ? current : automatic[0]?.id ?? null);
    }
    if (controlsResult.status === "fulfilled") setContinuousRuns(controlsResult.value);
    setSelectedVersionId((current) => {
      if (current) return current;
      if (!runnable) return "";
      return runnable.some((item) => String(item.versionId) === requestedVersionId)
        ? requestedVersionId ?? ""
        : String(runnable[0]?.versionId ?? "");
    });
    if (results.some((result) => result.status === "rejected")) {
      setError("部分运行数据暂时无法读取；已返回的完整策略和运行记录仍会保留显示。请刷新后再启动新运行。");
    }
    setLoading(false);
  }, [requestedVersionId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!automaticRuns.some((item) => item.status === "queued" || item.status === "running") && !continuousRuns.some((item) => item.status === "running")) return undefined;
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    return () => window.clearInterval(timer);
  }, [automaticRuns, continuousRuns, refresh]);
  useEffect(() => {
    if (!runId) { setDetail(null); return; }
    void strategyWorkspaceApi.getPublishedRun(Number(runId)).then(setDetail).catch(() => setError("找不到这条运行记录。"));
  }, [runId]);

  const counts = useMemo(() => ({
    failedBatches: automaticRuns.filter((batch) => batch.status === "failed" || batch.status === "completed_with_failures").length,
    activeBatches: automaticRuns.filter((batch) => batch.status === "queued" || batch.status === "running").length,
  }), [automaticRuns]);

  const selectedVersion = versions.find((item) => item.versionId === Number(selectedVersionId));
  const hasCompletedReplay = selectedVersion?.validationStatus === "completed" || selectedVersion?.validationStatus === "validated";
  const selectedControl = continuousRuns.find((control) => control.strategyVersionId === Number(selectedVersionId));

  const startAutomatic = async () => {
    if (!selectedVersionId || startingAutomatic) return;
    setStartingAutomatic(true);
    setError("");
    try {
      const batch = await strategyWorkspaceApi.createAutomaticRun(Number(selectedVersionId));
      setAutomaticRuns((current) => [batch, ...current.filter((item) => item.id !== batch.id)]);
      setSelectedBatchId(batch.id);
    } catch (cause: unknown) {
      const message = typeof cause === "object" && cause && "response" in cause
        ? (cause as { response?: { data?: { detail?: { message?: string } } } }).response?.data?.detail?.message
        : undefined;
      setError(message || "策略运行启动失败。请检查正式版本、数据依赖和内核输入契约。");
    } finally {
      setStartingAutomatic(false);
    }
  };

  const startContinuous = async () => {
    if (!selectedVersionId || startingAutomatic || updatingControl) return;
    setUpdatingControl(true);
    setError("");
    try {
      const control = await strategyWorkspaceApi.startContinuousRun(Number(selectedVersionId), Number(intervalSeconds));
      setContinuousRuns((current) => [control, ...current.filter((item) => item.id !== control.id)]);
    } catch (cause: unknown) {
      const message = typeof cause === "object" && cause && "response" in cause
        ? (cause as { response?: { data?: { detail?: { message?: string } } } }).response?.data?.detail?.message
        : undefined;
      setError(message || "持续运行启动失败。请检查正式版本、数据依赖和运行间隔。");
    } finally {
      setUpdatingControl(false);
    }
  };

  const changeControl = async (action: "pause" | "terminate") => {
    if (!selectedControl || updatingControl) return;
    setUpdatingControl(true);
    setError("");
    try {
      const control = action === "pause"
        ? await strategyWorkspaceApi.pauseContinuousRun(selectedControl.id)
        : await strategyWorkspaceApi.terminateContinuousRun(selectedControl.id);
      setContinuousRuns((current) => [control, ...current.filter((item) => item.id !== control.id)]);
    } catch {
      setError(action === "pause" ? "暂停持续运行失败。" : "终止持续运行失败。");
    } finally {
      setUpdatingControl(false);
    }
  };

  const openCandidate = (batch: AutomaticStrategyRunBatch, candidate: Candidate) => {
    setDrawerBatch(batch);
    setDrawerCandidate(candidate);
    setDrawerRun(null);
    setDrawerError("");
    setDrawerLoading(true);
    void strategyWorkspaceApi.getPublishedRun(candidate.runId)
      .then(setDrawerRun)
      .catch(() => setDrawerError("运行结果暂时无法读取；当前只展示批次中已保存的边界状态。"))
      .finally(() => setDrawerLoading(false));
  };

  if (runId) {
    return detail
      ? <RunDetails run={detail} />
      : <AppPage><p className="text-secondary-text">正在读取运行记录…</p>{error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}</AppPage>;
  }

  return (
    <AppPage className="space-y-7">
      <PageHeader eyebrow="Published strategy runs" title="运行中心" description="运行已经配置并正式发布的完整策略。平台冻结输入后调用策略内核，只展示执行状态与标准输出；策略内部规则、工具和模型实现保持黑盒。当前仍是研究运行，不会自动交易。" actions={<button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => void refresh()} disabled={loading}><RefreshCw className="h-4 w-4" />刷新</button>} />
      <StrategyLifecycleNav current="runs" />

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-border/70 bg-border/70 lg:grid-cols-4" aria-label="运行状态摘要">
        {[
          ["完整策略", loading ? "—" : versions.length, "可运行的正式版本"],
          ["活动批次", loading ? "—" : counts.activeBatches, "等待或执行中"],
          ["持续运行", loading ? "—" : continuousRuns.filter((item) => item.status === "running").length, "按间隔调用内核"],
          ["异常批次", loading ? "—" : counts.failedBatches, "保留真实失败原因"],
        ].map(([label, value, hint]) => <div key={label} className="bg-card px-4 py-4"><p className="text-xs text-secondary-text">{label}</p><p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">{value}</p><p className="mt-1 text-xs text-muted-text">{hint}</p></div>)}
      </section>

      <section className="rounded-[12px] border border-border/70 bg-card p-5 shadow-soft-card lg:p-6" aria-labelledby="run-control-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl"><h2 id="run-control-heading" className="text-lg font-semibold text-foreground">完整策略运行控制</h2><p className="mt-1 text-sm leading-6 text-secondary-text">选择正式运行配置后，系统会冻结市场、数据源、股票范围、周期和参数，再调用关联的策略内核。</p></div>
          <span className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-secondary-text"><Code2 className="h-4 w-4" />内核实现不可在此编辑</span>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <label className="block text-sm font-medium text-foreground" htmlFor="run-version">完整策略
            <select id="run-version" className="mt-2 w-full rounded-[10px] border border-border bg-background px-3 py-2.5 text-foreground" value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.target.value)}>
              {versions.map((version) => <option key={version.versionId} value={version.versionId}>{version.strategyName} · V{version.versionNumber ?? "—"} · {version.validationStatus === "validated" ? "已通过验证" : version.validationStatus === "completed" ? "观察性回放已完成" : "未回放"}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-foreground" htmlFor="continuous-interval">持续运行间隔
            <select id="continuous-interval" className="mt-2 w-full rounded-[10px] border border-border bg-background px-3 py-2.5 text-foreground" value={intervalSeconds} onChange={(event) => setIntervalSeconds(event.target.value)}>
              <option value="300">每 5 分钟</option><option value="900">每 15 分钟</option><option value="1800">每 30 分钟</option><option value="3600">每小时</option>
            </select>
          </label>
        </div>
        {selectedVersion ? (
          <dl className="mt-4 grid gap-px overflow-hidden rounded-[10px] border border-border/70 bg-border/70 sm:grid-cols-4">
            <div className="bg-base/35 px-3 py-3"><dt className="text-xs text-muted-text">市场</dt><dd className="mt-1 text-sm font-medium text-foreground">{selectedVersion.market?.toUpperCase() || "按版本配置"}</dd></div>
            <div className="bg-base/35 px-3 py-3"><dt className="text-xs text-muted-text">运行周期</dt><dd className="mt-1 text-sm font-medium text-foreground">{selectedVersion.timeHorizon || "按版本配置"}</dd></div>
            <div className="bg-base/35 px-3 py-3"><dt className="text-xs text-muted-text">策略内核</dt><dd className="mt-1 text-sm font-medium text-foreground">{selectedVersion.kernelRuntime || "兼容内核"}</dd></div>
            <div className="bg-base/35 px-3 py-3"><dt className="text-xs text-muted-text">输出契约</dt><dd className="mt-1 text-sm font-medium text-foreground">{selectedVersion.outputContract || "DecisionProposal"}</dd></div>
          </dl>
        ) : null}
        {selectedVersionId ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-warning/30 bg-warning/5 px-4 py-3"><p className="text-sm leading-6 text-warning">{hasCompletedReplay ? "该版本已有观察性 OHLCV 历史回放，但不代表完整策略已经验证有效。" : "该版本尚无可信的策略级历史回放；研究运行不代表策略已经验证有效。"}</p><Link className="text-sm font-medium text-primary hover:underline" to={`/backtests?strategyId=${selectedVersion?.strategyId ?? ""}&versionId=${selectedVersionId}`}>查看验证</Link></div>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={!selectedVersionId || startingAutomatic} onClick={() => void startAutomatic()}><PlayCircle className="h-4 w-4" />{startingAutomatic ? "正在提交…" : "运行一次"}</button>
          <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={!selectedVersionId || startingAutomatic || updatingControl} onClick={() => void startContinuous()}><RotateCw className="h-4 w-4" />{selectedControl?.status === "paused" ? "恢复持续运行" : "持续运行"}</button>
          <button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={!selectedControl || selectedControl.status !== "running" || updatingControl} onClick={() => void changeControl("pause")}><PauseCircle className="h-4 w-4" />暂停运行</button>
          <button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={!selectedControl || selectedControl.status === "terminated" || updatingControl} onClick={() => void changeControl("terminate")}><StopCircle className="h-4 w-4" />终止运行</button>
        </div>
        {selectedControl ? (
          <section className="mt-4 rounded-[10px] border border-border/70 bg-base/35 p-4" aria-label="持续运行记录">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p role="status" className="text-sm font-medium text-foreground">{selectedVersion?.strategyName ?? `策略版本 #${selectedControl.strategyVersionId}`} · {continuousStatus[selectedControl.status]}</p>
              {selectedControl.lastBatchId ? <span className="text-xs text-secondary-text">最近批次 #{selectedControl.lastBatchId}</span> : null}
            </div>
            <dl className="mt-3 grid gap-x-5 gap-y-2 text-xs text-secondary-text sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-muted-text">创建时间</dt><dd className="mt-1 tabular-nums text-foreground">{formatRunTime(selectedControl.createdAt)}</dd></div>
              <div><dt className="text-muted-text">最近开始</dt><dd className="mt-1 tabular-nums text-foreground">{formatRunTime(selectedControl.lastStartedAt)}</dd></div>
              <div><dt className="text-muted-text">最近完成</dt><dd className="mt-1 tabular-nums text-foreground">{formatRunTime(selectedControl.lastCompletedAt)}</dd></div>
              <div><dt className="text-muted-text">下次计划</dt><dd className="mt-1 tabular-nums text-foreground">{formatRunTime(selectedControl.nextRunAt)}</dd></div>
            </dl>
          </section>
        ) : null}
        {selectedControl?.errorMessage ? <p role="alert" className="mt-2 text-sm leading-6 text-danger">最近周期失败：{selectedControl.errorMessage}</p> : null}
        <p className="mt-3 text-xs leading-5 text-secondary-text">纯规则策略可直接运行；需要模型或特定数据的策略由后端按内核声明的依赖检查，不再受旧运行时全局开关统一阻断。</p>
        {error ? <p role="alert" className="mt-4 text-sm leading-6 text-danger">{error}</p> : null}
      </section>

      <BatchWorkspace batches={automaticRuns} selectedBatchId={selectedBatchId} onSelectBatch={setSelectedBatchId} onOpenCandidate={openCandidate} />

      <Card variant="gradient" padding="lg"><FileOutput className="h-5 w-5 text-warning" aria-hidden="true" /><p className="mt-3 font-medium text-foreground">收益还不能展示</p><p className="mt-1 max-w-3xl text-sm leading-6 text-secondary-text">运行中心保存策略输入、执行状态和标准输出。模拟收益仍需订单、成交、滑点、费用、持仓与账本闭环后才能成立。</p></Card>

      <CandidateRunDrawer batch={drawerBatch} candidate={drawerCandidate} run={drawerRun} loading={drawerLoading} error={drawerError} onClose={() => { setDrawerCandidate(null); setDrawerBatch(null); setDrawerRun(null); setDrawerError(""); }} />
    </AppPage>
  );
};

export default StrategyRunPage;
