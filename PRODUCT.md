# TradeBot Product Baseline

> 状态：产品方向已确认，Crypto Paper 与受控编排/审阅垂直切片已运行
> 最后更新：2026-07-30
> 文档导航：`docs/README.md`
> 详细架构与交付状态：`docs/architecture-and-delivery-plan.md`
> 新窗口接手摘要：`docs/project-status-and-handoff.md`

## 产品定义

TradeBot 是一个输入可配置、Agent 可编排、可回测、可审计、可受控进化的 Human-in-the-loop Multi-Agent 交易系统。A 股、港股、美股或币圈不是彼此独立的产品模块，而是由用户选择的 Market Pack、Data Source、Schema、Observation Window 和执行规则组合。

它不是普通看盘工具，也不是让聊天机器人直接下单的产品。交易 Agent 是系统主角；右侧 Copilot 是受约束的编排和解释入口，负责把人的自然语言意图转换为结构化配置草案、Pipeline 变更草案与验证任务。

## 核心差异

1. **多 Agent 协作**：把复杂交易任务拆成职责单一、输入最小化的子 Agent，通过 typed Artifact 协作。
2. **灵活的观察窗口拆解**：默认支持多周期分析，但不固定 `5m/15m/1h`，允许任意数量、任意粒度、单周期或完全事件驱动。
3. **输入与市场解耦**：用户通过注册配置接入行情、事件、财报或其他结构化事实；Market Pack 只承载数据语义、日历、费用和模拟执行约束，不把具体市场写死在 Agent 流程中。
4. **可配置的数据与 Agent**：数据源、Connector、Agent Template、Agent 实例和 Pipeline Graph 均版本化、可验证、可替换。
5. **决策与独立风控**：Decision Agent 汇总压缩后的结构化证据；Risk Gate 拥有独立否决权；LLM 不能直接创建可执行订单。
6. **可验证的持续进化**：Reflection 只能产生 Lesson Candidate。经验必须经过证据校验、回测、Walk-Forward 和人工审批，才能成为有效经验或新策略版本。

## 默认模板

默认模板采用语义职责，而不是固定 K 线周期：

```text
Universe / Selector
  -> Data Sync + Data Quality
  -> one or more Horizon / Event Agents
  -> optional Context / Cross-Horizon Reconciler
  -> Decision
  -> Portfolio
  -> Risk Gate
  -> Execution / Position Monitor
  -> Review + Reflection
```

`Regime`、`Setup`、`Trigger` 是推荐职责，不是强制节点。根据数据源能力，合法配置可以是：

- `1h + 15m + 5m`；
- `1M + 1W + 1D`；
- 任意两个观察窗口；
- 只有一个日线 Agent；
- 没有 K 线、完全由新闻或事件驱动的 Pipeline。

## 数据源原则

- 先登记和探测数据源能力，再创建依赖它的 Agent。
- 统一区分 Data Source、Connector 和 Data Processing Agent。
- 数据源必须声明数据类型、可用粒度、历史覆盖、时区、时间戳语义、交易日历、实时性、完整度及允许的聚合方式。
- 允许从可信的细粒度数据聚合更粗粒度数据，并保留 lineage；禁止用日线伪造分钟数据。
- K 线使用 interval；新闻、财报、宏观和订单簿使用更通用的 Observation Window。
- 必需数据缺失时禁止新开仓；可选输入缺失时只能按显式策略降级并写入审计记录。

## Copilot 权限边界

Copilot 可以：

- 查询当前交易、持仓、风险、策略版本、Trace、Artifact 和历史消息；
- 解释某次 Agent 决策；
- 创建 Data Source、Agent、Pipeline、Human Market Thesis 或 Strategy Change 的草案；
- 校验 Agent 配置和 Pipeline 连线；
- 发起回测、Walk-Forward、版本比较和审批请求。

Copilot 不可以：

- 动态生成并执行任意后端代码；
- 读取或输出 API Key、环境变量、完整 Prompt 或 Secret；
- 直接修改运行中的 Pipeline；
- 绕过数据能力、Schema、风险或发布门禁；
- 直接下单；
- 把 Reflection 的文本自动写入运行策略。

所有策略变更必须遵循：

```text
Draft -> Contract Validation -> Backtest -> Walk-Forward
      -> Human Approval -> Paper Running
```

“暂停新开仓 / 仅允许平仓”是唯一可立即生效的人工风险控制。

## 回测与发布

每次可复现的回测必须绑定：

```text
Market Pack Version
+ Data Snapshot Version
+ Pipeline Graph Version
+ Strategy Profile Version
+ Execution Model Version
= Reproducible Backtest Run
```

回测必须使用与 Paper/未来 Live 相同的 Agent 合同和决策 Pipeline，并由 Market Pack 提供市场特有的撮合、费用、结算和交易限制。候选版本至少经过基线对照、消融测试、Walk-Forward 和人工审批。

## 持续进化

TradeBot 使用快慢双循环：

- **快循环**：数据 -> Agent -> Decision -> Risk -> Execution。只能读取已批准配置和经验，不能自行改写。
- **慢循环**：Trace -> Reflection -> Lesson Candidate -> 证据验证/反事实回放 -> 回测/Walk-Forward -> 人工审批 -> Validated Lesson 或 Strategy Candidate。

交易记忆分为：

1. 不可变的 Episode Memory；
2. 尚未验证的 Reflection / Lesson Candidate；
3. 有适用市场、Regime、样本、置信度和有效期的 Validated Lesson；
4. 经过完整发布门禁的新 Strategy/Pipeline 版本。

## Web 产品结构

Web 首期收敛为四个工作区：

1. **运行控制台**：运行状态、当前选中标的、持仓、风险、策略阶段与人工待办。
2. **系统编排**：Data Source/Agent Catalog、Pipeline Canvas、右侧编排 Copilot 与结构化草案。
3. **研究与验证**：Draft、Backtest、Walk-Forward、Approval、Paper Running 的统一生命周期。
4. **连接与基础设施**：Market Pack、数据源、LLM Provider、Paper/只读账户、Secret Vault 和权限。

界面需要支持完整中英文切换。中文模式尽量使用中文；市场代码、标的代码、产品名和通用交易缩写可以保留英文。

## 当前现实

- 当前 TypeScript Runtime 仍是固定依赖注入的加密货币 Paper Pipeline。
- 当前行情合同仍固定为 `5m/15m/1h`，Data Source kind 仍主要是 CSV 与 Binance Futures Public。
- 当前已经有 Selector、DataSync、Analysis、Decision、Risk、Paper Execution、Position Monitor、Reflection、Trace、Artifact Ledger、回测和 Walk-Forward 基础。
- 当前 Web 无 Runtime HTTP API，页面展示和配置交互仍主要使用 mock data。
- DeepSeek 是当前唯一实际接入 TypeScript Runtime 的 LLM Adapter；其他 Provider 仅有前端配置合同。
- 不接入实盘写接口；任何未来 Live 能力必须单独设计和验证。

上述“可编排、多市场、能力自适应数据源、受控进化”均为已经确认的下一阶段目标，不能误写成当前已实现能力。
