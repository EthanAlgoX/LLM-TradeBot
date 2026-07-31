# TradeBot 项目进度与新窗口接手说明

> 快照时间：2026-07-27
> 用途：让新开发窗口直接继续，不重复产品脑暴或已完成里程碑
> 产品定义：`../PRODUCT.md`
> 架构基线：`architecture-and-delivery-plan.md`
> 当前路线图：`product-roadmap-and-progress.md`

## 1. 一句话状态

TradeBot 已完成从架构合同到受控 Current Crypto Paper Runtime、Graph 历史证据链、真实 Runtime Evidence Dashboard 和 Conversation-first Draft Orchestration 的纵向基础；下一阶段进入 Causal Run / Trade Review。

## 2. 新窗口必须保留的事实

- 产品名只能使用 **TradeBot**，不要再使用 TradeBoard。
- 工作区包含大量尚未提交的 Runtime、Web、测试、SQLite 和文档修改，均属于用户当前工作成果。
- 不执行 `git reset`、`git checkout --` 或其他破坏性命令。
- 不覆盖或回退无关改动。
- 除非用户明确要求，不提交 Git。
- `selector.topN=1` 保持不变；symbols 只是候选池。
- 当前持仓继续进入 Position Monitor。
- 不重写现有 `DecisionPipeline`。
- 不改变 Paper Account、Risk、Execution 和 Runtime Safety 的核心行为。
- 不增加 Binance 或其他交易所写接口。

## 3. 当前已经实现

### 3.1 架构与 Graph

- 严格 Zod 架构合同、Capability Manifest 和 Data Lineage。
- Binance Futures Public 与 CSV Historical Source 能力声明。
- Pipeline Graph Validator，覆盖 Schema、Market、Source、Window、聚合、DAG、Fallback 和执行权限。
- 当前固定 Crypto Pipeline 的等价 Graph Manifest。
- SQLite Graph Draft、Registry、Validator、Compiler 和 Bearer-authenticated HTTP。

### 3.2 语义 Multi-Agent 与历史证据

- Market Observation、Semantic Assessment、Decision Context、Semantic Decision、Lesson Candidate 和 Approved Lesson 边界。
- Current Crypto、daily、event-only Preset Catalog。
- 后端注册 Historical Graph Plan、Node Executor、typed Artifact 和 DAG Executor。
- Graph Backtest、Walk-Forward、隔离 Session、Durable Evidence Job、幂等、lease 和 artifact verification。
- Configuration Draft、PipelineGraph Historical Bridge、Strategy Evidence Binding 和 staleness 检测。
- Human Approval 和 Approved Paper Plan。

### 3.3 Current Crypto Paper Runtime

- 服务端预注册 Current Crypto Binding。
- 复用现有 DecisionPipeline、Selector `topN=1`、Position Monitor、Portfolio、Risk、Persistent Paper Execution、Safety 和 Reflection。
- Approved Plan、Activation、只读 Preflight、lease、heartbeat、fencing、stop/drain 和 close-only。
- Incident、orphan detection/clearance、Operational Outbox、Dispatcher、Worker 和 Retention 基础。
- 永久 `exchangeWriteAllowed=false`。

### 3.4 Web 与 Runtime Evidence

- Paper Runtime 控制条：Preflight、Start、Pause Openings、Safe Stop。
- 运行会话恢复和 active/terminal Run 收敛。
- 只读 Runtime Evidence API 和严格 Zod Read Model。
- 有真实证据时替换静态 SAMPLE；无证据时保留 SAMPLE。
- ACTIVE 使用短轮询，终态显示 RECENT，不伪装为实时。
- 展示 Paper Account、Position Monitor、Selector、Cycle、Agent Artifact、Decision/Risk/Execution、Reflection 和 lineage。
- 中英文和 1440×900 / 820×760 响应式布局已检查。

### 3.5 Conversation-first Draft Orchestration

- 严格 Zod 合同：`ConversationCommand`、`ConversationContext`、`RegisteredToolCall/Result`、`DraftProposal/Change`、`ValidationSummary`、`EvidenceGateSummary` 和 `ConversationAssistantResponse`。
- 后端注册 15 个受控 Copilot Tool；工具调用现有 Intent Compiler、Pipeline Draft、Configuration Draft、Graph Validator、Evidence Workflow 和 Approval，不建立第二套实现。
- Current Crypto 对话创建真实持久化 Pipeline Draft 与 Configuration Draft，返回稳定版本、fingerprint、5m/15m/1h Capability 和 `runtimeApplied=false`。
- 只读 Daily Research Source 只有 1d 能力；请求 5m 返回稳定的 `UPSAMPLING_FORBIDDEN` / `OBSERVATION_WINDOW_UNSUPPORTED`，不创建版本。
- Analysis Agent 允许参数可创建不可变新版本和字段 Diff；父 fingerprint 冲突、禁止字段与未注册实体 fail closed；已有 Evidence 自动 stale。
- Bearer Auth 在服务端派生 Actor/Role；请求合同拒绝客户端 Runner、Evidence、Approval、代码、SQL、URL、路径、Secret、Runtime 与 Risk bypass 参数。
- Web Copilot 抽屉已接真实 API，展示当前 Market/Source/Preset/Draft、Proposal、Diff、Capability、窗口、稳定 Issue code、发布门禁、只读 Graph 预览和 Runtime 隔离。
- Copilot 没有 Start、Pause、Safe Stop、下单或 Runtime Apply 工具；现有 Runtime Controls 不变。

## 4. 最近新增文件重点

Runtime Evidence 本轮核心文件：

- `packages/contracts/src/runtime-evidence-read-model.ts`
- `packages/runtime/src/runtime-evidence-read-model.ts`
- `packages/runtime/src/runtime-evidence-http.ts`
- `apps/web/src/runtime-evidence-api.ts`
- `apps/web/src/runtime-evidence-view-state.ts`
- `apps/web/src/runtime-evidence.css`
- `tests-ts/runtime-evidence-read-model.test.ts`
- `tests-ts/runtime-evidence-view-state.test.ts`

Conversation-first Orchestration 核心文件：

- `packages/contracts/src/orchestration-copilot.ts`
- `packages/core/src/orchestration-copilot-service.ts`
- `packages/core/src/pipeline-graph-validator.ts`
- `packages/runtime/src/current-pipeline-orchestration-runtime.ts`
- `packages/runtime/src/pipeline-orchestration-http.ts`
- `apps/web/src/strategy-workspace-api.ts`
- `apps/web/src/strategy-workspace.css`
- `apps/web/src/orchestration-conversation-view-state.ts`
- `tests-ts/orchestration-copilot.test.ts`
- `tests-ts/orchestration-conversation-view-state.test.ts`

运行控制与会话恢复重点文件：

- `apps/web/src/runtime-control-state.ts`
- `apps/web/src/runtime-operation-session.ts`
- `apps/web/src/runtime-control.css`
- `apps/web/src/runtime-dashboard.css`

不要把 `.playwright-cli/`、`output/`、本地 SQLite 或其他运行产物自动纳入提交。

## 5. 最近验证结果

在 Conversation-first Draft Orchestration Loop 完成后：

```text
npm run check       PASS
npm run test:ts     PASS (216/216)
npm run build:web   PASS
git diff --check    PASS
```

本轮运行验证：

- `npm run dev:paper` 正常启动 Web 5174 / API 8787；
- CSV Backtest / Walk-Forward Runner、Current Crypto Paper Binding 与 Strategy Evidence API 正常注册；
- 当前执行环境没有可连接的内置浏览器会话，因此本轮未完成 1440×900 / 820×760、中英文、三个 Conversation 场景和 Console 的视觉复核；
- 上一轮 Runtime Evidence 的视口与 Console 结果仍可参考，但不能替代本轮 Copilot 抽屉复核。

截图位于 `output/playwright/`，仅作为本地验证产物。

## 6. 本地运行

完整本地 Paper 工作区：

```bash
npm run dev:paper
```

默认地址：

```text
Web: http://127.0.0.1:5174/
API: http://127.0.0.1:8787/
```

该入口使用 CSV synthetic fixture 生成历史证据，使用 local backend fixture 执行有界 Paper cycles；不会进行交易所写入。

其他入口和配置说明见：

- `local-paper-workspace.md`
- `binance-public-paper-workspace.md`
- `production-orchestration-workspace.md`
- `strategy-evidence-approval.md`

## 7. 当前真实边界与待复核项

- 真实可运行市场仍主要是 Current Crypto；daily 和 event-only 主要是已注册历史能力模板。
- Web 已接真实 Runtime、Evidence 与 Conversation Orchestration；连接配置、第二市场和部分 Catalog 扩展仍是 mock、unavailable 或局部实现。
- Copilot 的 Backtest/Walk-Forward 工具只调用服务端现有 Evidence Workflow；未注册 Runner/数据集时返回 unavailable/failed，不伪造成功。
- Copilot Approval 只产生 `APPROVED_NOT_APPLIED`，不会激活 Paper Runtime。
- 当前 Rule Agent Artifact 中部分语义内容仍是 stage success summary；下一步 Causal Review 需要暴露更有用的 thesis、evidence 和 invalidation。
- Reflection 尚未形成 Candidate 持久化审阅、证据验证、Human Approval 和 Approved Lesson 使用闭环。
- 外部 Slack、Email、Webhook 没有注册，Operational Outbox 当前不代表网络通知已发送。
- 通用 Graph Paper Runtime 尚未实现；当前固定 Crypto Runtime 不应被提前替换。
- 本轮自动化曾因很短的 Preflight 有效期和页面刷新时序出现一次过期启动请求；重新 Preflight 后运行正常。后续修改 Runtime Controls 时应手工复核 Start 与 Safe Stop 的点击稳定性，但不要未经证据重写后端 stop/drain。

## 8. 下一阶段决策

优先进入 **M9 Causal Run / Trade Review**。

原因：

- Conversation-first Draft Orchestration 已完成真实后端垂直切片。
- Runtime Evidence 已能提供 Run/Cycle/Artifact 基础，但仍缺按 Trade 展开的因果解释、输入输出和 lineage 浏览。
- 下一步应把真实 Decision、Portfolio、Risk、Execution、Position Monitor 与 Reflection 证据组织成只读 Causal Review。
- Reflection 仍只能创建 Lesson Candidate；Lesson 审批闭环应在 Causal Review 之后继续。

## 9. 下一阶段 Loop Prompt

```text
你现在继续开发 /Users/hyx/Documents/workspace/tradebot。

本轮名称：TradeBot Causal Run / Trade Review Loop。

不要重新做泛泛产品脑暴，不要重写 DecisionPipeline，不要扩展交易所写接口。先检查 Git 工作区并保留所有现有未提交修改。完整阅读 PRODUCT.md、docs/architecture-and-delivery-plan.md、docs/product-roadmap-and-progress.md、docs/project-status-and-handoff.md，以及现有 orchestration-copilot、orchestration-intent、configuration-draft、pipeline orchestration HTTP、strategy evidence 和 Web Copilot 相关代码。

目标：基于现有 Runtime Evidence Read Model、Trace、Artifact Ledger、Paper Cycle Journal 和 Trade Review Presenter，形成按 Run、Cycle 和 Trade 浏览的只读因果审阅闭环。

必须完成：

1. 复用现有 Runtime Evidence、Trace、Artifact Ledger 和 Trade Review，不建立第二套事实源。
2. 增加严格只读的 Run/Cycle/Trade 查询合同与 Bearer API。
3. 展示 Selector 选择原因、Agent 输入输出、Decision、Portfolio、Risk、Execution、Position Monitor、Reflection 和 lineage。
4. 区分真实 Evidence、缺失 Evidence、降级 Artifact 和 SAMPLE，不从摘要推断不存在的因果关系。
5. 不增加交易、Runtime Apply 或 Reflection 自动生效能力。
6. 保持 Selector topN=1、现有持仓监控、Risk、Execution、Paper Only 和 exchangeWriteAllowed=false。
7. 增加合同、查询、权限、分页、缺失证据和 Web view-state 测试。
8. 完成后运行全部质量门禁和中英文响应式浏览器检查。

完成本轮后，更新 docs/product-roadmap-and-progress.md 与 docs/project-status-and-handoff.md，明确哪些是真实后端能力，哪些仍为 mock，以及下一步是否进入 Causal Run/Trade Review。
```

## 10. 新窗口完成本轮时的输出要求

简洁说明：

- 新增或复用了哪些合同、服务和工具；
- 对话能够完成哪些真实 Draft 操作；
- 哪些状态仍是 mock、unavailable 或 runtime-not-applied；
- 是否改变现有 Runtime 行为；
- 测试数量与四项质量门禁；
- 浏览器验证结果；
- 下一阶段建议。
## 2026-07-27 handoff: Causal Run / Trade Review

### Delivered

- `tradebot.causal-run-review.v1` 严格合同覆盖稳定 Review ID、human version、fingerprint、lifecycle、Market/Source/Graph/Schema 引用、Cycle、Agent evidence、Trade Review、Reflection、lineage 和稳定 issue code。
- `/api/orchestration/causal-review/runs/...` 是 Bearer 保护的只读 API。客户端只能选择服务端已知 Run/Cycle/Trade opaque ID，以及受限分页 cursor/limit。
- 服务复用 `SqlitePaperRuntimeRunRepository`、`SQLiteTraceSink`、`SQLiteAgentArtifactLedger`、`SQLiteReflectionStore` 和 `buildTradeReview`；没有第二套 Runtime、Trace、Artifact、Evidence Job 或 Approval 事实源。
- Evidence 缺失、fallback/error Artifact、敏感字段脱敏、未记录显式 lineage、Reflection 非 cycle-linked 均返回稳定 code。
- Audit Log 已接真实后端并明确显示 ACTIVE/RECENT/PARTIAL/UNAVAILABLE、SAMPLE/RUNTIME、READ ONLY 和 NOT APPLIED TO RUNTIME。

### Still unavailable or not applied

- Causal Review 不修改 Pipeline，不应用 Draft，不启动/暂停 Runtime，不下单，也不绕过 Risk。
- Reflection 仍只展示最新账户级 Lesson Candidate，明确不是 cycle-causal，也不会自动生效。
- 没有显式 Artifact 引用时，只展示非因果 `observed_sequence`；不会从摘要补造因果边。
- 旧 Audit Log 静态事件仍存在，但已明确标注 `SAMPLE FALLBACK`，不冒充 Runtime 事实。

### Runtime and validation

- 现有交易行为未改变：Selector topN=1、当前持仓进入 Position Monitor、唯一动作链 Decision → Portfolio → Risk → Execution、Paper Only、`exchangeWriteAllowed=false`。
- 预期验证：`npm run check` 通过；`npm run test:ts` 226/226；`npm run build:web` 通过；`git diff --check` 通过。
- 浏览器验证：`npm run dev:paper` 启动成功；in-app browser 未暴露可连接会话，按既定 fallback 使用真实 headed Chromium/Playwright 完成 1440×900 中文、1440×900 英文、820×760 中文和 820×760 英文检查。四组均无页面或 Review 横向溢出，中文/英文隔离提示正确，Console 为 0 errors / 0 warnings。
- 真实 fixture 检查：最近完成的 Paper Run 和 6 个 Cycle 均可读取；Cycle 1/6 各展示 7 个真实 Agent Artifact。该 Run 没有显式 order/trade 引用，界面正确显示“没有显式引用”，没有补造 Trade 因果关系；显式 Trade 路由成功与未知 Trade fail-closed 由自动化测试覆盖。
- 下一阶段建议：使用真实 Paper Run 做操作员 Trade Review 走查，补强订单/成交显式 lineage 记录和单笔交易复盘，不进入新的产品脑暴或独立 Graph 系统。
## 2026-07-27 handoff: Explicit Trade Lineage / Single-Trade Review

- 已接真实后端：新 Paper 交易持久化稳定 `tradeId`、`positionId`、Entry/Exit Order、Fill、Decision/Portfolio/Risk/Execution Artifact refs。
- 已接真实后端：Causal Review 直接读取现有 Paper Account、Trace、Artifact Ledger 与 Reflection；Closed Trade 的费用和 realized PnL 原样返回。
- 历史兼容：旧 Position/Trade 缺少显式引用时返回 `partial_evidence` 和稳定 issue code，不按 symbol、时间或数组顺序补造因果边。
- Reflection：`sourceTradeIds` 显式关联 Closed Trade，但仍是 Lesson Candidate，`runtimeApplied=false`。
- Runtime：没有修改 Selector topN=1、Position Monitor 优先级、Risk、Execution、Paper Account 会计或 Runtime Safety 行为，交易所写入仍关闭。
- 预期验证：`npm run check` 通过；`npm run test:ts` 232/232；`npm run build:web` 通过；`git diff --check` 通过。
- 浏览器验证：待本轮启动 `dev:paper` 后记录；必须使用真实受控 Trade fixture，不能把无 Trade 的历史 Run 伪报为 Single Trade Review 通过。

### 2026-07-27 Explicit Trade Lineage Loop 浏览器与交付状态

- 浏览器实测通过：中文/英文 `1440x900`、中文/英文 `820x760`，无明显横向溢出、遮挡或不可读小字；Console `0 errors / 0 warnings`。
- 新 Paper 持仓可从 Trade 引用进入 Single Trade Review，读取同一 Paper Account 与 Artifact Ledger 中的 Entry Order、Decision、Portfolio、Risk、Execution 和 Fill 引用。
- 旧版缺少 Entry lineage 的持仓在平仓后保持 `partial_evidence`，不会按时间邻近推断因果；新写入数据使用显式 lineage。
- 页面和 API 均为只读复盘，`runtimeApplied=false`、`exchangeWriteAllowed=false`；现有 DecisionPipeline、Selector `topN=1`、Position Monitor、Risk、Execution 和 Runtime Safety 行为未改变。
- 最终验证：`npm run check` 通过，`npm run test:ts` 为 `232/232`，`npm run build:web` 通过，`git diff --check` 通过。
- 下一阶段建议进入 Trade Review 的对照证据与 Lesson Candidate 人工审阅闭环；仍不得让 Reflection 自动修改策略或绕过既有 Evidence/Approval 门禁。

### 2026-07-27 Comparative Evidence / Lesson Review 交接

- Prompt 文档：`docs/trade-review-comparative-evidence-loop-prompt.md`。
- 已实现：严格比较与审阅合同、确定性服务端 comparator 选择、Candidate/Evidence fail-closed 校验、幂等人工审阅、SQLite 不可变记录、Bearer HTTP Handler。
- 已验证：同 Graph/Market/Symbol 筛选、最近历史 baseline、原始 PnL/fee 保留、无 comparator 时 `insufficient_evidence`、指纹漂移、幂等冲突、Actor/Role 服务端派生和注入拒绝。
- 安全边界：`runtimeApplied=false`、`exchangeWriteAllowed=false`、`approvedLessonCreated=false`、`strategyMutationCreated=false`。
- 尚未完成：把新 Handler 和现有 Paper Account/Reflection Candidate concrete ports 挂入生产组合根，以及在 Causal Review Web 中提供人工审阅入口；不得把独立 Handler 描述成已部署 UI。
- 测试基线：`npm run check` 通过，`npm run test:ts` 为 `241/241`。下一阶段应完成 production composition + Causal Review UI wiring，随后再进入 Lesson Evidence 的 Backtest/Walk-Forward gate。

### 2026-07-27 Production Comparative Review Wiring 交接

- Prompt：`docs/production-comparative-review-wiring-loop-prompt.md`。
- 已完成 concrete ports：真实 Paper Account Store、Reflection Store、服务端引用配置、Bearer Handler 和 Review SQLite Repository 已在同一 production composition 中组合。
- 新增 candidate inspect：只接受 `selectedTradeId`，拒绝 actor/role/SQL/code/path/URL/runner/Runtime 注入；候选必须来自 Reflection 的显式 `sourceTradeIds`。
- 集成测试使用真实 SQLite Store 和 Rule Reflection Agent 覆盖 compare -> inspect -> accept_for_validation，并验证关闭资源后 Paper DB 可重新打开。
- 未挂载范围：`local-paper-workspace` 主 HTTP server 尚未创建该 composition，现有 Causal Review Web 尚无比较/人工审阅控件。因此不得描述为浏览器可用功能。
- 最终基线：`npm run check` 通过，`npm run test:ts` 为 `245/245`。下一阶段应只做 main server route mounting、Web 状态/界面接入和真实浏览器验证，不再创建新的比较或审阅模型。
## 2026-07-29 handoff: Main Server Comparative Review and Causal Review UI

- Real backend: the production comparative review composition is mounted in the
  main loopback server and closes its SQLite resources with the Runtime.
- Real backend routes:
  `POST /api/orchestration/trade-reviews/comparisons`,
  `POST /api/orchestration/lesson-candidates/inspect`, and
  `POST /api/orchestration/lesson-candidates/reviews`.
- Real Web: the existing Causal Review loads comparison and Reflection
  candidate evidence for the explicitly selected closed trade and supports
  human accept-for-validation or reject decisions.
- Honest unavailable state: active positions, incomplete lineage, missing prior
  same-scope trades, and missing explicit Reflection source trade IDs are not
  synthesized into evidence.
- Runtime boundary: no Approved Lesson is created, no strategy is mutated, no
  Pipeline is applied, and no exchange write capability is enabled.
- Trading behavior: unchanged. Selector topN=1, Position Monitor, Decision to
  Portfolio to Risk to Execution, Paper Account, and Runtime Safety retain
  their existing behavior.
- Validation: TypeScript check passed; TypeScript tests passed 248/248; Web
  production build passed with 27 modules; diff check passed.
- Local launch: `npm run dev:paper` started the API and Web processes and
  logged Comparative Trade Review enabled.
- Browser boundary: the browser control surface returned no available browser
  instances. Chinese/English checks at 1440x900 and 820x760, visual overflow,
  and browser Console checks therefore remain unavailable and are not reported
  as passed.
- Next stage: persist and browse a bounded review history, then enter Causal
  Run / Trade Review only after browser verification of this mounted slice. Do
  not create an Approved Lesson or strategy mutation in that stage.
## 2026-07-29 handoff: Bounded Human Review History

- Real backend route:
  `POST /api/orchestration/lesson-candidates/reviews/history`.
- Request boundary: only selected Trade ID, opaque cursor, and a limit up to 20
  are accepted. Candidate, actor, role, database path, SQL, URL, code, Runtime,
  and execution selectors remain server-owned or rejected.
- Persistence: the existing SQLite Lesson Candidate review repository provides
  deterministic newest-first cursor pagination.
- Real Web: Causal Review restores persisted accepted/rejected records and
  displays a compact read-only history.
- Runtime boundary remains `runtimeApplied=false`,
  `exchangeWriteAllowed=false`, `approvedLessonCreated=false`, and
  `strategyMutationCreated=false`.
- Validation passed: TypeScript check, 251/251 TypeScript tests, Web production
  build with 27 modules, and diff check.
- Local Paper launch passed and loaded the mounted comparative composition and
  history endpoint.
- Browser validation remains blocked because the browser control surface has no
  available instance. No claim is made for the requested 1440x900 or 820x760
  Chinese/English visual and Console checks.
- Next stage: add explicit evidence-to-validation handoff status for an
  accepted candidate, reusing Contract Validation and never promoting directly
  to an Approved Lesson or Runtime mutation.

## 2026-07-29 Handoff: Accepted Candidate Contract Validation

- Prompt：`docs/accepted-candidate-contract-validation-handoff-loop-prompt.md`。
- 新合同：`LessonCandidateValidationHandoffRequest/Response`、Binding Reference 和 Contract Validation Gate Summary，全部 strict。
- 新核心服务：`LessonCandidateValidationHandoffService`。它读取最新不可变 Review，重新解析当前 Candidate 与 Comparative Evidence，并验证所有 fingerprint 连续性。
- 新 API：`POST /api/orchestration/lesson-candidates/validation-handoff`。请求只接受 `selectedTradeId`；Actor、Review、Evidence、Draft、Graph 和 Validator 结果均为服务端能力。
- 当前生产 handoff 是真实只读状态，但 Configuration Draft / Pipeline Graph binding 尚不可用，所以 accepted candidate 返回 `validation_unavailable`，不会伪装为 Contract Validation passed。
- Web 已展示 `NOT_REVIEWED`、`CANDIDATE_CLOSED`、`VALIDATION_UNAVAILABLE`、`VALIDATION_FAILED`、`VALIDATION_PASSED`、`STALE` 等状态以及稳定 issue code。
- 安全不变量：`approvedLessonCreated=false`、`strategyMutationCreated=false`、`runtimeApplied=false`、`exchangeWriteAllowed=false`；没有 Approved Lesson、Evidence Job、Approval 或 Runtime 写入。
- Runtime 交易行为未修改。
- 验证结果在本节后续交付记录中报告。
- 下一 loop 应实现服务端持久化 binding，并复用现有 Configuration Draft Service 与 Pipeline Graph Validator 产生真实 Contract Validation 结果；通过后只进入现有 Backtest 门禁。
- 最终验证：check 通过；TypeScript 257/257；Web build 通过（28 modules，71ms）；diff-check 通过；dev:paper 启动成功。
- Browser：宿主未提供任何内置浏览器实例，因此桌面/窄屏、中英文、场景交互和 Console 尚未验证。服务当前运行在 `http://127.0.0.1:5174/`，API 在 `http://127.0.0.1:8787`。
