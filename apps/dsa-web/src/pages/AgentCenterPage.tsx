import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Boxes,
  Check,
  CheckCircle2,
  GitBranch,
  Layers3,
  LoaderCircle,
  Network,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CapabilityLibraryPreview, WorkflowLibraryPanel } from "../components/capability";
import { StrategyLifecycleNav } from "../components/strategy/StrategyLifecycleNav";

import {
  agentFromTemplate,
  strategyWorkspaceApi,
  type Agent,
  type AgentTemplate,
  type AgentTemplateDetail,
  type AgentWorkflowSummary,
  type AgentWorkflowValidation,
  type AgentWorkflowVersion,
  type Connection,
} from "../api/strategyWorkspace";
import { AppPage, Card, PageHeader } from "../components/common";

type WorkflowItem = {
  workflow: AgentWorkflowSummary;
  version: AgentWorkflowVersion;
};
type AgentCenterTab = "capabilities" | "workflows";
type WorkflowView = "library" | "editor";
const agentTypeLabel: Record<Agent["agentType"], string> = {
  INPUT: "历史输入",
  SCREENING: "选股 Agent",
  ANALYSIS: "分析 Agent",
  DECISION: "决策 Agent",
  REFLECTION: "反思 Agent",
};

const llmTypeLabel: Record<Agent["agentType"], string> = {
  INPUT: "历史输入 LLM",
  SCREENING: "选股 LLM",
  ANALYSIS: "分析 LLM",
  DECISION: "决策 LLM",
  REFLECTION: "反思 LLM",
};

const versionLabel = (version: AgentWorkflowVersion) =>
  version.status === "PUBLISHED"
    ? `正式版本 V${version.versionNumber ?? "—"}`
    : `草稿 · revision ${version.revision}`;

const cloneVersion = (version: AgentWorkflowVersion) =>
  JSON.parse(JSON.stringify(version)) as AgentWorkflowVersion;

const llmDisplayName = (name: string) => name.replace(/\s*Agent$/i, " LLM");

function TabButton({
  active,
  id,
  controls,
  icon,
  label,
  description,
  onClick,
}: {
  active: boolean;
  id: string;
  controls: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-controls={controls}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      onKeyDown={(event) => {
        const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || []);
        const currentIndex = tabs.indexOf(event.currentTarget);
        const nextIndex = event.key === "ArrowRight" ? (currentIndex + 1) % tabs.length : event.key === "ArrowLeft" ? (currentIndex - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
        if (nextIndex >= 0) {
          event.preventDefault();
          tabs[nextIndex].focus();
          tabs[nextIndex].click();
        }
      }}
      className={`flex min-w-[164px] flex-1 items-center gap-3 border-b-2 px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 sm:min-w-[190px] ${active ? "border-cyan bg-cyan/5 text-foreground" : "border-transparent text-secondary-text hover:bg-hover/40 hover:text-foreground"}`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? "bg-cyan/15 text-cyan" : "bg-base text-muted-text"}`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold">{label}</span>
        <span className="mt-0.5 hidden text-xs text-secondary-text sm:block">
          {description}
        </span>
      </span>
    </button>
  );
}

function WorkflowBuilder({
  workflows,
  templates,
  selectedWorkflowId,
  legacyStrategyVersionId,
  onSelectWorkflow,
  onReload,
  onBack,
}: {
  workflows: WorkflowItem[];
  templates: AgentTemplate[];
  selectedWorkflowId?: number;
  legacyStrategyVersionId?: number;
  onSelectWorkflow: (workflow: WorkflowItem) => void;
  onReload: (versionId?: number) => Promise<void>;
  onBack: () => void;
}) {
  const selectedWorkflow = workflows.find((item) => item.version.id === selectedWorkflowId);
  const [draft, setDraft] = useState<AgentWorkflowVersion>();
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [validation, setValidation] = useState<AgentWorkflowValidation>();
  const [changeLog, setChangeLog] = useState("");
  const [newWorkflowName, setNewWorkflowName] = useState("");
  const [showNewWorkflow, setShowNewWorkflow] = useState(false);

  const restoreSnapshot = (workflow = selectedWorkflow) => {
    if (!workflow) return;
    const next = cloneVersion(workflow.version);
    setDraft(next);
    setSelectedAgentId(next.agents[0]?.id);
    setSelectedConnectionId(undefined);
    setDirty(false);
    setValidation(undefined);
    setMessage("");
  };

  useEffect(() => {
    restoreSnapshot(selectedWorkflow);
    // Reset only when the selected persisted workflow changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkflowId, workflows]);

  const editable = draft?.status === "DRAFT" && !draft.immutable;
  const agents = useMemo(() => draft?.agents ?? [], [draft?.agents]);
  const agentIds = useMemo(() => new Set(agents.map((agent) => agent.id)), [agents]);
  const connections = draft?.connections.filter((edge) => agentIds.has(edge.sourceAgentId) && agentIds.has(edge.targetAgentId)) ?? [];
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const selectedConnection = connections.find((edge) => edge.id === selectedConnectionId);
  const canvasWidth = Math.max(760, 70 + agents.length * 260);

  const changeDraft = (updater: (current: AgentWorkflowVersion) => AgentWorkflowVersion) => {
    if (!editable) return;
    setDraft((current) => (current ? updater(current) : current));
    setDirty(true);
    setValidation(undefined);
  };
  const updateAgent = (patch: Partial<Agent>) => selectedAgent && changeDraft((current) => ({ ...current, agents: current.agents.map((agent) => agent.id === selectedAgent.id ? { ...agent, ...patch } : agent) }));
  const updateConnection = (patch: Partial<Connection>) => selectedConnection && changeDraft((current) => ({ ...current, connections: current.connections.map((edge) => edge.id === selectedConnection.id ? { ...edge, ...patch } : edge) }));

  const toggleRelation = (otherId: string, direction: "upstream" | "downstream", checked: boolean) => {
    if (!selectedAgent) return;
    const sourceAgentId = direction === "upstream" ? otherId : selectedAgent.id;
    const targetAgentId = direction === "upstream" ? selectedAgent.id : otherId;
    changeDraft((current) => {
      const exists = current.connections.some((edge) => edge.sourceAgentId === sourceAgentId && edge.targetAgentId === targetAgentId);
      if (checked && !exists) return { ...current, connections: [...current.connections, { id: crypto.randomUUID(), sourceAgentId, targetAgentId, connectionType: "DATA_FLOW", fieldMapping: {} }] };
      if (!checked && exists) return { ...current, connections: current.connections.filter((edge) => edge.sourceAgentId !== sourceAgentId || edge.targetAgentId !== targetAgentId) };
      return current;
    });
  };

  const addTemplate = async (templateId: number) => {
    if (!draft || !editable) return;
    setBusy(`template-${templateId}`);
    try {
      const detail = await strategyWorkspaceApi.getAgentTemplate(templateId);
      const agent = agentFromTemplate(detail);
      agent.positionX = agents.length * 260;
      agent.positionY = 80;
      changeDraft((current) => ({ ...current, agents: [...current.agents, agent] }));
      setSelectedAgentId(agent.id);
      setSelectedConnectionId(undefined);
    } catch {
      setMessage("无法读取这个 LLM 配置。");
    } finally {
      setBusy("");
    }
  };

  const save = async (reload = true) => {
    if (!draft || !selectedWorkflow || !editable) return undefined;
    setBusy("save");
    setMessage("");
    try {
      const result = await strategyWorkspaceApi.saveAgentWorkflowDraft(draft, { name: selectedWorkflow.workflow.name, description: selectedWorkflow.workflow.description || "" });
      setDraft(result.draft);
      setDirty(false);
      setMessage("工作流草稿已保存到数据库。");
      if (reload) await onReload(result.draft.id);
      return result.draft;
    } catch {
      setMessage("保存失败；如果草稿已被其他页面修改，请刷新后重试。");
      return undefined;
    } finally {
      setBusy("");
    }
  };

  const check = async () => {
    let current = draft;
    if (dirty) current = await save(false);
    if (!current) return;
    setBusy("check");
    try {
      const result = await strategyWorkspaceApi.validateAgentWorkflow(current.id);
      setValidation(result);
      setMessage(result.valid ? "工作流检查已通过。" : `工作流仍有 ${result.errors.length} 个问题。`);
    } catch {
      setMessage("无法检查工作流，请稍后重试。");
    } finally {
      setBusy("");
    }
  };

  const publish = async () => {
    if (!changeLog.trim()) { setMessage("发布前请填写本次工作流变更说明。"); return; }
    let current = draft;
    if (dirty) current = await save(false);
    if (!current) return;
    setBusy("publish");
    try {
      const checked = await strategyWorkspaceApi.validateAgentWorkflow(current.id);
      setValidation(checked);
      if (!checked.valid) { setMessage(`工作流仍有 ${checked.errors.length} 个问题，不能发布。`); return; }
      const published = await strategyWorkspaceApi.publishAgentWorkflow(current.id, current.revision, changeLog.trim());
      setChangeLog("");
      setMessage(`工作流已正式发布为 V${published.versionNumber}。`);
      await onReload(published.id);
    } catch {
      setMessage("发布工作流失败，请确认草稿版本和检查结果。");
    } finally {
      setBusy("");
    }
  };

  const createWorkflow = async (fromStrategy = false) => {
    const name = newWorkflowName.trim() || (fromStrategy ? `策略编排 ${new Date().toLocaleString("zh-CN", { hour12: false })}` : "");
    if (!name) { setMessage("请输入工作流名称。"); return; }
    setBusy("create");
    try {
      const result = await strategyWorkspaceApi.createAgentWorkflow({ name, description: fromStrategy ? "从现有 StrategyVersion 编排导入。" : "", basedOnStrategyVersionId: fromStrategy ? legacyStrategyVersionId : undefined });
      setShowNewWorkflow(false);
      setNewWorkflowName("");
      setMessage("工作流草稿已创建。");
      await onReload(result.draft.id);
    } catch {
      setMessage("创建工作流失败，请检查名称是否重复。");
    } finally {
      setBusy("");
    }
  };

  const createDraftFromPublished = async () => {
    if (!selectedWorkflow || !draft) return;
    setBusy("fork");
    try {
      const created = await strategyWorkspaceApi.createAgentWorkflowDraft(selectedWorkflow.workflow.id, draft.id);
      await onReload(created.id);
    } catch {
      setMessage("无法创建草稿；该工作流可能已经有可编辑草稿。");
    } finally {
      setBusy("");
    }
  };

  return (
    <section id="capability-center-panel-workflows" aria-labelledby="capability-center-tab-workflows" role="tabpanel">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl"><button type="button" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-foreground" onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden="true" />返回工作流</button><h2 id="workflow-heading" className="text-xl font-semibold text-foreground">工作流编辑器</h2><p className="mt-2 text-sm leading-6 text-secondary-text">流程编排是工作流的编辑状态：把能力连接、检查并发布为可复用版本。当前编辑器继续读写真实工作流 API，旧 Agent 节点按兼容节点显示。</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={() => restoreSnapshot()} disabled={!dirty}><RefreshCw className="mr-1 inline h-4 w-4" aria-hidden="true" />放弃未保存修改</button><button type="button" className="btn-secondary" onClick={() => setShowNewWorkflow((value) => !value)}><Plus className="mr-1 inline h-4 w-4" aria-hidden="true" />新建工作流</button></div>
      </div>

      {showNewWorkflow ? <Card variant="bordered" padding="md" className="mb-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-sm text-foreground">工作流名称<input aria-label="新工作流名称" maxLength={120} value={newWorkflowName} onChange={(e) => setNewWorkflowName(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-base p-2.5" /></label><button type="button" className="btn-primary" disabled={busy === "create"} onClick={() => void createWorkflow(false)}>创建空白草稿</button>{legacyStrategyVersionId ? <button type="button" className="btn-secondary" disabled={busy === "create"} onClick={() => void createWorkflow(true)}>从当前策略编排导入</button> : null}</div></Card> : null}
      {legacyStrategyVersionId && !showNewWorkflow ? <div className="mb-4 flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-warning">这个入口来自尚未绑定独立工作流的旧 StrategyVersion。可将其真实 Agent 快照导入为工作流草稿。</p><button type="button" className="btn-secondary shrink-0" onClick={() => { setShowNewWorkflow(true); setNewWorkflowName("从现有策略导入的工作流"); }}>导入现有编排</button></div> : null}
      <div className="mb-4 border border-warning/30 bg-warning/5 px-4 py-3 text-sm leading-6 text-secondary-text"><span className="font-medium text-warning">兼容编辑模式</span><span className="ml-2">当前后端工作流版本仍保存旧 Agent 节点；页面不把它伪装成新的原子能力图。能力目录、类型端口与工具节点持久化将在后续接入。</span></div>
      {message ? <p role="status" className="mb-4 rounded-lg border border-border bg-base px-4 py-3 text-sm text-secondary-text">{message}</p> : null}

      {!workflows.length ? <Card variant="bordered" padding="lg"><p className="font-medium text-foreground">还没有工作流</p><p className="mt-1 text-sm text-secondary-text">新建空白工作流，或从现有策略版本导入真实编排。</p></Card> : (
        <div className="grid gap-4 xl:grid-cols-[210px_minmax(440px,1fr)_320px]">
          <aside className="space-y-4 self-start xl:sticky xl:top-6">
            <Card variant="bordered" padding="none" className="overflow-hidden"><div className="border-b border-border/70 px-4 py-3"><p className="font-semibold text-foreground">工作流版本</p><p className="mt-1 text-xs text-muted-text">数据库持久化编排</p></div><div className="divide-y divide-border/60">{workflows.map((item) => <button key={item.version.id} type="button" aria-pressed={item.version.id === selectedWorkflowId} onClick={() => onSelectWorkflow(item)} className={`w-full px-4 py-3 text-left transition-colors hover:bg-hover/50 ${item.version.id === selectedWorkflowId ? "bg-cyan/5" : ""}`}><span className="block truncate text-sm font-medium text-foreground">{item.workflow.name}</span><span className="mt-1 block text-xs leading-5 text-secondary-text">{versionLabel(item.version)} · {item.version.agentCount} 个 Agent</span>{item.version.outputContract ? <code className="mt-1 block text-[11px] text-cyan">输出 {item.version.outputContract}</code> : null}<span className={`mt-1 block text-[11px] ${item.version.status === "PUBLISHED" ? "text-success" : "text-warning"}`}>{item.version.status === "PUBLISHED" ? "可供策略选择" : "仅能力中心可编辑"}</span></button>)}</div></Card>
            <Card variant="bordered" padding="md"><div className="flex items-center gap-2"><Bot className="h-4 w-4 text-cyan" aria-hidden="true" /><p className="font-semibold text-foreground">加入 LLM 能力</p></div><p className="mt-1 text-xs leading-5 text-muted-text">真实保存为兼容 Agent 节点，并引用现有 LLM 配置版本。</p><div className="mt-3 space-y-2">{templates.map((template) => <button key={template.templateId} type="button" disabled={!editable || Boolean(busy)} onClick={() => void addTemplate(template.templateId)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2 text-left text-xs text-secondary-text transition-colors hover:border-cyan/50 hover:bg-cyan/5 disabled:opacity-50"><span className="min-w-0"><span className="block truncate font-medium text-foreground">{llmDisplayName(template.name)}</span><span>{llmTypeLabel[template.agentType]}</span></span>{busy === `template-${template.templateId}` ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4 text-cyan" aria-hidden="true" />}</button>)}</div></Card>
          </aside>

          <Card variant="gradient" padding="none" className="min-w-0 overflow-hidden">
            {selectedWorkflow && draft ? <>
              <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"><div><p className={`text-xs font-medium ${editable ? "text-warning" : "text-success"}`}>{editable ? "工作流草稿" : "已发布工作流"}</p><h3 className="mt-1 text-lg font-semibold text-foreground">{selectedWorkflow.workflow.name}</h3><p className="mt-1 text-sm text-secondary-text">{versionLabel(draft)} · {agents.length} 个 Agent · {connections.length} 条连接{draft.outputContract ? <> · 输出 <code className="text-cyan">{draft.outputContract}</code></> : null}</p></div>{!editable ? <button type="button" className="btn-secondary shrink-0" disabled={busy === "fork"} onClick={() => void createDraftFromPublished()}>基于此版本创建草稿</button> : null}</div>
              <div className="overflow-x-auto bg-base/25"><div className="relative h-[330px]" style={{ width: canvasWidth }} aria-label="流程编排画布"><svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">{connections.map((edge) => { const sourceIndex = agents.findIndex((agent) => agent.id === edge.sourceAgentId); const targetIndex = agents.findIndex((agent) => agent.id === edge.targetAgentId); if (sourceIndex < 0 || targetIndex < 0) return null; const x1 = 252 + sourceIndex * 260; const x2 = 52 + targetIndex * 260; const bend = Math.max(30, Math.abs(x2 - x1) / 2); return <path key={edge.id} d={`M ${x1} 155 C ${x1 + bend} 155, ${x2 - bend} 155, ${x2} 155`} fill="none" stroke="currentColor" strokeWidth="2" className={selectedConnectionId === edge.id ? "text-cyan" : "text-border"} />; })}</svg>{agents.map((agent, index) => { const active = agent.id === selectedAgentId && !selectedConnectionId; const upstream = connections.filter((edge) => edge.targetAgentId === agent.id).length; const downstream = connections.filter((edge) => edge.sourceAgentId === agent.id).length; return <button key={agent.id} type="button" data-testid={`workflow-agent-${agent.id}`} aria-pressed={active} onClick={() => { setSelectedAgentId(agent.id); setSelectedConnectionId(undefined); }} className={`absolute top-20 w-[200px] rounded-xl border p-4 text-left transition-colors ${active ? "border-cyan bg-cyan/10" : "border-border bg-surface hover:border-cyan/50"}`} style={{ left: 52 + index * 260 }}><span className="absolute -left-1.5 top-[68px] h-3 w-3 rounded-full border-2 border-cyan bg-base" /><span className="absolute -right-1.5 top-[68px] h-3 w-3 rounded-full border-2 border-cyan bg-base" /><span className="text-xs font-medium text-cyan">兼容节点 · {agentTypeLabel[agent.agentType]}</span><span className="mt-1 block truncate font-medium text-foreground">{agent.name}</span><span className="mt-2 block line-clamp-2 min-h-10 text-xs leading-5 text-secondary-text">{agent.role}</span><span className="mt-3 flex items-center justify-between border-t border-border/60 pt-2 text-[11px] text-muted-text"><span>上游 {upstream}</span><span>下游 {downstream}</span></span></button>; })}</div></div>
              <div className="border-t border-border/70 px-5 py-4"><div className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-cyan" aria-hidden="true" /><p className="text-sm font-medium text-foreground">连接与数据流</p></div><div className="mt-3 flex flex-wrap gap-2">{connections.length ? connections.map((edge) => <button key={edge.id} type="button" aria-pressed={selectedConnectionId === edge.id} onClick={() => { setSelectedConnectionId(edge.id); setSelectedAgentId(undefined); }} className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${selectedConnectionId === edge.id ? "border-cyan bg-cyan/10 text-foreground" : "border-border text-secondary-text hover:border-cyan/50"}`}>{agents.find((agent) => agent.id === edge.sourceAgentId)?.name ?? "未知"} → {agents.find((agent) => agent.id === edge.targetAgentId)?.name ?? "未知"}</button>) : <p className="text-sm text-muted-text">尚无连接。可在右侧节点配置中选择上下游。</p>}</div></div>
              {validation ? <div className={`mx-5 mt-4 rounded-lg border px-4 py-3 text-sm ${validation.valid ? "border-success/30 bg-success/5 text-success" : "border-danger/30 bg-danger/5 text-danger"}`}>{validation.valid ? <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />检查通过，可发布这个工作流。</span> : <div><p className="font-medium">检查发现 {validation.errors.length} 个问题：</p><ul className="mt-2 list-disc space-y-1 pl-5">{validation.errors.slice(0, 5).map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul></div>}</div> : null}
              <div className="border-t border-border/70 px-5 py-4">{editable ? <><label className="block text-sm text-foreground">发布变更说明<input aria-label="工作流发布说明" maxLength={4000} value={changeLog} onChange={(e) => setChangeLog(e.target.value)} placeholder="说明本次节点、Prompt 或连接变化" className="mt-1 w-full rounded-lg border border-border bg-base p-2.5" /></label><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn-secondary" disabled={Boolean(busy)} onClick={() => void check()}>检查工作流</button><button type="button" className="btn-secondary" disabled={!dirty || Boolean(busy)} onClick={() => void save()}>{busy === "save" ? "正在保存…" : "保存草稿"}</button><button type="button" className="btn-primary" disabled={Boolean(busy)} onClick={() => void publish()}>{busy === "publish" ? "正在发布…" : "发布工作流"}</button></div></> : <p className="text-sm text-secondary-text">正式工作流不可修改；策略选择后会冻结该版本的节点和连接快照。</p>}</div>
            </> : null}
          </Card>

          <Card variant="bordered" padding="lg" className="self-start xl:sticky xl:top-6"><div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-cyan" aria-hidden="true" /><h3 className="font-semibold text-foreground">{selectedConnection ? "连接配置" : selectedAgent ? "节点配置" : "选择一个节点"}</h3></div>
            {selectedConnection ? <div className="mt-5 space-y-4 text-sm"><p className="rounded-lg bg-base px-3 py-2 text-secondary-text">{agents.find((agent) => agent.id === selectedConnection.sourceAgentId)?.name} → {agents.find((agent) => agent.id === selectedConnection.targetAgentId)?.name}</p><label className="block text-foreground">连接类型<select aria-label="连接类型" disabled={!editable} value={selectedConnection.connectionType} onChange={(e) => updateConnection({ connectionType: e.target.value as Connection["connectionType"] })} className="mt-1 w-full rounded-lg border border-border bg-base p-2.5 disabled:opacity-70"><option value="DATA_FLOW">数据流</option><option value="POST_RUN_CONTEXT">运行后上下文</option></select></label><label className="block text-foreground">执行条件<input aria-label="连接执行条件" disabled={!editable} value={selectedConnection.condition || ""} onChange={(e) => updateConnection({ condition: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-base p-2.5 disabled:opacity-70" /></label></div> : selectedAgent ? <div className="mt-5 space-y-4 text-sm"><div className="rounded-lg border border-cyan/20 bg-cyan/5 px-3 py-2 text-xs leading-5 text-secondary-text">兼容节点引用固定 LLM 配置版本；旧工作流允许覆盖职责和 Prompt，但尚未包含完整 Agent 的前置工具图。</div><label className="block text-foreground">节点名称<input aria-label="工作流节点名称" disabled={!editable} value={selectedAgent.name} onChange={(e) => updateAgent({ name: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-base p-2.5 disabled:opacity-70" /></label><label className="block text-foreground">节点职责<textarea aria-label="工作流节点职责" disabled={!editable} value={selectedAgent.role} onChange={(e) => updateAgent({ role: e.target.value })} className="mt-1 min-h-20 w-full rounded-lg border border-border bg-base p-2.5 disabled:opacity-70" /></label><label className="block text-foreground">System Prompt<textarea aria-label="工作流节点 System Prompt" disabled={!editable} value={selectedAgent.systemPrompt} onChange={(e) => updateAgent({ systemPrompt: e.target.value })} className="mt-1 min-h-32 w-full rounded-lg border border-border bg-base p-2.5 disabled:opacity-70" /></label>{(["upstream", "downstream"] as const).map((direction) => <div key={direction} className="border-t border-border/70 pt-4"><p className="font-medium text-foreground">{direction === "upstream" ? "上游 Agent" : "下游 Agent"}</p><div className="mt-2 space-y-2">{agents.filter((agent) => agent.id !== selectedAgent.id).map((agent) => { const checked = connections.some((edge) => direction === "upstream" ? edge.sourceAgentId === agent.id && edge.targetAgentId === selectedAgent.id : edge.sourceAgentId === selectedAgent.id && edge.targetAgentId === agent.id); return <label key={agent.id} className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-secondary-text"><input type="checkbox" disabled={!editable} aria-label={`${agent.name} 作为${direction === "upstream" ? "上游" : "下游"}`} checked={checked} onChange={(e) => toggleRelation(agent.id, direction, e.target.checked)} /><span className="min-w-0 flex-1 truncate">{agent.name}</span>{checked ? <Check className="h-3.5 w-3.5 text-cyan" aria-hidden="true" /> : null}</label>; })}</div></div>)}{editable ? <button type="button" className="inline-flex items-center gap-1 text-sm text-danger" onClick={() => { changeDraft((current) => ({ ...current, agents: current.agents.filter((agent) => agent.id !== selectedAgent.id), connections: current.connections.filter((edge) => edge.sourceAgentId !== selectedAgent.id && edge.targetAgentId !== selectedAgent.id) })); setSelectedAgentId(undefined); }}><Trash2 className="h-4 w-4" />删除节点</button> : null}</div> : <p className="mt-4 text-sm leading-6 text-secondary-text">点击画布中的 Agent 节点或连接查看配置。</p>}
          </Card>
        </div>
      )}
    </section>
  );
}

export default function AgentCenterPage() {
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab");
  const requestedEditor = requestedTab === "composer" || params.get("view") === "editor" || params.has("workflowVersionId") || params.has("versionId");
  const tab: AgentCenterTab = requestedEditor || requestedTab === "workflows" ? "workflows" : "capabilities";
  const workflowView: WorkflowView = requestedEditor ? "editor" : "library";
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplateDetail>();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  const loadTemplate = async (templateId: number) => {
    setDetailLoading(true);
    try { setSelectedTemplate(await strategyWorkspaceApi.getAgentTemplate(templateId)); }
    catch { setError("无法读取这个 LLM 配置的详细信息。"); }
    finally { setDetailLoading(false); }
  };

  const reloadTemplates = async (preferredTemplateId?: number) => {
    setError("");
    try {
      const catalog = await strategyWorkspaceApi.listAgentTemplates();
      const llmCatalog = catalog.filter((template) => template.agentType !== "INPUT");
      setTemplates(llmCatalog);
      const templateId = preferredTemplateId || llmCatalog[0]?.templateId;
      if (templateId) await loadTemplate(templateId);
      else setSelectedTemplate(undefined);
    } catch {
      setError("无法刷新 LLM 能力库，请检查服务连接后重试。");
    }
  };

  const load = async (preferredVersionId?: number, preferredTemplateId?: number) => {
    setLoading(true);
    setError("");
    try {
      // Seed/read the template library before the starter workflow consumes
      // those templates on a brand-new database.
      const catalog = await strategyWorkspaceApi.listAgentTemplates();
      const llmCatalog = catalog.filter((template) => template.agentType !== "INPUT");
      const workflowCatalog = await strategyWorkspaceApi.listAgentWorkflows();
      const targets = workflowCatalog.flatMap((workflow) => {
        const id = workflow.activeDraftVersionId ?? workflow.currentPublishedVersionId;
        return id ? [{ workflow, id }] : [];
      });
      const versions = await Promise.all(targets.map(async ({ workflow, id }) => ({ workflow, version: await strategyWorkspaceApi.getAgentWorkflowVersion(id) })));
      setTemplates(llmCatalog);
      setWorkflows(versions);
      const requested = preferredVersionId || Number(params.get("workflowVersionId")) || undefined;
      const selected = versions.find((item) => item.version.id === requested) || versions[0];
      setSelectedWorkflowId(selected?.version.id);
      if (selected && (preferredVersionId || workflowView === "editor")) setParams({ tab: "workflows", view: "editor", workflowId: String(selected.workflow.id), workflowVersionId: String(selected.version.id) });
      const templateId = preferredTemplateId || llmCatalog[0]?.templateId;
      if (templateId) await loadTemplate(templateId);
      else setSelectedTemplate(undefined);
    } catch { setError("无法读取 LLM 配置或工作流，请检查服务连接后重试。"); }
    finally { setLoading(false); }
  };

  // URL parameters only seed the first selection; subsequent changes use the
  // explicit tab and workflow handlers below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const changeTab = (next: AgentCenterTab) => {
    setParams({ tab: next });
  };
  const selectWorkflow = (item: WorkflowItem) => {
    setSelectedWorkflowId(item.version.id);
    setParams({ tab: "workflows", view: "editor", workflowId: String(item.workflow.id), workflowVersionId: String(item.version.id) });
  };
  const openWorkflowEditor = (item?: WorkflowItem) => {
    if (item) {
      selectWorkflow(item);
      return;
    }
    setParams({ tab: "workflows", view: "editor" });
  };
  const closeWorkflowEditor = () => {
    setParams({ tab: "workflows" });
  };
  return (
    <AppPage className="space-y-6">
      <div className="hidden" aria-hidden="true" dangerouslySetInnerHTML={{ __html: "<!-- THESIS: 能力中心是从原子能力到可调用工作流的装配台，不是 Agent 配置堆栈。 OWN-WORLD: 延续冷瓷白/石墨工作台、矿物细线与单一钴蓝操作信号。 STORY: 先识别能力，再检查工作流契约，最后进入编排。 FIRST VIEWPORT: 标题下直接展示原子能力到黑盒工作流再到产品调用的水平装配轨。 FORM: 操作型契约装配台，结构候选 6，seed 0beffdd3。 -->" }} />
      <PageHeader eyebrow="Capability center" title="能力中心" description="把数据输入、确定性工具、评级、规则和 LLM 组合成可复用工作流；策略、回测与运行只调用冻结后的工作流版本。" />

      <section className="workspace-surface overflow-hidden p-0" aria-labelledby="capability-contract-heading">
        <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-xs font-medium text-warning">统一工作流调用契约 · 后续接入</p><h2 id="capability-contract-heading" className="mt-1 font-semibold text-foreground">内部自由组合，外部稳定调用</h2></div>
          <p className="max-w-xl text-xs leading-5 text-secondary-text">LLM 能力已使用真实版本 API；工作流现阶段仍通过兼容 Agent 节点保存，后续再统一原子能力调用契约。</p>
        </div>
        <div className="px-5 py-5">
          <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[1fr_auto_1.05fr_auto_1.55fr]">
            <div className="border border-border bg-base/35 p-4"><div className="flex items-center gap-2"><Boxes className="h-4 w-4 text-primary" aria-hidden="true" /><p className="text-sm font-semibold text-foreground">原子能力</p></div><p className="mt-2 text-xs leading-5 text-secondary-text">输入 · 工具 · 评级 · 规则 · LLM · 输出</p></div>
            <ArrowRight className="h-4 w-4 rotate-90 self-center justify-self-center text-muted-text sm:rotate-0" aria-hidden="true" />
            <div className="border border-primary/25 bg-primary/5 p-4"><div className="flex items-center gap-2"><Network className="h-4 w-4 text-primary" aria-hidden="true" /><p className="text-sm font-semibold text-foreground">工作流版本</p></div><p className="mt-2 text-xs leading-5 text-secondary-text">有类型的连线 · 冻结契约 · 可校验版本</p></div>
            <ArrowRight className="h-4 w-4 rotate-90 self-center justify-self-center text-muted-text sm:rotate-0" aria-hidden="true" />
            <div className="grid grid-cols-2 gap-px border border-border bg-border text-center sm:grid-cols-4">
              <Link to="/stock-research" className="bg-surface px-3 py-4 transition-colors hover:bg-hover/70"><span className="text-xs font-medium text-foreground">单股研究</span><span className="mt-1 block text-[10px] text-muted-text">ResearchReport</span></Link>
              <Link to="/strategies" className="bg-surface px-3 py-4 transition-colors hover:bg-hover/70"><span className="text-xs font-medium text-foreground">策略中心</span><span className="mt-1 block text-[10px] text-muted-text">DecisionProposal</span></Link>
              <Link to="/backtests" className="bg-surface px-3 py-4 transition-colors hover:bg-hover/70"><span className="text-xs font-medium text-foreground">验证中心</span><span className="mt-1 block text-[10px] text-muted-text">验证版本</span></Link>
              <Link to="/runs" className="bg-surface px-3 py-4 transition-colors hover:bg-hover/70"><span className="text-xs font-medium text-foreground">运行中心</span><span className="mt-1 block text-[10px] text-muted-text">调用版本</span></Link>
            </div>
          </div>
        </div>
      </section>

      <div className="hidden sm:block"><StrategyLifecycleNav current="agents" /></div>
      <nav aria-label="策略工作链" className="workspace-surface p-3 sm:hidden">
        <p className="text-sm font-semibold text-foreground">当前：能力中心</p>
        <p className="mt-1 text-xs leading-5 text-secondary-text">准备可复用组件与数据，再进入策略、回测和运行。</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Link to="/data" className="border border-border px-2.5 py-1.5 text-secondary-text">数据中心</Link>
          <Link to="/strategies" className="border border-border px-2.5 py-1.5 text-secondary-text">策略中心</Link>
          <Link to="/backtests" className="border border-border px-2.5 py-1.5 text-secondary-text">验证中心</Link>
          <Link to="/runs" className="border border-border px-2.5 py-1.5 text-secondary-text">运行中心</Link>
        </div>
      </nav>

      <Card variant="bordered" padding="none">
        <div role="tablist" aria-label="能力中心视图" className="flex overflow-x-auto">
          <TabButton id="capability-center-tab-capabilities" controls="capability-center-panel-capabilities" active={tab === "capabilities"} icon={<Boxes className="h-4 w-4" />} label="能力库" description="原子输入、工具、规则与 LLM" onClick={() => changeTab("capabilities")} />
          <TabButton id="capability-center-tab-workflows" controls="capability-center-panel-workflows" active={tab === "workflows"} icon={<Layers3 className="h-4 w-4" />} label="工作流" description="默认流程、我的版本与编排编辑" onClick={() => changeTab("workflows")} />
        </div>
      </Card>
      {error ? <div role="alert" className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 sm:flex-row sm:items-center sm:justify-between"><span className="flex items-center gap-2 text-sm text-danger"><AlertTriangle className="h-4 w-4" />{error}</span><button type="button" className="btn-secondary" onClick={() => void load()}>重新加载</button></div> : null}
      {loading ? <Card variant="bordered" padding="lg"><div className="flex items-center gap-2 text-sm text-secondary-text"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取能力与工作流数据…</div></Card> : tab === "capabilities" ? <CapabilityLibraryPreview templates={templates} selectedTemplate={selectedTemplate} detailLoading={detailLoading} onSelectTemplate={(id) => void loadTemplate(id)} onReloadTemplates={reloadTemplates} onOpenComposer={() => openWorkflowEditor()} /> : workflowView === "library" ? <WorkflowLibraryPanel workflows={workflows} onOpenComposer={openWorkflowEditor} /> : <WorkflowBuilder workflows={workflows} templates={templates} selectedWorkflowId={selectedWorkflowId} legacyStrategyVersionId={Number(params.get("versionId")) || undefined} onSelectWorkflow={selectWorkflow} onBack={closeWorkflowEditor} onReload={async (id) => { await load(id); }} />}
    </AppPage>
  );
}
