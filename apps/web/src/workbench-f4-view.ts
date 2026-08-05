type F4Reference = { id?: unknown; version?: unknown; fingerprint?: unknown };
type F4Job = { jobId?: unknown; status?: unknown; evidenceRef?: unknown; evidenceFingerprint?: unknown };
type F4Binding = {
  bindingId?: unknown; versionId?: unknown; versionIndex?: unknown; fingerprint?: unknown; lifecycleStatus?: unknown;
  configurationRef?: { versionId?: unknown; versionFingerprint?: unknown };
  compiledGraphRef?: F4Reference; datasetRef?: F4Reference; backtestProfileRef?: F4Reference;
  walkForwardCandidateSetRef?: F4Reference; walkForwardPlanRef?: F4Reference;
  backtestJob?: F4Job; walkForwardJob?: F4Job;
};
type F4Configuration = { draftId?: unknown; versionId?: unknown; fingerprint?: unknown; parentVersionId?: unknown; parentFingerprint?: unknown };
type F4Projection = { error?: unknown; configuration?: F4Configuration; gates?: Array<{ id?: unknown; status?: unknown }>; preflight?: { issues?: Array<{ code?: unknown; suggestion?: unknown }> }; binding?: F4Binding; nextAction?: unknown };

const esc = (value: unknown) => String(value ?? "—").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const value = (input: unknown) => typeof input === "string" || typeof input === "number" ? esc(input) : "—";
const reference = (label: string, ref?: F4Reference) => `<div><dt>${label}</dt><dd><code>${value(ref?.id)}</code> · ${value(ref?.version)}<br><code>${value(ref?.fingerprint)}</code></dd></div>`;
const job = (label: string, input?: F4Job) => `<div><dt>${label}</dt><dd>${value(input?.status)} · <code>${value(input?.jobId)}</code><br>${value(input?.evidenceRef)} · <code>${value(input?.evidenceFingerprint)}</code></dd></div>`;

/** Render only the server-projected F4 facts; this view owns no evidence state. */
export function renderWorkbenchF4Evidence(input: unknown, locale: "zh-CN" | "en" | "en-US"): string {
  const f4 = input as F4Projection;
  if (f4.error) return `<p class="paper-unavailable">${value(f4.error)}</p>`;
  const zh = locale === "zh-CN";
  const binding = f4.binding;
  const configuration = f4.configuration;
  const gates = (f4.gates ?? []).map((gate) => `${value(gate.id)}: <strong>${value(gate.status)}</strong>`).join(" → ");
  const issues = f4.preflight?.issues?.map((issue) => `${value(issue.code)}: ${value(issue.suggestion)}`).join(" · ") ?? "";
  const terminal = binding?.lifecycleStatus === "evidence_ready";
  const configurationLineage = configuration ? `<dl class="workbench-f4__configuration"><div><dt>${zh ? "配置版本" : "Configuration version"}</dt><dd><code>${value(configuration.versionId)}</code><br><code>${value(configuration.fingerprint)}</code></dd></div>${configuration.parentVersionId ? `<div><dt>${zh ? "父版本" : "Parent version"}</dt><dd><code>${value(configuration.parentVersionId)}</code><br><code>${value(configuration.parentFingerprint)}</code></dd></div>` : ""}</dl>` : "";
  return `<div class="workbench-f4__projection"><p class="workbench-f4__gate"><strong>${terminal ? "EVIDENCE READY / APPROVAL REQUIRED" : zh ? "证据门禁" : "Evidence gate"}</strong><br><small>${gates}</small></p>${configurationLineage}${issues ? `<p class="paper-unavailable">${issues}</p>` : ""}${binding ? `<details class="workbench-f4__lineage" open><summary>${zh ? "权威证据谱系（只读）" : "Authoritative evidence lineage (read-only)"}</summary><dl>${reference(zh ? "配置版本" : "Configuration version", { id: binding.configurationRef?.versionId, version: "immutable", fingerprint: binding.configurationRef?.versionFingerprint })}${reference(zh ? "Pipeline / Graph" : "Pipeline / graph", binding.compiledGraphRef)}${reference(zh ? "数据集" : "Dataset", binding.datasetRef)}${reference(zh ? "回测配置" : "Backtest profile", binding.backtestProfileRef)}${reference(zh ? "Walk-Forward 候选集" : "Walk-Forward candidate set", binding.walkForwardCandidateSetRef)}${reference(zh ? "Walk-Forward 计划" : "Walk-Forward plan", binding.walkForwardPlanRef)}<div><dt>${zh ? "绑定版本" : "Binding version"}</dt><dd><code>${value(binding.bindingId)}</code> · v${value(binding.versionIndex)}<br><code>${value(binding.versionId)}</code> · <code>${value(binding.fingerprint)}</code><br>${zh ? "状态" : "Status"}: ${value(binding.lifecycleStatus)}</dd></div>${job(zh ? "回测 Job / Evidence" : "Backtest job / evidence", binding.backtestJob)}${job(zh ? "Walk-Forward Job / Evidence" : "Walk-Forward job / evidence", binding.walkForwardJob)}</dl></details>` : ""}${f4.nextAction ? `<p class="workbench-f4__next"><small>${zh ? "唯一下一动作" : "Only next action"}</small><br><button type="button" class="primary-action" data-f4-action="${value(f4.nextAction)}" data-f4-draft="">${value(f4.nextAction)}</button></p>` : ""}</div>`;
}
