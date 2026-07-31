# TradeBot Accepted Candidate Contract Validation Handoff Loop

## 目标

把 `accepted_for_validation` 的 Lesson Candidate 接入现有 Contract Validation 边界的只读状态投影，形成从人工复核到验证门禁的连续、可审计 handoff。

本轮不得创建 Approved Lesson，不得修改 Strategy、Pipeline 或 Runtime，不得创建第二套 Validation、Evidence 或 Approval 模型。

## 必须保持的产品边界

1. Reflection 只能创建 Lesson Candidate。
2. 人工接受只表示允许进入 Contract Validation，不表示验证通过。
3. Contract Validation 必须来自现有 Configuration Draft、Pipeline Graph 和 Graph Validator 链路。
4. 客户端不得提交 Review、Evidence、Draft、Graph、Runner、Actor 或 Runtime 标识。
5. 缺少服务端 Draft/Graph 绑定时必须返回 `validation_unavailable`，不得推断或伪造验证结果。
6. Candidate、Comparative Evidence 或绑定指纹不连续时必须 fail closed。
7. Backtest、Walk-Forward、Human Approval 和 Paper Running 门禁保持不变。
8. `runtimeApplied=false`、`exchangeWriteAllowed=false`。
9. 不改变 Decision → Portfolio → Risk → Execution。
10. 不增加交易所写接口，不提供 Runtime Apply、Start、Pause、Safe Stop 或下单入口。

## 后端合同

在 `packages/contracts` 增加严格 Zod 合同：

- `LessonCandidateValidationHandoffRequest`
- `LessonCandidateValidationHandoffResponse`
- `LessonCandidateValidationGateSummary`
- `LessonCandidateValidationBindingReference`

请求只允许：

- `selectedTradeId`

响应必须包含：

- `schemaVersion`
- 稳定 `id`
- `humanVersion`
- `fingerprint`
- `createdAt`
- lifecycle status
- 当前 Candidate、Review、Comparative Evidence 引用
- 可选的 Configuration Draft 和 Pipeline Graph 引用
- Contract Validation 状态和稳定 issue code
- `nextGate`
- `readOnly=true`
- `runtimeApplied=false`
- `exchangeWriteAllowed=false`

所有合同使用 `.strict()`。

## 核心服务

实现 `LessonCandidateValidationHandoffService`：

1. 根据 `selectedTradeId` 从服务端 Reflection Catalog 解析当前 Candidate。
2. 从现有 Review Repository 读取最新不可变 Review。
3. 重新读取当前 Comparative Evidence 并核对持久化 Review 的 Evidence fingerprint。
4. 核对当前 Candidate fingerprint。
5. `rejected` 返回关闭状态。
6. `accepted_for_validation` 但没有服务端 Draft/Graph 绑定时返回 `validation_unavailable`。
7. 只有绑定同时匹配 Review、Candidate、Evidence 指纹，并携带现有 Validator 的真实结果时，才投影 `validation_failed` 或 `validation_passed`。
8. 不创建 Draft、Evidence Job、Approval、Approved Lesson 或 Runtime 变更。

## HTTP API

新增受 Bearer Authentication 保护的：

`POST /api/orchestration/lesson-candidates/validation-handoff`

严格拒绝客户端注入：

- actor / role
- reviewId / candidateId
- evidenceId / approvalId
- draftId / versionId / graphId
- runner / code / SQL / URL / filesystem path
- Runtime symbols / cycles / interval / execution mode
- Risk bypass / Paper Account / exchange 参数

## Web

在现有 Causal / Comparative Trade Review 中增加紧凑的只读 Contract Validation handoff：

- 区分 `NOT_REVIEWED`、`CANDIDATE_CLOSED`、`ACCEPTED_FOR_VALIDATION`、`VALIDATION_UNAVAILABLE`、`VALIDATION_FAILED`、`VALIDATION_PASSED` 和 `STALE`。
- 显示稳定 issue code。
- 明确缺少 Draft binding 不等于验证失败或通过。
- 始终显示 `runtimeApplied=false`。
- 不新增独立 Graph 画布或 Runtime 控件。
- 中文模式使用中文，英文模式使用英文。

## 测试

至少覆盖：

1. 请求和响应合同拒绝未知字段。
2. Bearer Auth 与服务端 Actor 派生。
3. Review、Evidence、Draft、Graph、Runner、Code、Path、URL、SQL 和 Runtime 参数注入被拒绝。
4. 未复核、拒绝、已接受但无绑定状态。
5. Candidate fingerprint 变化时 stale。
6. Comparative Evidence fingerprint 变化时 stale。
7. 绑定 scope 不匹配时 stale。
8. 没有真实 Validator 结果时不能声称 passed。
9. 真实 `valid=false` 投影 validation failed 和原始 issue code。
10. 真实 `valid=true` 才投影 validation passed，下一门禁为 Backtest。
11. Response 永远 `runtimeApplied=false` 和 `exchangeWriteAllowed=false`。
12. Web view state 正确区分所有 handoff 状态。

## 验证

运行：

- `npm run check`
- `npm run test:ts`
- `npm run build:web`
- `git diff --check`
- `npm run dev:paper`

如浏览器能力可用，检查 1440×900、820×760 的中英文界面和 Console；如环境不提供浏览器，必须明确记录未验证，不得声称通过。

## 文档

更新：

- `docs/product-roadmap-and-progress.md`
- `docs/project-status-and-handoff.md`

明确真实 handoff、缺失绑定时的 unavailable 状态、Runtime 未改变、测试数量和下一阶段。
