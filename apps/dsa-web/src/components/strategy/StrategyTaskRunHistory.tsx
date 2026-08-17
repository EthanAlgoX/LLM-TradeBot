import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, History, RefreshCw } from "lucide-react";

import { analysisApi } from "../../api/analysis";
import { screeningApi } from "../../api/screening";
import type { TaskInfo } from "../../types/analysis";
import type { SelectedProductStrategy } from "./StrategyProductSelector";

type StrategyTaskRunHistoryProps = {
  selection: SelectedProductStrategy | null;
  kind: "research_report" | "candidate_screening";
  refreshKey?: string | number | null;
  limit?: number;
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const statusMeta: Record<TaskInfo["status"], { label: string; className: string }> = {
  pending: { label: "等待执行", className: "text-secondary-text" },
  processing: { label: "运行中", className: "text-primary" },
  completed: { label: "已完成", className: "text-success" },
  failed: { label: "运行失败", className: "text-danger" },
  cancel_requested: { label: "正在取消", className: "text-warning" },
  cancelled: { label: "已取消", className: "text-muted-text" },
};

function formatTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function runTarget(task: TaskInfo, kind: StrategyTaskRunHistoryProps["kind"]) {
  if (kind === "candidate_screening") return task.stockName || "候选池扫描";
  return [task.stockCode, task.stockName].filter(Boolean).join(" · ") || "单股研究";
}

export function StrategyTaskRunHistory({ selection, kind, refreshKey, limit = 4 }: StrategyTaskRunHistoryProps) {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!selection) {
      setTasks([]);
      setError("");
      return;
    }
    setLoading(true);
    try {
      const versionId = selection.version.id;
      const response = await analysisApi.getTasks({ limit: 100, strategyVersionId: versionId });
      let next = response.tasks
        .filter((task) => task.strategyVersionId === versionId)
        .filter((task) => kind === "candidate_screening" ? task.reportType === "screening_screen" : task.reportType !== "screening_screen");
      if (kind === "candidate_screening") {
        const history = await screeningApi.getHistory({ limit: 100, strategyVersionId: versionId });
        const active = next.filter((task) => task.status !== "completed");
        const completed: TaskInfo[] = history.runs.map((run) => ({
          taskId: run.runId,
          stockCode: "screening_screen",
          stockName: `${run.strategy} / ${run.market}`,
          status: "completed",
          progress: 100,
          reportType: "screening_screen",
          strategyVersionId: run.strategyVersionId ?? versionId,
          createdAt: run.submittedAt || run.createdAt || "",
          startedAt: run.startedAt || undefined,
          completedAt: run.completedAt || run.createdAt || undefined,
        }));
        next = [...active, ...completed];
      }
      next = next
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, limit);
      setTasks(next);
      setError("");
    } catch {
      setError("运行记录暂时无法读取；当前策略仍可按原有方式运行。");
    } finally {
      setLoading(false);
    }
  }, [kind, limit, selection]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const hasActiveTask = useMemo(
    () => tasks.some((task) => task.status === "pending" || task.status === "processing" || task.status === "cancel_requested"),
    [tasks],
  );

  useEffect(() => {
    if (!selection || !hasActiveTask) return;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [hasActiveTask, load, selection]);

  return (
    <section className="workspace-surface p-4" aria-labelledby={`${kind}-run-history-heading`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <History className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id={`${kind}-run-history-heading`} className="text-sm font-semibold text-foreground">运行记录</h2>
            <p className="mt-1 truncate text-xs text-secondary-text">
              {selection ? `${selection.summary.name} · 正式版本 V${selection.version.versionNumber ?? "—"}` : "选择正式策略后查看对应记录"}
            </p>
          </div>
        </div>
        <button type="button" className="inline-flex items-center gap-1.5 text-xs font-medium text-secondary-text hover:text-foreground disabled:opacity-50" onClick={() => void load()} disabled={!selection || loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          刷新记录
        </button>
      </div>

      {error ? <p role="alert" className="mt-3 text-xs leading-5 text-warning">{error}</p> : null}
      {!selection ? <p className="mt-3 text-sm text-secondary-text">当前没有选择可运行的完整策略。</p> : null}
      {selection && !loading && !error && tasks.length === 0 ? (
        <div className="mt-3 border-t border-border/70 pt-3">
          <p className="text-sm font-medium text-foreground">这个正式版本还没有运行记录</p>
          <p className="mt-1 text-xs leading-5 text-secondary-text">发起运行后，这里会保存真实任务状态、运行时间和所用策略版本。</p>
        </div>
      ) : null}
      {tasks.length > 0 ? (
        <ol className="mt-3 divide-y divide-border/70 border-t border-border/70">
          {tasks.map((task) => {
            const meta = statusMeta[task.status];
            return (
              <li key={task.taskId} className="grid gap-2 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="truncate text-sm font-medium text-foreground">{runTarget(task, kind)}</p>
                    <span className={`text-xs font-medium ${meta.className}`}>{meta.label}</span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-muted-text">任务 {task.taskId.slice(0, 12)}</p>
                  {task.error ? <p className="mt-1 text-xs leading-5 text-danger">{task.error}</p> : null}
                </div>
                <dl className="grid gap-x-4 gap-y-1 text-[11px] text-secondary-text sm:grid-cols-3 lg:text-right">
                  <div><dt className="inline text-muted-text">提交 </dt><dd className="inline tabular-nums">{formatTime(task.createdAt)}</dd></div>
                  <div><dt className="inline text-muted-text">开始 </dt><dd className="inline tabular-nums">{formatTime(task.startedAt)}</dd></div>
                  <div><dt className="inline text-muted-text">完成 </dt><dd className="inline tabular-nums">{formatTime(task.completedAt)}</dd></div>
                </dl>
              </li>
            );
          })}
        </ol>
      ) : null}
      {loading && tasks.length === 0 ? <p className="mt-3 inline-flex items-center gap-2 text-xs text-secondary-text"><Clock3 className="h-3.5 w-3.5" />正在读取运行记录…</p> : null}
    </section>
  );
}
