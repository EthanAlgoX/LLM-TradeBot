import assert from "node:assert/strict";
import test from "node:test";
import { renderWorkbenchF4Evidence } from "../apps/web/src/workbench-f4-view.js";

const fp = (character: string) => `sha256:${character.repeat(64)}`;

test("F4 view renders only authoritative lineage and the approval-required terminal state", () => {
  const html = renderWorkbenchF4Evidence({ gates: [{ id: "preflight", status: "passed" }, { id: "backtest", status: "succeeded" }, { id: "walk_forward", status: "succeeded" }], binding: { bindingId: "binding:f4", versionId: "binding:f4:v3", versionIndex: 3, fingerprint: fp("a"), lifecycleStatus: "evidence_ready", configurationRef: { versionId: "config:v1", versionFingerprint: fp("b") }, compiledGraphRef: { id: "graph:csv", version: "v1", fingerprint: fp("c") }, datasetRef: { id: "dataset:csv", version: "v1", fingerprint: fp("d") }, backtestProfileRef: { id: "profile:backtest", version: "v1", fingerprint: fp("e") }, walkForwardCandidateSetRef: { id: "candidates:wfv", version: "v1", fingerprint: fp("0") }, walkForwardPlanRef: { id: "plan:wfv", version: "v1", fingerprint: fp("1") }, backtestJob: { jobId: "job:backtest", status: "succeeded", evidenceRef: "evidence:backtest", evidenceFingerprint: fp("2") }, walkForwardJob: { jobId: "job:wfv", status: "succeeded", evidenceRef: "evidence:wfv", evidenceFingerprint: fp("3") } }, runtimeApplied: false }, "en-US");
  for (const text of ["EVIDENCE READY / APPROVAL REQUIRED", "Configuration version", "Pipeline / graph", "Dataset", "Backtest profile", "Walk-Forward candidate set", "Backtest job / evidence", "Walk-Forward job / evidence", "binding:f4:v3"]) assert.match(html, new RegExp(text));
  assert.doesNotMatch(html, /data-f4-action/);
});

test("F4 view keeps the only server-authorized next action and escapes error content", () => {
  const html = renderWorkbenchF4Evidence({ error: "<unsafe>" }, "zh-CN");
  assert.match(html, /&lt;unsafe&gt;/);
  const action = renderWorkbenchF4Evidence({ gates: [], nextAction: "preflight" }, "en-US");
  assert.match(action, /Only next action/);
  assert.match(action, /data-f4-action="preflight"/);
});

test("F4 view exposes immutable parent lineage without projecting evidence into a fresh version", () => {
  const html = renderWorkbenchF4Evidence({ configuration: { versionId: "config:v2", fingerprint: fp("4"), parentVersionId: "config:v1", parentFingerprint: fp("3") }, gates: [{ id: "preflight", status: "pending" }], nextAction: "preflight" }, "en-US");
  assert.match(html, /Parent version/);
  assert.match(html, /config:v1/);
  assert.match(html, /Only next action/);
  assert.doesNotMatch(html, /EVIDENCE READY/);
  assert.doesNotMatch(html, /Backtest job/);
});
