---
name: hd-plugin-design
description: The hoardodile plugin design system — how a plugin iframe follows the host's theme, palettes, typography, icons and motion via @hoardodile/ui. Use when building or reshaping any hoardodile plugin UI, choosing tokens instead of raw values, or checking a plugin against the design contract.
license: MIT
metadata:
  author: hoardodile
  version: "1.1.0"
---

# Hoardodile Plugin Design

A hoardodile plugin's iframe is a **surface inside the host app**, not a
separate product: it should feel like the app's own viewer. The design
system ships as a package — [`@hoardodile/ui`](https://www.npmjs.com/package/@hoardodile/ui), "the design-system
component library for hoardodile (the host app and plugin iframes
alike)". All tokens below are real, exported names from that package and
its `theme.css`; verify anything you are unsure of against a hoardodile
checkout ([`packages/ui/src/styles/theme.css`](../../packages/ui/src/styles/theme.css), [`packages/ui/src/viewport.ts`](../../packages/ui/src/viewport.ts)).

## When to Apply

- Building or reshaping plugin iframe UI (viewer, controls, settings
  popovers, overlays).
- Choosing between tokens and raw values, or between a component and a
  hand-rolled one.
- Making the plugin follow palette/theme/font/icon changes from the
  host (Settings → Theme, Settings → Fonts, Settings → Icons).
- Reviewing a plugin's UI against the host's design contract.

## How the host themes your iframe

The app pushes a `context` into the iframe — see `hd-plugin`
(`references/client.md`) — with `resolvedTheme` (`light`/`dark`),
`palette`, `iconStyle`, `fonts` and `language`. Theme application runs
*inside your iframe document*, via `@hoardodile/sdk-web`:

- `createPluginRoot` (`@hoardodile/sdk-react`) wires theme and fonts
  automatically — `ThemeSync`/`FontSync` subscribe to the pushes and
  call `applyTheme`/`applyFonts` for you.
- On bare `@hoardodile/sdk-web` (no React), subscribe to
  `themeChanged`/`fontsChanged` and call the helpers yourself.

What the helpers do:

- `applyTheme(resolvedTheme, palette, iconStyle)` sets classes on
  `document.documentElement` — `.light`/`.dark` plus
  `.theme-<palette>` (skipped for `mono`, which lives unclassed in
  `:root`/`.dark`) — and sets `data-icon-style` (duotone/grayscale/
  linear); theme.css's grayscale rule keys off it.
- `applyFonts(family, cssPaths)` injects the host's preset font
  stylesheets once and points `--font-app` at the inherited family;
  an empty family (manifest `ui.inheritFont: false`) removes the
  variable so the plugin keeps its own fonts.
- `language` selects your locale bundle — the official
  `createPluginTranslation` wrapper or your own react-i18next assembly
  (advanced pattern in `references/client.md`).

So: import `@hoardodile/ui/theme.css`, render through the SDK, and the
whole token vocabulary below just works — light/dark, palette hue via
`--icon-tone`, icon style, and fonts follow the user's settings.

## Principles

1. **Hierarchy is tonal, not linear.** Depth comes from fills —
   canvas → fill → card — never borders or shadows. Cards are the only
   surface allowed a shadow (`--shadow-card`); dialogs deepen the same
   shadow one step (`--shadow-dialog`).
2. **Whitespace separates; hairlines punctuate.** No vertical rules.
   Hairlines are horizontal and 1px (`--border`); 2px rules mark only
   structural seams (tab bars, panel sections).
3. **Accent is information, not decoration.** Hue enters only to mean
   something: entity colors, the duotone icon tone (`--icon-tone`). The
   neutral palette has none.
4. **Two voices: chrome and content.** Chrome speaks the system sans
   stack; reading content (books, long text) speaks the doc serif
   (`--font-doc`, Georgia). A plugin is chrome unless its job IS
   reading.
5. **Metadata is quiet and knows its place.** Counts/dates/times muted
   (`--muted-foreground`) and right-aligned. Muted type is only for
   metadata and placeholders — user data is never muted.
6. **Media is the content.** Renders artwork at intrinsic aspect ratio;
   no placeholder tiles. Empty states are designed, not defaulted.
7. **Danger is a ritual, not a color.** No warning hues; destruction
   communicates through copy, iconography and confirmation. The
   `--destructive` token exists only for bulk warning actions.
8. **Density with rhythm.** Dense single-line rows at fixed heights
   (`h-chip`/`h-control`); repetition and hairlines make rhythm, not
   cards and gaps.

## Tokens

Everything below is defined in `@hoardodile/ui/theme.css`. Use the
utility class when one exists; otherwise the CSS variable.

| Area | Tokens / utilities | Notes |
| --- | --- | --- |
| UI tiny | `--text-tiny` 11px · `text-tiny` | tags, counts; 12px in CJK locales (`html:lang(zh)`) |
| UI small | `text-xs` 12px | labels, meta |
| UI base | `--text-ui` 13px · `text-ui` | panels, menus |
| UI nav | `text-ui`/`text-sm` 13–14px medium | chrome nav |
| Section label | `text-xs tracking-label` | 12px uppercase, 0.1em, muted |
| Reading | `text-doc` 19px/1.9 · `text-doc-title` 48px · `text-doc-heading` 28px · `text-quote` 18px/1.65 | only for reading content |
| Fonts | `--font-sans` (system + CJK) · `--font-doc` (Georgia) | font prefs cascade via `--font-app`/`--font-doc-*` vars — never edit theme.css |
| Colors | `--background`, `--muted`, `--accent`, `--card`, `--primary`, `--border`, `--border-strong`, `--foreground`, `--secondary-foreground`, `--muted-foreground`, `--destructive` | see ten roles below |
| Chart | `--chart` = `var(--icon-tone, var(--foreground))` | chart ink, duotone fallback chain |
| Radius | `--radius` 10px base: `--radius-sm/md/lg/xl/2xl/3xl/4xl` (0.6/0.8/1/1.2/1.8/2.2/2.6×) | one family — rows/inputs/buttons base, pills down, cards/popovers up, sheets largest, character pills fully round |
| Shadows | `--shadow-card`, `--shadow-dialog` | one shadow in the system — floating cards only; `--shadow-dialog` is the same shadow one step deeper (dialogs float above a scrim) |
| Widths | `max-w-reading` 680 / `max-w-medium` 800 / `max-w-content` 1200 (`--container-*`) | page width is content width; padding never counts |
| Control heights | `h-chip` 28 (`--spacing-chip`) / `h-control` 32 (`--spacing-control`) / `h-nav` 38 (`--spacing-nav`) | never raw numbers at call sites |
| Motion | `--duration-1` 100ms / `-2` 160ms / `-3` 240ms / `-4` 320ms · `--ease-out`, `--ease-in`, `--ease-standard` | see Motion |
| Breakpoints | `sm` 640 / `md` 768 / `lg` 1024 / `xl` 1280 / `2xl` 1536 · `sidebar:` 1150 · `panel:` 1440 | constants + query strings in `@hoardodile/ui/viewport`; JS and CSS never disagree |
| Animations | `--animate-skel` (skeleton pulse), `--animate-pop` (quiet completion pop) | the only sanctioned skeleton/confirmation animations |

## Color — ten roles

| Role | Variable | Usage |
| --- | --- | --- |
| canvas | `--background` | page background |
| fill | `--muted` / `--accent` | selected/hover rows, search fields, tag pills |
| card | `--card` | floating cards only |
| action | `--primary` / `--primary-foreground` | primary buttons, badges, checked controls, sliders |
| hairline | `--border` | 1px separators; 2px structural seams |
| divider-strong | `--border-strong` | quote bars, strong callouts |
| text | `--foreground` | primary text |
| text-soft | `--secondary-foreground` | secondary text, icons |
| text-muted | `--muted-foreground` | counts, dates, placeholders |
| chart | `--chart` | chart ink |

**Chip surfaces**: a plain color tints the whole chip — a 6% wash as the
fill, the color itself as ink, no border. White keeps a hairline (pure
white would vanish on the canvas); black and the special surfaces
(silver, gold, rainbow, oilslick, kintsugi) go borderless. The active
chip changes tint only (6% → 20%), never geometry.

## Typography

- The stack is `--font-sans` (`-apple-system … Arial` plus CJK
  fallbacks PingFang SC / Hiragino Sans GB / Microsoft YaHei).
- CJK tiny text: `html:lang(zh) .text-tiny` reads at 12px — CJK strokes
  lose detail at 11px, and the rule out-ranks the utility.
- User font preferences cascade through `--font-app` / `--font-doc-*`
  variables — the runtime applies them, you never edit `theme.css`.
- Reading serif (Georgia) belongs to reading content only — a plugin
  that is a book reader uses the `text-doc*` roles; everything else
  stays in the app sans.

## Iconography

Solar Icon Set (CC BY 4.0), via the design system's registry —
**importing Solar directly is confined to the registry and
`@hoardodile/ui` internals; consumers import the wrapped exports only.**

- **Glyphs**: `@hoardodile/ui/icons/registry` exports one wrapped
  component per glyph, each carrying all three weights
  (`bold`/`boldDuotone`/`linear`). The wrapper picks the glyph for the
  active icon style; an explicit `mode` overrides.
- **Render**: `<Icon icon={Glyph} size="md" />` from
  `@hoardodile/ui/components/icon`. Sizes are exactly three tiers —
  `sm` 12 / `md` 16 / `lg` 20 (utilities `size-3/4/5`); escape with
  `className="size-[18px]"`. `selected` maps to the filled `bold`
  weight — the only sanctioned use of bold.
- **Duotone is the default voice**: the second tone takes
  `--icon-tone` (the palette hue), via the `.hd-icon` hook's
  `--solar-secondary-color: var(--icon-tone)`; mono stays neutral. The
  grayscale preference flips the second tone to `currentColor` through
  `data-icon-style` (host-managed) — keep the two-tone structure.
- **Recurring chrome actions** import the shared aliases from
  `@hoardodile/ui/icons/actions` (`Add`, `Remove`, `Check`, `More`) so
  two places that mean "add" render the same icon. ✓/×/+ are in-house
  marks (`marks.tsx`: `Check`, `Cross`, `Plus`) — never Solar's
  Circle/Square composites, which go muddy at small sizes.
- **Host-rendered plugin icons are Solar-only.** `manifest.icon`,
  `{{icon('<SolarGlyph>')}}` and search-kind icons name a **Solar glyph**
  from the host's full glyph index (not a curated subset) — same
  three-weight `createIcon` wrapper as the registry, so the icon style
  preference (duotone/grayscale/linear), `selected`→bold and
  `--icon-tone` all apply. A name outside the Solar set renders nothing
  (never an error). Custom images are allowed only as plugin zip asset
  paths (`assets/icon.svg` via `asset('path')` or the manifest `icon`);
  URLs and `data:` URIs are rejected. Raw Solar imports stay confined to
  host machinery (`packages/ui` registry + the app's generated lazy
  index) — plugin iframes import `@hoardodile/ui` wrapped exports only.
- Every glyph is small with `currentColor`; duotone only via the hook.

## Components

Use `@hoardodile/ui` components before hand-rolling — they carry the
design contract (focus rings, motion, anatomy). Import per-subpath so
bundles stay small:

```
@hoardodile/ui/components/button, input, label, slider, switch,
popover, dropdown-select, dropdown-menu, toast, app-dialog
@hoardodile/ui/hooks/use-mobile        (isBelowMd, useBelowMd, useBelowSidebar,
                                       useBelowPanel; useIsMobile is a compat alias)
@hoardodile/ui/lib/utils               (cn → twMerge)
@hoardodile/ui/viewport                (breakpoint constants + queries)
```

- **`Button` is a base-ui thin wrapper — the polymorphic prop is
  `render`, not shadcn's `asChild`** (e.g.
  `render={<a href={url} download />}`). Real options: variants
  `default | outline | secondary | ghost | destructive | danger | link`,
  sizes `default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg`,
  and `active` (latched toggle fill — pair it with `aria-pressed`).
- **Components are thin — check the props of the version you import.**
  Example: `Spinner` is plain `ComponentProps<"svg">` (no `size` prop;
  size it via `className`). `Icon`'s `icon/mode/size/selected` are the
  real contract.
- **`theme.css` pulls peer dependencies into your build**: it
  `@import`s `tailwindcss`, `tw-animate-css` and `shadcn/tailwind.css`.
  In the monorepo those resolve via hoisting; a standalone plugin must
  declare `shadcn` + `tw-animate-css` (and `tailwindcss`) as
  devDependencies or the CSS import fails.
- `hooks/use-mobile.ts` is the repo-wide source of truth for viewport
  detection — if a `shadcn add` regenerates it with its own
  `useIsMobile`, restore this file.

### Verified sample: the PDF plugin

`plugins/pdf` is the current official plugin that follows this system
end to end — worth reading before writing your own chrome: minimal
toolbar (density + hairline separator, ghost icon buttons with
`title`/`aria-label`), explicit loading/error/empty states (render
failures never show as loading), `@hoardodile/ui` subpath imports, and
auto theme/font/icon-style following through the SDK.

## Layout & surfaces in the iframe

- The plugin owns its iframe's internals only — the app's shell
  (sidebar/panel/caption strip, single scroll container) is the host's.
- Padding on a 4px grid (4/8/12/16/24/32/48/64); pages 32–40, cards
  16–24, list rows fixed height with no vertical margins.
- Three tonal surfaces: canvas carries everything, fills create
  hierarchy within it, cards float (the only shadow). Cards never nest
  inside cards — a nested surface is a fill. Page sections share a
  single sheet, parted by full-bleed hairlines.
- Control geometry from tokens (`h-chip`/`h-control`/`h-nav`), width
  from the container tokens when laying out reading content.
- One scroll container per surface, always-on bar — modal scroll
  locking must never shift layout or flicker first paint.

## States

| State | Rule |
| --- | --- |
| Hover / selected | a fill on rows, a 2px underline on tabs — never both, never accent |
| Link hover | muted deepens to soft text; no fill |
| Focus | 1px soft outline, offset 2px |
| Disabled | muted label; the fill does not change |
| Loading | a 2px progress bar at the top; skeletons in their own geometry (`--animate-skel`) |

## Overlays

- Layering: popovers/floating hints below the dialog layer; one anchored
  popover per trigger, one open surface at a time; a transparent fixed
  click-catcher closes popovers on outside clicks — never blurred.
- Dialogs: floating card at `--card` + hairline + `--radius-2xl` (step
  up) + `--shadow-dialog`; the body is the only scrolling region; the
  footer parts from the body with an inset hairline (never edge to
  edge); a three-button footer puts the secondary function at the left
  edge and cancel/primary right-aligned. Prefer the shared
  `app-dialog` component.
- Media viewers opt out of the dialog layer — opaque dark fill, no
  scrim, no dialog chrome.
- Focus defaults: focus the dialog container, not the first focusable
  element (keeps caret/scroll/soft keyboard stable); heavy surfaces
  (WebGL, video) degrade motion to fade-only.
- Animations that render timestamps/floating values (video progress,
  current time) never change layout geometry — updates are text
  swap/crossfade.

## Motion

Motion is **feedback, not ornament** — confirm the state change, keep
the provenance, get out of the way.

1. Faster than the mainstream: chrome at 100–200ms (`--duration-1..3`);
   media and full-surface transitions breathe at 250–300ms
   (`--duration-4`).
2. Transform and opacity only — never width/height/margin/padding;
   `will-change` only during the animation.
3. Ease out, arrive: entering decelerates (`--ease-out`), leaving
   accelerates (`--ease-in`). No bounce; springs belong to touch
   gestures only.
4. Hierarchy is tonal in time too: fills fade, text crossfades, media
   scales. No animated borders, shadows, or color wipes.
5. Motion is information — every animation answers *where did this come
   from, where did it go, did it work*. Otherwise delete it.
6. Respect `prefers-reduced-motion`: collapse every transition to ≤1ms
   via a single `!important` override block; nothing essential is ever
   conveyed by movement alone.

Quick per-surface map: menu/popover fades + 4px rise
(`--duration-2 --ease-out`); dialog fades + `scale(0.98→1)`
(`--duration-3 --ease-out`); panels slide 24px (`--duration-3`); rows
fade `--duration-1`; focus appears instantly; media cover hover zoom
`scale(1.03/1.05)` `--duration-4 --ease-standard`; loading bar loops
only while time is unknown — never fake determinate progress; staggered
reveals ≤5 items at 24–32ms and are skipped entirely under reduced
motion. Long lists use `content-visibility: auto`; animation must hold
60fps with 10⁴ rows.

## Plugin UI Checklist

- [ ] `@import "@hoardodile/ui/theme.css"`; tokens, never raw values
      (spacing 4px grid, radius family, `h-*`/`w-*` utilities).
- [ ] Theme/palette/icon style/fonts tracked via the SDK (runtime
      `applyTheme`/`applyFonts`); iframe root follows `context.palette`.
- [ ] Icons via the registry + `Icon` (three tiers, `selected` for
      bold, duotone kept); shared chrome actions from `actions.ts`;
      ✓/×/+ from `marks`.
- [ ] CJK tiny text at 12px; doc serif only for reading content.
- [ ] Tonal hierarchy: fills for depth, horizontal hairlines for
      separation, one shadow for floating cards; cards never nested.
- [ ] Muted type only for metadata and placeholders; counts/dates
      right-aligned.
- [ ] States complete: hover/selected, focus (1px outline), disabled,
      loading (2px top bar or `--animate-skel` skeletons).
- [ ] Motion within the duration/ease tokens, transform-opacity only,
      collapsed under `prefers-reduced-motion`.
- [ ] i18n: every user-visible string in the app's five languages
      (`en`/`zh`/`ja`/`de`/`es` — `en`/`zh` at minimum), via
      `{{t()}}` in the manifest and `t()` in the client; untranslated
      strings fall back exact locale → base language → first shipped.
