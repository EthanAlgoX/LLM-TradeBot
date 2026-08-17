import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  FileText,
  FlaskConical,
  GitCompareArrows,
  PlayCircle,
  ScanSearch,
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AppPage, Card, InlineAlert, PageHeader } from "../components/common";
import {
  strategyWorkspaceApi,
  type StrategySummary,
  type StrategyValidationVersionStatus,
  type StrategyVersion,
  type VersionDiff,
} from "../api/strategyWorkspace";
import { versionCompareDefaults } from "./strategyEditorUtils";
import { purposeDefinition } from "../utils/strategyPurpose";

export default function StrategyWorkspacePage() {
  const { strategyId } = useParams();
  const [params, setParams] = useSearchParams();
  const [strategy, setStrategy] = useState<StrategySummary | null>(null);
  const [versions, setVersions] = useState<StrategyVersion[]>([]);
  const [error, setError] = useState("");
  const [validationStatusError, setValidationStatusError] = useState("");
  const [diff, setDiff] = useState<VersionDiff>();
  const [diffError, setDiffError] = useState("");
  const [validationStatuses, setValidationStatuses] = useState<
    Record<number, StrategyValidationVersionStatus>
  >({});

  useEffect(() => {
    if (!strategyId) return;
    void strategyWorkspaceApi
      .getStrategy(Number(strategyId))
      .then(async (value) => {
        setStrategy(value);
        setVersions(value.versions);
        const statusResults = await Promise.allSettled(
          value.versions
            .filter((version) => (version.strategyPurpose || "trading_decision") === "trading_decision")
            .map((version) =>
            strategyWorkspaceApi.getValidationStatus(version.id),
            ),
        );
        setValidationStatuses(
          Object.fromEntries(
            statusResults.flatMap((result) =>
              result.status === "fulfilled"
                ? [[result.value.strategyVersionId, result.value] as const]
                : [],
            ),
          ),
        );
        setValidationStatusError(
          statusResults.some((result) => result.status === "rejected")
            ? "策略版本已读取，但部分验证状态暂时不可用；版本与配置入口仍可正常查看。"
            : "",
        );
      })
      .catch(() => setError("无法读取策略版本。"));
  }, [strategyId]);

  const defaults = useMemo(
    () =>
      versionCompareDefaults(
        versions,
        Number(params.get("fromVersion")) || undefined,
        Number(params.get("toVersion")) || undefined,
      ),
    [versions, params],
  );
  const compare = async (from = defaults.from, to = defaults.to) => {
    if (!from || !to) return setDiffError("请选择两个版本。");
    if (
      params.get("fromVersion") !== String(from) ||
      params.get("toVersion") !== String(to)
    )
      setParams({ fromVersion: String(from), toVersion: String(to) });
    try {
      setDiffError("");
      setDiff(await strategyWorkspaceApi.diff(to, from));
    } catch {
      setDiffError("无法读取版本差异，请检查版本权限后重试。");
    }
  };
  useEffect(() => {
    if (!defaults.from || !defaults.to) return;
    void strategyWorkspaceApi
      .diff(defaults.to, defaults.from)
      .then(setDiff)
      .catch(() => setDiffError("无法读取版本差异，请检查版本权限后重试。"));
  }, [defaults.from, defaults.to]);

  const label = (version: StrategyVersion) =>
    `${version.status === "PUBLISHED" ? `v${version.versionNumber}` : "Draft"} · ${new Date(version.createdAt).toLocaleString()}`;
  const explainedVersion = versions.find(
    (version) => version.id === strategy?.currentPublishedVersionId,
  ) || versions.find((version) => version.id === strategy?.activeDraftVersionId) || versions[0];
  return (
    <AppPage className="space-y-5">
      <PageHeader
        eyebrow="Strategy workspace"
        title={strategy?.name || "策略工作台"}
        description="推荐先对草稿做发布前验证，再正式发布；已发布的历史版本也可以重新研究。"
      />
      {error ? (
        <Card variant="bordered" padding="lg">
          {error}
        </Card>
      ) : (
        <>
          {validationStatusError ? (
            <InlineAlert variant="warning" message={validationStatusError} />
          ) : null}
          <section aria-labelledby="strategy-explanation-heading" className="rounded-xl border border-border/70 bg-surface px-5 py-5">
            <h2 id="strategy-explanation-heading" className="font-semibold text-foreground">策略说明</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-secondary-text">
              {explainedVersion?.objective || strategy?.description || "这个策略版本尚未填写策略说明。"}
            </p>
            {strategy?.description && explainedVersion?.objective && strategy.description !== explainedVersion.objective ? (
              <p className="mt-2 max-w-4xl text-xs leading-5 text-muted-text">概要：{strategy.description}</p>
            ) : null}
          </section>
          <section aria-labelledby="versions-heading">
            <div className="mb-3">
              <h2
                id="versions-heading"
                className="text-lg font-semibold text-foreground"
              >
                配置版本、发布与研究入口
              </h2>
              <p className="mt-1 text-sm text-secondary-text">
                每个版本都冻结一个策略内核引用和一套运行配置。草稿可先进入发布前验证；“已发布”不表示已经验证有效或已经交易。
              </p>
            </div>
            <Card variant="bordered" padding="none">
              <div className="divide-y divide-border/60">
                {versions.map((version) => {
                  const isPublished = version.status === "PUBLISHED";
                  const purpose = version.strategyPurpose || "trading_decision";
                  const purposeMeta = purposeDefinition(purpose);
                  const isTrading = purpose === "trading_decision";
                  const hasFrozenUniverse = Array.isArray(version.marketScope?.symbols)
                    && version.marketScope.symbols.map(String).some(Boolean);
                  const historical = validationStatuses[version.id];
                  const replayCompleted =
                    historical?.status === "completed" ||
                    historical?.status === "validated";
                  return (
                    <div key={version.id} className="px-5 py-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-foreground">
                              {isPublished
                                ? `正式版本 V${version.versionNumber}`
                                : "可编辑草稿"}
                            </p>
                            {isPublished ? (
                              <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                                已发布
                              </span>
                            ) : (
                              <span className="rounded-full border border-border bg-base px-2 py-0.5 text-xs text-secondary-text">
                                草稿
                              </span>
                            )}
                            <code className="rounded-md border border-border/70 bg-base px-2 py-0.5 text-xs text-cyan">
                              {purposeMeta.output}
                            </code>
                          </div>
                          <p className="mt-2 text-sm text-secondary-text">
                            {version.changeLog || "尚未填写变更说明"} ·{" "}
                            {version.agentCount ?? version.agents.length} 个
                            内部步骤
                          </p>
                          {isTrading ? <p className="mt-2 text-sm text-secondary-text">
                            验证状态：
                            <span className="font-medium text-warning">
                              {historical
                                ? historical.status === "validated"
                                  ? "已通过验证"
                                  : historical.status === "completed"
                                    ? "观察性回放已完成"
                                    : historical.status === "failed"
                                      ? "回放失败"
                                      : historical.status === "running"
                                        ? "回放中"
                                        : "未开始"
                                : "正在读取"}
                            </span>
                            {isPublished ? (
                              <>
                                {" "}
                                · 运行状态：
                                <span className="font-medium text-secondary-text">
                                  未运行
                                </span>
                              </>
                            ) : null}
                          </p> : <p className="mt-2 text-sm text-secondary-text">消费入口：{purposeMeta.destination} · 不进入交易回测</p>}
                        </div>
                        {isPublished && isTrading ? (
                          <div className="flex flex-wrap gap-2">
                            <Link
                              className="btn-secondary"
                              to={`/strategies/${version.strategyId}/editor?versionId=${version.id}`}
                            >
                              查看策略配置
                            </Link>
                            <Link
                              className="btn-primary inline-flex items-center gap-2"
                              to={`/backtests?strategyId=${version.strategyId}&versionId=${version.id}`}
                            >
                              <FlaskConical className="h-4 w-4" />
                              {hasFrozenUniverse ? "重新回测研究" : "打开验证中心"}
                            </Link>
                            <Link
                              className="btn-secondary"
                              to={`/backtests?strategyId=${version.strategyId}&versionId=${version.id}`}
                            >
                              查看验证记录
                            </Link>
                            <Link
                              className="btn-secondary inline-flex items-center gap-1"
                              to={`/runs?strategyId=${version.strategyId}&versionId=${version.id}`}
                            >
                              在运行中心打开 <PlayCircle className="h-4 w-4" />
                            </Link>
                          </div>
                        ) : isPublished ? (
                          <div className="flex flex-wrap gap-2">
                            <Link
                              className="btn-secondary"
                              to={`/strategies/${version.strategyId}/editor?versionId=${version.id}`}
                            >
                              查看策略配置
                            </Link>
                            <Link
                              className="btn-primary inline-flex items-center gap-2"
                              to={`${purpose === "research_report" ? "/stock-research" : "/screening"}?strategyId=${version.strategyId}&versionId=${version.id}`}
                            >
                              {purpose === "research_report" ? <FileText className="h-4 w-4" /> : <ScanSearch className="h-4 w-4" />}
                              查看{purposeMeta.destination}工具
                            </Link>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {isTrading ? <Link
                              className="btn-primary inline-flex items-center gap-2"
                              to={`/backtests?strategyId=${version.strategyId}&versionId=${version.id}`}
                            >
                              <FlaskConical className="h-4 w-4" />
                              {hasFrozenUniverse ? "发布前回测" : "打开验证中心"}
                            </Link> : null}
                            <Link
                              className="btn-secondary inline-flex items-center gap-1"
                              to={`/strategies/${version.strategyId}/editor?versionId=${version.id}`}
                            >
                              继续策略配置 <ArrowRight className="h-4 w-4" />
                            </Link>
                          </div>
                        )}
                      </div>
                      <p className="mt-4 border-t border-border/60 pt-3 text-sm text-secondary-text">
                        {!isTrading
                          ? `此版本交付 ${purposeMeta.output}；当前策略由现有兼容执行器消费。`
                          : replayCompleted
                          ? "当前定义已有覆盖和快照校验通过的观察性历史回放；它不代表完整策略已经验证有效。"
                          : isPublished
                            ? hasFrozenUniverse
                              ? "此正式版本尚未产生可信的策略级历史回放记录。"
                              : "此版本使用动态选股；验证中心可进行指定股票诊断，正式回放需先接入历史时点股票池。"
                            : hasFrozenUniverse
                              ? "历史回放是可选步骤；你也可以返回编辑器，在策略检查通过后直接正式发布。"
                              : "此草稿使用动态选股；可进入验证中心做股票诊断，正式回放需先接入历史时点股票池。"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>
          <Card variant="bordered" padding="lg">
            <div className="flex items-center gap-2">
              <GitCompareArrows className="h-5 w-5 text-cyan" />
              <h2 className="font-semibold text-foreground">比较版本</h2>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
              <select
                aria-label="基准版本"
                value={defaults.from || ""}
                onChange={(event) =>
                  void compare(Number(event.target.value), defaults.to)
                }
                className="rounded-lg border border-border bg-base p-2"
              >
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {label(version)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary"
                aria-label="交换比较版本"
                onClick={() => void compare(defaults.to, defaults.from)}
              >
                交换
              </button>
              <select
                aria-label="目标版本"
                value={defaults.to || ""}
                onChange={(event) =>
                  void compare(defaults.from, Number(event.target.value))
                }
                className="rounded-lg border border-border bg-base p-2"
              >
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {label(version)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void compare()}
              >
                比较
              </button>
            </div>
            {diffError ? (
              <p className="mt-3 text-sm text-danger">{diffError}</p>
            ) : diff ? (
              <div className="mt-4">
                <p className="text-sm text-secondary-text">
                  新增内部步骤 {String(diff.summary.agentsAdded || 0)} · 删除
                  内部步骤 {String(diff.summary.agentsRemoved || 0)} · 修改内部步骤{" "}
                  {String(diff.summary.agentsModified || 0)} · 新增连接{" "}
                  {String(diff.summary.connectionsAdded || 0)} · 删除连接{" "}
                  {String(diff.summary.connectionsRemoved || 0)}
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
                        {item.agentName ? ` · ${item.agentName}` : ""}
                        {item.field ? ` · ${item.field}` : ""}
                        <p className="mt-1 text-secondary-text">
                          {item.sensitive
                            ? "Prompt 已变化（仅显示哈希）"
                            : `${String(item.before ?? "—")} → ${String(item.after ?? "—")}`}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-secondary-text">
                选择两个版本以查看差异。
              </p>
            )}
          </Card>
        </>
      )}
    </AppPage>
  );
}
