# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are human operators supervising a multi-agent trading strategy in Paper mode. They need to understand system state, current exposure, risk, strategy provenance, and why an Agent made a decision without treating the interface as a chat product.

## Product Purpose

TradeBot is a Human-in-the-loop Multi-Agent Trading Strategy Operating Console. It makes the full decision and execution chain visible, reviewable, and governable while preserving strict separation between explanation, strategy drafting, validation, approval, and execution.

## Positioning

TradeBot treats every Agent action as auditable operational evidence linked by trace, artifact, order, and strategy fingerprints. The human is an approver and emergency risk controller, not an unrestricted prompt-based trader.

## Operating Context

Operators monitor sequential Paper cycles, inspect open positions, review Agent artifacts, trace decisions through risk and execution, compare candidate profiles, create bounded Human Market Thesis records, and approve strategy changes only after Backtest and Walk-Forward validation.

## Capabilities and Constraints

- Agent flow: Selector, DataSync, Analysis, Bull/Bear, Decision, Portfolio, Risk, Execution, Position Monitor, and Review.
- Core runtime concepts are versioned contracts, Paper Account state, Paper Cycle Journal, Stage Events, Agent Artifact Ledger, Trade Review, Strategy Profile, Run Manifest, Backtest Report, and Walk-Forward Report.
- Copilot tasks are read-only queries or draft creation. They cannot directly place orders or modify a running strategy.
- Human Market Thesis records must be structured, scoped, confidence-rated, time-bounded, and auditable.
- Strategy release follows Draft, Backtest, Walk-Forward, Human Approval, then Paper Running.
- Pausing new openings while preserving close logic is the only immediate risk control exposed in the Web UI.
- No live exchange write integration is part of this Web redesign.
- The current Web uses TypeScript, Vite, semantic HTML, and CSS without a component framework.

## Brand Commitments

The product name is TradeBot. The interface must feel like a precise financial mission-control instrument: dark, restrained, dense, readable, and evidence-led. It must avoid generic SaaS cards, chat-first layouts, crypto-dashboard clichés, gratuitous glow, decorative noise, emoji, and purple gradient branding.

## Evidence on Hand

- Architecture and delivery plan: `docs/architecture-and-delivery-plan.md`
- Agent Artifact Ledger and Trade Review behavior: `docs/agent-artifact-ledger.md`
- Runtime schemas: `packages/contracts/src/index.ts`
- Read-only runtime dashboard and review presenters: `packages/runtime/src/`
- SQLite Paper Account, Cycle Journal, Runtime Safety, Trace, and Artifact adapters: `packages/adapters/src/`
- The Web currently has no runtime HTTP API; UI data remains clearly identified mock data until an application API is added.

## Product Principles

1. Agents are the operating subject; Copilot is a constrained support surface.
2. Every consequential state must have provenance, version, and an inspectable evidence trail.
3. Explanation and proposal never imply permission to execute.
4. Risk controls must be immediate, unmistakable, and safe by default.
5. Strategy changes earn release through evidence and explicit human approval.

## Accessibility & Inclusion

The Web console must preserve keyboard operation, visible focus, semantic form labels, sufficient contrast, reduced-motion behavior, and responsive access on wide desktop, narrow laptop, and small viewports.
