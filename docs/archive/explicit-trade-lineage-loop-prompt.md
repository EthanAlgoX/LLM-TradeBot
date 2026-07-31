# TradeBot Explicit Trade Lineage and Single-Trade Review Loop

你现在继续开发 TradeBot。请直接检查仓库、实施方案、运行测试并交付可运行代码，不要重新进行泛泛的产品脑暴，也不要只给建议。

## 一、仓库与本轮名称

仓库路径：

```text
/Users/hyx/Documents/workspace/tradebot
```

本轮名称：

```text
TradeBot Explicit Trade Lineage and Single-Trade Review Loop
```

本轮目标是在现有 Causal Run / Trade Review 能力上，补齐订单、成交、开仓、持仓监控、平仓和 Reflection 之间的显式证据引用，使操作员可以审阅一笔真实 Paper Trade 的完整来源与结果。

## 二、开始前必须完成

先检查 Git 工作区。当前仓库存在大量尚未提交的 Runtime、Web、测试、SQLite 和文档修改，这些都属于用户，必须完整保留。

禁止执行：

- `git reset`
- `git checkout --`
- `git clean`
- 任何覆盖或回退无关修改的命令

不要提交 Git，除非用户明确要求。

完整阅读：

- `PRODUCT.md`
- `docs/architecture-and-delivery-plan.md`
- `docs/product-roadmap-and-progress.md`
- `docs/project-status-and-handoff.md`
- `packages/contracts` 中现有 Agent Artifact、Trace、Paper Runtime Run、Paper Account、Execution、Reflection、Trade Review 和 Causal Review 合同
- `packages/core` 中现有 DecisionPipeline、Artifact Ledger、Trace、Portfolio、Risk、Execution、Position Monitor 和 Reflection 实现
- `packages/runtime` 中现有 Review Presenter、Causal Trade Review Read Model、HTTP Handler、Paper Runtime 组合根和 SQLite Repository
- `packages/adapters` 中现有 SQLite Trace、Agent Artifact、Paper Account、Cycle Journal 和 Reflection 实现
- `apps/web` 中现有 Audit Log、Causal Review、Runtime Evidence、Runtime Controls 和国际化实现
- 相关测试与 `package.json`

优先复用现有代码，不要建立第二套 Trade、Order、Artifact、Trace、Evidence、Review 或 Reflection 模型。

当前验证基线：

- `npm run check`：通过
- `npm run test:ts`：226/226
- `npm run build:web`：通过
- `git diff --check`：通过
- `dev:paper`：可启动
- Causal Review 浏览器验证：1440×900 与 820×760，中英文均无横向溢出，Console 0 errors / 0 warnings

## 三、持续保持的产品和安全边界

1. Selector `topN=1` 不变，symbols 只是候选池。
2. 当前持仓继续优先进入 Position Monitor。
3. 唯一开仓动作链仍是 Decision → Portfolio → Risk → Execution。
4. 平仓必须继续经过既有受控链路，不允许 Review 或 Reflection 直接下单。
5. Copilot、LLM、Review 和 Reflection 都不能绕过 Risk。
6. Reflection 只能创建 Lesson Candidate，不能自动改变策略。
7. 策略变化继续经过 Contract Validation、Backtest、Walk-Forward、Human Approval 和 Paper Running。
8. 唯一允许立即生效的人工风险控制仍是暂停新开仓 / 仅允许平仓。
9. 不重写现有 DecisionPipeline。
10. 不改变 Paper Account、Risk、Execution 和 Runtime Safety 的核心行为。
11. 不增加 Binance 或其他交易所写接口。
12. 保持 Paper Only 和 `exchangeWriteAllowed=false`。
13. Causal Review 必须保持只读，`runtimeApplied=false`。
14. 时间顺序不能被冒充为因果关系。

## 四、本轮核心目标

形成一个真实可运行的单笔交易复盘闭环：

```text
Run
→ Cycle
→ Selector Evidence
→ Decision Artifact
→ Portfolio Artifact
→ Risk Artifact
→ Execution Order
→ Fill / Paper Account Mutation
→ Position Monitor
→ Exit Decision
→ Closing Risk / Execution
→ Closed Trade
→ Reflection Lesson Candidate
```

每条边必须来自显式持久化引用。缺少引用时必须返回稳定 issue code，并标记为 partial 或 unavailable，不得从时间、symbol、摘要或相邻 Artifact 推断因果关系。

## 五、必须实现的后端能力

### 1. 审计并完善显式引用合同

在 `packages/contracts` 中定义或完善严格 Zod 合同，至少覆盖：

- Trade Evidence Reference
- Explicit Artifact Reference
- Order Evidence Reference
- Fill Evidence Reference
- Position Lifecycle Reference
- Closed Trade Reference
- Trade Causal Link
- Single Trade Review
- Trade Review Issue
- Trade Review Availability

合同必须具备适当的：

- `schemaVersion`
- 稳定 ID
- `humanVersion`
- `fingerprint`
- `createdAt`
- lifecycle status
- `runId`
- `cycle`
- `traceId`
- `artifactId`
- `orderId`
- `tradeId`
- `symbol`
- Agent、Graph、Market、Source 和 Schema 引用

所有对象合同必须使用 `.strict()` 或等价严格拒绝策略。

不要仅依赖 symbol、时间戳或数组顺序建立 Trade 关系。

### 2. 在现有 Artifact 写入链路记录显式 lineage

审计现有 Artifact Recorder、Trace Sink、Decision、Portfolio、Risk、Execution、Paper Account 和 Position Monitor 写入位置。

在不改变交易决策和执行行为的前提下，使相关 Artifact 显式记录其输入证据引用。

至少应支持：

- Decision Artifact 引用实际分析或 Position Monitor Artifact。
- Portfolio Artifact 引用实际 Decision Artifact。
- Risk Artifact 引用实际 Portfolio 或 Decision Artifact。
- Execution Artifact 引用实际 Risk Artifact 和服务端 Order ID。
- Paper Fill 或 Account Mutation 引用实际 Execution Artifact 和 Order ID。
- Position Monitor Artifact 引用被监控 Position 的开仓 Trade/Order。
- 平仓 Execution 引用 Position Monitor 或 Exit Decision Artifact。
- Closed Trade 显式关联开仓与平仓引用。
- Reflection Lesson Candidate 显式引用 Closed Trade ID，但仍保持 `runtimeApplied=false`。

如果现有 Contract 已有 `orderId`、`tradeId` 或 Artifact 引用字段，应优先复用和完善，不要增加竞争字段。

### 3. 保持事实源唯一

必须继续复用：

- `SqlitePaperRuntimeRunRepository`
- `SQLiteTraceSink`
- `SQLiteAgentArtifactLedger`
- 现有 Paper Account SQLite Store
- 现有 Cycle Journal
- `SQLiteReflectionStore`
- `buildTradeReview`
- 现有 Causal Trade Review Read Model

禁止：

- 新建第二套 Trade 数据库
- 新建第二套 Order Ledger
- 新建第二套 Evidence Job
- 新建第二套 Reflection Store
- 将 Web 状态作为事实源
- 用摘要拼接虚构完整交易链

### 4. 扩展 Single Trade Review Read Model

在现有 Causal Review 服务中增加或完善单笔交易读取能力。

至少返回：

- Trade 基本信息和 lifecycle
- 开仓与平仓 Order/Execution 引用
- Entry 与 Exit Artifact 链
- Decision、Portfolio、Risk、Execution 的显式引用
- Position Monitor 记录
- Paper Fill 与费用
- realized PnL
- Reflection Lesson Candidate
- Market、Source、Graph、Schema lineage
- evidence availability
- 稳定 issue code
- `readOnly=true`
- `runtimeApplied=false`
- `exchangeWriteAllowed=false`

明确区分：

- `ACTIVE_POSITION`
- `CLOSED_TRADE`
- `PARTIAL_EVIDENCE`
- `UNAVAILABLE`
- `SAMPLE`
- `RECENT_TERMINAL_RUN`

### 5. 扩展 Bearer Authentication 保护的只读 HTTP API

建议继续使用现有路由层级：

```text
GET /api/orchestration/causal-review/runs/:runId/cycles/:cycle/trades/:tradeRef
```

如需列表能力，可增加：

```text
GET /api/orchestration/causal-review/runs/:runId/trades
```

客户端只允许提交：

- 服务端已知 opaque Run ID
- 服务端已知 Cycle number
- 服务端已知 opaque Trade/Order ID
- 服务端签发的 cursor
- 受限分页 limit

客户端不得提交或控制：

- actorId
- role
- SQL
- code
- module
- command
- path
- URL
- header
- Secret
- API Key
- exchange account
- evidence payload
- Artifact 内容
- Order 内容
- Fill 内容
- Runtime symbols
- Runtime cycles
- Runtime interval
- execution mode
- Paper Account 参数
- Risk bypass 参数

Actor、Role、事实源、Trade、Order、Fill 和 Artifact 必须由服务端派生。

### 6. 稳定错误和降级语义

至少提供稳定 code：

- `RUN_NOT_FOUND`
- `CYCLE_NOT_FOUND`
- `TRADE_NOT_FOUND`
- `ORDER_NOT_FOUND`
- `ENTRY_EVIDENCE_NOT_RECORDED`
- `EXIT_EVIDENCE_NOT_RECORDED`
- `FILL_EVIDENCE_NOT_RECORDED`
- `POSITION_LINEAGE_NOT_RECORDED`
- `EXPLICIT_LINEAGE_NOT_RECORDED`
- `REFLECTION_NOT_RECORDED`
- `REFLECTION_NOT_TRADE_LINKED`
- `ARTIFACT_DEGRADED`
- `ARTIFACT_ERROR`
- `TRADE_REVIEW_QUERY_REJECTED`

错误和缺失证据不能触发 Runtime mutation。

## 六、必须支持的真实场景

### 场景一：真实开仓链

一个 Paper Cycle 产生开仓交易。

预期：

- Selector 仍只选择一个 symbol。
- Decision、Portfolio、Risk、Execution 依次产生显式 Artifact 引用。
- Risk 通过后才出现 Execution Order。
- Fill 关联服务端 Order ID 和 Execution Artifact。
- Trade Review 能从 Trade/Order 返回完整开仓证据。
- `runtimeApplied=false` 表示 Review 本身未修改 Runtime。

### 场景二：持仓监控与平仓链

已有持仓进入 Position Monitor，满足退出条件并平仓。

预期：

- Position Monitor 显式引用原开仓 Trade。
- Exit Decision、Risk、Execution 和 Closed Trade 具备显式链路。
- Review 同时展示 Entry 与 Exit。
- 显示费用、realized PnL 和退出原因。
- 不允许绕过 Risk。

### 场景三：证据缺失

历史 Trade 有 Order 或 Closed Trade，但缺少某个 Artifact 引用。

预期：

- 返回 `PARTIAL_EVIDENCE`。
- 返回稳定缺失 code。
- 不从时间、symbol 或相邻 Artifact 推断缺失边。
- 仍可展示已验证的部分事实。

### 场景四：Reflection

Closed Trade 之后产生 Reflection Lesson Candidate。

预期：

- Reflection 显式引用 Trade ID。
- 明确 `candidateOnly=true`。
- 明确 `runtimeApplied=false`。
- 不修改策略、不触发订单、不进入 Decision Context，除非未来经过既有人工批准链。

## 七、必须实现的 Web 能力

继续使用现有 Audit Log / Causal Review 表面，不新增复杂独立页面或 Graph 画布。

界面必须：

1. 支持 Run → Cycle → Trade 的逐级只读浏览。
2. 展示服务端真实 Trade/Order 引用。
3. 展示 Entry 与 Exit 两段证据链。
4. 展示 Decision → Portfolio → Risk → Execution。
5. 展示 Position Monitor 和退出原因。
6. 展示 Fill、费用和 realized PnL。
7. 展示 Reflection Lesson Candidate。
8. 展示显式 lineage 与非因果 observed sequence 的区别。
9. 展示稳定 issue code。
10. 始终显示 `READ ONLY`、`NOT APPLIED TO RUNTIME` 和 `EXCHANGE WRITE OFF`。
11. 缺失证据时展示 partial，不隐藏、不补造。
12. 保留 SAMPLE fallback，但必须与 Runtime 事实明显分离。
13. 中文模式尽量全部中文，英文模式全部英文。
14. 字体保持可读，避免密集小字和满屏卡片。
15. 桌面与 820px 宽度下无横向溢出。

Copilot 和 Audit Log 不得增加：

- Start
- Pause
- Safe Stop
- Runtime Apply
- 下单
- Risk bypass
- Reflection 自动应用

Runtime Controls 继续由现有独立受控链路负责。

## 八、必须增加的测试

至少覆盖：

1. 新增合同拒绝未知字段。
2. Bearer Auth 和服务端 Actor/Role 派生。
3. actor、SQL、path、URL、code、Order、Fill、Artifact 和 Runtime 参数注入被拒绝。
4. `/runs/latest` 专用路由不会被通用 `:runId` 路由吞掉。
5. Run/Cycle/Trade 精确引用成功。
6. 未知 Run、Cycle、Trade、Order fail closed。
7. 开仓链包含 Decision → Portfolio → Risk → Execution → Fill 显式引用。
8. Risk 未通过时不存在 Execution/Fill。
9. 持仓继续进入 Position Monitor。
10. 平仓链显式关联原开仓 Trade。
11. Closed Trade 正确关联 Entry 和 Exit。
12. 费用和 realized PnL 来自 Paper Account 事实，不由 Presenter 重算或猜测。
13. Reflection 显式引用 Closed Trade，且 `runtimeApplied=false`。
14. 缺失引用返回 partial 和稳定 code。
15. 时间顺序不会被标记为 causal。
16. Artifact fallback/error 正确降级。
17. 相同 Trade Review 请求不会创建任何新版本或 Runtime mutation。
18. 分页 cursor 和 limit 严格受限。
19. Web view state 正确区分 active position、closed trade、partial、unavailable、sample 和 recent。
20. 现有 226 个测试继续通过。
21. DecisionPipeline、Selector、Position Monitor、Risk、Execution 和 Runtime Safety 回归继续通过。

## 九、实现限制

- 不重写 DecisionPipeline。
- 不重新实现 Trade Review Presenter。
- 不建立第二套 Trade、Order、Trace、Artifact 或 Reflection Store。
- 不从时间顺序推断因果。
- 不允许客户端动态创建 Artifact 引用。
- 不执行用户生成代码。
- 不修改正在运行的 Pipeline。
- 不接入交易所写接口。
- 不把 Review 表现为 Runtime mutation。
- 不削弱 Bearer Auth 和严格请求合同。
- 不通过本轮修改策略、Risk 参数或 Paper Account 行为。

## 十、质量验证

完成后必须运行：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

如果修改 Web，启动：

```bash
npm run dev:paper
```

然后使用真实浏览器检查：

- 1440×900 中文
- 1440×900 英文
- 820×760 中文
- 820×760 英文
- 真实 Run 列表
- 真实 Cycle Review
- 真实开仓 Trade Review
- 真实持仓监控与平仓 Review
- Entry/Exit 证据链
- 缺失证据 partial 场景
- Reflection Lesson Candidate
- SAMPLE 与 Runtime 区分
- Draft/Review 与 Runtime 隔离提示
- 无明显横向溢出、遮挡、过密文字或不可读小字
- Browser Console 0 errors / 0 warnings

如果当前 fixture 没有真实 Trade 引用，不得伪造浏览器通过结果。应使用受控 Paper fixture 产生一笔可复现交易，或明确记录该浏览器场景未完成，同时用自动化测试覆盖 fail-closed 行为。

## 十一、文档更新

完成后更新：

- `docs/product-roadmap-and-progress.md`
- `docs/project-status-and-handoff.md`

文档必须明确：

- 哪些 Trade lineage 已接真实后端。
- 哪些历史记录仍是 partial、sample 或 unavailable。
- 是否存在仍未显式记录的 Entry/Exit 引用。
- Reflection 是否仍为 Lesson Candidate。
- 是否改变现有 Runtime 或交易行为。
- 测试数量和完整验证结果。
- 浏览器是否使用了真实 Trade fixture。
- 下一阶段是否进入 Operator Trade Review Workflow、Evidence Export 或 Incident Review。

## 十二、最终输出

最终简洁说明：

- 新增或复用了哪些合同、服务和显式引用。
- 一笔 Trade 能审阅到哪些真实 Entry/Exit 证据。
- 哪些关系仍不可用或 partial。
- 新增了哪些 Auth、注入拒绝和 fail-closed 测试。
- Reflection 是否应用到 Runtime。
- 是否修改现有交易行为。
- Web 修改和真实浏览器验证结果。
- `check`、`test`、`build` 和 `diff-check` 结果。
- 下一阶段最合理的工作。

直接执行本轮，不要停留在规划或建议阶段。
