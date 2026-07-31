# TradeBot 架构与交付规划

> 文档角色：长期目标架构、不可破坏边界和阶段依赖的权威基线
> 当前状态：核心编排、历史证据、受控 Crypto Paper Runtime、Causal Trade Review 与 Human Lesson Review 已形成真实垂直切片；Accepted Candidate 的生产 Draft binding 待完成
> 最后更新：2026-07-30
> 当前完成度：`product-roadmap-and-progress.md`
> 新窗口交接：`project-status-and-handoff.md`

## 1. 产品定位

TradeBot 是：

> 跨市场、可编排、可回测、可审计、可受控进化的 Human-in-the-loop Multi-Agent 交易系统。

产品最终需要同时支持：

- 多个真实市场及各自的 Market Pack；
- 后端预注册 Agent Template 和可版本化 AgentConfig；
- 单周期、任意多周期和完全事件驱动的 Pipeline；
- 结构化数据输入与受控语义 Artifact 交接；
- Graph Backtest、Walk-Forward、Human Approval 和 Paper Running；
- 对话式编排与直接编辑两种操作方式；
- Reflection Lesson 的证据化、审批和受限使用；
- 可审计、可停止、可恢复但不自动越权恢复的 Runtime。

当前可运行市场仍主要是 Crypto。A 股、港股、美股属于后续真实垂直切片，不能仅凭合同或界面宣称已经支持。

## 2. 不可破坏的系统边界

1. 唯一可形成执行动作的链路是：

   ```text
   Decision -> Portfolio -> Risk -> Execution
   ```

2. LLM、Copilot、Reflection 和 Analysis Agent 都不能直接下单或绕过 Risk。
3. `--symbols` 或 Web 中的 symbols 只表示候选池；Selector 继续保持 `topN=1`。
4. 当前持仓始终进入 Position Monitor，不能因没有新信号而跳过。
5. 所有策略变化必须经过：

   ```text
   Draft -> Contract Validation -> Backtest -> Walk-Forward
         -> Human Approval -> Paper Running
   ```

6. Draft、编译结果和审批记录不能热更新正在运行的 Pipeline。
7. “暂停新开仓 / 仅允许平仓”是唯一允许立即生效的人工风险控制。
8. Reflection 只能创建 Lesson Candidate；未经批准的 Candidate 不得进入 Decision Context。
9. Data Source 决定数据粒度。日线不能伪造 5 分钟，月线不能伪造日线。
10. 允许可信细粒度聚合为粗粒度，但必须记录 lineage、转换版本、时区和交易日历。
11. Secret、完整 Prompt、账户敏感数据和任意客户端代码不得进入 Artifact、日志或浏览器持久状态。
12. 当前阶段不增加 Binance 或其他交易所写接口，`exchangeWriteAllowed` 保持 `false`。

## 3. 目标架构

```text
Web / Copilot / Direct Editor
        |
        v
Authenticated Orchestration API
        |
        +--> Market Pack Registry
        +--> Data Source & Capability Registry
        +--> Agent Template / Config Registry
        +--> Pipeline Graph Registry & Validator
        +--> Configuration / Strategy Drafts
        +--> Evidence Jobs & Approval
        |
        v
Registered Historical Graph Executor
        |
        +--> Backtest
        +--> Walk-Forward
        +--> Artifact / Trace / Lineage
        |
        v
Approved Paper Plan
        |
        v
Server-registered Paper Runtime Binding
        |
        v
Decision -> Portfolio -> Risk -> Execution
```

横切能力：

```text
Authentication / Authorization
Version + Fingerprint
Immutable Audit
Runtime Safety
Lease + Heartbeat + Fencing
Stop / Drain
Operational Outbox
Runtime Evidence Read Model
```

## 4. 市场、数据与观察窗口

### 4.1 Market Pack

Market Pack 隔离以下市场规则：

- Instrument 和 Symbol 规范；
- 时区、交易日历和交易时段；
- 手续费、税费、滑点和结算；
- 涨跌停、停牌、盘前盘后和公司行动；
- 杠杆、资金费率和强平；
- 市场特有 Risk Policy；
- Backtest Execution Simulator。

通用 Agent 和 Web 不得散落硬编码的市场规则。

### 4.2 Data Provider、Connector、Processing Agent

三层必须分离：

```text
Data Provider
  -> Connector (auth / request / rate limit / cache / retry)
  -> Normalizer or Processing Agent
  -> Typed Market Artifact
```

当前已有 Binance Futures Public 与 CSV Historical Source 的真实 Capability Manifest。其他 Provider 必须先实现 Connector、Schema 映射、Capability、时间语义和质量验证，不能仅增加一个市场名称。

### 4.3 Observation Window

合同支持：

- `bar_interval`；
- `rolling_window`；
- `event_batch`；
- `reporting_period`。

时间单位支持：

- `second`；
- `minute`；
- `hour`；
- `day`；
- `week`；
- `month`；
- `quarter`。

默认 Crypto Preset 可以继续使用当前真实支持的 `5m/15m/1h`，但该组合不是平台级固定约束。

## 5. Agent 与语义交接

后端 Agent 必须先实现并注册。客户端只能引用稳定 Template ID、版本和允许编辑的配置字段，不能上传模块、代码、命令、SQL 或任意 Provider。

旧 LM Multi-Agent 系统需要保留的核心行为是：

```text
Structured Market Data
  -> per-window Analysis Agents
  -> Semantic Assessments
  -> Bull / Bear / Context Fusion
  -> Decision Context
  -> Semantic Decision Intent
  -> Portfolio -> Risk -> Execution
```

每个语义 Artifact 同时包含：

- 自然语言 thesis 或 summary；
- direction、confidence、regime 等结构化字段；
- evidence、invalidation 和 risk flags；
- source refs、Schema refs 和 lineage；
- Agent、版本、trace、时间和 fingerprint；
- success、fallback 或 error 状态。

语义不能被压缩为单一分数，也不能以无 Schema 的长文本直接成为执行事实。

## 6. Pipeline Graph 与执行

Pipeline Graph 可以表达：

- 单周期 K 线；
- 双周期或任意多周期；
- 新闻、公告、基本面等事件驱动研究；
- Research-only Graph；
- 带 Position Monitor 和 Reflection 后处理的交易 Graph。

Validator 已负责检查：

- 节点和边引用；
- 输入输出 Schema；
- Market Pack 与 Data Source 类型；
- Observation Window 与合法聚合；
- 必需输入、悬空节点和不允许循环；
- Required、Optional、Fallback；
- Decision、Portfolio、Risk、Execution 权限边界。

Historical Graph Executor 只执行后端注册 Plan，不接受客户端 raw Graph、代码或 executor 选择。Paper Runtime 当前仍由服务端注册的 Current Crypto Binding 复用原 `DecisionPipeline`；在通用 Graph Paper Runtime 完成前，不替换这条稳定链路。

## 7. 研究、证据与发布

Graph Backtest 和 Walk-Forward 绑定：

- Pipeline Graph / Historical Plan；
- Dataset fingerprint；
- Strategy Profile；
- Market Pack 与 Data Source；
- Observation schedule 和 `asOf`；
- fee、slippage 和 execution model；
- Artifact、Trace 和 lineage。

Evidence Job 由服务端注册 Runner 执行，支持幂等、lease、orphan recovery 和 artifact integrity verification。客户端不能指定 runner、模块、命令、文件路径、artifact ID 或 actor。

只有完全匹配当前 Graph、Strategy、Dataset 和 Artifact fingerprint 的 Backtest 与 Walk-Forward 证据，才允许 Human Approval 和 Approved Paper Plan。

## 8. Paper Runtime 与运维控制

当前 Current Crypto Paper Runtime 已具备：

- 服务端注册 Binding；
- Approved Paper Plan 与显式 Activation；
- 只读 Preflight；
- SQLite Paper Account 与 Safety 状态；
- lease、heartbeat、fencing 和单计划并发保护；
- stop-after-current-cycle / drain；
- close-only；
- incident、orphan detection 和受控 clearance；
- Operational Outbox、Dispatcher、Dead Letter、Worker 和 Retention 基础；
- Trace、Agent Artifact、Reflection 和 Runtime Evidence Read Model。

这些能力不等于实盘交易。当前 Runtime 仍是 Paper Only，并永久声明不允许交易所写入。

## 9. Web 与 Copilot

Web 的主要产品入口应是交易运行与对话式编排，而不是要求用户先理解复杂自由画布。

推荐交互：

- 交易首页：Preflight、Start、Pause Openings、Safe Stop、账户、持仓、周期和真实 Runtime Evidence；
- 对话式编排：用户用自然语言选择市场、数据源、Preset、Agent 和策略修改；
- 结构化 Draft：Copilot 调用后端注册工具，创建可审阅的 Draft 和 Diff；
- 直接编辑：作为高级补充，编辑允许字段而不是任意代码；
- 验证与发布：显示 Contract、Backtest、Walk-Forward、Approval 和 Runtime-not-applied 状态；
- 审计：按 Run、Cycle、Trace 和 Artifact 查看因果链。

聊天记录不是配置真相。Registry、Draft、Graph Version、Evidence 和 Approval 才是系统事实。

## 10. 已落地的架构基线

截至 2026-07-27，以下垂直切片已经进入代码并有自动化测试：

1. 架构合同、Capability Manifest 和 Pipeline Graph Validator。
2. 当前 Crypto Graph Manifest、Graph Registry、Draft Persistence 和 Compiler。
3. 语义 Agent Artifact 与 Crypto/daily/event-only Preset 基线。
4. 注册式 Historical Graph Executor。
5. Graph Backtest、Walk-Forward 和 Durable Evidence Job。
6. Configuration Draft 与 PipelineGraph-to-HistoricalPlan Bridge。
7. Strategy Evidence Binding、Human Approval 和 Approved Paper Plan。
8. Current Crypto 受控 Paper Runtime Binding。
9. Preflight、lease、heartbeat、fencing、stop/drain、incident 和 outbox。
10. Web Runtime controls、会话恢复和只读 Runtime Evidence Dashboard。

## 11. 仍需完成的架构闭环

1. 对话式编排需要与现有 Draft、Validator、Evidence 和 Approval API 形成完整后端工具链。
2. Web 需要以对话为主完成市场、数据源、Agent 和策略 Draft，而不是依赖独立复杂画布。
3. Runtime Evidence 需要继续发展为可按 Run/Cycle 浏览的 Causal Trade Review。
4. Reflection 需要完整实现 Candidate、证据验证、Human Approval、Approved Lesson 和 Decision Context 生命周期。
5. 需要第二个真实市场证明 Market Pack、Connector、Calendar、Risk 和 Backtest 抽象有效。
6. 通用 Graph Paper Runtime 仍是后置阶段，不能提前替换当前固定 Crypto Runtime。
7. 外部 Operational Outbox 渠道仍未配置；当前只有本地/注册式基础。
8. 不增加交易所写接口。

## 12. 交付顺序

后续按以下依赖推进：

```text
P1 Conversation-first Draft Orchestration
  -> P2 Causal Run / Trade Review
  -> P3 Reflection Lesson Lifecycle
  -> P4 Second Real Market Vertical Slice
  -> P5 General Graph Paper Runtime
```

任何阶段都必须保持现有 `DecisionPipeline`、Selector `topN=1`、Position Monitor、Paper Account、Risk、Execution 和 Runtime Safety 行为不被无意改变。

## 13. 每轮质量门禁

每个实现 Loop 完成后执行：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

Web 修改还需要检查：

- 宽桌面与较窄笔记本；
- 中文与英文；
- 无明显横向溢出、遮挡、过密文字和不可读小字；
- SAMPLE、RECENT 和 ACTIVE 状态不混淆；
- Draft 不表现为 Runtime Applied；
- Exchange Write 始终明确为关闭。
