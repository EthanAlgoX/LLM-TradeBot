import { AlertTriangle, ArrowRight, CheckCircle2, FileArchive, LoaderCircle, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { toApiErrorMessage } from "../api/error";
import { strategyWorkspaceApi, type StrategyPackageMetadata, type StrategySummary, type StrategyVersion } from "../api/strategyWorkspace";
import { AppPage, Card, PageHeader } from "../components/common";

type IntakeResult = {
  strategy: StrategySummary;
  draft: StrategyVersion;
  package: StrategyPackageMetadata;
  warnings: string[];
};

export default function StrategyImportPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [creatingConfiguration, setCreatingConfiguration] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [configurationName, setConfigurationName] = useState("");

  useEffect(() => {
    document.title = "上传策略包 - LLM TradeBot";
  }, []);

  const uploadPackage = async () => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const next = await strategyWorkspaceApi.intakeStrategyPackage(file);
      setResult(next);
      setConfigurationName(`${next.strategy.name} · 运行配置`);
    } catch (cause) {
      setError(toApiErrorMessage(cause, "策略包读取失败。请按生成指南检查目录、Manifest 和数据依赖后重试。"));
    } finally {
      setUploading(false);
    }
  };

  const continueToConfiguration = async () => {
    if (!result || !configurationName.trim()) return;
    setCreatingConfiguration(true);
    setError("");
    try {
      const created = await strategyWorkspaceApi.createConfiguredStrategy(
        result.draft.id,
        configurationName.trim(),
        `基于“${result.strategy.name}”策略内核创建的独立运行配置。`,
      );
      navigate(`/strategies/${created.strategy.id}/editor?versionId=${created.draft.id}`);
    } catch (cause) {
      setError(toApiErrorMessage(cause, "无法创建运行配置。请确认名称未被占用，然后重试。"));
    } finally {
      setCreatingConfiguration(false);
    }
  };

  return (
    <AppPage className="space-y-7">
      <PageHeader
        eyebrow="Strategy package intake"
        title="上传策略包"
        description="上传外部工具生成的策略内核，再用网站补齐市场、数据源、周期、运行频率和策略参数。上传不会把这些运行配置写死在代码包中。"
        actions={<Link to="/strategies" className="btn-secondary">返回策略中心</Link>}
      />

      <ol aria-label="策略接入步骤" className="grid overflow-hidden rounded-xl border border-border/70 bg-border/70 md:grid-cols-3 md:gap-px">
        {[
          ["1", "上传策略内核", result ? "已完成结构与依赖检查" : "读取代码包、契约和策略说明"],
          ["2", "完成策略配置", "选择市场、数据、周期和参数"],
          ["3", "检查、验证与发布", "回测可选；发布前冻结完整版本"],
        ].map(([number, title, detail], index) => (
          <li key={number} className={`bg-card px-5 py-4 ${index === 0 ? "text-foreground" : "text-secondary-text"}`}>
            <div className="flex items-start gap-3"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${index === 0 ? "bg-primary text-white" : "bg-base text-secondary-text"}`}>{number}</span><span><span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs leading-5 text-muted-text">{detail}</span></span></div>
          </li>
        ))}
      </ol>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <main>
          {!result ? (
            <Card variant="bordered" padding="lg">
              <div className="max-w-3xl">
                <h2 className="text-lg font-semibold text-foreground">选择完整 ZIP 策略包</h2>
                <p className="mt-2 text-sm leading-6 text-secondary-text">平台会静态检查并保存策略包，确认入口、输入输出 Schema、策略说明和数据依赖后，才允许受限执行器调用 Python 函数。</p>
              </div>
              <label className="mt-5 flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-base px-5 py-8 text-center transition-colors hover:border-primary/50 hover:bg-hover/40">
                <Upload className="h-7 w-7 text-primary" aria-hidden="true" />
                <span className="mt-3 font-medium text-foreground">{file ? file.name : "选择 .zip 策略包"}</span>
                <span className="mt-1 text-xs text-muted-text">最大 10 MB；服务器会阻止路径穿越、符号链接和异常解压体积</span>
                <input type="file" accept=".zip,application/zip" className="sr-only" aria-label="选择策略包" onChange={(event) => { setFile(event.target.files?.[0] || null); setError(""); }} />
              </label>
              {file ? <dl className="mt-4 grid gap-3 rounded-xl border border-border/70 p-4 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-text">文件</dt><dd className="mt-1 break-all text-foreground">{file.name}</dd></div><div><dt className="text-xs text-muted-text">大小</dt><dd className="mt-1 font-mono text-foreground">{(file.size / 1024).toFixed(1)} KB</dd></div></dl> : null}
              {error ? <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm leading-6 text-danger"><AlertTriangle className="mt-1 h-4 w-4 shrink-0" />{error}</p> : null}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={!file || uploading || file.size > 10 * 1024 * 1024} onClick={() => void uploadPackage()}>{uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}{uploading ? "正在检查并接入…" : "上传并检查策略包"}</button>
                <Link to="/strategy-development" className="text-sm font-medium text-primary hover:underline">查看生成指南</Link>
              </div>
            </Card>
          ) : (
            <Card variant="bordered" padding="lg">
              <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" /><div><h2 className="text-lg font-semibold text-foreground">策略内核已保存，函数入口可调用</h2><p className="mt-1 text-sm leading-6 text-secondary-text">包结构、Python 入口、输出契约和当前数据依赖已经通过接入检查。下一步从它创建独立运行配置，形成可发布的完整策略。</p></div></div>
              <dl className="mt-5 grid gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 sm:grid-cols-2">
                {[
                  ["策略", result.strategy.name],
                  ["包版本", result.package.declaredVersion],
                  ["输出契约", result.package.outputContract],
                  ["入口", `${result.package.runtime} · ${result.package.entrypoint}`],
                  ["可配置市场", result.package.configurable.markets.join(" / ")],
                  ["策略参数", `${result.package.parameters.length} 项`],
                ].map(([label, value]) => <div key={label} className="bg-card px-4 py-4"><dt className="text-xs text-muted-text">{label}</dt><dd className="mt-1 break-words text-sm font-medium text-foreground">{value}</dd></div>)}
              </dl>
              <section className="mt-5" aria-labelledby="uploaded-dependencies-heading"><h3 id="uploaded-dependencies-heading" className="text-sm font-semibold text-foreground">已声明的数据依赖</h3><div className="mt-2 overflow-hidden rounded-xl border border-border/70">{result.package.dataRequirements.map((requirement, index) => <div key={requirement.id} className={`grid gap-2 px-4 py-3 text-xs sm:grid-cols-[150px_100px_minmax(0,1fr)] ${index ? "border-t border-border/70" : ""}`}><span className="font-medium text-foreground">{requirement.id}</span><span className={requirement.required ? "text-warning" : "text-secondary-text"}>{requirement.required ? "必需 · 缺失停止" : "可选 · 缺失降级"}</span><span className="min-w-0 break-words text-secondary-text">{requirement.sourceIds.join(" / ")} · {requirement.usage}</span></div>)}</div></section>
              {result.warnings.length ? <ul className="mt-4 space-y-2 rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm leading-6 text-warning">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
              {error ? <p role="alert" className="mt-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p> : null}
              <label className="mt-5 grid max-w-xl gap-1.5 text-xs font-medium text-secondary-text">完整策略名称<input aria-label="完整策略名称" value={configurationName} maxLength={120} onChange={(event) => setConfigurationName(event.target.value)} className="h-10 rounded-control border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /><span className="font-normal leading-5 text-muted-text">这会创建一个独立的 StrategyVersion 配置草稿，不会修改刚上传的内核。</span></label>
              <div className="mt-5 flex flex-wrap gap-3"><button type="button" disabled={!configurationName.trim() || creatingConfiguration} className="btn-primary inline-flex items-center gap-2" onClick={() => void continueToConfiguration()}>{creatingConfiguration ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}{creatingConfiguration ? "正在创建配置…" : "创建并配置完整策略"}</button><button type="button" className="btn-secondary" disabled={creatingConfiguration} onClick={() => { setFile(null); setResult(null); setConfigurationName(""); setError(""); }}>上传另一个包</button></div>
            </Card>
          )}
        </main>

        <aside className="space-y-4">
          <Card variant="bordered" padding="lg">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="mt-4 font-semibold text-foreground">策略内核与配置分离</h2>
            <p className="mt-2 text-sm leading-6 text-secondary-text">代码包固定计算和输出逻辑；网站配置市场、股票范围、数据源、观察周期、运行频率、参数值和风险边界。正式版本会同时冻结二者。</p>
          </Card>
          <Card variant="bordered" padding="lg">
            <AlertTriangle className="h-5 w-5 text-warning" aria-hidden="true" />
            <h2 className="mt-4 font-semibold text-foreground">受限执行边界</h2>
            <p className="mt-2 text-sm leading-6 text-secondary-text">上传代码只允许指南列出的 Python 标准库，不能读取平台文件、环境密钥或直接访问网络；运行数据由平台按 Manifest 授权并注入。</p>
          </Card>
        </aside>
      </div>
    </AppPage>
  );
}
