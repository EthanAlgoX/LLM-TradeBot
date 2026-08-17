---
name: LLM TradeBot
description: An instrument-grade control plane for versioned strategy validation and research operations.
colors:
  primary: "hsl(231 86% 61%)"
  primary-dark: "hsl(231 94% 70%)"
  canvas-light: "hsl(220 27% 97%)"
  canvas-dark: "hsl(225 31% 7%)"
  surface-light: "hsl(0 0% 100%)"
  surface-dark: "hsl(225 25% 10%)"
  ink-light: "hsl(225 32% 10%)"
  ink-dark: "hsl(218 25% 96%)"
  border-light: "hsl(220 18% 85%)"
  border-dark: "hsl(223 18% 20%)"
  success: "hsl(157 61% 36%)"
  warning: "hsl(35 91% 46%)"
  danger: "hsl(350 72% 51%)"
typography:
  headline:
    fontFamily: "Inter, SF Pro Display, Segoe UI, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, SF Pro Display, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.006em"
  label:
    fontFamily: "Inter, SF Pro Display, Segoe UI, system-ui, sans-serif"
    fontSize: "0.65rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.14em"
  data:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "1.8rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.04em"
rounded:
  control: "10px"
  surface: "12px"
  overlay: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface-light}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    height: "40px"
  workspace-surface:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.surface}"
    padding: "20px"
---

# Design System: LLM TradeBot

## Overview

**Creative North Star: "The Strategy Control Plane"**

LLM TradeBot should feel like a precise institutional research instrument: calm enough for long sessions, dense enough for real decision work, and explicit about every state transition. The design exposes the product's defining mechanism—data entering a frozen black-box strategy version, then becoming a validation experiment or research run—without turning it into a decorative financial dashboard.

The system rejects floating neon cards, decorative glass, diffuse colored glow, and oversized rounded containers. Brand expression comes from exact alignment, restrained cobalt signals, compact labels, tabular data, and a stable operational rail.

**Key Characteristics:**

- Continuous workspace rather than isolated floating canvases.
- Cool porcelain in light mode and carbon graphite in dark mode.
- Cobalt reserved for primary action, current location, focus, and selected state.
- Thin mineral rules and shallow structural elevation.
- Compact, familiar controls that disappear into the task.

## Colors

The palette is restrained and state-rich. Neutral surfaces carry almost the whole interface; cobalt identifies the current operation, while success, warning, and danger remain semantic.

### Primary

- **Control Cobalt:** Used for primary actions, selected navigation, focus, and active lifecycle nodes. It must not become decorative ambient color.

### Neutral

- **Cool Porcelain:** Light workspace canvas kept visually quiet so borders and data carry the structure.
- **Carbon Canvas:** Dark workspace canvas for low-light research sessions.
- **Instrument Surface:** Opaque panel surface; never decorative glass.
- **Mineral Rule:** Borders, dividers, and structure with low contrast but clear geometry.

### Named Rules

**The One Signal Rule.** Cobalt should identify what is active or actionable; inactive content remains neutral.

**The Semantic State Rule.** Green, amber, and red communicate real state only. They never decorate ordinary content.

## Typography

**Display Font:** Inter / SF Pro Display / Segoe UI with system fallback  
**Body Font:** The same workhorse UI stack  
**Label/Mono Font:** Native UI monospace only for identifiers, code, timestamps, and numeric measurements

**Character:** Compact and operational. Hierarchy comes from weight, size, and spacing rather than an ornamental display face.

### Hierarchy

- **Headline** (600, 2rem, 1.2): Page titles and major workspace headings.
- **Title** (600, 1rem–1.125rem): Section and object names.
- **Body** (400, 0.875rem, 1.5): Explanations and operational copy, normally limited to 65–75 characters per line.
- **Label** (700, 0.65rem, 0.14em tracking): A single contextual kicker or navigation group label.
- **Data** (600, tabular mono): Counts, versions, timestamps, identifiers, and measurements.

**The Mono Evidence Rule.** Monospace is evidence formatting, not a technology costume.

## Layout

Desktop uses a fixed 232px operational rail and a continuous content canvas. Content is capped near 1540px and uses 16px, 28px, and 40px responsive page gutters. Page headers sit directly on the canvas with a structural divider rather than inside a card. Dense information may use tables or divided ledgers; repeated equal cards are reserved for genuinely independent objects.

At widths below 1024px, the sidebar becomes a drawer and a 56px mobile command bar owns navigation, theme, and language. Multi-column metrics collapse to a two-column ledger; task forms and lifecycle rails stack without changing label hierarchy.

## Elevation & Depth

Depth is structural and shallow. Opaque surfaces separate tasks through tonal contrast and a 1px rule. Resting surfaces use a one-pixel key shadow plus a broad, low-opacity ambient shadow; stronger lift appears only for interactive hover or overlays.

**The Flat-By-Default Rule.** No glow and no zero-offset colored shadow. Elevation must imply a real layer or interaction state.

## Shapes

Controls use a compact 10px radius. Main surfaces use 12px, and overlays may use 16px. Pills are limited to compact statuses and tags. Large page sections must not become soft floating capsules.

## Components

### Buttons

- **Shape:** Compact rectangle with gently curved corners (10px).
- **Primary:** Solid control cobalt, 40px high, with a shallow downward shadow.
- **Hover / Focus:** Small tonal shift; focus uses a visible two-pixel cobalt outline with offset.
- **Secondary:** Opaque neutral surface with a mineral border; hover strengthens the border rather than moving the button.

### Chips

- **Style:** Small status-only pills using semantic tint, text, and border.
- **State:** Selection uses cobalt; health and lifecycle states use their semantic colors.

### Cards / Containers

- **Corner Style:** Restrained 12px surface radius.
- **Background:** Opaque instrument surface.
- **Shadow Strategy:** Structural low elevation at rest, slightly stronger only when interactive.
- **Border:** One-pixel mineral rule.
- **Internal Padding:** 16px for compact objects, 20–24px for workspace sections.

### Inputs / Fields

- **Style:** 40px standard height, 10px radius, neutral inset surface and explicit border.
- **Focus:** Cobalt border and low-opacity three-pixel focus ring.
- **Error / Disabled:** Semantic border and copy for errors; reduced opacity and unchanged geometry for disabled state.

### Navigation

The desktop rail is fixed and opaque. Items are 40px high with a 10px radius. Active state uses a two-pixel left indicator, cobalt icon/text, and a quiet cobalt tint. Group labels are compact uppercase labels; mobile navigation uses a standard drawer. Product navigation groups are stable: strategy operations first, data and applications second, governance and system last. Future execution surfaces must carry an explicit not-enabled status until real execution exists.

### Strategy Lifecycle Rail

A complete strategy product enters version management, then validation, then research run. Data is shown as a supporting dependency link rather than the first lifecycle node because the platform checks declared requirements during strategy intake. The active node is cobalt and every other node remains neutral. This component is navigation and product explanation at once; internal Agent/workflow assets never appear as a required user step.

## Do's and Don'ts

### Do:

- **Do** use divided ledgers and lists for related strategy state.
- **Do** reserve cobalt for the one active or primary operation.
- **Do** keep published, validated, running, and trading states visually and semantically distinct.
- **Do** preserve both light and dark themes with equivalent hierarchy and contrast.

### Don't:

- **Don't** restore cyan-purple gradients, decorative glow, or glass surfaces.
- **Don't** wrap every section in a large rounded card.
- **Don't** use fake market metrics, performance data, or decorative charts.
- **Don't** use semantic colors where no semantic state exists.
