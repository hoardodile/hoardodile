# Hoardodile Design

Hoardodile's interface is specified here as a design system. All measurements are CSS pixels at a 1600×900 baseline. Implementation contracts the production app must hold — token structure, scrollbar strategy, breakpoint sync, overlay layers — are specified in this document, not in code comments.

## Principles

1. **Hierarchy is tonal, not linear.** Depth comes from fills — canvas, fill, card — never from borders or shadows. The system carries exactly one shadow, and it belongs to floating cards.
2. **Whitespace separates; hairlines punctuate.** Vertical rules do not exist. Hairlines are horizontal, 1px, and few; a 2px rule marks only structural seams (tab bars, panel sections).
3. **Accent is information, not decoration.** Hue enters only to mean something: user-assigned entity colors, the duotone icon tone. The neutral palette has no accent.
4. **Two voices: chrome and content.** UI chrome speaks a system sans; the documents section (pages, titles, reading text) speaks a literary serif. Everything else stays in the app sans.
5. **Metadata is quiet and knows its place.** Counts, dates, times are muted and right-aligned. Muted type is only for metadata and placeholders — user data is never muted.
6. **Media is the content.** Covers and avatars render as artwork at their intrinsic aspect ratio; no placeholder tiles; empty states are designed, not defaulted.
7. **Danger is a ritual, not a color.** No warning hues; destructive actions communicate through copy, iconography, and confirmation rituals. The `--destructive` token exists in every palette (the same red, sage slightly muted) but only serves bulk warning actions — the ritual itself always stays in copy and the confirm button.
8. **Density with rhythm.** Lists are dense, single-line rows at fixed heights; repetition and hairlines make the rhythm, not cards and gaps.

## Theme

Every palette is defined light and dark, with no intermediate grays: fills are tints of the canvas; selection is always a fill. Five palettes: **Mono** (no accent hue, no icon tone — but `--accent` still exists as a gray one step deeper than `--muted`, which hover on muted fills depends on), **Sage**, **Parchment**, **Azure**, **Hoardodile**. Colored palettes define an icon tone (`--icon-tone`) that tints the duotone second layer; Mono defines none and stays neutral.

- **The variable name is the contract.** Runtime palette blocks (`:root` / `.dark` / `.theme-<id>`) are the single definition point for colors; `@theme inline` mirrors every one as `--color-*: var(--*)` so utility classes reference the runtime variable. Changing a palette only touches its block — utilities never change.
- **Palette registry sync.** Palette ids are registered in `@hoardodile/ui`'s `pluginThemePalettes` and mirrored by `.theme-<id>` CSS blocks and i18n labels — a test guards the three-way alignment. Mono lives unclassed in `:root`/`.dark`; `.theme-mono` re-registers it for local opt-in. Users pick from the registry; they never author palettes.
- **Geometry as tokens, not numbers.** One radius base scales a family; the two shadows are `--shadow-card` and `--shadow-dialog` (two-step, dialogs float above a scrim).

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
| chart | `--chart` | chart ink — `var(--icon-tone, var(--foreground))`, the duotone fallback chain; Mono renders plain ink |

### Chip surfaces

A plain color tints the whole chip: a 6% wash of the color on the card surface as the fill, the color itself as ink — no border (the app's `${color}30` hairline is the web client's own dialect). White is the exception — a pure white fill would vanish on the canvas, so it keeps a hairline. Black and the five special surfaces (silver, gold, rainbow, oilslick, kintsugi) carry enough contrast on their own and go borderless. The active chip changes tint only (6% → 20%), never geometry; surfaces that cannot deepen keep their fill.

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

### Fonts and user preferences

- **The stack** is the system sans (`-apple-system … Arial`) plus CJK fallbacks (PingFang SC / Hiragino Sans GB / Microsoft YaHei); the documents section speaks the literary serif — rendered as Georgia.
- **User font preferences cascade by CSS variable, never by editing theme.css.** `--font-app` is set on `<html>`; document slots override per-slot via `--font-doc-ui-body` / `--font-doc-ui-heading` / `--font-doc-editor-body` inline on the page; every slot falls back `var(--font-doc-ui-body, var(--font-app, var(--font-sans)))`.
- **CJK tiny text.** `html:lang(zh) .text-tiny` reads at 12px — CJK strokes are denser than Latin and lose detail at 11px — and out-ranks the `.text-tiny` utility.

## Space, radius, elevation

- **Spacing** — a 4px grid (4/8/12/16/24/32/48/64), never arbitrary. Pages pad 32–40, sections gap 24–32, cards pad 16–24. List rows have fixed heights and no vertical margins.
- **Radius** — one base radius scales a family: rows/inputs/buttons take the base, pills step down, cards and popovers step up, sheets take the largest, character pills are fully round.
- **Surfaces** — three tonal elevations: canvas carries everything, fills create hierarchy within it, cards float (the only surface allowed a shadow). Cards never nest inside cards — nested surfaces are fills. A page's sections share a single sheet, parted by full-bleed hairlines.

## Iconography

Solar Icon Set (CC BY 4.0) through the `Icon` component: `currentColor` at three tiers — `sm` 12 / `md` 16 / `lg` 20, class-based; `selected` is the only way to Bold. Duotone is the default voice (second tone takes `--icon-tone`), with grayscale and monochrome as preferences. Recurring chrome actions import from `actions.ts` by action name (`Add`/`Remove`/`Check`/`More`) so two places that mean "add" render the same icon; ✓/×/+ are in-house marks (2-unit stroke / 3-unit filled arms — integer pixels at `md`), never Solar's Circle/Square composites.

- **solar v2 hooks** — `:root` pins `--solar-size: 1em` so class-less sizing matches v1; the duotone second tone is recolored through the `.hd-icon` hook's `--solar-secondary-color: var(--icon-tone)`. `[data-icon-style="grayscale"]` overrides it to `currentColor` — two-tone structure kept, never the palette hue. Only the `linear` preference swaps components.
- **One import door.** Consumers import only the wrapped exports (`@hoardodile/ui/components/icon`); raw Solar imports live exclusively inside the registry, which registers every glyph across the three weights in parallel (a test guards the structure), plus the app's generated plugin-icon lazy index (`scripts/generate-solar-lazy-index.mjs` — host-only, never published, never in the SDK closure): `manifest.icon`, `{{icon('…')}}` and search-kind icons resolve through it with the same three weights and preference semantics. Escaping a tier is `className="size-[18px]"`, via twMerge.
- **Icon style as an attribute.** The preference lives in `data-icon-style` on `<html>`, propagated by a shared observer — plugins follow through the host's theme change push, no context injection.

## Layout

```
┌──────────────┬─────────────────────────────┬──────────────┐
│  Sidebar     │  Canvas                     │  Panel       │
│  264, fixed  │  flexible, padding 32–40    │  320,        │
│              │                             │  contextual  │
└──────────────┴─────────────────────────────┴──────────────┘
```

On the Electron desktop the caption strip sits on the content column (canvas + panel), not over the sidebar:

```
┌──────────────┬────────────────────────────────────────────┐
│  Sidebar     │  Caption (38px)                            │
│  264, full   ├─────────────────────────────┬──────────────┤
│  height      │  Canvas                     │  Panel       │
└──────────────┴─────────────────────────────┴──────────────┘
```

- **Measures.** 680 reading / 800 medium / 1200 content, centered beyond the measure — the page width is the content width, padding never counts toward it. Padding lives on the outer wrapper; `max-w-*` lands on the inner centered element only (desktop frame padding `px-10 pt-10 pb-16`, tighter on mobile/tablet). Narrow surfaces (sign-in, dialogs, forms) hold the 320–480 slot; working dialogs widen by tier (pickers 672, edit hubs 768, search previews 896).
- **Control geometry.** Heights `h-chip` 28 / `h-control` 32 / `h-nav` 38; chrome widths `w-sidebar` 264 / `w-panel` 320 — tokens, never raw numbers at call sites.
- **Desktop caption strip.** The Electron frameless window adds a 38px (`h-nav`) caption. On the SPA it sits at the top of everything to the right of the sidebar (canvas and panel together); it is full-width on login, below the sidebar breakpoint, and on the first-run wizard. Below the sidebar breakpoint the strip's leftmost slot (`leading`) hosts the global sidebar toggle (drawer opener) on desktop — back, forward, and reload sit to its right; Windows caption buttons sit on the right; the rest of the strip is a drag region (`-webkit-app-region: drag`, `no-drag` on buttons and inputs). With the toggle in the strip, the content column's own top row below the sidebar breakpoint exists only while a route claims its ported compact actions (document header); the browser tab keeps that row with the drawer hamburger instead. Double-clicking the drag region toggles maximize. The strip is absent in the browser. Wizard and SPA share one control component so they cannot drift. Dragging the caption to a screen edge still snaps; a transparent window is not used. The Win11 snap-layout flyout on the maximize button is an accepted v1 gap.
- **Breakpoints have one source of truth.** `@hoardodile/ui/viewport` owns the pixel constants — `MOBILE_BREAKPOINT_PX` 768, `SIDEBAR_BREAKPOINT_PX` 1150, `PANEL_BREAKPOINT_PX` 1440 — and CSS mirrors them via `@theme` `--breakpoint-md` / `--breakpoint-sidebar` / `--breakpoint-panel` (`md:` / `sidebar:` / `panel:`, plus `max-*`). JS hooks and CSS prefixes must never disagree. `MOBILE_INITIAL_SCALE = 0.8` is the single viewport initial-scale factor for the app shell and plugin iframe previews.
- **Slot ownership.** The right panel column renders only while a route claims it — a fixed `w-panel` column at ≥1440px, a route-owned drawer below; only the visible instance exists. Portaled sidebar modules stay React descendants of routed content so providers reach them.
- **One scroll container.** The app's single always-on scrollbar lives on `<main data-app-scroll>`: the bar stays present so modal scroll-locking can't shift layout and first paint never flickers.

## States

| State | Rule |
| --- | --- |
| Hover / selected | a fill on rows, a 2px underline on tabs — never both, never accent |
| Link hover | muted deepens to soft text; no fill — preview-card links alone underline |
| Focus | 1px soft outline, offset 2px |
| Disabled | muted label; the fill does not change |
| Loading | a 2px progress bar at the top; skeletons in their own geometry |

## Scrollbars

Quiet and thin, styled per engine — the one place the implementation must be engine-aware: Chrome 121+ disables all `::-webkit-scrollbar` styling on any element that sets the standard `scrollbar-width`/`scrollbar-color` properties, resurrecting the classic Windows scrollbar with arrow buttons.

- **Chromium** styles go through the `::-webkit-scrollbar` pseudo-element family only (track transparent; thumb `color-mix(in oklab, var(--muted-foreground) 28%, transparent)`, 8px radius, 3px transparent border with `background-clip: padding-box`, 45% on hover; buttons `display: none`).
- **Firefox** gets the standard properties exclusively via `@supports not selector(::-webkit-scrollbar)` — never on the same element as the pseudos. The viewport bar needs the bare pseudo selectors (`::-webkit-scrollbar` without `*`): element-scoped selectors never match the Chromium viewport bar.
- **Two utility tiers.** `strip-scroll` — a 4px thumb in `--border-strong`, for pinned marquee strips and long settings lists. `no-scrollbar` — fully hidden, for carousels, tab bars and command palettes that scroll programmatically.

## Overlays

- **Dialog width tiers.** `sm` 384 / `md` 448 / `lg` 672 / `xl` 768 / `2xl` 896. Confirmations never leave the narrow slot; edit hubs, pickers and selectors get the wide tiers.
- **Z-index order.** z-10 card corner badges → z-20 sticky page headers and floating hint cards → z-40 click catchers and anchored popovers → z-50 the dialog layer. A trigger owns one anchored popover and any number of dialogs, but only one surface is open at a time.
- **Preview cards.** Read-only hover previews (tag chips) are anchored popovers: portal to the overlay layer, `side="top"` with collision flipping, one surface open at a time. Hover or keyboard focus opens them; clicks are never intercepted — navigation triggers keep press = click, so previews never swallow a click-through (and touch devices simply don't get them, matching the desktop hover-card convention). A chip that has preview content gets a subtle `ring-primary/20` **on hover only** — its static look stays identical to a content-less chip, so the pill's visual language never splits. The card is `w-fit` (width follows the artwork), artwork renders borderless on the popover surface at its own size clamped to a min/max window (scale up small art to the floor, downscale large art, aspect kept), and inline text links inside the card underline on hover (the only place the link-hover rule deviates).
- **Click catcher.** A transparent fixed `z-40` layer below the dialog layer and above anchored cards closes popovers on outside clicks — never blurred.
- **Media viewers opt out.** Lightbox-style surfaces own an opaque `bg-black/85` fill and never reuse the dialog layer; the dialog scrim (`bg-foreground/5` + `backdrop-blur-sm`) is a static surface definition, not a motion effect.
- **Dialog anatomy.** The card floats at `bg-card` + hairline + `rounded-2xl` + `shadow-dialog`. The body is the only scrolling region (`flex-1 overflow-y-auto`), header carries `p-5` with no bottom padding, the footer parts from the body with an inset hairline (`mx-5`, never edge to edge), and `gap-4` holds the three parts apart. **Three-button footers** split the bar: the secondary function key sits at the left edge, cancel and the primary action stay right-aligned. `flush` drops body padding for two-pane editors.
- **Focus and motion defaults.** `suppressAutoFocus` is the default — focus routes to the dialog container instead of the first focusable element, so the caret, scroll position and iOS soft keyboard are never hijacked. `contentMotion="minimal"` degrades to fade-only over heavy surfaces (WebGL, video). At ≥sm the centered popup keeps `-translate-y-1/2` in its starting/ending states — zoom + fade only, never a slide that clobbers the centering offset.

## Motion

Motion is **feedback, not ornament** — it confirms that state changed, preserves where things came from, and then gets out of the way.

### Principles

1. **Faster than the mainstream.** Chrome moves at 100–200ms; only media and full-surface transitions breathe at 250–300ms. An archive is used for years, not first-use delight.
2. **Transform and opacity only.** Motion never changes layout geometry — no animating width, height, margin, or padding. `will-change` only during the animation, never permanently.
3. **Ease out, arrive.** Entering elements decelerate (`ease-out`); leaving ones accelerate (`ease-in`). The interface never bounces; springs belong to touch gestures, nowhere else.
4. **Hierarchy is tonal in time too.** Fills fade, text crossfades, media scales. No animated borders, shadows, or color wipes.
5. **Motion is information.** Every animation answers: *where did this come from, where did it go, did it work.* Otherwise, delete it.
6. **Respect `prefers-reduced-motion`.** Reduced motion collapses every transition and animation to ≤1ms with a single `!important` override block (plus `animation-iteration-count: 1` and `scroll-behavior: auto`) — instant state change, no opacity-only hints. Nothing essential is ever conveyed by movement alone.

### Tokens

```css
--duration-1: 100ms; /* micro — hover fills, icon swaps, toggle knob */
--duration-2: 160ms; /* fast  — menus, popovers, tooltips, reveals */
--duration-3: 240ms; /* base  — panel overlays, tab underline, sidebars */
--duration-4: 320ms; /* slow  — drawers, dialogs, media transitions   */

--ease-out: cubic-bezier(0.16, 1, 0.3, 1);     /* standard arrive      */
--ease-in: cubic-bezier(0.7, 0, 0.84, 0);      /* standard depart      */
--ease-standard: cubic-bezier(0.2, 0, 0, 1);   /* on-screen movement   */
```

`--ease-out` (the Vercel/Linear curve) reads as responsive at any duration; `--ease-standard` (Material's standard curve) is for on-screen elements changing position or scale — including the cover zoom.

### Per-surface spec

| Surface | Enter | Exit |
| --- | --- | --- |
| Menu / popover / tooltip / preview card | fade + 4px rise, `--duration-2 --ease-out` | fade, `--duration-1 --ease-in` |
| Panel overlay (<1440px) | slide 24px from right + fade, `--duration-3 --ease-out` | `--duration-2 --ease-in` |
| Dialog | fade + `scale(0.98→1)`, `--duration-3 --ease-out` | `--duration-2 --ease-in` |
| Sidebar drawer (`max-sidebar`) | spring (stiffness ~380, damping ~38) or slide `--duration-4 --ease-out` | `--duration-2 --ease-in` |

- **Rows, fills, links** — fade over `--duration-1`; focus appears instantly (0ms). The tab underline slides at `--duration-3` — the system's one permitted position animation in chrome.
- **Media** — cover hover zoom keeps `scale(1.03/1.05)` at `--duration-4 --ease-standard`; marquee pauses on hover and reduced motion; skeleton→content crossfades at `--duration-2`. The grid→detail shared-element cover travel is the single most valuable motion (provenance): the grid cover morphs into the detail hero via the View Transitions API with a synchronous route swap (`flushSync`); the transition name lives on the elements only while the flight is in progress, and plain navigation is the fallback when the API is missing or reduced motion is on.
- **Loading** — the 2px top bar loops indeterminately only while time is unknown; determinate progress eases with `--ease-standard`. Never fake determinate progress.
- **Danger ritual** — confirmation enters at `--duration-4`, the row fades out at `--duration-3` with a quiet undo fading in. No shake, no red flash — errors are copy. The sign-in surface animates once per session at most (brand fade-in, `--duration-4`).
- **Stagger** — dense lists never cascade; if ever used (grid first paint), ≤5 items at 24–32ms intervals, skipped entirely under reduced motion.
- **Surfaces** — motion never introduces a surface: dialogs and drawers may dim the canvas only if a scrim already exists in statics. Dialog floats deepen to `shadow-dialog`.

### Mobile and touch

Drawers and panels respond to drag 1:1 and complete as a spring on release; animation that fires without a gesture stays on the desktop durations. No pull-to-refresh (a toolbar spinner is the refresh affordance). Scroll physics stay platform default — no scroll-jacking, no parallax in the reading view.

### Performance

Long lists use `content-visibility: auto`. All motion must hold 60fps with a library of 10⁴ rows — shorten before adding complexity.
