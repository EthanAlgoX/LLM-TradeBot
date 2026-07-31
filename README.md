<div align="center">

**English** | [简体中文](README.zh-CN.md)

# LLM-TradeBot

### Build your own multi-Agent trading system like Lego, using natural language

**Describe the idea. Connect the Agents. Validate the strategy. Run it safely on Paper.**

![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?style=flat-square)
![Runtime](https://img.shields.io/badge/Runtime-Paper%20Only-B7D979?style=flat-square)
![Exchange Write](https://img.shields.io/badge/Exchange%20Write-Disabled-E1847C?style=flat-square)
![Tests](https://img.shields.io/badge/TypeScript%20Tests-320%2F320-94C9AA?style=flat-square)

</div>

---

## What is TradeBot?

TradeBot is a **Human-in-the-loop Multi-Agent trading system orchestration platform**.

You do not need to start from an empty graph or manually wire a wall of configuration. Describe what you want in the Orchestration Agent:

- which data should enter the system;
- which sub-Agents are needed;
- what each Agent should analyze;
- how the Agents should connect;
- how the workflow should decide, execute, and reflect.

TradeBot compiles that request into a Workflow Draft with typed inputs and outputs, immutable versions, fingerprints, validation, and controlled release gates.

> **In one sentence: TradeBot lets users combine data, analysis, decision, and reflection Agents like Lego through natural language, producing a trading workflow that can be validated, backtested, audited, and safely promoted.**

~~~mermaid
flowchart LR
    U["Describe a trading idea"] --> C["Orchestration Agent"]
    C --> I["Input Agent blocks"]
    C --> A["Analysis Agent blocks"]
    C --> D["Decision & Reflection blocks"]
    I --> W["Workflow Draft"]
    A --> W
    D --> W
    W --> V["Validation & Backtest"]
    V --> P["Human Approval"]
    P --> R["Controlled Paper Runtime"]

    style U fill:#13171b,stroke:#8db9c8,color:#edf1f2
    style C fill:#15190f,stroke:#b7d979,color:#edf1f2
    style W fill:#13171b,stroke:#dbb76f,color:#edf1f2
    style R fill:#13171b,stroke:#94c9aa,color:#edf1f2
~~~

## Three Agent building-block families

The system uses three Agent families. Every Agent has explicit inputs, outputs, configuration behavior, permissions, versions, and downstream connections.

~~~mermaid
flowchart LR
    subgraph INPUT["1. Input Agents"]
        K["Market bars"]
        F["Fundamental / Macro"]
        N["Financial news"]
        S["Social sources"]
        Q["Normalization & Quality"]
        K --> Q
        F --> Q
        N --> Q
        S --> Q
    end

    subgraph ANALYSIS["2. Analysis Agents"]
        T["Short horizon"]
        M["Medium horizon"]
        L["Long horizon"]
        E["Event / Sentiment"]
        X["Context synthesis"]
        T --> X
        M --> X
        L --> X
        E --> X
    end

    subgraph DECISION["3. Decision & Reflection Agents"]
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

### 1. Input Agents

Input Agents connect, inspect, and normalize external information.

Potential inputs include:

- A-share, Hong Kong, US, or crypto market bars;
- financial statements, valuation data, and macro indicators;
- financial news, filings, announcements, and research;
- X/Twitter, Reddit, and other social sources;
- Paper positions, orders, fills, and historical outcomes.

Markets are not separate TradeBot products. They are compositions of Market Packs, Data Sources, Connectors, Schemas, Observation Windows, calendars, and capability rules.

Input Agents produce standardized Typed Artifacts:

| Artifact | Purpose |
| --- | --- |
| `BarSeriesArtifact` | Bars and market time series |
| `FundamentalArtifact` | Financial, valuation, and macro facts |
| `NewsEventArtifact` | News, filings, and events |
| `SocialEventArtifact` | Social information and sentiment events |
| `AccountSnapshotArtifact` | Paper account, position, and order state |

### 2. Analysis Agents

Analysis Agents are the closest thing to a general-purpose Lego block:

~~~text
Input Artifact
+ System Prompt / strategy parameters
+ Output Schema
+ downstream Agents
~~~

They can represent horizon analysis, news interpretation, fundamental analysis, bull/bear research, event detection, and context synthesis.

Supported workflow patterns include:

- sequential stages;
- parallel Agent branches;
- multi-source synthesis;
- conditional routing;
- Typed Artifact lineage.

Prompts and strategy parameters must be versioned. A change creates a new Draft Version; it never mutates the running Trading Agent directly.

### 3. Decision & Reflection Agents

This family contains Decision, Portfolio, Risk, Execution, Position Monitor, Trade Review, and Reflection.

It includes a non-removable safety foundation:

~~~mermaid
flowchart LR
    A["Analysis semantics"] --> D["Decision"]
    P["Current position"] --> D
    D --> PF["Portfolio"]
    PF --> R{"Risk Gate"}
    R -->|Approved| E["Paper Execution"]
    R -->|Rejected| B["Blocked"]
    E --> RV["Trade Review"]
    RV --> RF["Reflection"]
    RF --> LC["Lesson Candidate"]
    LC --> G["Evidence + Backtest + Approval"]

    style R fill:#19150e,stroke:#dbb76f,color:#edf1f2
    style B fill:#191112,stroke:#e1847c,color:#edf1f2
    style E fill:#101713,stroke:#94c9aa,color:#edf1f2
~~~

- `Decision → Portfolio → Risk → Execution` is the only action-capable chain.
- Risk Gate retains independent veto authority.
- LLMs and Copilot cannot place orders directly.
- Reflection can create only a Lesson Candidate.
- Lessons never rewrite the running strategy automatically.

## From one request to a Paper release

~~~mermaid
flowchart LR
    A["Describe the need"] --> B["Generate Workflow Draft"]
    B --> C["Confirm connections & strategy"]
    C --> D["Contract / Graph Validation"]
    D --> E["Backtest"]
    E --> F["Walk-Forward"]
    F --> G["Human Approval"]
    G --> H["Approved Paper Plan"]
    H --> I["Controlled Paper Runtime"]

    D -.Failed.-> B
    E -.Insufficient evidence.-> C
    F -.Out-of-sample failure.-> C
~~~

A conversation operation returns structured facts, not just chat text:

- Draft ID, version, and fingerprint;
- selected Market Pack, Data Sources, and Preset;
- the three Agent families and their connections;
- field-level Prompt/strategy Diff;
- Observation Windows and data lineage;
- stable Validation Issue codes;
- Backtest, Walk-Forward, and Approval gate state;
- `runtimeApplied=false`.

## Why not unrestricted drag-and-drop?

Lego-like orchestration does not mean arbitrary or unsafe connections.

Every Agent block must declare:

| Contract | Responsibility |
| --- | --- |
| Input Schema | Which Artifacts the Agent can consume |
| Output Schema | Which structured results it produces |
| Configuration Kind | Input source, Prompt/strategy, or controlled policy |
| Permissions | Observe, analyze, propose, veto, or execute on Paper |
| Version + Fingerprint | Reproducible Draft, evidence, and Runtime identity |
| Failure Policy | Missing-input, timeout, fallback, and degradation behavior |
| Downstream Edges | Which Agents may consume the output |

Incompatible schemas, unsupported source capabilities, missing risk boundaries, and fingerprint drift fail closed.

For example:

> A source has only `1d` data, but a Trigger Agent requests `5m`.

TradeBot rejects the compilable Draft because daily data cannot be reverse-generated into minute bars.

## Web workspaces

| Workspace | Primary job |
| --- | --- |
| **Trading Agent** | Inspect the current Paper Runtime, Agent semantics, positions, risk, and execution |
| **Orchestration Agent** | Generate three-family Agent Workflows through conversation and advance validation |
| **Audit Log** | Trace Selector, Decision, Risk, Execution, Trade Review, and Reflection evidence |
| **Connections & Permissions** | Configure data, LLMs, Paper/read-only accounts, Secrets, and boundaries |

The UI explicitly distinguishes:

| State | Meaning |
| --- | --- |
| `REAL` | Connected to a real backend or persisted fact source |
| `MOCK` | Interface sample only; never a Runtime fact |
| `DRAFT` | Candidate configuration or Graph, not released |
| `VALIDATED` | Contract and Graph validation passed |
| `APPROVED_NOT_APPLIED` | Approved without changing the Runtime |
| `ACTIVE PAPER RUNTIME` | The currently controlled Paper process |
| `RECENT TERMINAL RUN` | Historical output from a completed process |
| `UNAVAILABLE` | Required production capability does not exist |
| `STALE` | A parent, capability, configuration, or evidence fingerprint changed |

## Quick start

### Requirements

- Node.js 20+
- npm

### Install

~~~bash
npm install
~~~

### Start the recommended local Paper workspace

~~~bash
npm run dev:paper
~~~

Open:

| Service | Address |
| --- | --- |
| Web | http://127.0.0.1:5174/ |
| API | http://127.0.0.1:8787 |

The recommended workspace requires no secrets. It uses an explicitly labelled fixture market, an ephemeral local Operator token, ignored SQLite files, and no exchange-write capability.

### Other development commands

~~~bash
# Web only
npm run dev:web

# Orchestration API after a TypeScript build
npm run dev:orchestration

# Public live market reads where configured
npm run dev:paper:live

# Historical CLI / backtest entrypoint
npm run backtest:ts
~~~

## Implemented today

- strict Zod contracts and unknown-field rejection;
- server-controlled Market, Data Source, Capability, Preset, and Agent Template registries;
- a conversation-first Intent Compiler and registered Copilot Tool Registry;
- server-derived Input, Analysis, and Decision & Reflection Agent families;
- immutable SQLite Configuration and Pipeline Draft versions;
- fingerprint, parent conflict, idempotency, and stale-evidence handling;
- Pipeline Graph Validator and registered historical Graph execution;
- Backtest, Walk-Forward, Strategy Evidence, and Human Approval;
- Approved Paper Plan and controlled Crypto Paper Runtime;
- Runtime Evidence, Causal Review, and Comparative Trade Review;
- Reflection, Lesson Candidate, Evidence Gates, and Shadow Replay;
- bilingual Web UI connected to the real Conversation Orchestration API.

## Not implemented yet

The following must not be interpreted as production-ready:

- a generic Graph Paper Runtime;
- real production connectors for A-share, Hong Kong, and US markets;
- production news, X/Twitter, or Reddit adapters;
- arbitrary Prompt changes applied directly to running Agents;
- automatic use of Approved Lessons in the active Decision Context;
- exchange-write adapters or live trading.

Unavailable capabilities are explicit and fail closed. They are never synthesized by an LLM or client payload.

## Safety boundaries

> **The current system is Paper only. `exchangeWriteAllowed=false`.**

- Selector remains `topN=1`; symbols are only a candidate universe.
- Existing positions continue through Position Monitor.
- Copilot creates Drafts and cannot mutate the running Pipeline.
- Copilot exposes no Start, Pause, Safe Stop, Runtime Apply, or order tool.
- Prompt, LLM, Reflection, and client payloads cannot bypass Risk.
- The only immediately effective human control is pause-new-openings / close-only.
- No exchange-write adapter exists.

## Reproducible validation

~~~bash
npm run check
npm run test:ts
npm run build:web
git diff --check
~~~

Current baseline:

| Check | Result |
| --- | --- |
| TypeScript check | PASS |
| TypeScript tests | **320/320 PASS** |
| Web build | PASS |
| Diff check | PASS |

## Repository map

| Path | Responsibility |
| --- | --- |
| `packages/contracts` | Zod contracts, IDs, versions, fingerprints, and lifecycle |
| `packages/core` | Intent Compiler, Draft, Graph, Evidence, Approval, and review services |
| `packages/agents` | Agent implementations consuming and producing Typed Artifacts |
| `packages/adapters` | Data-source, execution, LLM, and SQLite adapters |
| `packages/runtime` | HTTP, authentication, composition roots, repositories, and Paper Runtime |
| `apps/web` | Trading Agent, Orchestration Agent, Audit Log, and Connections |
| `apps/cli` | Historical execution and CLI entrypoints |
| `tests-ts` | Contract, security, persistence, orchestration, Runtime, and Web-state tests |
| `docs` | Product architecture, delivery status, handoff, and Loop prompts |

## Configuration and secrets

Copy `.env.example` to `.env` only when an optional provider is needed.

- DeepSeek is the only LLM adapter currently wired into the TypeScript Runtime and still requires explicit authorization.
- Binance credentials are used only for signed read-only reconciliation.
- Binance public market data never enables an exchange-write path.
- Never commit `.env`, API keys, authorization headers, account credentials, or vault exports.

## Documentation

- [Product baseline](PRODUCT.md)
- [Documentation index](docs/README.md)
- [Architecture and delivery plan](docs/architecture-and-delivery-plan.md)
- [Roadmap and current progress](docs/product-roadmap-and-progress.md)
- [Project status and handoff](docs/project-status-and-handoff.md)
- [Production orchestration workspace](docs/production-orchestration-workspace.md)
- [Local Paper workspace](docs/local-paper-workspace.md)
- [Next development loop](docs/next-loop-prompt.md)

## Repository policy

Local browser artifacts, screenshots, generated output, SQLite databases, secrets, and Runtime data are not source files and must not be committed. Preserve append-only Evidence, Approval, Lineage, and Audit records. Never represent a Draft, terminal run, or approved-but-not-applied Artifact as the Active Paper Runtime.

---

<div align="center">

**Build the workflow like Lego. Validate it like software. Operate it like a trading system.**

[简体中文](README.zh-CN.md)

</div>
