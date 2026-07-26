---
name: TradeBot
description: A cold-graphite Selection Aperture for one auditable Atlas Trading Agent.
colors:
  graphite-abyss: "#090b0d"
  graphite-surface: "#0e1114"
  graphite-raised: "#13171b"
  graphite-active: "#181d22"
  graphite-line: "#272d32"
  graphite-line-strong: "#3b444b"
  evidence-white: "#edf1f2"
  evidence-soft: "#c5cdd1"
  telemetry-muted: "#919ca3"
  live-chartreuse: "#b7d979"
  live-ink: "#11170a"
  verified-green: "#94c9aa"
  gate-amber: "#dbb76f"
  risk-coral: "#e1847c"
  context-blue: "#8db9c8"
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "clamp(34px, 4vw, 54px)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.04em"
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: 'ui-monospace, "SFMono-Regular", "Cascadia Code", Consolas, "Liberation Mono", monospace'
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.04em"
  metric:
    fontFamily: 'ui-monospace, "SFMono-Regular", "Cascadia Code", Consolas, "Liberation Mono", monospace'
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "normal"
rounded:
  hard: "0px"
  signal: "999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "18px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.live-chartreuse}"
    textColor: "{colors.live-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.hard}"
    padding: "0 18px"
    height: "44px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.evidence-white}"
    typography: "{typography.label}"
    rounded: "{rounded.hard}"
    padding: "0 18px"
    height: "44px"
  candidate-row-selected:
    backgroundColor: "#14190f"
    textColor: "{colors.evidence-white}"
    rounded: "{rounded.hard}"
    padding: "8px 14px"
    height: "62px"
  capability-node:
    backgroundColor: "{colors.graphite-surface}"
    textColor: "{colors.evidence-white}"
    rounded: "{rounded.hard}"
    padding: "20px"
    height: "160px"
  input-structured:
    backgroundColor: "{colors.graphite-abyss}"
    textColor: "{colors.evidence-white}"
    typography: "{typography.body}"
    rounded: "{rounded.hard}"
    padding: "10px 12px"
    height: "44px"
  panel:
    backgroundColor: "{colors.graphite-surface}"
    textColor: "{colors.evidence-white}"
    rounded: "{rounded.hard}"
    width: "min(560px, 100vw)"
---

# Design System: TradeBot

## Overview

**Creative North Star: "Selection Aperture"**

TradeBot is the operating surface for one Atlas Trading Agent. A broad market universe enters through a visible aperture, but `Selector topN=1` admits exactly one auditable symbol into the cycle. The interface gives that selection, the running Agent, its six-stage chain, current position, and one required human action clear priority.

The world is cold graphite, hard seams, system sans, mono evidence, and a single chartreuse live signal. It is bilingual by construction and restrained in density. Bull/Bear and Position Monitor remain inspectable artifacts inside the main chain rather than peer stages that inflate the topology. Agent Lab owns candidate evolution; Audit Log owns historical trace; Copilot stays a controlled drawer.

**Key Characteristics:**

- One running Atlas Trading Agent and one admitted symbol per cycle.
- Selection narrows 42 scanned candidates to 8 qualified and 1 admitted.
- Six visible stages: Selector, Data, Analysis, Decision, Risk, and Execution.
- Bull/Bear artifacts nest under Analysis; Position Monitor nests under Decision.
- Candidate release requires Draft, Backtest, Walk-Forward, human Approval, then Paper.
- Chinese and English share one layout and evidence hierarchy.
- Mock data and the missing Runtime API are always explicit.

## Colors

The palette uses four cold graphite planes, one rare chartreuse focus signal, and isolated semantic colors.

### Primary

- **Live Chartreuse:** Running state, the single selected candidate, current chain state, active navigation, and safe primary action.
- **Live Ink:** High-contrast text on chartreuse actions.

### Secondary

- **Verified Green:** Passed stages, positive results, and completed gates.
- **Gate Amber:** Fallbacks, pending approval, mock boundary, and incomplete validation.
- **Risk Coral:** Only Close, emergency control, rejection, and destructive confirmation.
- **Context Blue:** Reviews, attached context, and read-only provenance.

### Neutral

- **Graphite Abyss:** Page background, raw evidence wells, and inset fields.
- **Graphite Surface / Raised / Active:** Default regions, attached emphasis, and hover state.
- **Graphite Line / Strong Line:** Internal seams and major module boundaries.
- **Evidence White / Soft:** Identity and explanatory copy.
- **Telemetry Muted:** Labels, versions, traces, timestamps, and lower-priority evidence.

**The One Live Signal Rule.** Chartreuse identifies the single admitted path and its safe action. Never spread it across unrelated decoration.

**The Semantic Isolation Rule.** Green, amber, coral, and blue keep their operational meanings.

## Typography

**Display Font:** Platform system sans, led by Segoe UI and native Chinese sans  
**Body Font:** The same platform system sans  
**Label/Mono Font:** UI monospace, SFMono-Regular, Cascadia Code, Consolas

**Character:** System sans keeps bilingual operating copy familiar and highly readable at 16px. Mono is reserved for evidence: scores, ranks, traces, versions, latency, fingerprints, and state identifiers.

### Hierarchy

- **Display** (700, fluid 34–54px, 1.02): Atlas Trading Agent and top-level view identity.
- **Headline** (700, 21px, 1.25): Selection, chain, position, candidate, and audit modules.
- **Title** (700, 16px, 1.4): Capability and evidence object names.
- **Body** (400, 16px, 1.6): Primary bilingual explanation; sustained copy stays near 70ch.
- **Label** (700, 12px, mono): Provenance, state, metadata, and compact controls.
- **Metric** (700, 30px, mono): Selection counts, PnL, and decisive numeric evidence.

**The Evidence Voice Rule.** Use sans for interpretation and mono for facts that must be compared or audited.

## Layout

The 72px sticky command bar contains the product identity, Trading Agent / Agent Lab / Audit Log navigation, language switch, controlled Copilot trigger, and emergency risk control. A centered 1504px page frame uses 32px gutters.

The first viewport begins with one Atlas Agent identity and provenance grid. Below it, the operation layout pairs a flexible main path with a 356px operator rail. The main path presents the Selection Aperture before the six-stage chain; the rail contains current position, Human Action, and runtime safety. Lifecycle and recent evidence follow.

At 1240px the operator rail narrows and the chain becomes two columns. At 1020px the header becomes two rows, identity and operation layout stack, risk/action priority is repeated above the chain, and the operator rail becomes two columns. At 760px the chain, operator rail, release gates, forms, and major evidence regions become single-column. At 440px position, profile diff, and validation metrics also become one column. Controls preserve touch sizes, panels fill the viewport, and reduced-motion/reduced-transparency preferences are honored.

**The Aperture Before Chain Rule.** Show universe narrowing before downstream reasoning so users understand why the only symbol entered the cycle.

**The One-Agent Rule.** Fixed coin tabs and multiple equal-weight Trading Agents are prohibited; candidates are inputs, not separate Agent identities.

## Elevation & Depth

Persistent surfaces are flat. Tonal graphite changes and one-pixel shared seams provide depth. Selected candidates use a three-pixel inset chartreuse edge; live status uses a restrained four-pixel halo. Drawers and detail panels use a dark backdrop and a structural side shadow.

### Shadow Vocabulary

- **Selected path** (`inset 3px 0 var(--accent)`): Marks the only admitted candidate.
- **Live signal halo** (`0 0 0 4px rgb(183 217 121 / 0.1)`): Reinforces runtime state.
- **Panel separation** (`-18px 0 48px rgb(0 0 0 / 0.28)`): Protected drawers only.
- **Toast lift** (`0 18px 42px rgb(0 0 0 / 0.32)`): Transient feedback only.

**The Flat Runtime Rule.** Persistent operating modules never float; only overlays and transient feedback use cast shadow.

## Shapes

All modules, buttons, inputs, candidate rows, chain nodes, panels, and release steps use zero-radius corners. Boundaries are one-pixel seams. Circles are reserved for point-state signals; square numbers encode sequence and release progress.

**The Hard Seam Rule.** A new component starts rectangular and attached. Round only a state dot.

## Components

### Buttons

- **Primary:** 44px chartreuse action with dark ink and 18px horizontal padding.
- **Secondary:** Transparent, hard-bordered, and tonal on hover.
- **Text action:** Unboxed chartreuse for evidence navigation.
- **Risk:** Coral-tinted command-bar control that opens a separate confirmation panel.
- **Focus:** Two-pixel chartreuse outline with three-pixel offset; active controls move down one pixel.

### Chips

Use compact mono state labels plus an optional circular state signal. Passed is green, current is chartreuse, fallback is amber, rejected or Only Close is coral, and idle is muted.

### Cards / Containers

Major regions use Strong Line around Graphite Surface. Internal rows share ordinary seams. Headers use 22–24px padding; chain nodes use 20px; primary frame spacing uses 24–32px. Cards never use radius.

### Inputs / Fields

Structured fields use Graphite Abyss, Strong Line, zero radius, 44px minimum height, and readable 15–16px content. Draft forms must state that they cannot change the running profile or execute an order.

### Navigation

Trading Agent, Agent Lab, and Audit Log are the only primary views. Active state uses a chartreuse underline. The language toggle and Copilot remain explicit utilities; neither competes with the primary path.

### Selection Aperture

Show scanned, qualified, and admitted counts; a short ranked candidate sample; collapsed remainder; and the immutable `StrategyProfile.selector.topN = 1` rule. Selecting a row opens evidence but cannot change the selection or create an order.

### Agent Chain

Render six ordered nodes: Selector, Data, Analysis, Decision, Risk, Execution. Each exposes status, concise output, latency, and Artifact count. Bull/Bear appear inside Analysis; Position Monitor appears inside Decision. Deep inputs and evidence open in a panel.

### Candidate Release

Candidate work follows a visible state machine: Draft → Backtest → Walk-Forward → Approval → Paper. Requesting approval, recording human approval, and releasing to Paper remain separate actions; the running profile stays immutable until release.

### Controlled Drawer

Copilot and evidence panels enter from the right, trap attention with a backdrop, and return focus on close. Copilot may query, explain, or prepare drafts, but it cannot alter the running Agent or call an exchange write API.

## Do's and Don'ts

### Do:

- **Do** make Atlas, its one admitted symbol, and `topN=1` immediately clear.
- **Do** preserve the six-stage chain and nest Bull/Bear and Position Monitor artifacts.
- **Do** keep candidate approval and Paper release as distinct, auditable states.
- **Do** maintain complete Chinese and English labels without changing hierarchy.
- **Do** expose the synthetic-data banner and disconnected exchange-write boundary.
- **Do** preserve keyboard focus, focus return, reduced motion, and responsive stacking.

### Don't:

- **Don't** introduce fixed BTC/ETH/SOL tabs or multiple equal-weight running Agents.
- **Don't** flatten Bull, Bear, or Position Monitor into extra primary stages.
- **Don't** imply that candidate inspection, Copilot, or a draft can execute.
- **Don't** hide the mock/runtime boundary or invent live API connectivity.
- **Don't** add rounded SaaS cards, ambient chartreuse, decorative glow, or high-amplitude motion.
