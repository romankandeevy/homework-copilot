---
name: Homework Copilot
description: Textbook-first copying flow with instant shared answers and notebook-ready solutions.
colors:
  canvas: "oklch(97% 0.003 250)"
  surface: "oklch(99.2% 0.001 250)"
  surface-raised: "oklch(100% 0 0)"
  surface-sunken: "oklch(94% 0.004 250)"
  border: "oklch(84.5% 0.007 250)"
  border-strong: "oklch(70% 0.009 250)"
  text-subtle: "oklch(48% 0.009 250)"
  text-muted: "oklch(39% 0.011 250)"
  text: "oklch(24% 0.012 250)"
  strong: "oklch(15.5% 0.01 250)"
  on-strong: "oklch(97% 0.003 250)"
  accent-soft: "oklch(94% 0.09 111)"
  accent: "oklch(84% 0.19 111)"
  accent-hover: "oklch(79% 0.2 111)"
  disabled-on-accent: "oklch(92% 0.06 111)"
  disabled-on-accent-border: "oklch(57% 0.105 111)"
  on-accent: "oklch(17% 0.025 111)"
  brand-accent: "oklch(61% 0.15 111)"
  info: "oklch(59% 0.15 245)"
  success: "oklch(58% 0.13 154)"
  success-strong: "oklch(43% 0.12 154)"
  warning: "oklch(70% 0.15 78)"
  danger: "oklch(59% 0.19 29)"
typography:
  display:
    fontFamily: "Unbounded Variable, Arial Black, sans-serif"
    fontSize: "clamp(2.7rem, 4.8vw, 5.5rem)"
    fontWeight: 400
    lineHeight: 0.99
    letterSpacing: "-0.04em"
  heading:
    fontFamily: "Unbounded Variable, Arial Black, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Onest, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Onest, Segoe UI, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 620
    lineHeight: 1.45
  mono-label:
    fontFamily: "JetBrains Mono Variable, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 620
    lineHeight: 1.45
    letterSpacing: "0.04em"
rounded:
  xs: "0.25rem"
  control: "0.5rem"
  surface: "0.75rem"
  panel: "1rem"
  pill: "999px"
spacing:
  1: "0.25rem"
  2: "0.5rem"
  3: "0.75rem"
  4: "1rem"
  5: "1.25rem"
  6: "1.5rem"
  8: "2rem"
  10: "2.5rem"
  12: "3rem"
  16: "4rem"
  20: "5rem"
  24: "6rem"
components:
  button-primary:
    backgroundColor: "{colors.strong}"
    textColor: "{colors.on-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 {spacing.4}"
    height: "2.5rem"
  task-action:
    backgroundColor: "{colors.strong}"
    textColor: "{colors.on-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 {spacing.6}"
    height: "4.5rem"
  textbook-field:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.surface}"
    padding: "{spacing.4} {spacing.5}"
    height: "6.25rem"
  navigation-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.surface}"
---

# Design System: Homework Copilot

## Overview

**Creative North Star: "The Guided Margin"**

Homework Copilot feels like a precise route drawn through a clean school notebook: neutral paper, graphite structure, citrus direction, and no ornamental dashboard noise. The system is dense enough to make the next action obvious, but never busy enough to compete with the task the student came to copy.

The primary journey is textbook-first. An exact book and a task number form one search key: if the shared solution base already contains that pair, the answer opens immediately; otherwise the same surface starts a new notebook-ready solution. Shared catalogue and personal history stay visibly separate because they answer different questions.

**Key Characteristics:**

- Cool-neutral canvas with crisp, bordered working surfaces.
- One citrus signal for the primary route, active location, and decisive state.
- Editorial display type at weight 400, compact interface copy, and monospace metadata.
- Route lines, nodes, and measured motion that explain location rather than decorate it.
- Direct duotone subject icons without gray tiles or ornamental backplates.

## Colors

The palette combines clean paper and graphite with one sharp citrus signal; semantic colors appear only when they communicate a real state.

### Primary

- **Citrus Signal:** points to the primary copying action, active navigation, selected book, and progress.
- **Deep Graphite:** carries decisive controls and the strongest text hierarchy.

### Neutral

- **Chalk Canvas:** the page field shared by both product routes and the design-system playground.
- **Paper Surface:** the default content plane.
- **Raised Paper:** interactive fields and overlays that sit above the page.
- **Soft Recess:** hover rows and quiet grouped areas.
- **Graphite Borders:** separate regions without turning every block into a card.

### Named Rules

**The One Signal Rule.** Citrus marks the route or the decision; it is never an ambient background effect.

**The No Gray Icon Tile Rule.** Subject and content icons sit directly in the composition. A filled icon container is reserved for navigation state or a control with a real hit target.

## Typography

**Display Font:** Unbounded Variable with Arial Black fallback

**Body Font:** Onest with Segoe UI fallback
**Label/Mono Font:** JetBrains Mono Variable with Consolas fallback

**Character:** Unbounded gives the product a recognizable editorial voice without feeling childish. Onest keeps dense controls calm, while JetBrains Mono makes task numbers, dates, balance, and compact labels easy to scan.

### Hierarchy

- **Display:** weight 400, tightly tracked, compact leading; used for the greeting and primary action statement.
- **Heading:** weight 400 in the same family; used for section and state titles.
- **Body:** regular Onest with relaxed reading leading; used for explanation and supporting copy.
- **Label:** semibold Onest; used for actions, navigation, and list titles.
- **Mono label:** semibold JetBrains Mono with wide tracking and uppercase treatment; used for task identifiers and field labels.

### Named Rules

**The 400 Voice Rule.** Every display heading stays at weight 400. Hierarchy comes from scale, placement, and contrast, not extra boldness.

## Layout

Desktop uses a sticky 14rem sidebar and a centered content canvas capped at 88rem. Home starts with one dominant copying surface, then splits into a wider work/history column and a narrower saved-books/base column. The spacing system follows a 4px rhythm and reserves larger jumps for section boundaries.

At 1180px the secondary column compacts; below 980px the sidebar becomes a fixed five-item bottom navigation and Home becomes one column. Below 640px, fields and actions stack, secondary metadata compresses, and the primary action keeps full width. The document must remain usable from 320px without horizontal overflow.

The exact textbook is visible before the task-number field. The picker expands inline from that field rather than interrupting the task with a modal. Saved books provide shortcuts, but subject, class, title, authors, and edition remain one exact identity.

## Elevation & Depth

The system is flat by default and uses a hybrid of tonal layers, borders, and two restrained shadows. Raised controls use the low shadow; dropdowns and dialogs use the overlay shadow. Hover movement is one pixel, and pressed feedback compresses rather than bounces.

### Named Rules

**The Flat Until Lifted Rule.** Lists and groups stay flat at rest. Shadow appears only when a surface is interactively raised or actually overlays another plane.

## Shapes

Corners are gently geometric: compact marks use the smallest radius, controls use a half-rem radius, fields and rows use a three-quarter-rem radius, and only major panels reach one rem. Pills are reserved for continuous tracks and true capsule controls. Borders remain one pixel unless focus or a deliberate selected state requires stronger emphasis.

The sidebar route stays on one measured icon grid. Only the active icon shifts toward content while the label remains fixed; the route bends by the same distance and the seam marker stays level with the icon center. The line never overlaps a label.

## Components

### Primary Copying Surface

The citrus panel is the visual and functional start of Home. It contains the exact textbook selector, task-number field, base-match feedback, and one adaptive action: **«Открыть готовое»** for an existing shared solution or **«Списать»** for a new request. The action and result copy update together, never independently.

### Textbook Picker

The closed field shows subject, class, book title, and authors. Opening it reveals search and saved books with direct 32px duotone subject icons. Selection closes the picker, updates the task context, and preserves keyboard behavior including Escape.

### Task Number Field

The number uses the monospace face and accepts identifiers such as `123` or `18.5`. The whole input-and-action group receives the focus ring. Error copy stays adjacent and explicit; empty input disables submission.

### Navigation

The five destinations remain, in order: **Главная**, **Мои решения**, **База решений**, **Разобраться**, **Расписание**. Desktop uses the routed sidebar and a single theme control at bottom-left. Mobile uses the same order in bottom navigation. Active state combines citrus, movement, label contrast, and `aria-current`.

### Shared Base and Personal History

**База решений** means every ready solution available to all users and promises instant opening. **Мои решения** means only solutions this student opened or requested. They never share a heading, count, or ambiguous list treatment.

### Schedule

The schedule uses one day at a time to keep time, subject, and room fields comfortably editable at every viewport. Six compact day tabs expose the whole week. Photo import opens a centered OCR review dialog; recognized rows remain editable both before and after confirmation.

### Status and Result

Processing is passive system work, not a user-controlled stepper. A ready shared match uses a concise success state and direct open action. A new task uses restrained progress motion and an approximate five-minute expectation without fabricated precision.

### Geometry Notebook Output

Geometry output remains owned by `GeometryNotebookLayoutV1` and its approved fixed SVG layout. Product surfaces may pass semantic task content only; they never restyle or reflow the notebook page.

## Do's and Don'ts

### Do:

- **Do** require an exact textbook before a task number and show that context in the first action surface.
- **Do** check the shared base before starting new work and make instant availability explicit.
- **Do** keep saved textbooks, personal history, and the shared base semantically distinct.
- **Do** use direct two-tone 32px subject icons and preserve visible keyboard focus.
- **Do** keep light and dark themes structurally identical, with the same role hierarchy.

### Don't:

- **Don't** add gray icon backplates, decorative pills, glass effects, glow, gradient text, or generic dashboard cards.
- **Don't** infer a textbook from a task number alone or merge editions into one identity.
- **Don't** turn processing stages into tabs, controls, or work the student must manage.
- **Don't** add streaks, completion scores, gamification, or homework-productivity metrics.
- **Don't** show a MЭШ connection state or request school-platform cookies.
- **Don't** modify the approved geometry notebook layout while changing product UI.
