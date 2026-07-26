import { z } from "zod";
import {
  ArtifactFingerprintSchema,
  MarketPackReferenceSchema,
  SemanticArtifactSchemaVersion,
  SemanticObservationWindowKindSchema,
  VersionedEntityReferenceSchema,
} from "./semantic-agent-artifacts.js";

const PresetStableIdSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/u, "stable_id_format");

export const SemanticPresetAvailabilitySchema = z.enum([
  "registered_available",
  "capability_required",
]);

export const SemanticPresetExecutionModeSchema = z.enum([
  "paper_capable",
  "research_only",
]);

export const SemanticPresetNodeRoleSchema = z.enum([
  "selector",
  "data_sync",
  "data_quality",
  "window_analysis",
  "bull_research",
  "bear_research",
  "research_synthesis",
  "decision",
  "portfolio",
  "risk",
  "execution",
  "position_monitor",
  "reflection",
]);

export const SemanticPresetAuthoritySchema = z.enum([
  "none",
  "decision_intent",
  "portfolio_action",
  "risk_gate",
  "execution",
]);

export const SemanticPresetObservationWindowSchema = z
  .object({
    id: PresetStableIdSchema,
    kind: SemanticObservationWindowKindSchema,
    label: z.string().min(1).max(120),
    unit: z.enum(["second", "minute", "hour", "day", "week", "month", "quarter"]),
    value: z.number().int().positive(),
    capabilityMode: z.enum(["native", "derived", "required"]),
  })
  .strict();

export const SemanticPresetNodeSchema = z
  .object({
    nodeId: PresetStableIdSchema,
    role: SemanticPresetNodeRoleSchema,
    agentTemplateId: PresetStableIdSchema.optional(),
    observationWindowIds: z.array(PresetStableIdSchema),
    authority: SemanticPresetAuthoritySchema,
    inputArtifactTypes: z.array(z.string().min(1).max(120)),
    outputArtifactTypes: z.array(z.string().min(1).max(120)),
  })
  .strict();

export const SemanticPresetEdgePolicySchema = z.enum(["required", "optional", "fallback"]);

export const SemanticPresetEdgeSchema = z
  .object({
    edgeId: PresetStableIdSchema,
    sourceNodeId: PresetStableIdSchema,
    targetNodeId: PresetStableIdSchema,
    artifactType: z.string().min(1).max(120),
    policy: SemanticPresetEdgePolicySchema,
    fallbackForEdgeId: PresetStableIdSchema.optional(),
  })
  .strict()
  .superRefine((edge, context) => {
    if (edge.policy === "fallback" && !edge.fallbackForEdgeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fallback_edge_requires_target_edge",
        path: ["fallbackForEdgeId"],
      });
    }
    if (edge.policy !== "fallback" && edge.fallbackForEdgeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "non_fallback_edge_cannot_target_fallback",
        path: ["fallbackForEdgeId"],
      });
    }
  });

export const SemanticPipelinePresetDefinitionSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    id: PresetStableIdSchema,
    version: z.string().min(1).max(80),
    displayName: z.string().min(1).max(160),
    description: z.string().min(1).max(2_000),
    fingerprint: ArtifactFingerprintSchema,
    lifecycleStatus: z.enum(["active", "draft", "superseded", "archived"]),
    createdAt: z.string().datetime({ offset: true }),
    availability: SemanticPresetAvailabilitySchema,
    executionMode: SemanticPresetExecutionModeSchema,
    marketPackRefs: z.array(MarketPackReferenceSchema).min(1),
    defaultDataSourceIds: z.array(PresetStableIdSchema),
    requiredCapabilityKinds: z.array(z.enum(["bar", "event", "report"])).min(1),
    graphVersionRef: VersionedEntityReferenceSchema,
    observationWindows: z.array(SemanticPresetObservationWindowSchema).min(1),
    nodes: z.array(SemanticPresetNodeSchema).min(1),
    edges: z.array(SemanticPresetEdgeSchema),
    compatibilityTarget: z
      .object({
        kind: z.enum(["current_fixed_pipeline", "contract_template"]),
        reference: PresetStableIdSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((preset, context) => {
    const nodeIds = new Set<string>();
    for (const [index, node] of preset.nodes.entries()) {
      if (nodeIds.has(node.nodeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "preset_node_id_duplicate",
          path: ["nodes", index, "nodeId"],
        });
      }
      nodeIds.add(node.nodeId);
    }

    const edgeIds = new Set<string>();
    for (const [index, edge] of preset.edges.entries()) {
      if (edgeIds.has(edge.edgeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "preset_edge_id_duplicate",
          path: ["edges", index, "edgeId"],
        });
      }
      edgeIds.add(edge.edgeId);
      if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "preset_edge_node_missing",
          path: ["edges", index],
        });
      }
    }

    const windowIds = new Set(preset.observationWindows.map((window) => window.id));
    for (const [index, node] of preset.nodes.entries()) {
      if (node.observationWindowIds.some((windowId) => !windowIds.has(windowId))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "preset_node_window_missing",
          path: ["nodes", index, "observationWindowIds"],
        });
      }
    }

    const authorities = new Map(
      preset.nodes.map((node) => [node.role, node.authority] as const),
    );
    const authorityExpected: ReadonlyArray<
      readonly [
        "decision" | "portfolio" | "risk" | "execution",
        "decision_intent" | "portfolio_action" | "risk_gate" | "execution",
      ]
    > = [
      ["decision", "decision_intent"],
      ["portfolio", "portfolio_action"],
      ["risk", "risk_gate"],
      ["execution", "execution"],
    ];

    if (preset.executionMode === "paper_capable") {
      for (const [role, authority] of authorityExpected) {
        if (authorities.get(role) !== authority) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "paper_preset_authority_chain_incomplete",
            path: ["nodes"],
          });
        }
      }

      const requiredChain = [
        ["decision", "portfolio"],
        ["portfolio", "risk"],
        ["risk", "execution"],
      ] as const;
      for (const [sourceRole, targetRole] of requiredChain) {
        const source = preset.nodes.find((node) => node.role === sourceRole);
        const target = preset.nodes.find((node) => node.role === targetRole);
        if (
          !source ||
          !target ||
          !preset.edges.some(
            (edge) =>
              edge.sourceNodeId === source.nodeId &&
              edge.targetNodeId === target.nodeId &&
              edge.policy === "required",
          )
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "paper_preset_required_action_edge_missing",
            path: ["edges"],
          });
        }
      }
    } else if (
      preset.nodes.some((node) =>
        ["portfolio_action", "risk_gate", "execution"].includes(node.authority),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "research_preset_cannot_form_execution_action",
        path: ["nodes"],
      });
    }

    const adjacency = new Map<string, string[]>();
    for (const node of preset.nodes) adjacency.set(node.nodeId, []);
    for (const edge of preset.edges) adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const hasCycle = (nodeId: string): boolean => {
      if (visiting.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;
      visiting.add(nodeId);
      if ((adjacency.get(nodeId) ?? []).some(hasCycle)) return true;
      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    };
    if (preset.nodes.some((node) => hasCycle(node.nodeId))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "preset_graph_cycle_not_allowed",
        path: ["edges"],
      });
    }
  });

export type SemanticPresetAvailability = z.infer<typeof SemanticPresetAvailabilitySchema>;
export type SemanticPresetExecutionMode = z.infer<typeof SemanticPresetExecutionModeSchema>;
export type SemanticPresetNodeRole = z.infer<typeof SemanticPresetNodeRoleSchema>;
export type SemanticPresetNode = z.infer<typeof SemanticPresetNodeSchema>;
export type SemanticPresetEdge = z.infer<typeof SemanticPresetEdgeSchema>;
export type SemanticPipelinePresetDefinition = z.infer<
  typeof SemanticPipelinePresetDefinitionSchema
>;
