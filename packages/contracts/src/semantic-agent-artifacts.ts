import { z } from "zod";

export const SemanticArtifactSchemaVersion = "1.0.0" as const;

const StableIdSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/u, "stable_id_format");

const HumanVersionSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[0-9A-Za-z][0-9A-Za-z._+-]*$/u, "human_version_format");

export const ArtifactFingerprintSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u, "fingerprint_format");

export const SemanticArtifactLifecycleStatusSchema = z.enum([
  "draft",
  "validated",
  "candidate",
  "approved",
  "rejected",
  "superseded",
  "archived",
]);

export const ArtifactSchemaReferenceSchema = z
  .object({
    schemaId: StableIdSchema,
    schemaVersion: HumanVersionSchema,
  })
  .strict();

export const VersionedEntityReferenceSchema = z
  .object({
    id: StableIdSchema,
    version: HumanVersionSchema,
    fingerprint: ArtifactFingerprintSchema,
  })
  .strict();

export const MarketPackReferenceSchema = VersionedEntityReferenceSchema;

export const SemanticObservationWindowKindSchema = z.enum([
  "bar_interval",
  "rolling_window",
  "event_batch",
  "reporting_period",
]);

export const SemanticObservationWindowReferenceSchema = VersionedEntityReferenceSchema.extend({
  kind: SemanticObservationWindowKindSchema,
}).strict();

export const ArtifactLineageReferenceSchema = z
  .object({
    lineageId: StableIdSchema,
    fingerprint: ArtifactFingerprintSchema,
    sourceDefinitionId: StableIdSchema,
    sourceCapabilityId: StableIdSchema,
    transformationVersion: HumanVersionSchema,
    timezone: z.string().min(1).max(80),
    tradingCalendarRef: z.string().min(1).max(160),
  })
  .strict();

const VersionedArtifactFields = {
  schemaVersion: z.literal(SemanticArtifactSchemaVersion),
  id: StableIdSchema,
  version: HumanVersionSchema,
  fingerprint: ArtifactFingerprintSchema,
  lifecycleStatus: SemanticArtifactLifecycleStatusSchema,
  createdAt: z.string().datetime({ offset: true }),
  marketPackRef: MarketPackReferenceSchema,
  schemaRef: ArtifactSchemaReferenceSchema,
};

export const OhlcvBarSchema = z
  .object({
    openedAt: z.string().datetime({ offset: true }),
    closedAt: z.string().datetime({ offset: true }),
    availableAt: z.string().datetime({ offset: true }),
    open: z.number().finite().nonnegative(),
    high: z.number().finite().nonnegative(),
    low: z.number().finite().nonnegative(),
    close: z.number().finite().nonnegative(),
    volume: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((bar, context) => {
    if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ohlcv_price_bounds_invalid",
        path: ["high"],
      });
    }
    if (bar.low > bar.high) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ohlcv_low_above_high",
        path: ["low"],
      });
    }
    if (Date.parse(bar.openedAt) >= Date.parse(bar.closedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ohlcv_interval_invalid",
        path: ["closedAt"],
      });
    }
    if (Date.parse(bar.availableAt) < Date.parse(bar.closedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ohlcv_available_before_close",
        path: ["availableAt"],
      });
    }
  });

const BarPayloadSchema = z
  .object({
    kind: z.literal("bar_interval"),
    symbol: z.string().min(1).max(80),
    bars: z.array(OhlcvBarSchema).min(1),
  })
  .strict();

const RollingSampleSchema = z
  .object({
    observedAt: z.string().datetime({ offset: true }),
    availableAt: z.string().datetime({ offset: true }),
    values: z.record(z.string(), z.number().finite()),
  })
  .strict();

const RollingPayloadSchema = z
  .object({
    kind: z.literal("rolling_window"),
    subject: z.string().min(1).max(120),
    samples: z.array(RollingSampleSchema).min(1),
  })
  .strict();

const EventRecordSchema = z
  .object({
    eventId: StableIdSchema,
    eventType: z.string().min(1).max(120),
    occurredAt: z.string().datetime({ offset: true }),
    availableAt: z.string().datetime({ offset: true }),
    headline: z.string().min(1).max(500),
    content: z.string().min(1).max(20_000),
    attributes: z
      .record(
        z.string(),
        z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
      )
      .default({}),
  })
  .strict();

const EventBatchPayloadSchema = z
  .object({
    kind: z.literal("event_batch"),
    topic: z.string().min(1).max(160),
    events: z.array(EventRecordSchema).min(1),
  })
  .strict();

const ReportingPeriodPayloadSchema = z
  .object({
    kind: z.literal("reporting_period"),
    subject: z.string().min(1).max(120),
    periodStartedAt: z.string().datetime({ offset: true }),
    periodEndedAt: z.string().datetime({ offset: true }),
    publishedAt: z.string().datetime({ offset: true }),
    metrics: z.record(z.string(), z.number().finite()),
    narrative: z.string().min(1).max(20_000).optional(),
  })
  .strict();

export const MarketObservationPayloadSchema = z.discriminatedUnion("kind", [
  BarPayloadSchema,
  RollingPayloadSchema,
  EventBatchPayloadSchema,
  ReportingPeriodPayloadSchema,
]);

export const MarketObservationArtifactSchema = z
  .object({
    ...VersionedArtifactFields,
    artifactType: z.literal("market_observation"),
    lifecycleStatus: z.enum(["validated", "archived"]),
    asOf: z.string().datetime({ offset: true }),
    availableAt: z.string().datetime({ offset: true }),
    observationWindowRef: SemanticObservationWindowReferenceSchema,
    lineage: ArtifactLineageReferenceSchema,
    payload: MarketObservationPayloadSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    if (artifact.observationWindowRef.kind !== artifact.payload.kind) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "observation_window_payload_kind_mismatch",
        path: ["payload", "kind"],
      });
    }
    if (Date.parse(artifact.availableAt) > Date.parse(artifact.asOf)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "observation_available_after_as_of",
        path: ["availableAt"],
      });
    }

    const payloadAvailability =
      artifact.payload.kind === "bar_interval"
        ? artifact.payload.bars.map((bar) => bar.availableAt)
        : artifact.payload.kind === "rolling_window"
          ? artifact.payload.samples.map((sample) => sample.availableAt)
          : artifact.payload.kind === "event_batch"
            ? artifact.payload.events.map((event) => event.availableAt)
            : [artifact.payload.publishedAt];

    if (payloadAvailability.some((availableAt) => Date.parse(availableAt) > Date.parse(artifact.asOf))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "observation_contains_future_data",
        path: ["payload"],
      });
    }
  });

export const SemanticArtifactReferenceSchema = z
  .object({
    artifactId: StableIdSchema,
    artifactType: z.string().min(1).max(120),
    fingerprint: ArtifactFingerprintSchema,
  })
  .strict();

export const SemanticEvidenceReferenceSchema = z
  .object({
    evidenceId: StableIdSchema,
    sourceArtifactRef: SemanticArtifactReferenceSchema,
    evidenceType: z.enum([
      "price_structure",
      "volume",
      "indicator",
      "event",
      "report",
      "position",
      "risk",
      "lesson",
      "agent_assessment",
    ]),
    locator: z.string().min(1).max(500),
    summary: z.string().min(1).max(2_000),
  })
  .strict();

export const SemanticDirectionSchema = z.enum([
  "bullish",
  "bearish",
  "neutral",
  "mixed",
  "not_applicable",
]);

export const AgentAssessmentKindSchema = z.enum([
  "window_analysis",
  "bull_case",
  "bear_case",
  "research_synthesis",
  "position_monitor",
]);

export const AgentSemanticAssessmentSchema = z
  .object({
    ...VersionedArtifactFields,
    artifactType: z.literal("agent_semantic_assessment"),
    lifecycleStatus: z.enum(["validated", "archived"]),
    assessmentKind: AgentAssessmentKindSchema,
    agentConfigRef: VersionedEntityReferenceSchema,
    observationWindowRef: SemanticObservationWindowReferenceSchema.optional(),
    direction: SemanticDirectionSchema,
    confidence: z.number().finite().min(0).max(1),
    regime: z.string().min(1).max(160),
    semanticThesis: z.string().min(1).max(20_000),
    supportingEvidence: z.array(SemanticEvidenceReferenceSchema).min(1),
    invalidationConditions: z.array(z.string().min(1).max(2_000)).min(1),
    riskFlags: z.array(z.string().min(1).max(160)).max(64),
    sourceArtifactRefs: z.array(SemanticArtifactReferenceSchema).min(1),
    lineageFingerprint: ArtifactFingerprintSchema,
  })
  .strict()
  .superRefine((assessment, context) => {
    if (assessment.assessmentKind === "window_analysis" && !assessment.observationWindowRef) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "window_analysis_requires_observation_window",
        path: ["observationWindowRef"],
      });
    }
  });

const LessonFields = {
  failedTradeRef: z
    .object({
      tradeId: StableIdSchema,
      decisionArtifactRef: SemanticArtifactReferenceSchema,
    })
    .strict(),
  semanticLesson: z.string().min(1).max(20_000),
  failurePattern: z.string().min(1).max(4_000),
  applicableMarketPackIds: z.array(z.union([StableIdSchema, z.literal("*")])).min(1),
  applicableRegimes: z.array(z.string().min(1).max(160)).min(1),
  confidence: z.number().finite().min(0).max(1),
  supportingEvidence: z.array(SemanticEvidenceReferenceSchema).min(1),
};

export const ReflectionLessonCandidateSchema = z
  .object({
    ...VersionedArtifactFields,
    artifactType: z.literal("reflection_lesson_candidate"),
    lifecycleStatus: z.literal("candidate"),
    reflectionAgentConfigRef: VersionedEntityReferenceSchema,
    ...LessonFields,
  })
  .strict();

export const ApprovedReflectionLessonSchema = z
  .object({
    ...VersionedArtifactFields,
    artifactType: z.literal("approved_reflection_lesson"),
    lifecycleStatus: z.literal("approved"),
    candidateRef: SemanticArtifactReferenceSchema,
    approval: z
      .object({
        approvalId: StableIdSchema,
        approvedBy: StableIdSchema,
        approvedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
    ...LessonFields,
  })
  .strict()
  .superRefine((lesson, context) => {
    if (lesson.candidateRef.artifactType !== "reflection_lesson_candidate") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "approved_lesson_candidate_ref_invalid",
        path: ["candidateRef", "artifactType"],
      });
    }
  });

const PortfolioSemanticStateSchema = z
  .object({
    asOf: z.string().datetime({ offset: true }),
    baseCurrency: z.string().min(3).max(12),
    equity: z.number().finite().nonnegative(),
    availableCash: z.number().finite().nonnegative(),
    openPositionRefs: z.array(SemanticArtifactReferenceSchema),
  })
  .strict();

const RiskSemanticStateSchema = z
  .object({
    asOf: z.string().datetime({ offset: true }),
    riskProfileId: StableIdSchema,
    newEntriesPaused: z.boolean(),
    closeOnly: z.boolean(),
    remainingRiskBudget: z.number().finite().min(0),
    activeFlags: z.array(z.string().min(1).max(160)),
  })
  .strict();

const DataQualitySemanticStateSchema = z
  .object({
    status: z.enum(["pass", "degraded", "fail"]),
    issueCodes: z.array(z.string().min(1).max(160)),
    checkedArtifactRefs: z.array(SemanticArtifactReferenceSchema).min(1),
  })
  .strict();

export const DecisionSemanticContextSchema = z
  .object({
    ...VersionedArtifactFields,
    artifactType: z.literal("decision_semantic_context"),
    lifecycleStatus: z.literal("validated"),
    asOf: z.string().datetime({ offset: true }),
    decisionAgentConfigRef: VersionedEntityReferenceSchema,
    observations: z.array(MarketObservationArtifactSchema).min(1),
    assessments: z.array(AgentSemanticAssessmentSchema).min(1),
    approvedLessons: z.array(ApprovedReflectionLessonSchema),
    portfolioState: PortfolioSemanticStateSchema,
    riskState: RiskSemanticStateSchema,
    dataQuality: DataQualitySemanticStateSchema,
    lineageFingerprints: z.array(ArtifactFingerprintSchema).min(1),
  })
  .strict()
  .superRefine((decisionContext, context) => {
    const marketId = decisionContext.marketPackRef.id;
    const artifactIndex = new Map<string, { fingerprint: string; lineageFingerprint: string }>();

    for (const observation of decisionContext.observations) {
      if (observation.marketPackRef.id !== marketId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "decision_market_pack_mismatch",
          path: ["observations"],
        });
      }
      artifactIndex.set(observation.id, {
        fingerprint: observation.fingerprint,
        lineageFingerprint: observation.lineage.fingerprint,
      });
    }

    for (const assessment of decisionContext.assessments) {
      if (assessment.marketPackRef.id !== marketId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "decision_market_pack_mismatch",
          path: ["assessments"],
        });
      }
      artifactIndex.set(assessment.id, {
        fingerprint: assessment.fingerprint,
        lineageFingerprint: assessment.lineageFingerprint,
      });
    }

    for (const [assessmentIndex, assessment] of decisionContext.assessments.entries()) {
      const matchedSources = assessment.sourceArtifactRefs.map((reference) => ({
        reference,
        source: artifactIndex.get(reference.artifactId),
      }));

      for (const matchedSource of matchedSources) {
        if (!matchedSource.source || matchedSource.source.fingerprint !== matchedSource.reference.fingerprint) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "semantic_source_artifact_missing_or_changed",
            path: ["assessments", assessmentIndex, "sourceArtifactRefs"],
          });
        }
      }

      if (
        !matchedSources.some(
          ({ source }) => source?.lineageFingerprint === assessment.lineageFingerprint,
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "semantic_lineage_mismatch",
          path: ["assessments", assessmentIndex, "lineageFingerprint"],
        });
      }
    }

    const requiredLineage = new Set([
      ...decisionContext.observations.map((observation) => observation.lineage.fingerprint),
      ...decisionContext.assessments.map((assessment) => assessment.lineageFingerprint),
    ]);
    const declaredLineage = new Set(decisionContext.lineageFingerprints);
    for (const fingerprint of requiredLineage) {
      if (!declaredLineage.has(fingerprint)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "decision_lineage_incomplete",
          path: ["lineageFingerprints"],
        });
      }
    }

    for (const [lessonIndex, lesson] of decisionContext.approvedLessons.entries()) {
      if (
        !lesson.applicableMarketPackIds.includes("*") &&
        !lesson.applicableMarketPackIds.includes(marketId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "approved_lesson_market_incompatible",
          path: ["approvedLessons", lessonIndex, "applicableMarketPackIds"],
        });
      }
    }
  });

export const SemanticDecisionIntentSchema = z.enum([
  "hold",
  "open_long",
  "open_short",
  "reduce",
  "close",
]);

export const SemanticDecisionArtifactSchema = z
  .object({
    ...VersionedArtifactFields,
    artifactType: z.literal("semantic_decision"),
    lifecycleStatus: z.literal("validated"),
    asOf: z.string().datetime({ offset: true }),
    decisionAgentConfigRef: VersionedEntityReferenceSchema,
    decisionContextRef: SemanticArtifactReferenceSchema,
    intent: SemanticDecisionIntentSchema,
    confidence: z.number().finite().min(0).max(1),
    semanticRationale: z.string().min(1).max(20_000),
    supportingEvidence: z.array(SemanticEvidenceReferenceSchema).min(1),
    riskFlags: z.array(z.string().min(1).max(160)),
    requiresPortfolioRiskChain: z.literal(true),
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.decisionContextRef.artifactType !== "decision_semantic_context") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "semantic_decision_context_ref_invalid",
        path: ["decisionContextRef", "artifactType"],
      });
    }
  });

export const LegacyMultiTimeframeWindowSchema = z
  .object({
    windowRef: SemanticObservationWindowReferenceSchema.extend({
      kind: z.literal("bar_interval"),
    }).strict(),
    lineage: ArtifactLineageReferenceSchema,
    bars: z.array(OhlcvBarSchema).min(1),
    availableAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const LegacyMultiTimeframeSnapshotLikeSchema = z
  .object({
    snapshotId: StableIdSchema,
    version: HumanVersionSchema,
    createdAt: z.string().datetime({ offset: true }),
    asOf: z.string().datetime({ offset: true }),
    symbol: z.string().min(1).max(80),
    marketPackRef: MarketPackReferenceSchema,
    observationSchemaRef: ArtifactSchemaReferenceSchema,
    windows: z.array(LegacyMultiTimeframeWindowSchema).min(1),
  })
  .strict();

export type ArtifactFingerprinter = (value: unknown) => string;

export function mapLegacyMultiTimeframeSnapshotToObservations(
  input: LegacyMultiTimeframeSnapshotLike,
  fingerprint: ArtifactFingerprinter,
): MarketObservationArtifact[] {
  const snapshot = LegacyMultiTimeframeSnapshotLikeSchema.parse(input);
  return snapshot.windows.map((window, index) => {
    const identity = {
      snapshotId: snapshot.snapshotId,
      windowRef: window.windowRef,
      lineage: window.lineage,
      bars: window.bars,
      asOf: snapshot.asOf,
    };
    return MarketObservationArtifactSchema.parse({
      schemaVersion: SemanticArtifactSchemaVersion,
      id: `${snapshot.snapshotId}:observation:${index}`,
      version: snapshot.version,
      fingerprint: fingerprint(identity),
      lifecycleStatus: "validated",
      createdAt: snapshot.createdAt,
      marketPackRef: snapshot.marketPackRef,
      schemaRef: snapshot.observationSchemaRef,
      artifactType: "market_observation",
      asOf: snapshot.asOf,
      availableAt: window.availableAt,
      observationWindowRef: window.windowRef,
      lineage: window.lineage,
      payload: {
        kind: "bar_interval",
        symbol: snapshot.symbol,
        bars: window.bars,
      },
    });
  });
}

export function createDecisionSemanticContext(
  input: z.input<typeof DecisionSemanticContextSchema>,
): DecisionSemanticContext {
  return DecisionSemanticContextSchema.parse(input);
}

export type ArtifactSchemaReference = z.infer<typeof ArtifactSchemaReferenceSchema>;
export type VersionedEntityReference = z.infer<typeof VersionedEntityReferenceSchema>;
export type MarketPackReference = z.infer<typeof MarketPackReferenceSchema>;
export type SemanticObservationWindowReference = z.infer<
  typeof SemanticObservationWindowReferenceSchema
>;
export type ArtifactLineageReference = z.infer<typeof ArtifactLineageReferenceSchema>;
export type OhlcvBar = z.infer<typeof OhlcvBarSchema>;
export type MarketObservationArtifact = z.infer<typeof MarketObservationArtifactSchema>;
export type SemanticArtifactReference = z.infer<typeof SemanticArtifactReferenceSchema>;
export type SemanticEvidenceReference = z.infer<typeof SemanticEvidenceReferenceSchema>;
export type AgentSemanticAssessment = z.infer<typeof AgentSemanticAssessmentSchema>;
export type ReflectionLessonCandidate = z.infer<typeof ReflectionLessonCandidateSchema>;
export type ApprovedReflectionLesson = z.infer<typeof ApprovedReflectionLessonSchema>;
export type DecisionSemanticContext = z.infer<typeof DecisionSemanticContextSchema>;
export type SemanticDecisionArtifact = z.infer<typeof SemanticDecisionArtifactSchema>;
export type LegacyMultiTimeframeWindow = z.infer<typeof LegacyMultiTimeframeWindowSchema>;
export type LegacyMultiTimeframeSnapshotLike = z.infer<
  typeof LegacyMultiTimeframeSnapshotLikeSchema
>;
