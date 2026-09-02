# Design System

The principles and tokens behind `@hoardodile/ui`. When you use the library,
you're composing a real design system — here are the rules it follows and the
tokens it exposes (use the token/utility, never a raw value). Authority:
DESIGN.md, the hoardodile design system spec.

## Contents

- Principles
- Color — ten roles (and chip/tag surfaces)
- Typography
- Space, radius, elevation
- Layout & measures
- States
- Overlays
- Motion

---

## Principles

1. **Hierarchy is tonal, not linear.** Depth comes from fills — canvas → fill →
   card — never from borders or shadows. The system carries exactly one shadow
   (`--shadow-card`), and it belongs to floating cards; dialogs deepen it one
   step (`--shadow-dialog`).
2. **Whitespace separates; hairlines punctuate.** No vertical rules. Hairlines
   are horizontal, 1px, and few (`--border`); a 2px rule marks only structural
   seams (tab bars, panel sections) (`--border-strong`).
3. **Accent is information, not decoration.** Hue enters only to mean
   something: entity colors, the duotone icon tone (`--icon-tone`). The neutral
   palette has no accent hue.
4. **Two voices: chrome and content.** Chrome speaks a system sans; the
   documents section speaks a literary serif (`--font-doc`, Georgia). A surface
   is chrome unless its job IS reading.
5. **Metadata is quiet and knows its place.** Counts, dates, times are muted
   (`--muted-foreground`) and right-aligned. Muted type is only for metadata and
   placeholders — user data is never muted.
6. **Media is the content.** Covers and avatars render as artwork at their
   intrinsic aspect ratio; no placeholder tiles; empty states are designed, not
   defaulted.
7. **Danger is a ritual, not a color.** No warning hues; destructive actions
   communicate through copy, iconography and confirmation. `--destructive`
   exists everywhere but only serves bulk warning actions — the ritual always
   stays in copy and the confirm button.
8. **Density with rhythm.** Lists are dense, single-line rows at fixed heights;
   repetition and hairlines make the rhythm, not cards and gaps.

---

## Color — ten roles

| Role | Variable | Usage |
| --- | --- | --- |
| canvas | `--background` | page background, all columns |
| fill | `--muted` / `--accent` | selected/hover rows, search fields, tag pills |
| card | `--card` | floating cards only |
| action | `--primary` / `--primary-foreground` | primary buttons, badges, checked controls, slider |
| hairline | `--border` | 1px separators; 2px structural seams |
| divider-strong | `--border-strong` | quote bar, strong callouts |
| text | `--foreground` | primary text |
| text-soft | `--secondary-foreground` | secondary text, icons |
| text-muted | `--muted-foreground` | counts, dates, placeholders |
| chart | `--chart` | chart ink — `var(--icon-tone, var(--foreground))`; Mono renders plain ink |

Use these utilities/variables — never raw hex or Tailwind colors. Status and
emphasis come from `Badge`/`CountBadge`/`TagChip` variants or semantic tokens
(`text-destructive`), not a raw color.

### Chip / tag surfaces

A plain color tints the whole chip: a 6% wash of the color on the card surface
as the fill, the color itself as ink — no border. White keeps a hairline (pure
white would vanish on the canvas); black and the special surfaces (silver, gold,
rainbow, oilslick, kintsugi) go borderless. The active chip changes tint only
(6% → 20%), never geometry.

---

## Typography

| Role | Spec | Token |
| --- | --- | --- |
| UI tiny — tags, counts | 11px (12px in CJK locales) | `text-tiny` |
| UI small — labels, meta | 12px | `text-xs` |
| UI base — panels, menus | 13px | `text-ui` |
| UI nav — sidebar, brand | 13–14px medium | `text-ui` / `text-sm` |
| Section label | 12px uppercase, 0.1em tracking, muted | `text-xs tracking-label` |
| Reading body | 19px / 1.9 | `text-doc` |
| Document title | 48px bold / 1.15 | `text-doc-title` |
| Section heading | 28px bold | `text-doc-heading` |
| Quote | 18px / 1.65, 3px strong bar | `text-quote` |

- The stack is the system sans (`-apple-system … Arial`) plus CJK fallbacks
  (PingFang SC / Hiragino Sans GB / Microsoft YaHei); the doc serif is Georgia.
- **CJK tiny text** — `html:lang(zh) .text-tiny` reads at 12px (CJK strokes lose
  detail at 11px) and out-ranks the utility.
- **Reading serif belongs to reading content only** — everything else stays in
  the app sans.

---

## Space, radius, elevation

- **Spacing** — a 4px grid (4/8/12/16/24/32/48/64), never arbitrary. Pages pad
  32–40, sections gap 24–32, cards pad 16–24. List rows have fixed heights and
  no vertical margins.
- **Radius** — one base (10px) scales a family: `sm` 0.6× / `md` 0.8× / `lg` 1×
  / `xl` 1.2× / `2xl` 1.8× / `3xl` 2.2× / `4xl` 2.6×. Rows/inputs/buttons take
  the base, pills step down, cards/popovers step up, sheets take the largest,
  character pills are fully round.
- **Shadows** — `--shadow-card` (`0 1px 3px rgb(0 0 0 / 0.04)`) for floating
  cards; `--shadow-dialog` (`0 1px 2px rgb(0 0 0 / 0.04), 0 24px 48px -16px
  rgb(0 0 0 / 0.16)`) for dialogs above a scrim. Only these two — nothing else.
- **Surfaces** — three tonal elevations: canvas carries everything, fills create
  hierarchy within it, cards float (the only surface allowed a shadow). Cards
  never nest inside cards — a nested surface is a fill. A page's sections share
  a single sheet, parted by full-bleed hairlines.

---

## Layout & measures

```
┌──────────────┬─────────────────────────────┬──────────────┐
│  Sidebar     │  Canvas                     │  Panel       │
│  264, fixed  │  flexible, padding 32–40    │  320,        │
│              │                             │  contextual  │
└──────────────┴─────────────────────────────┴──────────────┘
```

On the Electron desktop the caption strip sits on the content column (canvas +
panel), not over the sidebar.

- **Measures.** 680 reading / 800 medium / 1200 content, centered beyond the
  measure — padding never counts toward the page width. Padding lives on the
  outer wrapper; `max-w-*` lands on the inner centered element only. Narrow
  surfaces (sign-in, dialogs, forms) hold the 320–480 slot; working dialogs
  widen by tier (pickers 672, edit hubs 768, search previews 896).
- **Control geometry.** Heights `h-chip` 28 / `h-control` 32 / `h-nav` 38;
  chrome widths `w-sidebar` 264 / `w-panel` 320 — tokens, never raw numbers.
- **Breakpoints have one source of truth.** `md` 768 / `sidebar` 1150 / `panel`
  1440 — CSS prefixes (`md:` / `sidebar:` / `panel:` + `max-*`) and the JS
  hooks (`useBelowMd`/`useBelowSidebar`/`useBelowPanel`) never disagree.
  `MOBILE_INITIAL_SCALE = 0.8` is the single viewport initial-scale factor.
- **Slot ownership.** The right panel column renders only while a route claims
  it — a fixed `w-panel` column at ≥1440px, a route-owned drawer below.
- **One scroll container.** The app's single always-on scrollbar lives on
  `<main data-app-scroll>` so modal scroll-locking can't shift layout and first
  paint never flickers.

---

## States

| State | Rule |
| --- | --- |
| Hover / selected | a fill on rows, a 2px underline on tabs — never both, never accent |
| Link hover | muted deepens to soft text; no fill — preview-card links alone underline |
| Focus | 1px soft outline, offset 2px |
| Disabled | muted label; the fill does not change |
| Loading | a 2px progress bar at the top; skeletons in their own geometry |

---

## Overlays

- **Dialog width tiers.** `sm` 384 / `md` 448 / `lg` 672 / `xl` 768 / `2xl` 896.
  Confirmations never leave the narrow slot; edit hubs, pickers and selectors
  get the wide tiers.
- **Z-index order.** z-10 card corner badges → z-20 sticky page headers and
  floating hint cards → z-40 click catchers and anchored popovers → z-50 the
  dialog layer. A trigger owns one anchored popover and any number of dialogs,
  but only one surface is open at a time.
- **Preview cards.** Read-only hover previews (tag chips) are anchored
  popovers: portal to the overlay layer, `side="top"` with collision flipping,
  one surface open at a time. Hover or keyboard focus opens them; clicks are
  never intercepted. A chip with preview content gets a subtle ring on hover
  only — its static look matches a content-less chip. The card is `w-fit`
  (width follows the artwork), artwork renders borderless, inline links
  underline on hover.
- **Click catcher.** A transparent fixed `z-40` layer below the dialog layer and
  above anchored cards closes popovers on outside clicks — never blurred.
- **Media viewers opt out.** Lightbox-style surfaces own an opaque
  `bg-black/85` fill and never reuse the dialog layer; the dialog scrim
  (`bg-foreground/5` + `backdrop-blur-sm`) is a static surface definition, not a
  motion effect.
- **Dialog anatomy.** The card floats at `bg-card` + hairline + `--radius-2xl` +
  `--shadow-dialog`. The body is the only scrolling region, the header carries
  `p-5` with no bottom padding, the footer parts from the body with an inset
  hairline (`mx-5`, never edge to edge), `gap-4` holds the parts apart.
  **Three-button footers** split the bar (function key at the left edge, cancel
  + primary right-aligned); **two-button footers** never split (cancel leads,
  function key holds the right edge). `flush` drops body padding for two-pane
  editors.
- **Focus & motion defaults.** `suppressAutoFocus` is the default (focus routes
  to the dialog container, not the first focusable element);
  `contentMotion="minimal"` degrades to fade-only over heavy surfaces (WebGL,
  video); the centered popup keeps `-translate-y-1/2` in its start/end states —
  zoom + fade only.

---

## Motion

Motion is **feedback, not ornament**.

1. **Faster than the mainstream.** Chrome at 100–200ms; only media and
   full-surface transitions breathe at 250–300ms.
2. **Transform and opacity only.** Never animate width/height/margin/padding.
   `will-change` only during the animation.
3. **Ease out, arrive.** Entering decelerates (`--ease-out`), leaving
   accelerates (`--ease-in`). No bounce; springs belong to touch gestures only.
4. **Hierarchy is tonal in time too.** Fills fade, text crossfades, media
   scales. No animated borders, shadows, or color wipes.
5. **Motion is information.** Every animation answers *where did this come from,
   where did it go, did it work*. Otherwise delete it.
6. **Respect `prefers-reduced-motion`.** Collapse every transition/animation to
   ≤1ms (single `!important` override block); nothing essential is conveyed by
   movement alone.

```css
--duration-1: 100ms; /* micro — hover fills, icon swaps, toggle knob */
--duration-2: 160ms; /* fast  — menus, popovers, tooltips, reveals */
--duration-3: 240ms; /* base  — panel overlays, tab underline, sidebars */
--duration-4: 320ms; /* slow  — drawers, dialogs, media transitions   */

--ease-out: cubic-bezier(0.16, 1, 0.3, 1);     /* standard arrive      */
--ease-in: cubic-bezier(0.7, 0, 0.84, 0);      /* standard depart      */
--ease-standard: cubic-bezier(0.2, 0, 0, 1);   /* on-screen movement   */
```

| Surface | Enter | Exit |
| --- | --- | --- |
| Menu / popover / tooltip / preview card | fade + 4px rise, `--duration-2 --ease-out` | fade, `--duration-1 --ease-in` |
| Panel overlay (<1440px) | slide 24px from right + fade, `--duration-3 --ease-out` | `--duration-2 --ease-in` |
| Dialog | fade + `scale(0.98→1)`, `--duration-3 --ease-out` | `--duration-2 --ease-in` |
| Sidebar drawer (`max-sidebar`) | spring or slide `--duration-4 --ease-out` | `--duration-2 --ease-in` |

- **Rows, fills, links** fade over `--duration-1`; focus appears instantly; the
  tab underline slides at `--duration-3` (the one permitted position animation
  in chrome).
- **Media** — cover hover zoom `scale(1.03/1.05)` at `--duration-4
  --ease-standard`; marquee pauses on hover and reduced motion; skeleton →
  content crossfades at `--duration-2`.
- **Loading** — the 2px top bar loops only while time is unknown; determinate
  progress eases with `--ease-standard`. Never fake determinate progress.
- **Danger ritual** — confirmation enters at `--duration-4`, the row fades out
  at `--duration-3` with a quiet undo. No shake, no red flash.
- **Stagger** — ≤5 items at 24–32ms intervals, skipped under reduced motion.
- **Performance** — long lists use `content-visibility: auto`; all motion must
  hold 60fps with 10⁴ rows — shorten before adding complexity.

---

## Scrollbars

Quiet and thin, styled per engine — the one place the implementation must be
engine-aware: Chrome 121+ disables all `::-webkit-scrollbar` styling on any
element that also sets the standard `scrollbar-width`/`scrollbar-color`
properties, resurrecting the classic Windows scrollbar with arrow buttons.

- **Chromium** styles go through the `::-webkit-scrollbar` pseudo-element family
  only (track transparent; thumb `color-mix(in oklab, var(--muted-foreground)
  28%, transparent)`, 8px radius, 3px transparent border with
  `background-clip: padding-box`, 45% on hover; buttons `display: none`).
- **Firefox** gets the standard properties exclusively via
  `@supports not selector(::-webkit-scrollbar)` — never on the same element as
  the pseudos. The viewport bar needs the bare pseudo selectors
  (`::-webkit-scrollbar` without `*`): element-scoped selectors never match the
  Chromium viewport bar.
- **Two utility tiers.** `strip-scroll` — a 4px thumb in `--border-strong`, for
  pinned marquee strips and long settings lists. `no-scrollbar` — fully hidden,
  for carousels, tab bars and command palettes that scroll programmatically.
- The app owns the single always-on scrollbar (`<main data-app-scroll>`), so a
  surface inside it never manages scrollbar layout.

---

## Design authority

> **Parity note.** The values above mirror DESIGN.md — the single source of
> truth. If a value changes there, update this reference; don't let the design
> descriptions drift.

The content above is derived from DESIGN.md, the hoardodile design system spec.
