import assert from "node:assert/strict";
import test from "node:test";
import type {
  PipelineGraphVersion,
  PipelineValidationResult,
} from "../packages/contracts/src/index.js";
import {
  CURRENT_CRYPTO_PIPELINE_GRAPH,
  ImmutablePipelineRegistry,
  InMemoryPipelineDraftRepository,
  PipelineGraphCompiler,
  PipelineOrchestrationError,
  PipelineOrchestrationService,
  PipelinePromotionStage,
  calculatePipelineContentFingerprint,
} from "../packages/core/src/index.js";

const validResult = {
  valid: true,
  issues: [],
} as unknown as PipelineValidationResult;

const invalidResult = {
  valid: false,
  issues: [{ code: "SCHEMA_INCOMPATIBLE" }],
} as unknown as PipelineValidationResult;

function implementationBindings(graph: PipelineGraphVersion) {
  return graph.nodes.flatMap((node) => {
    const agentConfigId = (node as unknown as { agentConfigId?: string }).agentConfigId;
    return agentConfigId
      ? [{ agentConfigId, implementationKey: `backend:${agentConfigId}` }]
      : [];
  });
}

function createService(
  validator: (graph: PipelineGraphVersion) => PipelineValidationResult = () =>
    validResult,
) {
  const repository = new InMemoryPipelineDraftRepository();
  const registry = new ImmutablePipelineRegistry({
    implementationBindings: implementationBindings(CURRENT_CRYPTO_PIPELINE_GRAPH),
  });
  const compiler = new PipelineGraphCompiler(registry, validator);
  return {
    repository,
    compiler,
    service: new PipelineOrchestrationService(repository, compiler, validator),
  };
}

test("registry rejects duplicate backend implementation bindings", () => {
  assert.throws(
    () =>
      new ImmutablePipelineRegistry({
        implementationBindings: [
          { agentConfigId: "agent-config:x", implementationKey: "backend:x" },
          { agentConfigId: "agent-config:x", implementationKey: "backend:y" },
        ],
      }),
    (error: unknown) =>
      error instanceof PipelineOrchestrationError &&
      error.code === "DUPLICATE_REGISTRY_ID",
  );
});

test("compiler refuses graph nodes without backend-registered implementations", () => {
  const compiler = new PipelineGraphCompiler(
    new ImmutablePipelineRegistry(),
    () => validResult,
  );

  assert.throws(
    () => compiler.compile(CURRENT_CRYPTO_PIPELINE_GRAPH),
    (error: unknown) =>
      error instanceof PipelineOrchestrationError &&
      error.code === "UNREGISTERED_AGENT_IMPLEMENTATION",
  );
});

test("compiler creates a deterministic plan without applying it to runtime", () => {
  const { compiler } = createService();
  const first = compiler.compile(CURRENT_CRYPTO_PIPELINE_GRAPH);
  const second = compiler.compile(CURRENT_CRYPTO_PIPELINE_GRAPH);

  assert.deepEqual(first, second);
  assert.equal(first.runtimeApplied, false);
  assert.equal(first.steps.length, CURRENT_CRYPTO_PIPELINE_GRAPH.nodes.length);
  assert.equal(
    first.graphFingerprint,
    calculatePipelineContentFingerprint(CURRENT_CRYPTO_PIPELINE_GRAPH),
  );
  assert.ok(first.steps.find((step) => step.nodeId === "position-monitor"));
  assert.ok(first.steps.find((step) => step.nodeId === "reflection"));
});

test("compiler never emits a plan when graph validation fails", () => {
  const { compiler } = createService(() => invalidResult);
  assert.throws(
    () => compiler.compile(CURRENT_CRYPTO_PIPELINE_GRAPH),
    (error: unknown) =>
      error instanceof PipelineOrchestrationError &&
      error.code === "PIPELINE_VALIDATION_FAILED",
  );
});

test("stored graph versions are immutable and drafts never apply to runtime", () => {
  const { repository } = createService();
  const first = repository.save(CURRENT_CRYPTO_PIPELINE_GRAPH);
  const replay = repository.save(CURRENT_CRYPTO_PIPELINE_GRAPH);
  assert.deepEqual(first, replay);
  assert.equal(first.runtimeApplied, false);

  const changed = structuredClone(CURRENT_CRYPTO_PIPELINE_GRAPH) as unknown as {
    fingerprint: string;
  };
  changed.fingerprint = `${changed.fingerprint}-changed`;
  assert.throws(
    () => repository.save(changed),
    (error: unknown) =>
      error instanceof PipelineOrchestrationError &&
      error.code === "PIPELINE_VERSION_CONFLICT",
  );
});

test("promotion cannot skip contract, backtest, walk-forward, or human approval", () => {
  const { service } = createService();
  const draft = service.createDraft(CURRENT_CRYPTO_PIPELINE_GRAPH);

  assert.throws(
    () =>
      service.promote(
        draft.draftId,
        PipelinePromotionStage.paperRunning,
        "paper:run-1",
        "2026-07-26T00:00:00.000Z",
      ),
    (error: unknown) =>
      error instanceof PipelineOrchestrationError &&
      error.code === "PROMOTION_OUT_OF_ORDER",
  );
});

test("human approval requires an actor and the full promotion chain", () => {
  const { service } = createService();
  let draft = service.createDraft(CURRENT_CRYPTO_PIPELINE_GRAPH);
  draft = service.promote(
    draft.draftId,
    PipelinePromotionStage.contractValidated,
    "validation:current-crypto",
    "2026-07-26T00:00:00.000Z",
  );
  draft = service.promote(
    draft.draftId,
    PipelinePromotionStage.backtested,
    "backtest:run-1",
    "2026-07-26T00:01:00.000Z",
  );
  draft = service.promote(
    draft.draftId,
    PipelinePromotionStage.walkForwardValidated,
    "walk-forward:run-1",
    "2026-07-26T00:02:00.000Z",
  );

  assert.throws(
    () =>
      service.promote(
        draft.draftId,
        PipelinePromotionStage.humanApproved,
        "approval:ticket-1",
        "2026-07-26T00:03:00.000Z",
      ),
    (error: unknown) =>
      error instanceof PipelineOrchestrationError &&
      error.code === "HUMAN_APPROVER_REQUIRED",
  );

  draft = service.promote(
    draft.draftId,
    PipelinePromotionStage.humanApproved,
    "approval:ticket-1",
    "2026-07-26T00:03:00.000Z",
    "human:operator-1",
  );
  draft = service.promote(
    draft.draftId,
    PipelinePromotionStage.paperRunning,
    "paper:run-1",
    "2026-07-26T00:04:00.000Z",
  );

  assert.equal(draft.promotionStage, PipelinePromotionStage.paperRunning);
  assert.equal(draft.promotionEvidence.length, 5);
  assert.equal(draft.runtimeApplied, false);
});
