import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  FileText,
  FlaskConical,
  Link2,
  LoaderCircle,
  Network,
  Plus,
  Save,
  ScanSearch,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { isAxiosError } from "axios";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AppPage, Card, ConfirmDialog, PageHeader } from "../components/common";
import { ComposableStrategyPreview } from "../components/capability";
import {
  agentFromTemplate,
  strategyWorkspaceApi,
  type Agent,
  type AgentTemplate,
  type AgentWorkflowVersion,
  type Connection,
  type StrategyDataRequirement,
  type StrategyDataSource,
  type StrategyDeletionImpact,
  type StrategyPurpose,
  type StrategyValidationVersionStatus,
  type StrategyVersion,
  type ValidationResult,
  type VersionDiff,
} from "../api/strategyWorkspace";
import { toApiErrorMessage } from "../api/error";
import {
  dataSourceMarketSummary,
  dataSourceSupportsMarket,
  strategyMarketLabel,
} from "../utils/strategyMarkets";
import {
  buildForkLocalRequest,
  checkFieldCompatibility,
  findDuplicateConnection,
  flattenSchemaFields,
  inferConnectionType,
  isValidAgentConnection,
  mappingObjectToRows,
  mappingRowsToObject,
  mergeSavedRevision,
  type MappingRow,
} from "./strategyEditorUtils";
import {
  isWorkflowCompatible,
  purposeDefinition,
  workflowOutputContract,
} from "../utils/strategyPurpose";

type SaveState =
  | "CLEAN"
  | "DIRTY"
  | "SAVING"
  | "SAVED"
  | "SAVE_FAILED"
  | "CONFLICT"
  | "READ_ONLY";
export function FieldMappingEditor({
  source,
  target,
  mapping,
  disabled,
  onChange,
}: {
  source: Agent;
  target: Agent;
  mapping: Record<string, unknown>;
  disabled: boolean;
  onChange: (value: Record<string, unknown>) => void;
}) {
  const sources = flattenSchemaFields(
    source.outputSchema,
    "",
    Array.isArray(source.outputSchema.required)
      ? source.outputSchema.required.map(String)
      : [],
  );
  const targets = flattenSchemaFields(
    target.inputSchema,
    "",
    Array.isArray(target.inputSchema.required)
      ? target.inputSchema.required.map(String)
      : [],
  );
  const [pendingRows, setPendingRows] = useState<MappingRow[]>([]);
  const rows = [...mappingObjectToRows(mapping), ...pendingRows];
  const update = (next: MappingRow[]) => {
    setPendingRows(next.filter((row) => !row.sourcePath || !row.targetPath));
    onChange(mappingRowsToObject(next));
  };
  const targetFields = new Map(targets.map((item) => [item.path, item]));
  const sourceFields = new Map(sources.map((item) => [item.path, item]));
  const autoMatch = () => {
    const used = new Set(rows.map((row) => row.targetPath));
    const additions = targets
      .filter((targetField) => !used.has(targetField.path))
      .flatMap((targetField) => {
        const sourceField = sources.find(
          (item) =>
            item.path.split(".").at(-1) ===
              targetField.path.split(".").at(-1) &&
            checkFieldCompatibility(item, targetField).state === "ok",
        );
        return sourceField
          ? [{ sourcePath: sourceField.path, targetPath: targetField.path }]
          : [];
      });
    update([...rows, ...additions]);
  };
  return (
    <fieldset className="space-y-2" data-testid="field-mapping-editor">
      <legend className="text-sm font-medium">字段映射</legend>
      <p className="text-xs text-muted-text">
        选择上游输出和下游输入字段；保存格式兼容现有对象映射。
      </p>
      {!disabled && (
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={autoMatch}
        >
          自动匹配同名字段
        </button>
      )}
      {rows.map((row, index) => {
        const sourceField = sourceFields.get(row.sourcePath),
          targetField = targetFields.get(row.targetPath),
          status = checkFieldCompatibility(sourceField, targetField);
        const duplicate = rows.some(
          (item, i) =>
            i !== index && item.targetPath === row.targetPath && row.targetPath,
        );
        return (
          <div
            key={`${row.sourcePath}-${row.targetPath}-${index}`}
            data-testid={`field-mapping-row-${index}`}
            className="rounded-lg border border-border/70 p-2"
          >
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
              <label className="sr-only">上游字段</label>
              <select
                aria-label={`上游字段 ${index + 1}`}
                disabled={disabled}
                value={row.sourcePath}
                onChange={(event) =>
                  update(
                    rows.map((item, i) =>
                      i === index
                        ? { ...item, sourcePath: event.target.value }
                        : item,
                    ),
                  )
                }
                className="rounded border border-border bg-base p-2 text-xs"
              >
                <option value="">选择上游字段</option>
                {sources.map((field) => (
                  <option value={field.path} key={field.path}>
                    {field.path} · {field.type}
                    {field.required ? " · 必填" : ""}
                  </option>
                ))}
              </select>
              <span
                aria-hidden="true"
                className="self-center text-center text-muted-text"
              >
                →
              </span>
              <label className="sr-only">下游字段</label>
              <select
                aria-label={`下游字段 ${index + 1}`}
                disabled={disabled}
                value={row.targetPath}
                onChange={(event) =>
                  update(
                    rows.map((item, i) =>
                      i === index
                        ? { ...item, targetPath: event.target.value }
                        : item,
                    ),
                  )
                }
                className="rounded border border-border bg-base p-2 text-xs"
              >
                <option value="">选择下游字段</option>
                {targets.map((field) => (
                  <option value={field.path} key={field.path}>
                    {field.path} · {field.type}
                    {field.required ? " · 必填" : ""}
                  </option>
                ))}
              </select>
              {!disabled && (
                <button
                  aria-label={`删除字段映射 ${index + 1}`}
                  type="button"
                  className="text-danger"
                  onClick={() => update(rows.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <p
              className={`mt-1 text-xs ${status.state === "error" || duplicate ? "text-danger" : status.state === "warn" ? "text-warning" : "text-secondary-text"}`}
            >
              {duplicate ? "同一目标字段不能重复映射。" : status.label}
              {sourceField?.description ? ` · ${sourceField.description}` : ""}
              {targetField?.required ? " · 下游必填" : ""}
            </p>
          </div>
        );
      })}
      {!disabled && (
        <button
          type="button"
          className="flex items-center gap-1 text-sm text-cyan"
          onClick={() => update([...rows, { sourcePath: "", targetPath: "" }])}
        >
          <Plus className="h-4 w-4" />
          添加字段映射
        </button>
      )}
      {rows.length === 0 && (
        <p className="text-xs text-muted-text">
          尚未映射字段。required 输入是否由其他连接提供会在后端校验中确认。
        </p>
      )}
    </fieldset>
  );
}
type PolicyKey = "decisionPolicy" | "memoryPolicy" | "dataPermissionSnapshot";
function PolicyJsonField({
  label,
  policy,
  disabled,
  onChange,
}: {
  label: string;
  policy: Record<string, unknown>;
  disabled: boolean;
  onChange: (value: Record<string, unknown>) => void;
}) {
  const [invalid, setInvalid] = useState(false);
  return (
    <label className="block text-sm">
      {label}
      <textarea
        aria-label={label}
        readOnly={disabled}
        disabled={disabled}
        value={JSON.stringify(policy, null, 2)}
        onChange={(event) => {
          try {
            const parsed = JSON.parse(event.target.value);
            if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
              throw new Error("object");
            setInvalid(false);
            onChange(parsed as Record<string, unknown>);
          } catch {
            setInvalid(true);
          }
        }}
        className="mt-1 min-h-20 w-full rounded-lg border border-border bg-base p-2 font-mono text-xs disabled:opacity-70"
      />
      {invalid && (
        <p className="mt-1 text-xs text-danger">
          请输入有效的 JSON 对象后再保存。
        </p>
      )}
    </label>
  );
}
type DefaultDataSourceKind = "kline" | "news" | "fundamentals";
const DEFAULT_DATA_SOURCE_CATALOG: StrategyDataSource[] = [
  {
    sourceId: "system_market_data",
    name: "系统自动选择",
    kind: "kline",
    description: "按市场和可用性自动选择行情来源；失败时切换。",
    connectionKey: "system_market_data",
    required: true,
    builtIn: true,
    selectable: true,
    availability: "system_managed",
    selectionMode: "automatic",
    markets: ["cn", "hk", "us"],
  },
  {
    sourceId: "local_stock_daily",
    name: "本地日线库 stock_daily",
    kind: "kline",
    description: "只使用数据库中已经留存的日线数据。",
    connectionKey: "local_stock_daily",
    required: false,
    builtIn: true,
    selectable: true,
    availability: "system_managed",
    selectionMode: "local",
    markets: ["cn", "hk", "us"],
  },
  {
    sourceId: "system_news",
    name: "系统自动选择",
    kind: "news",
    description: "按设置中的新闻渠道顺序检索并自动切换。",
    connectionKey: "system_news",
    required: false,
    builtIn: true,
    selectable: true,
    availability: "system_managed",
    selectionMode: "automatic",
    markets: ["cn", "hk", "us"],
  },
  {
    sourceId: "system_fundamentals",
    name: "按市场自动选择",
    kind: "fundamentals",
    description: "按市场选择现有基本面适配器。",
    connectionKey: "system_fundamentals",
    required: false,
    builtIn: true,
    selectable: true,
    availability: "system_managed",
    selectionMode: "automatic",
    markets: ["cn", "hk", "us"],
  },
  {
    sourceId: "system_sentiment",
    name: "系统情绪与社交信号",
    kind: "other",
    description: "可选的情绪与社交研究输入。",
    connectionKey: "system_sentiment",
    required: false,
    builtIn: true,
    selectable: true,
    availability: "system_managed",
    selectionMode: "automatic",
    markets: ["cn", "hk", "us"],
  },
];

function reconcileDataSourcesForMarket(
  value: Record<string, unknown>,
  catalog: StrategyDataSource[],
  market: string,
) {
  const next: Record<string, unknown> = { ...value, schemaVersion: 2 };
  const resetKinds: DefaultDataSourceKind[] = [];
  for (const kind of ["kline", "news", "fundamentals"] as const) {
    const current =
      value[kind] && typeof value[kind] === "object" && !Array.isArray(value[kind])
        ? (value[kind] as Record<string, unknown>)
        : {};
    const selected = catalog.find(
      (item) => item.kind === kind && item.connectionKey === current.connection,
    );
    if (selected && !dataSourceSupportsMarket(selected, market)) {
      const replacement =
        catalog.find(
          (item) =>
            item.kind === kind &&
            item.selectable &&
            item.selectionMode === "automatic" &&
            dataSourceSupportsMarket(item, market),
        ) ||
        catalog.find(
          (item) =>
            item.kind === kind &&
            item.selectable &&
            dataSourceSupportsMarket(item, market),
        );
      next[kind] = {
        ...current,
        ...(replacement ? { connection: replacement.connectionKey } : {}),
      };
      resetKinds.push(kind);
    }
  }
  const other =
    value.other && typeof value.other === "object" && !Array.isArray(value.other)
      ? (value.other as Record<string, unknown>)
      : {};
  const sourceIds = Array.isArray(other.sourceIds) ? other.sourceIds.map(String) : [];
  const compatibleIds = sourceIds.filter((sourceId) => {
    const item = catalog.find((source) => source.sourceId === sourceId);
    return !item || dataSourceSupportsMarket(item, market);
  });
  const removedOther = sourceIds.filter((sourceId) => !compatibleIds.includes(sourceId));
  if (removedOther.length) {
    next.other = {
      ...other,
      enabled: compatibleIds.length > 0,
      sourceIds: compatibleIds,
    };
  }
  return { value: next, resetKinds, removedOther };
}
const defaultDataSourceDefinitions: Array<{
  kind: DefaultDataSourceKind;
  label: string;
  description: string;
  required: boolean;
}> = [
  {
    kind: "kline",
    label: "K 线与行情",
    description: "选股、策略检查和历史回放的基础输入。",
    required: true,
  },
  {
    kind: "news",
    label: "新闻与资讯",
    description: "用于识别事件、催化和信息风险。",
    required: false,
  },
  {
    kind: "fundamentals",
    label: "基本面",
    description: "用于质量、估值和财务分析。",
    required: false,
  },
];

function dataSourceDefinitionsForRequirements(
  requirements?: StrategyDataRequirement[],
) {
  if (!requirements) return defaultDataSourceDefinitions;
  return defaultDataSourceDefinitions.flatMap((definition) => {
    const matches = requirements.filter(
      (requirement) => requirement.kind === definition.kind,
    );
    if (!matches.length) return [];
    return [
      {
        ...definition,
        required: matches.some((requirement) => requirement.required),
        description: matches
          .map(
            (requirement) =>
              `${requirement.usage}${requirement.required ? "（必需）" : "（可选）"}`,
          )
          .join("；"),
      },
    ];
  });
}

function DataSourceConfiguration({
  value,
  disabled,
  market,
  catalog = DEFAULT_DATA_SOURCE_CATALOG,
  requirements,
  onChange,
}: {
  value: Record<string, unknown>;
  disabled: boolean;
  market: string;
  catalog?: StrategyDataSource[];
  requirements?: StrategyDataRequirement[];
  onChange: (next: Record<string, unknown>) => void;
}) {
  const dataSourceDefinitions =
    dataSourceDefinitionsForRequirements(requirements);
  const otherRequirements = requirements?.filter(
    (requirement) => requirement.kind === "other",
  );
  const showOtherSources = requirements === undefined || Boolean(otherRequirements?.length);
  const otherRequired = Boolean(
    otherRequirements?.some((requirement) => requirement.required),
  );
  const source = (kind: DefaultDataSourceKind | "other") => {
    const current = value[kind];
    return current && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  };
  const update = (
    kind: DefaultDataSourceKind | "other",
    patch: Record<string, unknown>,
  ) =>
    onChange({
      ...value,
      schemaVersion: 2,
      [kind]: { ...source(kind), ...patch },
    });
  const other = source("other");
  const selectedOther = Array.isArray(other.sourceIds)
    ? other.sourceIds.map(String)
    : [];
  const otherSources = catalog.filter(
    (item) =>
      item.kind === "other" &&
      item.selectable &&
      dataSourceSupportsMarket(item, market),
  );
  const selectedItems = selectedOther.map(
    (id) =>
      catalog.find((item) => item.sourceId === id) ||
      ({
        sourceId: id,
        name: `已归档来源 · ${id}`,
        kind: "other",
        connectionKey: id,
        required: false,
        builtIn: false,
        selectable: false,
        availability: "registered",
      } satisfies StrategyDataSource),
  );
  const addOther = (sourceId: string) => {
    if (!sourceId || selectedOther.includes(sourceId)) return;
    const sourceIds = [...selectedOther, sourceId];
    update("other", { enabled: true, sourceIds });
  };
  const removeOther = (sourceId: string) => {
    const sourceIds = selectedOther.filter((id) => id !== sourceId);
    update("other", { enabled: sourceIds.length > 0, sourceIds });
  };
  return (
    <fieldset
      className="rounded-xl border border-border/70 p-4"
      data-testid="strategy-data-source-config"
    >
      <legend className="px-1 text-sm font-semibold text-foreground">
        3. 输入数据来源
      </legend>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-3xl text-xs leading-5 text-secondary-text">
          决定哪些外部数据会在策略内核执行前准备好。是否必需及缺失时的处理方式由当前内核声明；必需来源不能关闭，可选来源可关闭。
          数据不是 Agent。
        </p>
        {disabled ? (
          <span className="shrink-0 text-xs text-muted-text">
            当前为正式版本，只展示已冻结配置
          </span>
        ) : (
          <span className="shrink-0 text-xs text-success">
            草稿中可切换来源
          </span>
        )}
      </div>
      <div className="mt-3 rounded-lg border border-cyan/25 bg-cyan/5 px-3 py-2 text-xs leading-5 text-secondary-text">
        当前策略市场：<span className="font-medium text-foreground">{strategyMarketLabel(market)}</span>
        。以下只显示支持该市场的数据源；切换市场会自动移除不兼容来源。
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {dataSourceDefinitions.map((definition) => {
          const current = source(definition.kind);
          const fallback =
            catalog.find(
              (item) =>
                item.kind === definition.kind &&
                item.selectionMode === "automatic",
            ) ||
            DEFAULT_DATA_SOURCE_CATALOG.find(
              (item) => item.kind === definition.kind,
            )!;
          const enabled = definition.required || current.enabled !== false;
          const connection = String(
            current.connection || fallback.connectionKey,
          );
          const compatibleConnections = catalog.filter(
            (item) =>
              item.kind === definition.kind &&
              dataSourceSupportsMarket(item, market),
          );
          const frozenIncompatible = catalog.find(
            (item) =>
              item.kind === definition.kind &&
              item.connectionKey === connection &&
              !dataSourceSupportsMarket(item, market),
          );
          const connections = frozenIncompatible
            ? [frozenIncompatible, ...compatibleConnections]
            : compatibleConnections;
          const selected =
            connections.find((item) => item.connectionKey === connection) ||
            fallback;
          const automatic = connections.filter(
            (item) =>
              item.selectionMode === "automatic" ||
              item.selectionMode === "local",
          );
          const providers = connections.filter(
            (item) => item.selectionMode === "provider",
          );
          return (
            <div
              key={definition.kind}
              className={`rounded-xl border p-3 ${enabled ? "border-cyan/30 bg-cyan/5" : "border-border/60 bg-base/35"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {definition.label}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-secondary-text">
                    {definition.description}
                  </p>
                </div>
                {definition.required ? (
                  <span className="rounded-full bg-cyan/10 px-2 py-1 text-[11px] font-medium text-cyan">
                    必备
                  </span>
                ) : (
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-secondary-text">
                    <input
                      type="checkbox"
                      aria-label={`启用${definition.label}`}
                      disabled={disabled}
                      checked={enabled}
                      onChange={(event) =>
                        update(definition.kind, {
                          enabled: event.target.checked,
                          connection,
                        })
                      }
                    />
                    启用
                  </label>
                )}
              </div>
              <label className="mt-3 block text-xs text-secondary-text">
                数据路由
                <select
                  aria-label={`${definition.label}连接`}
                  disabled={disabled || !enabled}
                  value={connection}
                  onChange={(event) =>
                    update(definition.kind, {
                      enabled: true,
                      connection: event.target.value,
                      ...(definition.kind === "kline"
                        ? { timeframe: String(current.timeframe || "1d") }
                        : {}),
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-base p-2 text-sm text-foreground disabled:opacity-60"
                >
                  <optgroup label="自动与本地">
                    {automatic.map((option) => (
                      <option
                        key={option.sourceId}
                        value={option.connectionKey}
                      >
                          {option.name}
                          {option.selectionMode === "automatic"
                            ? " · 推荐"
                            : " · 不请求外部"}
                          {dataSourceSupportsMarket(option, market)
                            ? ""
                            : " · 与当前市场不兼容"}
                      </option>
                    ))}
                  </optgroup>
                  {providers.length ? (
                    <optgroup label="指定提供方">
                      {providers.map((option) => (
                        <option
                          key={option.sourceId}
                          value={option.connectionKey}
                          disabled={!option.selectable}
                        >
                          {option.name}
                          {option.selectable ? "" : " · 未配置"}
                          {dataSourceSupportsMarket(option, market)
                            ? ""
                            : " · 与当前市场不兼容"}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
              <div className="mt-2 min-h-14 rounded-lg bg-base/60 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${selected.selectionMode === "provider" ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}
                  >
                    {selected.selectionMode === "provider"
                      ? "已锁定提供方"
                      : selected.selectionMode === "local"
                        ? "仅使用本地"
                        : "自动故障切换"}
                  </span>
                  {selected.markets?.length ? (
                    <span className="text-[11px] text-muted-text">
                      市场：{dataSourceMarketSummary(selected)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs leading-5 text-secondary-text">
                  {selected.description}
                </p>
                {selected.selectionMode === "provider" ? (
                  <p className="mt-1 text-[11px] leading-4 text-warning">
                    指定来源失败时不会自动改用同类提供方。
                  </p>
                ) : null}
                {!dataSourceSupportsMarket(selected, market) ? (
                  <p className="mt-1 text-[11px] leading-4 text-danger">
                    冻结配置与当前市场不兼容；请基于该版本创建草稿后调整。
                  </p>
                ) : null}
              </div>
              {definition.kind === "kline" ? (
                <label className="mt-3 block text-xs text-secondary-text">
                  K 线周期
                  <select
                    aria-label="K 线周期"
                    disabled={disabled}
                    value={String(current.timeframe || "1d")}
                    onChange={(event) =>
                      update("kline", {
                        enabled: true,
                        connection,
                        timeframe: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-border bg-base p-2 text-sm text-foreground disabled:opacity-60"
                  >
                    <option value="1d">日线 · 1d</option>
                  </select>
                </label>
              ) : null}
            </div>
          );
        })}
      </div>
      {showOtherSources ? <div className="mt-3 rounded-xl border border-border/70 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-foreground">其他数据源</p>
              {otherRequired ? (
                <span className="rounded-full bg-cyan/10 px-2 py-1 text-[11px] font-medium text-cyan">
                  必备
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-secondary-text">
              {otherRequirements?.length
                ? otherRequirements
                    .map(
                      (requirement) =>
                        `${requirement.usage}${requirement.required ? "（必需）" : "（可选）"}`,
                    )
                    .join("；")
                : "从“数据中心”目录选择情绪、行业或自定义研究数据；可添加多个。"}
            </p>
          </div>
          <a href="/data" className="shrink-0 text-xs font-medium text-cyan">
            管理数据源目录
          </a>
        </div>
        <label className="mt-3 block text-xs text-secondary-text">
          添加其他来源
          <select
            aria-label="添加其他数据源"
            disabled={disabled || otherSources.length === 0}
            value=""
            onChange={(event) => addOther(event.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-base p-2 text-sm text-foreground disabled:opacity-60"
          >
            <option value="">选择一个已登记的数据源</option>
            {otherSources
              .filter((item) => !selectedOther.includes(item.sourceId))
              .map((item) => (
                <option key={item.sourceId} value={item.sourceId}>
                  {item.name}
                  {item.builtIn ? " · 系统内置" : " · 自定义"}
                  {` · ${dataSourceMarketSummary(item)}`}
                </option>
              ))}
          </select>
        </label>
        {selectedItems.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedItems.map((item) => (
              <span
                key={item.sourceId}
                className={`inline-flex items-center gap-2 rounded-full border bg-base px-3 py-1.5 text-xs ${dataSourceSupportsMarket(item, market) ? "border-border text-secondary-text" : "border-danger/40 text-danger"}`}
              >
                {item.name}
                {!dataSourceSupportsMarket(item, market)
                  ? " · 与当前市场不兼容"
                  : ""}
                {!disabled ? (
                  <button
                    type="button"
                    aria-label={`移除${item.name}`}
                    disabled={otherRequired && selectedOther.length === 1}
                    onClick={() => removeOther(item.sourceId)}
                    className="text-muted-text hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        ) : (
          <p className={`mt-3 text-xs ${otherRequired ? "text-warning" : "text-muted-text"}`}>
            {otherRequired
              ? "当前内核要求至少选择一个其他数据源。"
              : "尚未选择其他来源；不影响已声明的默认来源。"}
          </p>
        )}
      </div> : null}
      <p className="mt-3 text-xs leading-5 text-muted-text">
        “自动选择”保留系统的故障切换能力；“指定提供方”用于可复现实验。未配置密钥的渠道不可选择，运行时仍会记录真实来源和失败原因。
      </p>
    </fieldset>
  );
}

export function AgentWorkflowSelection({
  version,
  purpose = "trading_decision",
  disabled = false,
  workflows = [],
  onChange,
}: {
  version: StrategyVersion;
  purpose?: StrategyPurpose;
  disabled?: boolean;
  workflows?: AgentWorkflowVersion[];
  onChange?: (next: StrategyVersion) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const agents = version.agents.filter((agent) => agent.agentType !== "INPUT");
  const agentTypeNames: Record<Agent["agentType"], string> = {
    INPUT: "历史输入",
    SCREENING: "选股",
    ANALYSIS: "分析",
    DECISION: "决策",
    REFLECTION: "反思",
  };
  const selectedWorkflow = workflows.find(
    (workflow) => workflow.id === version.agentWorkflowVersionId,
  );
  const purposeMeta = purposeDefinition(purpose);
  const compatibleWorkflows = workflows.filter((workflow) =>
    isWorkflowCompatible(workflow, purpose),
  );
  const incompatibleWorkflows = workflows.filter(
    (workflow) => !isWorkflowCompatible(workflow, purpose),
  );
  const selectWorkflow = async (value: string) => {
    if (!value || disabled || !onChange) return;
    setLoading(true);
    setError("");
    try {
      const workflow = await strategyWorkspaceApi.getAgentWorkflowVersion(
        Number(value),
      );
      const contract = workflowOutputContract(workflow);
      if (
        contract !== "UnknownOutput" &&
        contract !== purposeMeta.output
      ) {
        setError(
          `这个工作流输出 ${contract}，不能用于要求 ${purposeMeta.output} 的策略。`,
        );
        return;
      }
      onChange({
        ...version,
        agentWorkflowVersionId: workflow.id,
        agents: workflow.agents,
        connections: workflow.connections,
      });
    } catch {
      setError("无法读取这个工作流版本，请刷新工作流列表后重试。");
    } finally {
      setLoading(false);
    }
  };
  return (
    <fieldset
      className="rounded-xl border border-border/70 p-4"
      data-testid="agent-workflow-selection"
    >
      <legend className="px-1 text-sm font-semibold text-foreground">
        4. 选择已发布工作流
      </legend>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs leading-5 text-secondary-text">
            选择能力中心已经发布的工作流版本。策略中心负责绑定市场、标的、数据和硬约束，不修改工作流内部能力与连接。
          </p>
        </div>
        <a
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-cyan hover:underline"
          href={
            version.agentWorkflowVersionId
              ? `/agents?tab=workflows&view=editor&workflowVersionId=${version.agentWorkflowVersionId}`
              : "/agents?tab=workflows"
          }
        >
          在能力中心查看
          <Network className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
      <label className="mt-4 block text-sm">
        与 {purposeMeta.output} 兼容的工作流
        <select
          aria-label="执行工作流"
          disabled={disabled || loading}
          value={version.agentWorkflowVersionId ?? ""}
          onChange={(event) => void selectWorkflow(event.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-base p-2 disabled:opacity-70"
        >
          {!version.agentWorkflowVersionId ? (
            <option value="">当前版本内嵌组合 · 尚未绑定独立工作流</option>
          ) : null}
          {version.agentWorkflowVersionId && !selectedWorkflow ? (
            <option value={version.agentWorkflowVersionId}>
              已冻结工作流版本 #{version.agentWorkflowVersionId}
            </option>
          ) : null}
          {compatibleWorkflows.length ? (
            <optgroup label={`可输出 ${purposeMeta.output}`}>
              {compatibleWorkflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.workflowName || `工作流 ${workflow.workflowId}`} · V
                  {workflow.versionNumber ?? "—"} · {workflowOutputContract(workflow)}
                </option>
              ))}
            </optgroup>
          ) : null}
          {incompatibleWorkflows.length ? (
            <optgroup label="输出契约不兼容">
              {incompatibleWorkflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id} disabled>
                  {workflow.workflowName || `工作流 ${workflow.workflowId}`} · {workflowOutputContract(workflow)}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        <span
          className={`mt-1 block text-xs leading-5 ${version.agentWorkflowVersionId ? "text-success" : "text-warning"}`}
        >
          {loading
            ? "正在读取工作流快照…"
            : selectedWorkflow
              ? `已选择正式工作流 V${selectedWorkflow.versionNumber ?? "—"}，输出 ${workflowOutputContract(selectedWorkflow)}；保存策略时会冻结该版本及节点快照。`
              : compatibleWorkflows.length
                ? `请选择一个输出 ${purposeMeta.output} 的已发布工作流。`
                : `能力中心还没有输出 ${purposeMeta.output} 的已发布工作流，请先创建并发布。`}
        </span>
        {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : null}
      </label>
      <div className="mt-4 grid gap-3 rounded-xl border border-border/70 bg-base/45 p-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div>
          <p className="text-xs text-muted-text">策略提供</p>
          <p className="mt-1 text-sm text-foreground">市场 · 标的范围 · 数据快照</p>
        </div>
        <ArrowRight className="hidden h-4 w-4 text-muted-text sm:block" aria-hidden="true" />
        <div>
          <p className="text-xs text-muted-text">工作流必须产出</p>
          <code className="mt-1 block text-sm font-medium text-cyan">{purposeMeta.output}</code>
        </div>
      </div>
      {agents.length ? (
        <div
          className="mt-4 flex flex-wrap items-center gap-2"
          aria-label="当前 Agent 组合"
        >
          {agents.map((agent, index) => (
            <div key={agent.id} className="flex items-center gap-2">
              <span className="rounded-full border border-border bg-base px-3 py-1.5 text-xs text-secondary-text">
                <span className="font-medium text-foreground">
                  {agent.name}
                </span>
                <span className="ml-1 text-muted-text">
                  · {agentTypeNames[agent.agentType]}
                </span>
              </span>
              {index < agents.length - 1 ? (
                <span className="text-xs text-muted-text" aria-hidden="true">
                  →
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-secondary-text">
          当前版本没有可展示的工作流快照；请到能力中心准备并发布工作流。
        </p>
      )}
    </fieldset>
  );
}
/** The persisted policy fields intentionally stay definition-only; no runtime controls live here. */
export function StrategyConfigurationPanel({
  version,
  disabled,
  dataSources = DEFAULT_DATA_SOURCE_CATALOG,
  workflows = [],
  onCreateDraft,
  onChange,
}: {
  version: StrategyVersion;
  disabled: boolean;
  dataSources?: StrategyDataSource[];
  workflows?: AgentWorkflowVersion[];
  onCreateDraft?: () => void;
  onChange: (next: StrategyVersion) => void;
}) {
  const risk = version.riskPolicy || {};
  const [marketChangeNotice, setMarketChangeNotice] = useState("");
  const validity = (risk.decision_validity || risk.decisionValidity) as
    Record<string, unknown> | undefined;
  const updateRisk = (patch: Record<string, unknown>) =>
    onChange({ ...version, riskPolicy: { ...risk, ...patch } });
  const updatePolicy = (key: PolicyKey, value: Record<string, unknown>) =>
    onChange({ ...version, [key]: value });
  const screening = version.screeningPolicy || {
    strategy: "dual_low",
    market: "cn",
    maxCandidates: 3,
  };
  const updateScreening = (patch: Partial<typeof screening>) =>
    onChange({ ...version, screeningPolicy: { ...screening, ...patch } });
  const marketScope = version.marketScope || {};
  const purpose = version.strategyPurpose || "trading_decision";
  const purposeMeta = purposeDefinition(purpose);
  const strategyPackage = version.strategyPackage;
  const configurableMarkets = strategyPackage?.configurable.markets?.length
    ? strategyPackage.configurable.markets
    : ["cn", "hk", "us"];
  const configurableTimeframes = strategyPackage?.configurable.timeframes || [];
  const configurableIntervals = strategyPackage?.configurable.runIntervals || [];
  const packageParameterValues =
    version.decisionPolicy?.packageParameters &&
    typeof version.decisionPolicy.packageParameters === "object"
      ? (version.decisionPolicy.packageParameters as Record<string, unknown>)
      : {};
  const fixedSymbolValues = Array.isArray(marketScope.symbols)
    ? marketScope.symbols.map(String).filter(Boolean)
    : [];
  const rawScopeMode = String(marketScope.universeMode || "").toLowerCase();
  const scopeMode =
    rawScopeMode === "runtime_symbol"
      ? "runtime_symbol"
      : rawScopeMode === "fixed" || fixedSymbolValues.length
        ? "fixed"
        : "screening";
  const fixedSymbols = fixedSymbolValues.join(", ");
  const updateMarketScope = (patch: Record<string, unknown>) =>
    onChange({ ...version, marketScope: { ...marketScope, ...patch } });
  const selectedKernel = workflows.find(
    (workflow) => workflow.id === version.agentWorkflowVersionId,
  );
  const kernelName = selectedKernel?.workflowName
    ? selectedKernel.workflowName.replace(/工作流/g, "策略内核")
    : version.agentWorkflowVersionId
      ? `冻结内核 #${version.agentWorkflowVersionId}`
      : "历史内嵌策略内核";
  const changeMarket = (market: string) => {
    const reconciled = reconcileDataSourcesForMarket(
      version.dataPermissionSnapshot || {},
      dataSources,
      market,
    );
    const clearedFixedSymbols = scopeMode === "fixed" && fixedSymbolValues.length > 0;
    onChange({
      ...version,
      screeningPolicy: { ...screening, market },
      dataPermissionSnapshot: reconciled.value,
      marketScope: clearedFixedSymbols
        ? { ...marketScope, symbols: [] }
        : marketScope,
    });
    const changes = [
      reconciled.resetKinds.length
        ? `已将 ${reconciled.resetKinds.map((kind) => defaultDataSourceDefinitions.find((item) => item.kind === kind)?.label || kind).join("、")} 切换为兼容来源`
        : "",
      reconciled.removedOther.length
        ? `已移除 ${reconciled.removedOther.length} 个不兼容的其他来源`
        : "",
      clearedFixedSymbols ? "已清空原市场的固定股票代码" : "",
    ].filter(Boolean);
    setMarketChangeNotice(
      changes.length
        ? `${strategyMarketLabel(market)}已应用：${changes.join("；")}。`
        : `${strategyMarketLabel(market)}已应用，当前数据源均兼容。`,
    );
  };
  return (
    <Card
      variant="bordered"
      padding="lg"
      data-testid="strategy-configuration-panel"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-medium text-cyan">运行配置</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">
            配置完整策略
          </h2>
          <p className="mt-1 text-sm leading-6 text-secondary-text">
            当前内核是只读依赖。这里的市场、研究范围、数据源、周期、参数和平台级边界会作为独立配置保存。
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${disabled ? "bg-muted text-secondary-text" : "bg-primary/10 text-primary"}`}
        >
          {disabled ? "正式版本 · 已冻结" : "草稿 · 自动保存"}
        </span>
      </div>
      <p className="mt-4 text-xs leading-5 text-muted-text">
        策略内核 <span aria-hidden="true">+</span> 研究范围{" "}
        <span aria-hidden="true">→</span> 数据源绑定{" "}
        <span aria-hidden="true">→</span> 运行参数{" "}
        <span aria-hidden="true">→</span> 风险边界{" "}
        <span aria-hidden="true">=</span> 完整策略版本
      </p>
      {disabled ? (
        <div
          role="status"
          className="mt-4 flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm leading-6 text-warning">
            当前是已发布的正式版本，以下控件只展示冻结配置，不能直接切换。
          </p>
          {onCreateDraft ? (
            <button
              type="button"
              className="btn-secondary shrink-0"
              onClick={onCreateDraft}
            >
              创建配置草稿后调整
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="mt-5 space-y-4">
        <fieldset className="rounded-xl border border-border/70 p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            1. 输出契约
          </legend>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-secondary-text">
            输出契约由策略包决定，不能在网站内把它改造成另一种策略类型。
          </p>
          <div className="mt-4 grid gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="text-sm font-semibold text-foreground">{purposeMeta.label}</p>
              <p className="mt-1 text-xs leading-5 text-secondary-text">{purposeMeta.description}</p>
            </div>
            <div className="text-left sm:text-right">
              <code className="text-sm font-medium text-primary">{purposeMeta.output}</code>
              <p className="mt-1 text-xs text-muted-text">消费入口：{purposeMeta.destination}</p>
            </div>
          </div>
        </fieldset>
        <fieldset className="rounded-xl border border-border/70 p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            2. 研究对象与股票范围
          </legend>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-secondary-text">
            {purpose === "research_report"
              ? "研究报告策略在运行时接收一只股票，也可以提前固定一只；策略只处理这个范围内的数据。"
              : "这一层先决定哪些股票有资格进入策略。固定股票会在最前面排除其他标的；动态候选只负责缩小范围。"}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              市场
              <select
                aria-label="选股市场"
                disabled={disabled}
                value={screening.market}
                onChange={(event) => changeMarket(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-base p-2 disabled:opacity-70"
              >
                {configurableMarkets.map((market) => <option key={market} value={market}>{strategyMarketLabel(market)}</option>)}
              </select>
              <span className="mt-1 block text-xs leading-5 text-muted-text">
                同时约束可用行情来源和股票代码范围。
              </span>
            </label>
            <label className="block text-sm">
              {purpose === "research_report" ? "研究标的来源" : "候选股票来源"}
              <select
                aria-label="股票池来源"
                disabled={disabled}
                value={scopeMode}
                onChange={(event) =>
                  updateMarketScope(
                    event.target.value === "fixed"
                      ? { universeMode: "fixed", symbols: [] }
                      : event.target.value === "runtime_symbol"
                        ? { universeMode: "runtime_symbol", symbols: [] }
                        : { universeMode: "screening", symbols: [] },
                  )
                }
                className="mt-1 w-full rounded-lg border border-border bg-base p-2 disabled:opacity-70"
              >
                {purpose === "research_report" ? (
                  <>
                    <option value="runtime_symbol">运行时选择一只股票</option>
                    <option value="fixed">固定指定一只股票</option>
                  </>
                ) : (
                  <>
                    <option value="screening">系统动态筛选候选股票</option>
                    <option value="fixed">固定指定一个或多个股票</option>
                  </>
                )}
              </select>
              <span className="mt-1 block text-xs leading-5 text-muted-text">
                选择后会随 StrategyVersion 保存并在发布时冻结。
              </span>
            </label>
            {scopeMode === "fixed" ? (
              <div className="sm:col-span-2">
                <label className="block text-sm">
                  指定股票代码
                  <input
                    aria-label="策略固定股票代码"
                    disabled={disabled}
                    value={fixedSymbols}
                    onChange={(event) =>
                      updateMarketScope({
                        universeMode: "fixed",
                        symbols: event.target.value
                          .split(/[\s,，]+/)
                          .map((item) => item.trim().toUpperCase())
                          .filter(Boolean)
                          .slice(0, purpose === "research_report" ? 1 : undefined),
                      })
                    }
                    placeholder="例如 600519, 000001, AAPL"
                    className="mt-1 w-full rounded-lg border border-border bg-base p-2 disabled:opacity-70"
                  />
                  <span className="mt-1 block text-xs leading-5 text-muted-text">
                    {purpose === "research_report"
                      ? "研究报告策略固定一个代码；也可以切换为运行时选择。"
                      : "可输入一个或多个代码，用逗号或空格分隔。检查策略时会确认这些股票在所选 K 线输入中存在。"}
                  </span>
                </label>
                {fixedSymbolValues.length ? (
                  <div
                    aria-label="已指定股票"
                    className="mt-3 flex flex-wrap gap-2"
                  >
                    {fixedSymbolValues.map((symbol) => (
                      <span
                        key={symbol}
                        className="rounded-full border border-border bg-base px-2.5 py-1 text-xs text-secondary-text"
                      >
                        {symbol}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : scopeMode === "screening" ? (
              <>
                <label className="block text-sm">
                  前置筛选规则
                  <input
                    aria-label="选股策略"
                    disabled={disabled}
                    value={screening.strategy}
                    onChange={(event) =>
                      updateScreening({ strategy: event.target.value })
                    }
                    placeholder="例如 dual_low"
                    className="mt-1 w-full rounded-lg border border-border bg-base p-2 disabled:opacity-70"
                  />
                  <span className="mt-1 block text-xs leading-5 text-muted-text">
                    系统筛选引擎的规则标识，用于在 Agent 运行前产生候选。
                  </span>
                </label>
                <label className="block text-sm">
                  每批最多进入 Agent 的股票数
                  <input
                    aria-label="每批研究候选数"
                    disabled={disabled}
                    min={1}
                    max={10}
                    type="number"
                    value={screening.maxCandidates}
                    onChange={(event) =>
                      updateScreening({
                        maxCandidates: Math.max(
                          1,
                          Math.min(10, Number(event.target.value) || 1),
                        ),
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-border bg-base p-2 disabled:opacity-70"
                  />
                  <span className="mt-1 block text-xs leading-5 text-muted-text">
                    范围为 1–10，只限制单批研究规模。
                  </span>
                </label>
                <p className="text-xs leading-5 text-warning sm:col-span-2">
                  历史回测使用动态候选时，必须有对应历史时点的股票池；数据不足会明确停止，不会用今天的股票名单倒推历史。
                </p>
              </>
            ) : (
              <div className="rounded-lg border border-border/70 bg-base/45 px-3 py-3 text-xs leading-5 text-secondary-text sm:col-span-2">
                每次从单股研究页启动时选择一只股票；StrategyVersion 只冻结市场、数据源与策略内核，不提前绑定股票代码。
              </div>
            )}
          </div>
          {marketChangeNotice ? (
            <p role="status" className="mt-3 text-xs leading-5 text-success">
              {marketChangeNotice}
            </p>
          ) : null}
        </fieldset>
        <DataSourceConfiguration
          value={version.dataPermissionSnapshot || {}}
          disabled={disabled}
          market={String(screening.market || "cn")}
          catalog={dataSources}
          requirements={strategyPackage?.dataRequirements}
          onChange={(value) => updatePolicy("dataPermissionSnapshot", value)}
        />
        <fieldset className="rounded-xl border border-border/70 p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">4. 运行参数</legend>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-secondary-text">
            策略内核只声明允许调整的范围；这里保存本次策略版本实际使用的周期、运行频率和参数值。
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">观察与计算周期
              {configurableTimeframes.length ? <select aria-label="观察与计算周期" disabled={disabled} value={version.timeHorizon || configurableTimeframes[0]} onChange={(event) => onChange({ ...version, timeHorizon: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-base p-2 disabled:opacity-70">{configurableTimeframes.map((timeframe) => <option key={timeframe} value={timeframe}>{timeframe}</option>)}</select> : <input aria-label="观察与计算周期" disabled={disabled} value={version.timeHorizon || ""} onChange={(event) => onChange({ ...version, timeHorizon: event.target.value })} placeholder="例如 1d" className="mt-1 w-full rounded-lg border border-border bg-base p-2 disabled:opacity-70" />}
              <span className="mt-1 block text-xs leading-5 text-muted-text">决定策略读取和计算数据的时间粒度。</span>
            </label>
            <label className="block text-sm">运行频率
              {configurableIntervals.length ? <select aria-label="策略运行频率" disabled={disabled} value={String(version.decisionPolicy?.runInterval || configurableIntervals[0])} onChange={(event) => updatePolicy("decisionPolicy", { ...version.decisionPolicy, runInterval: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-base p-2 disabled:opacity-70">{configurableIntervals.map((interval) => <option key={interval} value={interval}>{interval}</option>)}</select> : <input aria-label="策略运行频率" disabled={disabled} value={String(version.decisionPolicy?.runInterval || "")} onChange={(event) => updatePolicy("decisionPolicy", { ...version.decisionPolicy, runInterval: event.target.value })} placeholder="例如 1d" className="mt-1 w-full rounded-lg border border-border bg-base p-2 disabled:opacity-70" />}
              <span className="mt-1 block text-xs leading-5 text-muted-text">表示多久产生一次研究结果或决策提案，不代表持续交易。</span>
            </label>
            {strategyPackage?.parameters.map((parameter) => {
              const value = packageParameterValues[parameter.name] ?? parameter.default ?? "";
              const updateParameter = (next: unknown) => updatePolicy("decisionPolicy", { ...version.decisionPolicy, packageParameters: { ...packageParameterValues, [parameter.name]: next } });
              return <label key={parameter.name} className="block text-sm">{parameter.description || parameter.name}
                {parameter.type === "boolean" ? <select aria-label={`策略参数 ${parameter.name}`} disabled={disabled} value={String(Boolean(value))} onChange={(event) => updateParameter(event.target.value === "true")} className="mt-1 w-full rounded-lg border border-border bg-base p-2 disabled:opacity-70"><option value="true">是</option><option value="false">否</option></select> : parameter.enum?.length ? <select aria-label={`策略参数 ${parameter.name}`} disabled={disabled} value={String(value)} onChange={(event) => updateParameter(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-base p-2 disabled:opacity-70">{parameter.enum.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select> : <input aria-label={`策略参数 ${parameter.name}`} disabled={disabled} type={parameter.type === "integer" || parameter.type === "number" ? "number" : "text"} min={parameter.minimum} max={parameter.maximum} step={parameter.type === "integer" ? 1 : "any"} value={String(value)} onChange={(event) => updateParameter(parameter.type === "integer" || parameter.type === "number" ? Number(event.target.value) : event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-base p-2 disabled:opacity-70" />}
                <span className="mt-1 block font-mono text-[11px] text-muted-text">{parameter.name}{parameter.required ? " · 必填" : ""}</span>
              </label>;
            })}
          </div>
        </fieldset>
        <fieldset className="rounded-xl border border-border/70 p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">5. 策略内核</legend>
          <div className="mt-1 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div>
              <p className="text-sm font-medium text-foreground">{strategyPackage ? `${strategyPackage.fileName} · ${strategyPackage.declaredVersion}` : kernelName}</p>
              <p className="mt-1 text-xs leading-5 text-secondary-text">
                {strategyPackage?.kind === "uploaded_package" ? "外部生成的规则、工具和模型逻辑作为一个 Python 内核整体保存；网站只配置它公开的输入、参数和运行边界。" : strategyPackage?.kind === "builtin_python" ? "现有成熟链路已经包装为统一的 Python 函数入口，与上传内核遵循相同输入、输出和依赖契约。" : "内部规则、工具、Prompt 和模型步骤随版本整体保存。策略中心不要求你理解或重新连接这些内部节点。"}
              </p>
            </div>
            <span className="rounded-md border border-border bg-base px-2.5 py-1 text-xs text-muted-text">
              {strategyPackage ? `${strategyPackage.runtime} · ${strategyPackage.entrypoint}` : `${version.agents.length} 个内部步骤 · ${version.connections.length} 条依赖`}
            </span>
          </div>
          {strategyPackage?.executionStatus !== undefined && strategyPackage.executionStatus !== "ready" ? <p role="note" className="mt-3 text-xs leading-5 text-warning">这个内核来自旧协议，尚未通过当前受限执行器的可调用检查。请按最新生成指南重新生成并上传。</p> : null}
          {strategyPackage?.dataRequirements.length ? <div className="mt-4 overflow-hidden rounded-lg border border-border/70"><div className="hidden grid-cols-[minmax(120px,0.7fr)_88px_minmax(0,1.3fr)] bg-base/70 px-3 py-2 text-[11px] font-medium text-muted-text sm:grid"><span>数据依赖</span><span>缺失行为</span><span>来源与用途</span></div>{strategyPackage.dataRequirements.map((requirement) => <div key={requirement.id} className="grid gap-1 border-t border-border/70 px-3 py-2.5 text-xs first:border-t-0 sm:grid-cols-[minmax(120px,0.7fr)_88px_minmax(0,1.3fr)] sm:gap-2 sm:first:border-t"><span className="font-medium text-foreground">{requirement.id}</span><span className={requirement.required ? "text-warning" : "text-secondary-text"}>{requirement.required ? "停止" : "降级"}</span><span className="min-w-0 break-words text-secondary-text">{requirement.sourceIds.join(" / ")} · {requirement.usage}</span></div>)}</div> : null}
        </fieldset>
        {purpose === "trading_decision" ? (
        <fieldset className="rounded-xl border border-border/70 p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            6. 决策边界
          </legend>
          <p className="mt-1 text-xs leading-5 text-secondary-text">
            这些是策略内核必须遵守的平台级硬约束，不由内部 Prompt 自由解释。
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block text-sm">
              最大单只股票权重（0–1）
              <input
                aria-label="最大单资产权重"
                disabled={disabled}
                value={String(
                  risk.max_asset_weight ?? risk.maxAssetWeight ?? "",
                )}
                onChange={(event) => {
                  const value = event.target.value.trim();
                  updateRisk(
                    value
                      ? { max_asset_weight: Number(value) }
                      : { max_asset_weight: undefined },
                  );
                }}
                inputMode="decimal"
                placeholder="例如 0.20"
                className="mt-1 w-full rounded-lg border border-border bg-base p-2 disabled:opacity-70"
              />
              <span className="mt-1 block text-xs leading-5 text-muted-text">
                0.20 表示单只股票最多占策略资金的 20%。
              </span>
            </label>
            <label className="block text-sm">
              决策有效期
              <input
                aria-label="决策有效期"
                disabled={disabled}
                value={String(validity?.max ?? "")}
                onChange={(event) =>
                  updateRisk({
                    decision_validity: {
                      ...(validity || {}),
                      max: event.target.value,
                    },
                  })
                }
                placeholder="例如 1d"
                className="mt-1 w-full rounded-lg border border-border bg-base p-2 disabled:opacity-70"
              />
              <span className="mt-1 block text-xs leading-5 text-muted-text">
                发布必填。1d 表示建议最多有效一天，过期后必须重新分析。
              </span>
            </label>
          </div>
        </fieldset>
        ) : (
          <section className="rounded-xl border border-border/70 p-4" aria-labelledby="strategy-output-boundary">
            <h3 id="strategy-output-boundary" className="text-sm font-semibold text-foreground">6. 产出边界</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <div>
                <p className="text-xs text-muted-text">策略终点</p>
                <code className="mt-1 block text-sm font-medium text-cyan">{purposeMeta.output}</code>
              </div>
              <ArrowRight className="hidden h-4 w-4 text-muted-text sm:block" aria-hidden="true" />
              <div>
                <p className="text-xs text-muted-text">明确不会继续</p>
                <p className="mt-1 text-sm text-foreground">不会生成交易决策、订单或持仓</p>
              </div>
            </div>
          </section>
        )}
        <details className="rounded-xl border border-border/70 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">
            7. 高级策略参数
          </summary>
          <p className="mt-2 text-xs leading-5 text-secondary-text">
            仅在需要配置结构化决策规则或跨次运行记忆时编辑。一般策略可保持默认空对象。
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <PolicyJsonField
              label="决策策略 JSON"
              policy={version.decisionPolicy || {}}
              disabled={disabled}
              onChange={(value) => updatePolicy("decisionPolicy", value)}
            />
            <PolicyJsonField
              label="记忆策略 JSON"
              policy={version.memoryPolicy || {}}
              disabled={disabled}
              onChange={(value) => updatePolicy("memoryPolicy", value)}
            />
          </div>
        </details>
      </div>
    </Card>
  );
}
export function StrategyValidationSummary({
  validation,
  purpose = "trading_decision",
  publishBlocked = false,
  onIssueSelect,
}: {
  validation: ValidationResult;
  purpose?: StrategyPurpose;
  publishBlocked?: boolean;
  onIssueSelect?: (issue: ValidationResult["errors"][number]) => void;
}) {
  return (
    <div className="space-y-2" aria-live="polite">
      {validation.valid && validation.warnings.length === 0 ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          {publishBlocked
            ? "策略结构与配置检查已通过，但当前内核尚未通过受限执行器的可调用检查；请按最新指南重新上传。"
            : purpose === "trading_decision"
            ? "策略检查已通过。你可以选择运行回测，也可以直接正式发布。"
            : `策略检查已通过，工作流输出与 ${purposeDefinition(purpose).output} 契约兼容，可以正式发布。`}
        </div>
      ) : null}
      {validation.errors.map((x, i) => (
        <button
          type="button"
          key={`${x.code}-${i}`}
          onClick={() => onIssueSelect?.(x)}
          className="flex w-full items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-left text-sm text-danger"
        >
          <X className="h-4 w-4 shrink-0" aria-hidden="true" />
          {x.message}
        </button>
      ))}
      {validation.warnings.map((x, i) => (
        <div
          key={`${x.code}-${i}`}
          className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {x.message}
        </div>
      ))}
    </div>
  );
}
export default function StrategyEditorPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const versionId = Number(params.get("versionId"));
  const [version, setVersion] = useState<StrategyVersion>();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string>();
  const [selectedEdge, setSelectedEdge] = useState<string>();
  const [dragSource, setDragSource] = useState<string>();
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [workflows, setWorkflows] = useState<AgentWorkflowVersion[]>([]);
  const [dataSources, setDataSources] = useState<StrategyDataSource[]>(
    DEFAULT_DATA_SOURCE_CATALOG,
  );
  const [query, setQuery] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("CLEAN");
  const [validation, setValidation] = useState<ValidationResult>();
  const [historicalValidation, setHistoricalValidation] =
    useState<StrategyValidationVersionStatus>();
  const [historicalValidationLoading, setHistoricalValidationLoading] =
    useState(false);
  const [error, setError] = useState("");
  const [diff, setDiff] = useState<VersionDiff>();
  const [showPublish, setShowPublish] = useState(false);
  const [changeLog, setChangeLog] = useState("");
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const [conflict, setConflict] = useState<{
    serverRevision?: number;
    serverUpdatedAt?: string;
  } | null>(null);
  const [showConflictDiff, setShowConflictDiff] = useState(false);
  const [deleteImpact, setDeleteImpact] = useState<StrategyDeletionImpact>();
  const [checkingDelete, setCheckingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const latest = useRef<StrategyVersion | undefined>(undefined);
  const saving = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!versionId) return;
    void Promise.all([
      strategyWorkspaceApi.getVersion(versionId),
      strategyWorkspaceApi.listAgentTemplates(),
      strategyWorkspaceApi.getValidationStatus(versionId),
      strategyWorkspaceApi.listPublishedAgentWorkflowVersions(false),
      strategyWorkspaceApi
        .listDataSources()
        .catch(() => DEFAULT_DATA_SOURCE_CATALOG),
    ])
      .then(([v, t, historical, workflowVersions, sources]) => {
        setVersion(v);
        latest.current = v;
        setSelected(v.agents.find((agent) => agent.agentType !== "INPUT")?.id);
        setTemplates(t);
        setDataSources(sources);
        setHistoricalValidation(historical);
        setWorkflows(workflowVersions);
        setSaveState(
          v.immutable || v.status !== "DRAFT" ? "READ_ONLY" : "CLEAN",
        );
        return strategyWorkspaceApi.getStrategy(v.strategyId);
      })
      .then((s) => setName(s.name))
      .catch(() => setError("无法加载策略版本。"));
  }, [versionId]);
  const readonly = !version || version.immutable || version.status !== "DRAFT";
  const selectedAgent = version?.agents.find((a) => a.id === selected);
  const selectedConnection = version?.connections.find(
    (c) => c.id === selectedEdge,
  );
  const setDraft = (next: StrategyVersion) => {
    if (readonly) return;
    latest.current = next;
    setVersion(next);
    setSaveState("DIRTY");
    setValidation(undefined);
    setHistoricalValidation(undefined);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(next), 700);
  };
  const save = async (next = latest.current) => {
    if (!next || readonly || saving.current || saveState === "CONFLICT") return;
    let needsFollowup = false;
    saving.current = true;
    setSaveState("SAVING");
    try {
      const result = await strategyWorkspaceApi.saveDraft(next, { name });
      needsFollowup = latest.current !== next;
      latest.current =
        needsFollowup && latest.current
          ? mergeSavedRevision(latest.current, result.draft)
          : result.draft;
      setVersion(latest.current);
      setSaveState(needsFollowup ? "DIRTY" : "SAVED");
    } catch (err) {
      const detail = isAxiosError(err)
        ? (
            err.response?.data as {
              detail?: {
                code?: string;
                details?: { serverRevision?: number; serverUpdatedAt?: string };
              };
            }
          )?.detail
        : undefined;
      if (detail?.code === "VERSION_CONFLICT") {
        setSaveState("CONFLICT");
        setConflict(detail.details || {});
      } else {
        setSaveState("SAVE_FAILED");
        setError("保存失败。本地修改仍保留，可手动重试。");
      }
    } finally {
      saving.current = false;
      if (needsFollowup) window.setTimeout(() => void save(latest.current), 0);
    }
  };
  const addTemplate = async (template: AgentTemplate) => {
    if (readonly) return;
    try {
      const detail = await strategyWorkspaceApi.getAgentTemplate(
        template.templateId,
      );
      const agent = agentFromTemplate(detail);
      setSelected(agent.id);
      setSelectedEdge(undefined);
      setDraft({ ...version!, agents: [...version!.agents, agent] });
    } catch {
      setError("无法读取 Agent 模板。");
    }
  };
  const removeAgent = (id: string) => {
    if (!version || readonly) return;
    const affected = version.connections.filter(
      (c) => c.sourceAgentId === id || c.targetAgentId === id,
    ).length;
    if (!window.confirm(`删除该 Agent 将同时删除 ${affected} 条关联连接。`))
      return;
    setSelected(undefined);
    setDraft({
      ...version,
      agents: version.agents.filter((a) => a.id !== id),
      connections: version.connections.filter(
        (c) => c.sourceAgentId !== id && c.targetAgentId !== id,
      ),
    });
  };
  const connect = (sourceId: string, targetId: string) => {
    if (!version || readonly) return;
    const source = version.agents.find((agent) => agent.id === sourceId),
      target = version.agents.find((agent) => agent.id === targetId);
    if (!source || !target) return setError("连接目标不存在。");
    const connectionType = inferConnectionType(source, target);
    const message = isValidAgentConnection(source, target, connectionType);
    if (message) return setError(message);
    if (
      findDuplicateConnection(version.connections, {
        sourceAgentId: sourceId,
        targetAgentId: targetId,
        connectionType,
      })
    )
      return setError("这条连接已经存在。");
    const connection: Connection = {
      id: crypto.randomUUID(),
      sourceAgentId: sourceId,
      targetAgentId: targetId,
      connectionType,
      fieldMapping: {},
    };
    setSelectedEdge(connection.id);
    setSelected(undefined);
    setDraft({ ...version, connections: [...version.connections, connection] });
  };
  const updateEdge = (patch: Partial<Connection>) => {
    if (!version || !selectedConnection || readonly) return;
    const next = { ...selectedConnection, ...patch };
    const source = version.agents.find((a) => a.id === next.sourceAgentId),
      target = version.agents.find((a) => a.id === next.targetAgentId);
    if (!source || !target) return;
    const message = isValidAgentConnection(source, target, next.connectionType);
    if (message) {
      setError(message);
      return;
    }
    setDraft({
      ...version,
      connections: version.connections.map((c) =>
        c.id === next.id ? next : c,
      ),
    });
  };
  const validate = async () => {
    if (!version) return;
    setError("");
    try {
      setValidation(await strategyWorkspaceApi.validate(version.id));
    } catch {
      setError("检查策略失败。");
    }
  };
  const publish = async () => {
    if (!version || !changeLog.trim())
      return setError("发布必须填写版本变更说明。");
    setHistoricalValidationLoading(true);
    setError("");
    try {
      let validationExperimentId: number | undefined;
      try {
        const latestHistorical = await strategyWorkspaceApi.getValidationStatus(
          version.id,
        );
        setHistoricalValidation(latestHistorical);
        if (
          (latestHistorical.status === "completed" ||
            latestHistorical.status === "validated") &&
          latestHistorical.latestCompletedExperimentId
        )
          validationExperimentId = latestHistorical.latestCompletedExperimentId;
      } catch {
        setHistoricalValidation(undefined);
      }
      const latestValidation = await strategyWorkspaceApi.validate(version.id);
      setValidation(latestValidation);
      if (latestValidation.errors.length)
        return setError("请先修复策略校验错误。");
      if (latestValidation.warnings.some((w) => !ack[w.code]))
        return setError("请确认全部发布警告。");
      await strategyWorkspaceApi.publish(
        version.id,
        version.revision,
        changeLog,
        Object.keys(ack).filter((key) => ack[key]),
        validationExperimentId,
      );
      const published = await strategyWorkspaceApi.getVersion(version.id);
      latest.current = published;
      setVersion(published);
      setSaveState("READ_ONLY");
      setShowPublish(false);
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data as { detail?: { message?: string } })?.detail
            ?.message
        : undefined;
      setError(message || "发布失败，请检查当前草稿 revision 和策略检查结果。");
    } finally {
      setHistoricalValidationLoading(false);
    }
  };
  const openPublish = async () => {
    if (!version) return;
    setShowPublish(true);
    setHistoricalValidationLoading(true);
    try {
      setHistoricalValidation(
        await strategyWorkspaceApi.getValidationStatus(version.id),
      );
    } catch {
      setError("无法读取当前版本的历史验证状态。");
    } finally {
      setHistoricalValidationLoading(false);
    }
  };
  const createDraftFromPublished = async () => {
    if (!version || !readonly) return;
    setError("");
    try {
      const draft = await strategyWorkspaceApi.createDraft(
        version.strategyId,
        version.id,
      );
      navigate(
        `/strategies/${version.strategyId}/editor?versionId=${draft.id}`,
      );
    } catch {
      setError("无法基于当前正式版本创建草稿，请稍后重试。");
    }
  };
  const removeStrategy = async (confirmed: boolean) => {
    if (!version) return;
    setDeleting(true);
    setError("");
    try {
      await strategyWorkspaceApi.deleteStrategy(version.strategyId, confirmed);
      setDeleteImpact(undefined);
      navigate("/strategies", { replace: true });
    } catch (cause) {
      setError(toApiErrorMessage(cause, "删除策略失败，请刷新后重试。"));
    } finally {
      setDeleting(false);
    }
  };
  const requestDelete = async () => {
    if (!version) return;
    setCheckingDelete(true);
    setError("");
    try {
      const impact = await strategyWorkspaceApi.getDeletionImpact(
        version.strategyId,
      );
      if (impact.requiresConfirmation) setDeleteImpact(impact);
      else await removeStrategy(false);
    } catch (cause) {
      setError(
        toApiErrorMessage(cause, "无法确认删除影响，未删除该策略。请重试。"),
      );
    } finally {
      setCheckingDelete(false);
    }
  };
  const showDiff = async () => {
    if (!version?.basedOnVersionId)
      return setError("此版本没有可比较的来源版本。");
    try {
      setDiff(
        await strategyWorkspaceApi.diff(version.id, version.basedOnVersionId),
      );
    } catch {
      setError("无法读取版本差异。");
    }
  };
  const loadServer = async () => {
    if (
      !version ||
      !window.confirm("加载服务器版本会替换当前未保存的本地修改。")
    )
      return;
    try {
      const server = await strategyWorkspaceApi.getVersion(version.id);
      latest.current = server;
      setVersion(server);
      setConflict(null);
      setSaveState("CLEAN");
    } catch {
      setError("无法加载服务器版本。");
    }
  };
  const conflictDiff = async () => {
    if (!version) return;
    try {
      setDiff(
        await strategyWorkspaceApi.diffPreview(version.id, latest.current!),
      );
      setShowConflictDiff(true);
    } catch {
      setError("无法比较本地与服务器版本。");
    }
  };
  const forkLocal = async () => {
    if (!version || !latest.current) return;
    const newName = window.prompt("新策略名称", `${name}—本地副本`);
    if (!newName?.trim()) return;
    try {
      const result = await strategyWorkspaceApi.forkLocal(
        version.id,
        buildForkLocalRequest(latest.current, newName, crypto.randomUUID()),
      );
      navigate(
        `/strategies/${result.newStrategyId}/editor?versionId=${result.newDraftVersionId}`,
      );
    } catch {
      setError("复制本地内容失败；本地修改仍保留。");
    }
  };
  const errorsFor = (id: string) =>
    validation?.errors.filter(
      (x) => x.agent_ids?.includes(id) || x.connection_ids?.includes(id),
    ) ?? [];
  if (error && !version)
    return (
      <AppPage>
        <Card variant="bordered" padding="lg">
          {error}
        </Card>
      </AppPage>
    );
  if (!version)
    return (
      <AppPage>
        <Card variant="bordered" padding="lg">
          正在加载策略草稿…
        </Card>
      </AppPage>
    );
  const deleteBusy = checkingDelete || deleting;
  const strategyPurpose = version.strategyPurpose || "trading_decision";
  const strategyPurposeMeta = purposeDefinition(strategyPurpose);
  const hasFrozenReplayUniverse = Array.isArray(version.marketScope?.symbols)
    && version.marketScope.symbols.map(String).some(Boolean);
  const packageExecutionReady = !version.strategyPackage || version.strategyPackage.executionStatus === "ready";
  const legacyInputIds = new Set(
    version.agents
      .filter((agent) => agent.agentType === "INPUT")
      .map((agent) => agent.id),
  );
  const strategyAgents = version.agents.filter(
    (agent) => agent.agentType !== "INPUT",
  );
  const strategyConnections = version.connections.filter(
    (connection) =>
      !legacyInputIds.has(connection.sourceAgentId) &&
      !legacyInputIds.has(connection.targetAgentId),
  );
  const migrateLegacyInput = () => {
    if (readonly || legacyInputIds.size === 0) return;
    const dataConfig = Object.keys(version.dataPermissionSnapshot || {}).length
      ? version.dataPermissionSnapshot
      : {
          schemaVersion: 2,
          kline: {
            enabled: true,
            connection: "system_market_data",
            timeframe: "1d",
          },
          news: { enabled: true, connection: "system_news" },
          fundamentals: { enabled: true, connection: "system_fundamentals" },
          other: { enabled: false, sourceIds: [] },
        };
    setSelected(strategyAgents[0]?.id);
    setSelectedEdge(undefined);
    setDraft({
      ...version,
      dataPermissionSnapshot: dataConfig,
      agents: strategyAgents,
      connections: strategyConnections,
    });
  };
  const deleteButton = (
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={deleteBusy}
      aria-label={`删除策略 ${name}`}
      onClick={() => void requestDelete()}
    >
      {deleteBusy ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      )}
      {deleting ? "正在删除…" : checkingDelete ? "正在确认…" : "删除策略"}
    </button>
  );
  const deleteDialogTitle = deleteImpact?.isRunning
    ? "删除正在运行的策略？"
    : "删除已发布策略？";
  const deleteDialogMessage = deleteImpact?.isRunning
    ? `“${name}”正在进行研究运行。删除后将终止持续运行，并取消等待中或运行中的研究任务；正在响应的 Agent 会在当前步骤结束后停止。策略将从策略中心移除，历史版本、验证和审计记录仍会保留。`
    : `“${name}”已有正式发布版本。删除后它将从策略中心和可运行列表中移除，不能再启动新的研究运行；历史版本、验证和审计记录仍会保留。`;
  const agentCenterPreviewEnabled = true;
  return (
    <AppPage className="space-y-5">
      <PageHeader
        eyebrow={
          readonly
            ? `策略配置 · 正式版本 v${version.versionNumber}`
            : `策略配置草稿 · revision ${version.revision}`
        }
        title={name || "策略编辑器"}
        description={
          readonly
            ? `当前完整策略由固定内核与冻结运行配置组成，产出 ${strategyPurposeMeta.output}。已发布不等于已经验证或交易。`
            : `策略内核保持不变；在这里配置市场、股票范围、真实数据、周期、参数和风险边界，形成完整策略。`
        }
        actions={
          <>
            {readonly ? (
              <>
                {strategyPurpose === "trading_decision" ? (
                  <>
                    <Link
                      className="btn-primary inline-flex items-center gap-2"
                      to={`/backtests?strategyId=${version.strategyId}&versionId=${version.id}`}
                    >
                      <FlaskConical className="h-4 w-4" />
                      {hasFrozenReplayUniverse ? "运行回测" : "打开验证中心"}
                    </Link>
                    <Link
                      className="btn-secondary"
                      to={`/backtests?strategyId=${version.strategyId}&versionId=${version.id}`}
                    >
                      查看验证记录
                    </Link>
                    <Link
                      className="btn-secondary"
                      to={`/runs?strategyId=${version.strategyId}&versionId=${version.id}`}
                    >
                      在运行中心打开
                    </Link>
                  </>
                ) : (
                  <Link
                    className="btn-primary inline-flex items-center gap-2"
                    to={`${strategyPurpose === "research_report" ? "/stock-research" : "/screening"}?strategyId=${version.strategyId}&versionId=${version.id}`}
                  >
                    {strategyPurpose === "research_report" ? <FileText className="h-4 w-4" /> : <ScanSearch className="h-4 w-4" />}
                    查看{strategyPurposeMeta.destination}工具
                  </Link>
                )}
                <button
                  className="btn-secondary"
                  onClick={() => void createDraftFromPublished()}
                >
                  基于此版本创建配置草稿
                </button>
                {deleteButton}
              </>
            ) : (
              <>
                <button
                  className="btn-secondary"
                  onClick={() => void validate()}
                >
                  检查策略
                </button>
                {strategyPurpose === "trading_decision" && validation?.valid && packageExecutionReady ? (
                  <Link
                    className="btn-secondary inline-flex items-center gap-2"
                    to={`/backtests?strategyId=${version.strategyId}&versionId=${version.id}`}
                  >
                    <FlaskConical className="h-4 w-4" />
                    {hasFrozenReplayUniverse ? "运行回测" : "打开验证中心"}{" "}
                    <span className="text-xs text-muted-text">可选</span>
                  </Link>
                ) : strategyPurpose === "trading_decision" ? (
                  <button
                    className="btn-secondary inline-flex items-center gap-2"
                    disabled
                    aria-label={`${hasFrozenReplayUniverse ? "运行回测" : "打开验证中心"}（可选，请先检查策略）`}
                  >
                    <FlaskConical className="h-4 w-4" />
                    {hasFrozenReplayUniverse ? "运行回测" : "打开验证中心"} <span className="text-xs">可选</span>
                  </button>
                ) : null}
                <button className="btn-secondary" onClick={() => void save()}>
                  {" "}
                  <Save className="mr-1 inline h-4 w-4" />
                  保存
                </button>
                <button
                  className="btn-primary"
                  disabled={!validation?.valid || !packageExecutionReady}
                  aria-label={
                    !packageExecutionReady ? "正式发布（请更新策略内核）" : validation?.valid ? "正式发布" : "正式发布（请先检查策略）"
                  }
                  onClick={() => void openPublish()}
                >
                  <Send className="mr-1 inline h-4 w-4" />
                  正式发布
                </button>
                {deleteButton}
              </>
            )}
          </>
        }
      />
      <p
        role="status"
        data-testid="save-status"
        className="text-sm text-secondary-text"
      >
        {saveState === "READ_ONLY"
          ? "正式版本只读"
          : {
              CLEAN: "未修改",
              DIRTY: "有未保存修改",
              SAVING: "保存中",
              SAVED: "已保存",
              SAVE_FAILED: "保存失败",
              CONFLICT: "存在版本冲突，自动保存已暂停",
            }[saveState]}
      </p>
      {error && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {error}
        </div>
      )}
      {validation && (
        <StrategyValidationSummary
          validation={validation}
          purpose={strategyPurpose}
          publishBlocked={!packageExecutionReady}
          onIssueSelect={(issue) => {
            setSelected(issue.agent_ids?.[0]);
            setSelectedEdge(issue.connection_ids?.[0]);
          }}
        />
      )}
      {strategyPurpose !== "trading_decision" ? (
        <div className="flex flex-col gap-3 rounded-xl border border-cyan/25 bg-cyan/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">这个版本交付 {strategyPurposeMeta.output}</p>
            <p className="mt-1 text-xs leading-5 text-secondary-text">
              策略定义、版本冻结与发布检查使用真实 API；正式版本可以在{strategyPurposeMeta.destination}入口选择。现有初始策略继续复用成熟执行链，并保留真实版本身份。
            </p>
          </div>
          <Link className="btn-secondary shrink-0" to={readonly ? `${strategyPurpose === "research_report" ? "/stock-research" : "/screening"}?strategyId=${version.strategyId}&versionId=${version.id}` : strategyPurpose === "research_report" ? "/stock-research" : "/screening"}>
            {readonly ? `用此版本打开${strategyPurposeMeta.destination}` : `查看${strategyPurposeMeta.destination}入口`}
          </Link>
        </div>
      ) : null}
      {!agentCenterPreviewEnabled && legacyInputIds.size > 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">
              历史版本包含旧版数据入口
            </p>
            <p className="mt-1 text-xs leading-5 text-secondary-text">
              它不再作为策略 Agent 展示。
              {readonly
                ? "基于此正式版本创建新草稿时，系统会自动迁移到下方的数据来源配置。"
                : "迁移后会移除旧 INPUT 节点，并由数据来源配置直接向根分析 Agent 提供输入。"}
            </p>
          </div>
          {!readonly ? (
            <button
              type="button"
              className="btn-secondary shrink-0"
              onClick={migrateLegacyInput}
            >
              迁移当前草稿
            </button>
          ) : null}
        </div>
      ) : null}
      {!agentCenterPreviewEnabled ? (
        <section aria-labelledby="agent-configuration-heading">
          <div className="mb-4 max-w-3xl">
            <p className="text-xs font-medium text-cyan">第一部分</p>
            <h2
              id="agent-configuration-heading"
              className="mt-1 text-lg font-semibold text-foreground"
            >
              策略 Agent 配置
            </h2>
            <p className="mt-1 text-sm leading-6 text-secondary-text">
              定义策略如何分析、筛选、决策和反思。外部数据与股票范围不在 Agent
              中重复配置，统一放在下方辅助配置。
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_340px]">
            <Card variant="bordered" padding="md">
              <h3 className="font-semibold text-foreground">Agent 模板库</h3>
              <p className="mt-1 text-xs leading-5 text-secondary-text">
                这里只配置策略行为；研究对象和数据输入在下方统一管理。
              </p>
              <input
                aria-label="搜索 Agent 模板"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索模板"
                className="mt-3 w-full rounded-lg border border-border bg-base p-2 text-sm"
              />
              {templates
                .filter(
                  (t) =>
                    t.agentType !== "INPUT" &&
                    (t.name.includes(query) ||
                      t.agentType.includes(query.toUpperCase())),
                )
                .map((t) => (
                  <button
                    key={t.templateId}
                    disabled={readonly || t.archived}
                    onClick={() => void addTemplate(t)}
                    className="mt-2 w-full rounded-lg border border-border p-2 text-left text-sm hover:bg-hover disabled:opacity-50"
                  >
                    <span className="block font-medium text-foreground">
                      {t.name}
                    </span>
                    <span className="text-xs text-muted-text">
                      {t.agentType} · v{t.currentVersion}
                    </span>
                  </button>
                ))}
              {templates.filter((t) => t.agentType !== "INPUT").length ===
                0 && (
                <p className="mt-3 text-sm text-secondary-text">
                  尚未配置策略 Agent 模板。
                </p>
              )}
            </Card>
            <Card variant="gradient" padding="lg">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-foreground">Agent 链路</h3>
                  <p className="mt-1 text-xs text-secondary-text">
                    辅助配置先准备研究对象和输入数据；再从节点右侧输出点拖到目标节点左侧输入点建立连接。
                  </p>
                </div>
                <Link2 className="h-5 w-5 text-cyan" aria-hidden="true" />
              </div>
              <div
                className="relative mt-4 grid gap-3 md:grid-cols-2"
                onClick={(event) => {
                  if (event.currentTarget === event.target) {
                    setSelected(undefined);
                    setSelectedEdge(undefined);
                  }
                }}
              >
                {strategyAgents.map((agent) => {
                  const hasOutput = agent.agentType !== "REFLECTION";
                  const issues = errorsFor(agent.id);
                  return (
                    <article
                      key={agent.id}
                      data-agent-node={agent.id}
                      data-testid={`agent-node-${agent.id}`}
                      onDragOver={(event) => {
                        if (!readonly) event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const sourceId =
                          event.dataTransfer.getData(
                            "application/x-strategy-agent",
                          ) || dragSource;
                        if (sourceId) connect(sourceId, agent.id);
                        setDragSource(undefined);
                      }}
                      onMouseUp={() => {
                        if (dragSource && dragSource !== agent.id)
                          connect(dragSource, agent.id);
                        setDragSource(undefined);
                      }}
                      className={`relative rounded-xl border p-3 ${selected === agent.id ? "border-cyan bg-cyan/5" : issues.length ? "border-danger/60 bg-danger/5" : "border-border/70"}`}
                    >
                      <div className="flex items-start gap-2">
                        {!readonly && (
                          <span
                            data-testid={`agent-input-handle-${agent.id}`}
                            aria-label={`${agent.name} 输入连接点：将输出连接拖到此处`}
                            className="mt-1 inline-flex h-4 w-4 shrink-0 rounded-full border-2 border-cyan bg-base"
                          />
                        )}
                        <button
                          className="min-w-0 flex-1 text-left"
                          onClick={() => {
                            setSelected(agent.id);
                            setSelectedEdge(undefined);
                          }}
                        >
                          <span className="font-medium text-foreground">
                            {agent.name}
                          </span>
                          <span className="ml-2 text-xs text-muted-text">
                            {agent.agentType}
                          </span>
                          <p className="mt-1 text-xs text-secondary-text">
                            {agent.role}
                          </p>
                        </button>
                        {hasOutput && !readonly && (
                          <button
                            data-testid={`agent-output-handle-${agent.id}`}
                            draggable
                            aria-label={`${agent.name} 输出连接点：拖动到目标输入点建立连接`}
                            onMouseDown={() => setDragSource(agent.id)}
                            onDragStart={(event) => {
                              event.dataTransfer.setData(
                                "application/x-strategy-agent",
                                agent.id,
                              );
                              event.dataTransfer.effectAllowed = "link";
                              setDragSource(agent.id);
                            }}
                            onDragEnd={() => setDragSource(undefined)}
                            className="inline-flex h-5 w-5 shrink-0 cursor-crosshair items-center justify-center rounded-full border-2 border-cyan bg-cyan/10 text-xs text-cyan"
                            type="button"
                          >
                            →
                          </button>
                        )}
                      </div>
                      {issues.map((issue) => (
                        <p
                          key={issue.code}
                          className="mt-2 flex items-center gap-1 text-xs text-danger"
                        >
                          <CircleAlert className="h-3 w-3" />
                          {issue.message}
                        </p>
                      ))}
                      {!readonly && (
                        <button
                          aria-label={`删除 ${agent.name}`}
                          className="mt-2 text-xs text-danger"
                          onClick={() => removeAgent(agent.id)}
                        >
                          <Trash2 className="mr-1 inline h-3 w-3" />
                          删除
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
              <div className="mt-5 border-t border-border/60 pt-3">
                <p className="text-xs font-medium text-secondary-text">
                  连接（选择边以配置）
                </p>
                {strategyConnections.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-text">
                    尚未连接策略 Agent。根 Agent 会直接接收版本冻结的数据输入。
                  </p>
                ) : (
                  strategyConnections.map((c) => {
                    const from =
                      strategyAgents.find((a) => a.id === c.sourceAgentId)
                        ?.name || "未知";
                    const to =
                      strategyAgents.find((a) => a.id === c.targetAgentId)
                        ?.name || "未知";
                    const issues = errorsFor(c.id);
                    return (
                      <button
                        data-testid={`agent-connection-${c.id}`}
                        key={c.id}
                        onClick={() => {
                          setSelectedEdge(c.id);
                          setSelected(undefined);
                        }}
                        className={`mt-2 w-full rounded-lg border p-2 text-left text-sm ${selectedEdge === c.id ? "border-cyan bg-cyan/5" : issues.length ? "border-danger/60 bg-danger/5" : "border-border/70"}`}
                      >
                        {from} <span className="text-muted-text">→</span> {to}
                        <span className="ml-2 text-xs text-muted-text">
                          {c.connectionType}
                        </span>
                        {issues.map((e) => (
                          <span
                            className="flex items-center gap-1 text-xs text-danger"
                            key={e.code}
                          >
                            <CircleAlert className="h-3 w-3" />
                            {e.message}
                          </span>
                        ))}
                      </button>
                    );
                  })
                )}
              </div>
            </Card>
            <Card variant="bordered" padding="lg">
              <h3 className="font-semibold text-foreground">
                {selectedConnection ? "连接配置" : "Agent 配置"}
              </h3>
              {selectedConnection ? (
                <div
                  data-testid="connection-config-panel"
                  className="mt-4 space-y-3 text-sm"
                >
                  {(() => {
                    const source = version.agents.find(
                        (agent) =>
                          agent.id === selectedConnection.sourceAgentId,
                      ),
                      target = version.agents.find(
                        (agent) =>
                          agent.id === selectedConnection.targetAgentId,
                      );
                    if (!source || !target)
                      return (
                        <p className="text-danger">连接引用的 Agent 不存在。</p>
                      );
                    return (
                      <>
                        <p className="text-secondary-text">
                          {source.name} → {target.name}
                        </p>
                        <label className="block">
                          连接类型
                          <select
                            disabled={readonly}
                            value={selectedConnection.connectionType}
                            onChange={(e) =>
                              updateEdge({
                                connectionType: e.target
                                  .value as Connection["connectionType"],
                              })
                            }
                            className="mt-1 w-full rounded-lg border border-border bg-base p-2"
                          >
                            <option>DATA_FLOW</option>
                            <option>POST_RUN_CONTEXT</option>
                          </select>
                        </label>
                        <label className="block">
                          条件（声明式文本）
                          <input
                            disabled={readonly}
                            value={selectedConnection.condition || ""}
                            onChange={(e) =>
                              updateEdge({ condition: e.target.value })
                            }
                            placeholder="仅支持当前受控条件格式"
                            className="mt-1 w-full rounded-lg border border-border bg-base p-2"
                          />
                        </label>
                        <FieldMappingEditor
                          source={source}
                          target={target}
                          mapping={selectedConnection.fieldMapping}
                          disabled={readonly}
                          onChange={(fieldMapping) =>
                            updateEdge({ fieldMapping })
                          }
                        />
                        {errorsFor(selectedConnection.id).map((issue) => (
                          <p className="text-xs text-danger" key={issue.code}>
                            {issue.field_path || issue.code}：{issue.message}
                          </p>
                        ))}
                        {!readonly && (
                          <button
                            className="text-danger"
                            onClick={() =>
                              setDraft({
                                ...version,
                                connections: version.connections.filter(
                                  (c) => c.id !== selectedConnection.id,
                                ),
                              })
                            }
                          >
                            <Trash2 className="mr-1 inline h-4 w-4" />
                            删除连接
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              ) : selectedAgent ? (
                <div className="mt-4 space-y-3 text-sm">
                  <label className="block">
                    名称
                    <input
                      disabled={readonly}
                      value={selectedAgent.name}
                      onChange={(e) =>
                        setDraft({
                          ...version,
                          agents: version.agents.map((a) =>
                            a.id === selectedAgent.id
                              ? { ...a, name: e.target.value }
                              : a,
                          ),
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-border bg-base p-2"
                    />
                  </label>
                  <label className="block">
                    职责
                    <textarea
                      disabled={readonly}
                      value={selectedAgent.role}
                      onChange={(e) =>
                        setDraft({
                          ...version,
                          agents: version.agents.map((a) =>
                            a.id === selectedAgent.id
                              ? { ...a, role: e.target.value }
                              : a,
                          ),
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-border bg-base p-2"
                    />
                  </label>
                  <label className="block">
                    系统 Prompt
                    <textarea
                      disabled={readonly}
                      value={selectedAgent.systemPrompt}
                      onChange={(e) =>
                        setDraft({
                          ...version,
                          agents: version.agents.map((a) =>
                            a.id === selectedAgent.id
                              ? { ...a, systemPrompt: e.target.value }
                              : a,
                          ),
                        })
                      }
                      className="mt-1 min-h-28 w-full rounded-lg border border-border bg-base p-2"
                    />
                  </label>
                  <p className="text-xs text-muted-text">
                    模板：
                    {selectedAgent.agentTemplateId
                      ? `${selectedAgent.agentTemplateId} · v${selectedAgent.agentTemplateVersion}`
                      : "自定义 Agent"}
                  </p>
                </div>
              ) : (
                <p className="mt-4 text-sm text-secondary-text">
                  选择一个 Agent 或连接。
                </p>
              )}
            </Card>
          </div>
        </section>
      ) : null}
      <ComposableStrategyPreview version={version} workflows={workflows} />
      <StrategyConfigurationPanel
        version={version}
        disabled={readonly}
        dataSources={dataSources}
        workflows={workflows}
        onCreateDraft={
          readonly ? () => void createDraftFromPublished() : undefined
        }
        onChange={setDraft}
      />
      <div className="flex gap-3">
        <button
          className="btn-secondary"
          onClick={() => void showDiff()}
          disabled={!version.basedOnVersionId}
        >
          查看版本差异
        </button>
      </div>
      {diff && (
        <Card variant="bordered" padding="lg">
          <div className="flex justify-between">
            <h2 className="font-semibold text-foreground">版本差异</h2>
            <button onClick={() => setDiff(undefined)}>关闭</button>
          </div>
          <p className="mt-2 text-sm text-secondary-text">
            新增 {String(diff.summary.agentsAdded || 0)} 个 Agent，删除{" "}
            {String(diff.summary.agentsRemoved || 0)} 个 Agent，修改{" "}
            {String(diff.summary.agentsModified || 0)} 个 Agent。
          </p>
          {diff.changes.length === 0 ? (
            <p className="mt-4 text-sm text-secondary-text">
              这两个版本没有可识别的配置差异。
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {diff.changes.map((item, index) => (
                <div
                  key={`${item.category}-${index}`}
                  className="rounded-lg border border-border p-3 text-sm"
                >
                  <b>{item.category}</b>
                  {item.agentName && ` · ${item.agentName}`}
                  {item.field && ` · ${item.field}`}
                  <p className="mt-1 text-secondary-text">
                    {item.sensitive
                      ? "Prompt 已变化（仅显示哈希）"
                      : `${String(item.before ?? "—")} → ${String(item.after ?? "—")}`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
      {showPublish && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="发布策略版本"
          className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
        >
          <Card variant="bordered" padding="lg" className="w-full max-w-lg">
            <h2 className="font-semibold">确认正式发布</h2>
            <p className="mt-2 text-sm leading-6 text-secondary-text">
              正式发布会冻结当前策略定义与 {strategyPurposeMeta.output} 输出契约。
              {strategyPurpose === "trading_decision"
                ? "历史回放是可选步骤；未回放也可以发布，但“已发布”不代表策略已经验证有效，更不代表已经交易。"
                : "发布后可由对应研究工具消费；现有初始策略继续使用成熟兼容执行器。"}
            </p>
            {strategyPurpose === "trading_decision" ? <div className="mt-4 rounded-xl border border-warning/30 bg-warning/5 px-3 py-3 text-sm text-warning">
              {historicalValidationLoading
                ? "正在读取历史回放状态…"
                : historicalValidation?.status === "validated"
                  ? `历史验证已通过 · 实验 #${historicalValidation.latestCompletedExperimentId}`
                  : historicalValidation?.status === "completed"
                    ? `观察性历史回放已完成 · 实验 #${historicalValidation.latestCompletedExperimentId}；不等于完整 Agent 策略已验证通过。`
                    : "尚未完成可信历史回放（可选），你仍可正式发布。"}
            </div> : <div className="mt-4 rounded-xl border border-cyan/25 bg-cyan/5 px-3 py-3 text-sm leading-6 text-secondary-text">此版本的终点是 <code className="font-medium text-cyan">{strategyPurposeMeta.output}</code>，不会进入当前历史交易验证或交易研究运行中心。</div>}
            <textarea
              autoFocus
              value={changeLog}
              onChange={(e) => setChangeLog(e.target.value)}
              placeholder="填写版本变更说明"
              className="mt-4 min-h-24 w-full rounded-lg border border-border bg-base p-2"
            />
            {validation?.warnings.map((w) => (
              <label className="mt-2 flex gap-2 text-sm" key={w.code}>
                <input
                  type="checkbox"
                  checked={!!ack[w.code]}
                  onChange={(e) =>
                    setAck({ ...ack, [w.code]: e.target.checked })
                  }
                />
                {w.message}
              </label>
            ))}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                className="btn-secondary"
                onClick={() => setShowPublish(false)}
              >
                取消
              </button>
              {strategyPurpose === "trading_decision" ? <button
                className="btn-secondary"
                onClick={() =>
                  navigate(
                    `/backtests?strategyId=${version.strategyId}&versionId=${version.id}`,
                  )
                }
              >
                {hasFrozenReplayUniverse ? "运行回测（可选）" : "打开验证中心（可选）"}
              </button> : null}
              <button
                className="btn-primary"
                disabled={historicalValidationLoading}
                onClick={() => void publish()}
              >
                正式发布
              </button>
            </div>
          </Card>
        </div>
      )}
      <ConfirmDialog
        isOpen={Boolean(deleteImpact)}
        title={deleteDialogTitle}
        message={deleteDialogMessage}
        confirmText={
          deleting
            ? "正在删除…"
            : deleteImpact?.isRunning
              ? "终止运行并删除"
              : "确认删除"
        }
        confirmDisabled={deleting}
        cancelDisabled={deleting}
        isDanger
        onConfirm={() => void removeStrategy(true)}
        onCancel={() => setDeleteImpact(undefined)}
      />
      {conflict && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="策略草稿冲突"
          data-testid="revision-conflict-dialog"
          className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
        >
          <Card variant="bordered" padding="lg" className="w-full max-w-lg">
            <h2 className="font-semibold">策略草稿已在其他位置更新</h2>
            <p className="mt-2 text-sm text-secondary-text">
              本地 revision {version.revision}，服务器 revision{" "}
              {conflict.serverRevision || "未知"}。自动保存已暂停。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="btn-secondary"
                onClick={() => void conflictDiff()}
              >
                查看本地与服务器差异
              </button>
              <button
                className="btn-secondary"
                onClick={() => void loadServer()}
              >
                加载服务器版本
              </button>
              <button className="btn-primary" onClick={() => void forkLocal()}>
                复制本地内容为新策略
              </button>
              <button
                className="btn-secondary"
                onClick={() => setConflict(null)}
              >
                保留本地内容
              </button>
            </div>
            <p className="mt-3 text-xs text-muted-text">
              副本会新建 Strategy、Draft、Agent ID 和
              lineage；不会覆盖服务器草稿。
            </p>
            {showConflictDiff && diff && (
              <p className="mt-3 text-sm text-secondary-text">
                检测到 {diff.changes.length}{" "}
                项本地差异，可在下方“版本差异”面板查看。
              </p>
            )}
          </Card>
        </div>
      )}
    </AppPage>
  );
}
