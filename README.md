<div align="center">

# LLM-TradeBot

### 用自然语言，像搭乐高一样编排自己的多 Agent 交易系统

**Describe the idea. Connect the Agents. Validate the strategy. Run it safely on Paper.**

![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?style=flat-square)
![Runtime](https://img.shields.io/badge/Runtime-Paper%20Only-B7D979?style=flat-square)
![Exchange Write](https://img.shields.io/badge/Exchange%20Write-Disabled-E1847C?style=flat-square)
![Tests](https://img.shields.io/badge/TypeScript%20Tests-320%2F320-94C9AA?style=flat-square)

</div>

---

## TradeBot 是什么？

TradeBot 是一个 **Human-in-the-loop Multi-Agent 交易系统编排平台**。

你不需要从空白 Graph 开始，也不需要手工把一大堆配置连接起来。只需要在编排工作台中描述：

- 想接入什么数据；
- 需要哪些子 Agent；
- 每个 Agent 应该分析什么；
- Agent 之间如何连接；
- 最终如何决策和复盘。

TradeBot 会把这些需求编译成一个具有严格输入输出合同、版本、指纹和发布门禁的 Workflow Draft。

> **一句话定位：TradeBot 让用户通过自然语言，像搭乐高一样组合数据、分析、决策与反思 Agent，构建可验证、可回测、可审计的交易系统。**

~~~mermaid
flowchart LR
    U["用户描述交易思路"] --> C["编排 Agent"]
    C --> I["输入 Agent 积木"]
    C --> A["分析 Agent 积木"]
    C --> D["决策与反思 Agent 积木"]
    I --> W["Workflow Draft"]
    A --> W
    D --> W
    W --> V["验证与回测"]
    V --> P["人工审批"]
    P --> R["受控 Paper Runtime"]

    style U fill:#13171b,stroke:#8db9c8,color:#edf1f2
    style C fill:#15190f,stroke:#b7d979,color:#edf1f2
    style W fill:#13171b,stroke:#dbb76f,color:#edf1f2
    style R fill:#13171b,stroke:#94c9aa,color:#edf1f2
~~~

## 三类 Agent 积木

系统统一使用三类 Agent。每个 Agent 都有明确的输入、输出、配置方式、权限和下游连接。

~~~mermaid
flowchart LR
    subgraph INPUT["1. 输入 Agent"]
        K["K 线"]
        F["财务 / 宏观"]
        N["财经新闻"]
        S["社交信息"]
        Q["标准化与质量检查"]
        K --> Q
        F --> Q
        N --> Q
        S --> Q
    end

    subgraph ANALYSIS["2. 分析 Agent"]
        T["短周期分析"]
        M["中周期分析"]
        L["长周期分析"]
        E["事件 / 情绪分析"]
        X["上下文汇总"]
        T --> X
        M --> X
        L --> X
        E --> X
    end

    subgraph DECISION["3. 决策与反思 Agent"]
        D["Decision"]
        PF["Portfolio"]
        R["Risk Gate"]
        EX["Paper Execution"]
        PM["Position Monitor"]
        RV["Trade Review"]
        RF["Reflection"]
        D --> PF --> R --> EX
        PM --> D
        EX --> RV --> RF
    end

    Q --> T
    Q --> M
    Q --> L
    Q --> E
    X --> D
~~~

### 1. 输入 Agent

负责连接和标准化外部数据。

输入来源可以是：

- A 股、港股、美股或币圈 K 线；
- 财报、估值和宏观数据；
- 财经新闻、公告和研报；
- X/Twitter、Reddit 等社交信息；
- Paper 持仓、订单和成交历史。

不同市场不是不同产品，而是不同的 Market Pack、Data Source、Connector、Schema 和 Observation Window 配置。

输入 Agent 输出标准化的 Typed Artifact，例如：

| Artifact | 用途 |
| --- | --- |
| `BarSeriesArtifact` | K 线和市场序列 |
| `FundamentalArtifact` | 财报、估值和宏观事实 |
| `NewsEventArtifact` | 新闻、公告和事件 |
| `SocialEventArtifact` | 社交信息和情绪事件 |
| `AccountSnapshotArtifact` | Paper 账户、持仓和订单状态 |

### 2. 分析 Agent

分析 Agent 是最接近“通用乐高积木”的部分：

~~~text
输入 Artifact
+ System Prompt / 策略参数
+ 输出 Schema
+ 下游 Agent
~~~

它可以用于多周期判断、新闻分析、基本面分析、多空研究、事件识别和上下文汇总，并支持：

- 串行连接；
- 多 Agent 并行；
- 多路结果汇总；
- 条件分支；
- Typed Artifact lineage。

Prompt 和策略参数必须版本化。修改只会创建新的 Draft Version，不会直接改变运行中的交易 Agent。

### 3. 决策与反思 Agent

这一类包含 Decision、Portfolio、Risk、Execution、Position Monitor、Trade Review 和 Reflection。

其中存在不可拆除的安全底座：

~~~mermaid
flowchart LR
    A["分析语义"] --> D["Decision"]
    P["当前持仓"] --> D
    D --> PF["Portfolio"]
    PF --> R{"Risk Gate"}
    R -->|批准| E["Paper Execution"]
    R -->|拒绝| B["Blocked"]
    E --> RV["Trade Review"]
    RV --> RF["Reflection"]
    RF --> LC["Lesson Candidate"]
    LC --> G["Evidence + Backtest + Approval"]

    style R fill:#19150e,stroke:#dbb76f,color:#edf1f2
    style B fill:#191112,stroke:#e1847c,color:#edf1f2
    style E fill:#101713,stroke:#94c9aa,color:#edf1f2
~~~

- `Decision → Portfolio → Risk → Execution` 是唯一动作链。
- Risk Gate 拥有独立否决权。
- LLM 和 Copilot 不能直接下单。
- Reflection 只能创建 Lesson Candidate。
- Lesson 不会自动写回运行策略。

## 从一句话到 Paper 上线

一个完整的编排过程如下：

~~~mermaid
flowchart LR
    A["描述需求"] --> B["生成 Workflow Draft"]
    B --> C["确认连接与策略"]
    C --> D["Contract / Graph Validation"]
    D --> E["Backtest"]
    E --> F["Walk-Forward"]
    F --> G["Human Approval"]
    G --> H["Approved Paper Plan"]
    H --> I["Controlled Paper Runtime"]

    D -.失败.-> B
    E -.证据不足.-> C
    F -.样本外失败.-> C
~~~

每次对话操作都会返回结构化结果，而不只是聊天文本：

- Draft ID、版本和 fingerprint；
- Market Pack、Data Source 和 Preset；
- 三类 Agent 及其连接关系；
- Prompt/策略字段级 Diff；
- Observation Window 和数据 lineage；
- 稳定 Validation Issue code；
- Backtest、Walk-Forward 和 Approval 状态；
- `runtimeApplied=false`。

## 为什么不是任意拖拽？

像乐高一样编排，不代表可以绕过接口和安全规则。

每块 Agent 积木都必须声明：

| 合同 | 作用 |
| --- | --- |
| Input Schema | 可以接收哪些 Artifact |
| Output Schema | 会产生什么结构化结果 |
| Configuration Kind | 数据源、Prompt/策略或受控策略 |
| Permissions | 观察、分析、决策建议、风险否决或 Paper 执行 |
| Version + Fingerprint | 保证 Draft、证据和运行版本可追溯 |
| Failure Policy | 缺失、超时和降级时如何处理 |
| Downstream Edges | 输出可以连接到哪些 Agent |

接口不兼容、数据能力不足、风险链缺失或版本漂移时，系统会 fail closed。

例如：

> 只有 `1d` 数据源，却要求 Trigger Agent 使用 `5m`。

系统会拒绝创建可编译版本，因为日线数据不能反向生成分钟数据。

## Web 工作区

| 页面 | 主要任务 |
| --- | --- |
| **交易 Agent** | 查看当前 Paper Runtime、Agent 语义输出、持仓、风险和执行状态 |
| **编排 Agent** | 通过对话生成三类 Agent Workflow、调整策略并推进验证 |
| **审计记录** | 追溯 Selector、Decision、Risk、Execution、Trade Review 和 Reflection |
| **连接与权限** | 配置数据、LLM、Paper/只读账户、Secret 和权限边界 |

页面明确区分：

| 状态 | 含义 |
| --- | --- |
| `REAL` | 已连接真实后端或持久化事实源 |
| `MOCK` | 仅用于界面示例，不是 Runtime 事实 |
| `DRAFT` | 尚未上线的候选配置或 Graph |
| `VALIDATED` | 合同和 Graph 验证通过 |
| `APPROVED_NOT_APPLIED` | 已批准，但尚未修改 Runtime |
| `ACTIVE PAPER RUNTIME` | 当前受控运行的 Paper 进程 |
| `RECENT TERMINAL RUN` | 最近结束的历史运行 |
| `UNAVAILABLE` | 缺少真实服务端能力 |
| `STALE` | 父版本、能力或证据 fingerprint 已变化 |

## 立即运行

### 环境要求

- Node.js 20+
- npm

### 安装

~~~bash
npm install
~~~

### 启动推荐的本地 Paper 工作区

~~~bash
npm run dev:paper
~~~

启动后访问：

| 服务 | 地址 |
| --- | --- |
| Web | http://127.0.0.1:5174/ |
| API | http://127.0.0.1:8787 |

推荐工作区不需要 Secret。它使用明确标识的 fixture market、临时本地 Operator token、被忽略的 SQLite 文件，并且不存在交易所写入能力。

### 其他开发命令

~~~bash
# 仅启动 Web
npm run dev:web

# TypeScript 构建后启动编排 API
npm run dev:orchestration

# 在已配置时读取公开实时行情
npm run dev:paper:live

# 历史 CLI / 回测入口
npm run backtest:ts
~~~

## 当前已经实现

- 严格 Zod 合同和未知字段拒绝；
- 服务端 Market、Data Source、Capability、Preset 和 Agent Template Registry；
- Conversation-first Intent Compiler 和注册式 Copilot Tool Registry；
- 服务端派生的输入、分析、决策与反思三类 Agent；
- 不可变 SQLite Configuration/Pipeline Draft；
- fingerprint、父版本冲突、幂等和 stale evidence；
- Pipeline Graph Validator 和注册式历史 Graph Executor；
- Backtest、Walk-Forward、Strategy Evidence 和 Human Approval；
- Approved Paper Plan 与受控 Crypto Paper Runtime；
- Runtime Evidence、Causal Review 和 Comparative Trade Review；
- Reflection、Lesson Candidate、Evidence Gate 和 Shadow Replay；
- 中英文 Web 界面以及真实 Conversation Orchestration API。

## 当前仍未实现

以下能力不能被理解为已经上线：

- 通用 Graph Paper Runtime；
- A 股、港股、美股的真实生产 Connector；
- 新闻、X/Twitter、Reddit 的生产数据 Adapter；
- 任意 Prompt 直接写入运行中的 Agent；
- 自动把 Approved Lesson 应用到当前 Decision Context；
- 交易所写接口和实盘交易。

所有 unavailable 能力必须明确显示并 fail closed，不能由 LLM 或客户端伪造。

## 安全边界

> **当前系统仅支持 Paper。`exchangeWriteAllowed=false`。**

- Selector 保持 `topN=1`，symbols 只是候选池。
- 当前持仓继续进入 Position Monitor。
- Copilot 只能创建 Draft，不能直接修改运行 Pipeline。
- Copilot 没有 Start、Pause、Safe Stop、Runtime Apply 或下单工具。
- Risk 不能被 Prompt、LLM、Reflection 或客户端绕过。
- 唯一允许立即生效的人工控制是暂停新开仓 / 仅允许平仓。
- 当前不存在任何交易所写 Adapter。

## 可复现验证

~~~bash
npm run check
npm run test:ts
npm run build:web
git diff --check
~~~

当前验证基线：

| 检查 | 结果 |
| --- | --- |
| TypeScript check | PASS |
| TypeScript tests | **320/320 PASS** |
| Web build | PASS |
| Diff check | PASS |

## 代码结构

| 路径 | 职责 |
| --- | --- |
| `packages/contracts` | Zod 合同、ID、版本、fingerprint 和生命周期 |
| `packages/core` | Intent Compiler、Draft、Graph、Evidence、Approval 和审阅服务 |
| `packages/agents` | 消费和生成 Typed Artifact 的 Agent 实现 |
| `packages/adapters` | 数据源、执行、LLM 和 SQLite Adapter |
| `packages/runtime` | HTTP、认证、组合根、SQLite Repository 和 Paper Runtime |
| `apps/web` | 交易 Agent、编排 Agent、审计记录和连接配置 |
| `apps/cli` | 历史执行和 CLI 入口 |
| `tests-ts` | 合同、安全、持久化、编排、Runtime 和 Web 状态测试 |
| `docs` | 产品架构、交付状态、交接文档和 Loop Prompt |

## 配置与 Secret

只有启用可选 Provider 时才需要把 `.env.example` 复制为 `.env`。

- DeepSeek 是当前唯一接入 TypeScript Runtime 的 LLM Adapter，仍需显式授权。
- Binance 凭证只用于签名只读对账。
- Binance Public Market Data 不会开启交易所写路径。
- 不要提交 `.env`、API Key、Authorization Header、账户凭证或 Vault 导出。

## 文档导航

- [产品基线](PRODUCT.md)
- [文档索引](docs/README.md)
- [架构与交付计划](docs/architecture-and-delivery-plan.md)
- [路线图与当前进度](docs/product-roadmap-and-progress.md)
- [项目状态与交接](docs/project-status-and-handoff.md)
- [生产编排工作区](docs/production-orchestration-workspace.md)
- [本地 Paper 工作区](docs/local-paper-workspace.md)
- [下一阶段开发 Loop](docs/next-loop-prompt.md)

## Repository policy

本地浏览器产物、截图、生成输出、SQLite 数据库、Secret 和 Runtime 数据都不是源文件，不应提交。必须保留 append-only Evidence、Approval、Lineage 和 Audit 记录，也不能把 Draft、Terminal Run 或 Approved-but-not-applied Artifact 表现成 Active Paper Runtime。

---

<div align="center">

**Build the workflow like Lego. Validate it like software. Operate it like a trading system.**

</div>
