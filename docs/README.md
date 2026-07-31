# TradeBot 文档导航

> 最后整理：2026-07-31
> 当前产品抽象：通用注册输入 + 可配置多 Agent；具体市场是 Market Pack 元数据，不是独立产品流程

## 1. 权威文档

| 文档 | 回答的问题 | 更新规则 |
| --- | --- | --- |
| [`../PRODUCT.md`](../PRODUCT.md) | TradeBot 是什么，哪些边界不能突破 | 产品定义或核心边界变化时更新 |
| [`architecture-and-delivery-plan.md`](architecture-and-delivery-plan.md) | 目标架构、系统边界和阶段依赖是什么 | 架构决策或交付阶段变化时更新 |
| [`product-roadmap-and-progress.md`](product-roadmap-and-progress.md) | 当前完成到哪里，剩余工作按什么顺序推进 | 每个 Loop 完成后更新当前状态，不追加完整日志 |
| [`project-status-and-handoff.md`](project-status-and-handoff.md) | 新窗口接手时需要知道哪些运行事实、风险和命令 | 每个 Loop 完成后覆盖为最新快照 |
| [`next-loop-prompt.md`](next-loop-prompt.md) | 尚未执行的下一阶段具体任务是什么 | 下一 Loop 完成后替换，不保留已完成任务 |

主文档只描述当前事实。历史基线和旧交接保存在 [`archive/`](archive/)；已完成 Loop 的 Prompt 保留为设计与安全边界记录。

## 2. 状态术语

所有进度文档统一使用以下状态：

| 状态 | 含义 |
| --- | --- |
| `REAL` | 已接真实后端或持久化事实源，并有自动化测试 |
| `PARTIAL` | 核心链路真实，但仍缺生产绑定、持久化、UI 或操作验证 |
| `UNAVAILABLE` | 合同或入口可能存在，但生产组合明确不可用 |
| `MOCK` | 仅演示或静态样例，不代表 Runtime 事实 |
| `NOT_APPLIED` | 已创建 Draft、Evidence、Approval 或只读投影，但未应用到 Runtime |

`APPROVED_NOT_APPLIED` 不等于 `ACTIVE PAPER RUNTIME`。`RECENT TERMINAL RUN` 不得显示为 Active。

## 3. 当前交付主题

当前已形成一条可运行的 Crypto Paper 垂直切片：

```text
Conversation -> Immutable Draft -> Validation / Evidence / Approval
                                    -> Approved Paper Plan
                                    -> Controlled Paper Runtime
                                    -> Runtime / Causal / Trade Review
                                    -> Lesson Candidate Human Review
                                    -> Validation Handoff (binding unavailable)
```

当前已支持独立 Lesson Human Approval，并能在服务端完整 Reflection Semantic Candidate 存在时复用 `ApprovedReflectionLessonSchema` 物化语义 Lesson。当前生产 Reflection Report 缺少该事实，因此明确显示 unavailable；任何结果均只进入 Shadow Projection，不修改 Runtime。

## 4. 实现专题文档

运行与工作区：

- [`local-paper-workspace.md`](local-paper-workspace.md)
- [`binance-public-paper-workspace.md`](binance-public-paper-workspace.md)
- [`production-orchestration-workspace.md`](production-orchestration-workspace.md)
- [`production-historical-evidence-runtime.md`](production-historical-evidence-runtime.md)

Draft、Graph 与 Evidence：

- [`configuration-drafts-and-historical-bridge.md`](configuration-drafts-and-historical-bridge.md)
- [`configuration-to-executable-strategy.md`](configuration-to-executable-strategy.md)
- [`historical-graph-executor.md`](historical-graph-executor.md)
- [`graph-backtest-and-walk-forward-evidence.md`](graph-backtest-and-walk-forward-evidence.md)
- [`strategy-evidence-approval.md`](strategy-evidence-approval.md)

## 5. 已完成 Loop Prompt

按执行顺序：

1. [`archive/explicit-trade-lineage-loop-prompt.md`](archive/explicit-trade-lineage-loop-prompt.md)
2. [`trade-review-comparative-evidence-loop-prompt.md`](trade-review-comparative-evidence-loop-prompt.md)
3. [`production-comparative-review-wiring-loop-prompt.md`](production-comparative-review-wiring-loop-prompt.md)
4. [`main-server-comparative-review-ui-loop-prompt.md`](main-server-comparative-review-ui-loop-prompt.md)
5. [`bounded-human-review-history-loop-prompt.md`](bounded-human-review-history-loop-prompt.md)
6. [`accepted-candidate-contract-validation-handoff-loop-prompt.md`](accepted-candidate-contract-validation-handoff-loop-prompt.md)
7. [`accepted-candidate-draft-binding-loop-prompt.md`](accepted-candidate-draft-binding-loop-prompt.md)
8. [`lesson-evidence-gate-projection-loop-prompt.md`](lesson-evidence-gate-projection-loop-prompt.md)
9. [`lesson-human-approval-loop-prompt.md`](lesson-human-approval-loop-prompt.md)
10. [`approved-lesson-semantic-materialization-loop-prompt.md`](approved-lesson-semantic-materialization-loop-prompt.md)
11. [`generic-configurable-input-and-multi-agent-semantic-pipeline-loop-prompt.md`](generic-configurable-input-and-multi-agent-semantic-pipeline-loop-prompt.md)
12. [`registered-semantic-input-execution-and-decision-context-assembly-loop-prompt.md`](registered-semantic-input-execution-and-decision-context-assembly-loop-prompt.md)
13. [`generic-historical-semantic-evaluation-loop-prompt.md`](generic-historical-semantic-evaluation-loop-prompt.md)

下一阶段只看 [`next-loop-prompt.md`](next-loop-prompt.md)。

## 6. 文档维护规则

1. Roadmap 和 Handoff 使用“当前快照”，不再追加完整历史交接。
2. 测试数量只在 Handoff 保留最新基线；历史数量进入 archive。
3. Loop 完成后把 Prompt 移入“已完成”，并替换 `next-loop-prompt.md`。
4. Mock、Unavailable、Not Applied 和 Active Runtime 必须明确区分。
5. 浏览器未实际连接时只能记录“未验证”，不能引用旧截图代替当前验证。
6. `.playwright-cli/`、`output/`、SQLite 数据库和其他本地产物不属于产品文档或提交范围。
## Production Semantic Candidate Persistence（2026-07-31）

- 生产 Rule Reflection 仅在失败 Trade 和真实 entry Decision Artifact lineage 完整时生成现有 `ReflectionLessonCandidateSchema`。
- SQLite Reflection Store 在保存 Report 时同事务 append-only 持久化 Candidate；相同 ID 的 fingerprint 漂移会 fail closed。
- Review Candidate 与 Materialization 从同一 Candidate Store 恢复真实 ID/fingerprint，不再从 report/sourceTrade 哈希构造竞争身份。
- Web 明确显示 Semantic Facts available/unavailable 与 lineage verified；Candidate、Lesson 和 Shadow Projection 均未应用 Runtime。
## Approved Lesson Shadow Decision Context Replay（2026-07-31）

- Production Materialization 可从 SQLite Agent Artifact Ledger 恢复 data、analysis、Bull/Bear、Decision、Portfolio 和 Risk 历史事实。
- 完整事实使用现有 `DecisionSemanticContextSchema` 形成 validated Shadow Projection；缺失事实 unavailable；Market/Artifact 漂移 stale。
- Shadow Replay 只读且可重放，始终 `decisionContextApplied=false`、`runtimeApplied=false`、`exchangeWriteAllowed=false`。
## Shadow Replay Durability and Approval Audit（2026-07-31）

- validated Shadow Projection 现在写入 SQLite append-only 审计仓库，并绑定 Approval、Candidate、Approved Lesson、Decision Context 和历史 lineage fingerprint。
- Bearer 只读历史 API 使用严格 selectedTradeId/cursor/limit 请求与有界分页。
- 相同 Actor/idempotency key 同内容重放；scope 或 fingerprint 改变时 fail closed。
