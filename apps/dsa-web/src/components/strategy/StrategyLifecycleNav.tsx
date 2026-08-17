import {
  ArrowRight,
  Database,
  FlaskConical,
  PlayCircle,
  SlidersHorizontal,
} from "lucide-react";
import { Link } from "react-router-dom";

import { cn } from "../../utils/cn";

export type StrategyCenterKey =
  | "strategy"
  | "agents"
  | "data"
  | "backtests"
  | "runs";

type StrategyLifecycleNavProps = {
  current: StrategyCenterKey;
};

const itemClass =
  "group flex min-h-12 min-w-0 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50";

function CenterLink({
  current,
  id,
  to,
  icon: Icon,
  title,
  description,
}: {
  current: StrategyCenterKey;
  id: StrategyCenterKey;
  to: string;
  icon: typeof Database;
  title: string;
  description: string;
}) {
  const active = current === id;
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        itemClass,
        active
          ? "border-primary/30 bg-primary/10"
          : "border-transparent bg-transparent hover:border-border hover:bg-hover/65",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          active ? "text-primary" : "text-muted-text group-hover:text-foreground",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="mt-0.5 block text-xs leading-4 text-secondary-text">
          {description}
        </span>
      </span>
    </Link>
  );
}

function FlowArrow() {
  return (
    <ArrowRight
      className="mx-auto hidden h-4 w-4 shrink-0 text-muted-text lg:block"
      aria-hidden="true"
    />
  );
}

export function StrategyLifecycleNav({ current }: StrategyLifecycleNavProps) {
  return (
    <nav
      aria-label="策略工作链"
      className="workspace-surface p-3 sm:p-4"
    >
      <div className="mb-3">
        <p className="text-sm font-semibold text-foreground">策略运行链</p>
        <p className="mt-0.5 text-xs leading-5 text-secondary-text">
          接入完整策略版本，记录验证证据，再进入持续运行与监控。
        </p>
      </div>
      <div className="grid gap-1.5 lg:grid-cols-[minmax(180px,1fr)_18px_minmax(180px,1fr)_18px_minmax(180px,1fr)] lg:items-stretch">
        <CenterLink
          current={current}
          id="strategy"
          to="/strategies"
          icon={SlidersHorizontal}
          title="策略中心"
          description="策略接入与版本"
        />
        <FlowArrow />
        <CenterLink
          current={current}
          id="backtests"
          to="/backtests"
          icon={FlaskConical}
          title="验证中心"
          description="实验与结果"
        />
        <FlowArrow />
        <CenterLink
          current={current}
          id="runs"
          to="/runs"
          icon={PlayCircle}
          title="运行中心"
          description="执行与监控"
        />
      </div>
      <Link
        to="/data"
        className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-secondary-text transition-colors hover:text-foreground"
      >
        <Database className="h-3.5 w-3.5" aria-hidden="true" />
        数据依赖由数据中心提供并在策略接入时核对
      </Link>
    </nav>
  );
}
