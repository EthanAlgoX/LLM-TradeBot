# TradeBot 项目进度与新窗口接手说明

> 快照时间：2026-07-26
> 用途：给下一开发窗口提供短而完整的上下文
> 权威产品定义：`../PRODUCT.md`
> 权威目标架构：`architecture-and-delivery-plan.md`

## 1. 已确认的方案

TradeBot 的目标不是固定币安链路，也不是聊天机器人交易页面，而是：

> 跨市场、可编排、可回测、可审计、可受控进化的 Multi-Agent 交易系统。

已经确认的关键决策：

1. 产品名统一为 **TradeBot**。
2. 默认提供多 Agent 模板，但用户可以增删 Agent、修改连线或创建简单/复杂 Pipeline。
3. 默认提供多周期/多窗口拆解，但不固定数量和粒度；单周期和事件驱动同样合法。
4. Data Source 必须先声明能力；不能假设一定有 `5m/15m/1h`，也不能从日线伪造分钟数据。
5. 使用 Market Pack 隔离 Crypto、A 股、港股、美股的市场规则和回测执行。
6. Data Source、Connector、Processing Agent 是三个不同层次。
7. 后端预先登记 Agent Template；Copilot 只能调用已安装能力创建结构化草案。
8. Copilot 不直接修改运行 Pipeline，不直接下单，不执行任意生成代码。
9. 所有变更走 Draft、校验、Backtest、Walk-Forward、人工审批、Paper Running。
10. Reflection 只产生 Lesson Candidate；经验验证通过后才能受限地进入 Decision Context。
11. 决策快循环和研究进化慢循环必须分离。
12. “暂停新开仓 / 仅允许平仓”是唯一立即生效的风险控制。

## 2. 当前已经实现

### Runtime

- TypeScript + Zod contracts；
- 固定依赖注入的 `DecisionPipeline`；
- Selector 候选排名，默认 `topN = 1`；
- CSV 历史行情；
- Binance Futures Public 只读行情；
- 固定 `5m/15m/1h` 快照与数据质量门；
- Analysis、Bull/Bear、Decision、Portfolio、Risk；
- Position Monitor；
- 本地 Paper Account 和模拟执行；
- 账户级风险与 Runtime Safety；
- DeepSeek 可选增强和规则 fallback；
- Reflection 基础。

### 审计和研究

- Stage Event / Trace；
- SQLite Agent Artifact Ledger；
- 按 trace/order 的 Trade Review；
- Strategy Profile、fingerprint、Run Manifest；
- 回测、参数实验、Baseline；
- Walk-Forward；
- Paper Journal 和运行状态读取。

### Web

- Vite + TypeScript + CSS；
- 运行控制台、Agent Lab、审计和连接配置原型；
- 中文/英文一键切换；
- Agent 节点、Review、Copilot 草案、Pause 确认等前端交互；
- LLM Provider、Paper/只读账户和 Secret 安全边界的 mock 配置体验。

## 3. 当前尚未实现

- Runtime HTTP API 或事件流；Web 仍主要是 mock data；
- Market Pack Registry；
- 通用 Data Source Registry；
- 数据源能力自动探测；
- 任意 Observation Window；
- 非 K 线 Market Event Artifact；
- Agent Template/Instance Registry；
- Pipeline Graph 持久化和 Compiler；
- Copilot 后端 tool endpoints；
- 真正的 Data Source/Agent/Pipeline 创建；
- Candidate Release/Approval 服务；
- 第二个市场及对应回测模拟；
- Lesson Candidate/Validated Lesson；
- Reflection 的证据验证、反事实、贡献度和消融闭环；
- 交易所写接口。

## 4. 当前代码中的已知固定假设

以下是需要逐步迁移的现状，不是目标设计：

- `MultiTimeframeSnapshot.stableBars` 固定为 `5m/15m/1h`；
- `MarketDataInput.timeframes` 固定为 `["5m","15m","1h"]`；
- `DecisionPipeline` 固定调用 Selector、Data、Analysis、Bull/Bear、Decision、Portfolio、Risk、Execution；
- `PipelineDependencies` 在构造时写死；
- `RunManifest.dataSource.kind` 主要覆盖 CSV 和 Binance Futures Public；
- Analysis 合同仍围绕 Crypto 技术分析语义；
- Web 没有真实 Registry/Compiler API。

迁移必须保持向后兼容，先给现有固定 Pipeline 建立 Manifest/Graph 表达，再替换调度器。

## 5. 下一窗口建议的第一个实施里程碑

建议第一个里程碑只做“合同和验证器垂直切片”：

1. 定义并测试：

   - `MarketPackDefinition`；
   - `DataSourceCapability`；
   - `ObservationWindow`；
   - `AgentTemplate` / `AgentConfig`；
   - `PipelineNode` / `PipelineEdge` / `PipelineGraphVersion`。

2. 为现有 Binance 和 CSV Adapter 输出 Capability。
3. 用 Pipeline Graph 描述当前固定链路，但暂时仍由原 `DecisionPipeline` 执行。
4. 实现纯函数式 Graph Validator：

   - Schema；
   - 市场；
   - 数据粒度；
   - 必需节点；
   - 禁止绕过 Risk；
   - 不兼容边；
   - 缺失数据处理策略。

5. 为以下场景建立 fixture：

   - `5m/15m/1h` 三周期；
   - 只有 `1d` 的单周期；
   - `1d/1w/1M` 多周期；
   - 只有新闻事件、没有 K 线；
   - 请求 5 分钟但数据只有日线，必须拒绝；
   - 由 5 分钟合法聚合 1 小时并保留 lineage。

这一里程碑不改订单行为，不接第二市场，不接实盘，不先做自由画布。

## 6. 实施时必须保留

- 当前用户未要求 Git commit；
- 工作区已有未提交的 Runtime、Web 和文档修改，不能覆盖无关改动；
- `selector.topN = 1` 表示从候选池只放行一个新标的，不是固定三个币；
- 当前持仓仍必须进入 Position Monitor；
- Web 中英文必须保持完整；
- API Key 不得写入浏览器持久状态、日志或 Artifact；
- Binance 写接口不在范围内；
- 每次交付运行 `npm run check`、`npm run test:ts`、`npm run build:web` 和 `git diff --check`。
# Orchestration Runtime loop handoff (2026-07-26)

TradeBot now has a local orchestration composition root that combines the current
Crypto Market Pack, Binance Futures Public and CSV Historical capability
manifests, registered Agent templates/configs, the pure Pipeline Graph Validator,
SQLite draft persistence, deterministic compilation, and the controlled HTTP API.

Start the local API with:

```bash
npm run dev:orchestration
```

Optional local configuration:

- `TRADEBOT_ORCHESTRATION_PORT`: loopback HTTP port, default `8787`.
- `TRADEBOT_ORCHESTRATION_DB_PATH`: SQLite file, default
  `tradebot-orchestration.sqlite`.

The server binds to `127.0.0.1` only. The API supports Catalog reads, Graph Draft
creation/readback, validation, deterministic compilation, and ordered promotion
evidence. It intentionally has no Runtime Apply, execution, exchange-write,
arbitrary Agent registration, or code upload route.

The Web orchestration workspace is API-first. It reads the registered current
Graph from the local Catalog before saving a Draft. When the API is unavailable,
the workspace explicitly reports `OFFLINE MOCK` and disables save, validate, and
compile actions. Existing canvas templates remain presentation fixtures until
they are promoted to registered backend Graph manifests.

Still pending:

- Authentication and authorization before any non-loopback deployment.
- Durable audit actor identity rather than caller-provided local actor IDs.
- Backtest and walk-forward job APIs that produce server-owned evidence.
- A separately approved adapter from an approved Paper Running plan to the
  existing DecisionPipeline. Compilation still returns `runtimeApplied=false`.
# Server-owned evidence and approval loop (2026-07-26)

Orchestration mutations now require a local Bearer token. Actor identity and
roles come from server configuration; request bodies cannot provide `actorId`.
When `TRADEBOT_ORCHESTRATION_TOKEN` is absent, the local CLI generates and prints
an ephemeral in-memory token once at startup. The Web console accepts this token
in a password field and keeps it in page memory only.

Backtest and walk-forward gates can no longer be advanced through a generic
promotion endpoint. A registered `PipelineEvidenceExecutor` must create a
server-owned Job. Successful Jobs generate immutable evidence IDs and
automatically advance only their corresponding gate. The default composition
uses `UnavailablePipelineEvidenceExecutor`, which records a failed Job rather
than pretending that a backtest ran.

Human approval is available only after successful walk-forward evidence. The
server derives the approver from the Bearer token and persists an approval audit
containing the Graph fingerprint plus the server-generated backtest and
walk-forward evidence references. The client cannot submit those fields.

New controlled routes:

- `GET /api/orchestration/session`
- `POST /api/orchestration/drafts/:id/jobs/backtest`
- `POST /api/orchestration/drafts/:id/jobs/walk-forward`
- `GET /api/orchestration/jobs/:jobId`
- `POST /api/orchestration/drafts/:id/approval`
- `GET /api/orchestration/approvals/:approvalId`

The removed `/promotions` route now returns `ROUTE_NOT_FOUND`. There is still no
Paper Running activation, Runtime Apply, execution, exchange-write, code upload,
or dynamic Agent registration route.
# Registered historical evidence artifacts (2026-07-26)

TradeBot now supports backend-registered historical evidence runners. A runner
is selected by server-owned Job kind, never by request input. Each registration
fixes the runner ID, Strategy Profile reference, Data Source reference, data
fingerprint, timezone, trading calendar, fee/slippage model, `asOf` provider, and
an explicit parameter allowlist.

Before invoking a registered runner, the server creates a strict Historical
Evidence Run Plan bound to the immutable Draft and Graph fingerprints. Results
are canonicalized under a server-configured artifact root. The artifact package
contains `manifest.json` and `result.json`, with separate SHA-256 hashes.
Artifact lineage and both hashes are also recorded in SQLite. Integrity
verification rejects modified files.

Evidence requests may provide an `idempotencyKey`, but cannot provide a runner,
module, command, code, output path, artifact reference, actor, or evidence ID.
SQLite maps `(draftId, kind, idempotencyKey)` to one Job across restarts. A
second idempotency key is rejected while a Job of the same kind is queued or
running for the Draft.

The composition root accepts `historicalRunners` and `artifactDirectory` only
from backend code. When no registered runners are supplied, it retains the
fail-closed unavailable executor. The CLI does not infer or dynamically load a
runner from environment input.

Remaining integration work is to implement backend registrations that adapt the
existing CSV Backtest and Walk-Forward application entry points into
`RegisteredHistoricalEvidenceRunner.run`. Those adapters must pass existing
run manifests and real experiment metrics through unchanged rather than
reimplementing DecisionPipeline behavior.
# Concrete CSV historical evidence runners (2026-07-26)

The orchestration composition can now register concrete rule-only CSV Backtest
and Walk-Forward runners through
`createCsvHistoricalEvidenceRunners`. These runners reuse the existing
`DecisionPipeline`, `PipelineBacktestService`,
`DeterministicWalkForwardValidator`, `CsvHistoricalCandleSource`, and
`SimulatedExecutionAgent`. Every trial receives isolated application and account
state. No trading logic is reimplemented and no LLM provider is enabled.

The runner factory loads a trusted server-side Strategy Profile and CSV path,
computes the CSV SHA-256 before registration, and fixes symbols, Data Source
reference, optimization grid, walk-forward plan, fee/slippage model, timezone,
calendar, and maximum trial count. The CSV hash is recomputed immediately before
each run. Changed content causes a failed Job and does not advance a gate.

To register both runners in the local orchestration CLI, configure:

- `TRADEBOT_HISTORICAL_CSV_PATH`
- `TRADEBOT_HISTORICAL_PROFILE_PATH`
- `TRADEBOT_HISTORICAL_SYMBOLS`

Optional server-owned configuration:

- `TRADEBOT_EVIDENCE_ARTIFACT_DIR`
- `TRADEBOT_WALK_FORWARD_GRID`
- `TRADEBOT_WALK_FORWARD_MODE`
- `TRADEBOT_WALK_FORWARD_TRAINING_CYCLES`
- `TRADEBOT_WALK_FORWARD_VALIDATION_CYCLES`
- `TRADEBOT_WALK_FORWARD_STEP_CYCLES`

The three required historical variables must be configured together. None of
these values are accepted from HTTP requests. If they are absent, the CLI keeps
the unavailable fail-closed executor.

Backtest artifacts include the real Backtest report and run manifest.
Walk-Forward artifacts include all training/validation folds, out-of-sample
metrics, parameter stability, and the run manifest. Tests verify that every
validation window begins strictly after its training window and that the
artifact data fingerprint matches the trusted CSV content.
# Approved Paper Plan 与显式激活门禁（2026-07-26）

- 已新增版本化 `ApprovedPaperPlan`、`PaperActivationRecord` 和 `PaperRuntimeControlState` Zod 合同。计划绑定 Graph、服务端审批、Backtest/Walk-Forward artifact、Strategy Profile、Data Source、Market Pack、Paper Account 和 Risk Policy fingerprint。
- 只有处于 `human_approved` 的不可变 Graph，且审批引用、Graph fingerprint、两类 Evidence、SQLite Artifact Ledger 和磁盘 artifact SHA-256 全部一致时，才可创建 `approved_ready` Paper Plan。
- 激活是第二次独立、认证的显式动作；它只生成 `activated_not_applied` 审计，`runtimeApplied=false`，不会调用 `DecisionPipeline`、Execution、订单接口或启动交易循环。
- `pause_new_openings_close_only` 是唯一受支持的即时控制面记录。当前尚无消费该状态的 Runtime Adapter，因此合同明确记录 `controlPlaneRecorded=true`、`runtimeApplied=false`，不伪造交易运行时已经应用。
- SQLite 仓储为 Plan、Activation、Control 提供不可变记录、幂等映射和唯一约束；受控 HTTP API 拒绝客户端 actor/evidence 注入。
- Web 编排桥接区可展示 Plan、Activation、close-only 与 `Runtime not applied` 状态。真实 Historical Runner 未配置时仍 fail closed。
# 受控 Paper Runtime Activation Adapter（2026-07-26）

- 已新增严格的 Paper Runtime Run/Cycle 合同、服务端 Binding Registry、SQLite Run/Cycle 审计、单计划并发锁、幂等启动和重启中断恢复。
- 只有完整通过 Approved Paper Plan、显式 Activation、Graph/Approval/Evidence/artifact 再校验，且命中服务端预注册 Paper Binding 的计划才能启动；客户端不能提交 symbols、cycles、间隔、模块或代码。
- `DecisionPipeline` 的 `CycleRequest` 新增可选 `executionMode`。缺省/`normal` 行为不变；`close_only` 仍运行 Position Monitor、Portfolio 和 Risk，但 Execution 只接受与当前持仓方向匹配的 `close_long/close_short`，拒绝任何新开仓。
- 每个 cycle 前重新读取持久化 control，并执行 Runtime Safety 检查；Safety 阻断发生在 TradingApplication 前。Run/Cycle 分别记录 control 是否实际应用、Safety 状态和执行数量。
- Paper Run 使用现有 `SequentialCycleRunner`，cycles、interval、Paper Account、Profile、Risk Policy 和 Application factory 全部由 binding 控制。Run 永久记录 `exchangeWriteAllowed=false`，未增加 Binance 或其他交易所写接口。
- 默认 composition 不注册 Paper Binding，因此生产入口继续 fail closed；只有后端显式注入可信 binding 时才开放实际 Paper Runtime。
- Web 编排桥接区显示 queued/running/completed/failed/safety_blocked、cycle 进度、control applied 与 `exchange write false`，不宣称真实交易。
# Current Crypto 具体 Paper Runtime Binding（2026-07-26）

- 已实现 `CurrentCryptoPaperRuntimeBinding`：严格加载 resolved Strategy Profile，固定 `selector.topN=1`，使用 Binance Futures Public 只读行情、现有 DecisionPipeline/Agents、Persistent Paper Execution、Position Monitor、Reflection 和 PaperSafetyGuard。
- Strategy Profile 引用与 CSV Evidence Runner 使用相同格式：`profileId@profileVersion:fingerprint`。Binding Registry 会再次核对 Profile、候选 symbols、Paper Account 和 Risk Policy。
- LLM-enabled Profile 当前 fail closed；本轮没有隐式创建 LLM provider，也没有增加任何交易所写客户端。
- Binding 的 SQLite Paper/Safety 状态跨 Run 持久化。每个有界 Run 完成、失败或 Safety 阻断后，Paper、Safety、Trace、Artifact 和 Reflection 资源都会显式关闭。
- Orchestration CLI 只在 `TRADEBOT_PAPER_PROFILE_PATH`、`TRADEBOT_PAPER_SYMBOLS`、`TRADEBOT_PAPER_DB_PATH`、`TRADEBOT_PAPER_ACCOUNT_ID`、`TRADEBOT_PAPER_SAFETY_DB_PATH` 全部存在时注册 Binding；部分配置直接拒绝启动。
- CLI 同时要求 Historical Evidence Runner 已配置，并强制 Paper 与 Historical 使用相同 resolved Profile 和候选 symbols。未配置时保持无 Binding、fail closed。
- 可选服务端配置：`TRADEBOT_PAPER_TRACE_DB_PATH`、`TRADEBOT_PAPER_ARTIFACT_DB_PATH`、`TRADEBOT_PAPER_REFLECTION_DB_PATH`、`TRADEBOT_PAPER_MAX_CYCLES`、`TRADEBOT_PAPER_INTERVAL_SECONDS`、`TRADEBOT_PAPER_MAX_CONSECUTIVE_FAILURES`、`TRADEBOT_PAPER_COOLDOWN_SECONDS`。

## 2026-07-26: Paper Runtime Preflight, Lease/Heartbeat, Stop/Drain

- Added strict Zod contracts for immutable Paper Runtime preflight reports/checks, fenced leases, and controlled stop records.
- Current Crypto concrete binding now requires a fresh passing preflight. It probes server-owned SQLite paths in rollback-only transactions and validates public ticker plus closed/fresh 5m, 15m, and 1h bars. Preflight never creates the execution agent, mutates a Paper Account, or enables exchange writes.
- Paper Runtime runs now acquire a durable SQLite lease with an owner, heartbeat, expiry, and monotonically increasing fencing token. A lost or replaced lease fails closed; expired leases become orphaned and are never auto-resumed after restart.
- Authenticated operators can request stop-after-current-cycle. The active Decision/Risk/Execution cycle is not interrupted, no future cycle starts, and the immutable stop record advances from requested to drained.
- Controlled HTTP routes expose plan preflight and per-run lease/stop state. The Web orchestration bridge shows these states and keeps `exchangeWriteAllowed=false`.
- Existing DecisionPipeline, Selector topN=1, candidate-pool semantics, Position Monitor, Paper Account, Risk, Execution, and Runtime Safety behavior remain unchanged.

## 2026-07-26: Durable Paper Runtime Supervisor and Operational Outbox

- Added strict supervision contracts for ordered operational events, durable incidents, authenticated acknowledgement, and terminal orphan clearance.
- Every configured Paper Runtime run writes a bounded, immutable SQLite event timeline/outbox with `outboxStatus=pending`, `deliveryConfigured=false`, and `exchangeWriteAllowed=false`; no third-party notifier is connected.
- Lease loss, orphaning, runtime failure, and resource-close failure create deduplicated durable incidents. Operator acknowledgement is idempotent and actor identity remains server-derived.
- Orphan clearance requires both a terminal orphaned Run and an orphaned/lost lease. It clears only the operational incident and explicitly records that no cycle, execution, Paper Account mutation, Runtime resume, or exchange write occurred.
- Operational journal failure before activation fails closed before Runtime resources or cycles are created. Journal failure after a cycle prevents subsequent cycles and terminates the bounded run.
- Controlled HTTP and Web orchestration expose event history, incident state, acknowledgement, and orphan clearance. External notification delivery remains intentionally unconfigured.
# 2026-07-26: Registered Operational Outbox Dispatcher

TradeBot now has a durable, registered-template operational event dispatcher.
The original operational journal remains immutable; per-event/template attempt,
retry, dead-letter, and replay state uses separate SQLite tables. A fenced
single-owner lease prevents concurrent dispatchers, retry uses capped
exponential backoff with an injectable clock, and interrupted `delivering`
records recover to `retry_wait`.

Only backend-registered in-memory test and local JSONL audit sinks exist. The
current composition registers none, so production startup performs no delivery
and no network request. Slack, email, and webhook remain explicitly
`not_configured`. Operator-only HTTP endpoints expose bounded state, explicit
dispatch, and payload-preserving dead-letter replay; actor, owner, target,
provider, path, headers, and code cannot be supplied by the client.

The Web app has a collapsed Operational Outbox monitor for lease, attempt,
retry, and dead-letter visibility. It does not imply an external delivery
channel exists. DecisionPipeline, Selector `topN=1`, Paper Account, Risk,
Execution, Runtime Safety, and exchange-write restrictions are unchanged.
# 2026-07-26: Durable Outbox Worker and Confirmed Retention

TradeBot now has a server-owned Operational Outbox Worker with immutable
schedule contracts, no-overlap execution, injectable scheduling, explicit
start/stop, and bounded dispatcher batches. The current composition registers a
disabled schedule, so startup does not create a background delivery loop.

Operational retention now follows `dry-run -> sealed Audit Export Manifest ->
operator confirmation -> candidate revalidation -> cleanup -> immutable
execution tombstone`. Only old events delivered through every active registered
template are eligible. Retry, pending, dead-letter, open delivery failure, open
Runtime incident, and orphaned Run state are protected. Candidate or fingerprint
drift fails closed.

The current 90-day policy is disabled and has `cleanupAllowed: false`; Web and
HTTP can display state and create a preview, but cannot enable cleanup. Client
bodies cannot provide schedule, owner, actor, target, URL, path, provider,
header, SQL, code, or trading parameters. Paper Account, Risk, Execution,
Runtime Safety, and exchange-write behavior remain unchanged.

---

## 2026-07-26 产品主线与交接入口

最新统一进度、缺口、后续里程碑和验收标准见 `docs/product-roadmap-and-progress.md`。

下一位实现者应从 M1“语义 Artifact 与 Preset 行为基线”开始，不再优先扩展运维通知、Outbox 或 Retention。最短正确路径是：

`Semantic Contracts + Presets → Historical Graph Executor → Graph Backtest + Walk-Forward`

关键事实：

- 当前固定 Crypto Pipeline 已有等价 Graph Manifest，但旧 LM Multi-Agent 的语义交接行为尚未完成通用合同化迁移。
- 当前任意 Graph 可以校验、注册和编译，但尚不能由通用 Executor 执行。
- 当前 CSV Backtest 与 Walk-Forward 服务于固定路径，尚不是任意 Graph 的统一证据执行器。
- Reflection 尚需收敛为 Lesson Candidate → Human Approval → Approved Lesson → Decision Context。
- Web 的编排和 Copilot 能力不得表现为已修改 Runtime。
- 当前真实运行市场仍主要是 Crypto；其他市场仍需 Market Pack、Connector、Capability、Calendar、Risk Profile 和证据垂直切片。
- 现有未提交 Runtime、Web 和文档改动属于用户，必须保留；不得重置、回退或覆盖。

## 2026-07-26 M1 Semantic Artifact 与 Preset 基线

新增：

- `packages/contracts/src/semantic-agent-artifacts.ts`
- `packages/contracts/src/semantic-pipeline-preset.ts`
- `packages/core/src/semantic-pipeline-presets.ts`
- `tests-ts/semantic-agent-artifacts-and-presets.test.ts`
- `docs/semantic-agent-artifacts-and-presets.md`

实现边界：

- 语义 thesis 与结构化 direction、confidence、regime、evidence、invalidation、risk flags、source refs 和 lineage 同时保留。
- Decision Context 只接受 Approved Lesson，严格拒绝未批准 Candidate 字段。
- Semantic Decision 只是 intent，不能绕过 Portfolio/Risk。
- 当前 Crypto Preset 是已注册行为基线；daily 和 event-only 是 `capability_required` 模板。
- Catalog 无客户端注册面。
- 旧固定 DecisionPipeline、Paper Runtime 和 Web 未修改。

下一实现者应进入 M2 Historical Graph Executor，不要在 M1 合同上直接接 Paper Runtime。
