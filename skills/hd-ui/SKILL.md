---
name: hd-ui
description: Use the @hoardodile/ui component library — a published, shadcn-style design-system package (built on @base-ui/react) for the host app, desktop shell and plugin iframes. Use when building, reshaping, or composing UI with @hoardodile/ui — choosing the right component, variant, size, or icon, wiring a dialog/forms/toolbar surface, styling with the design tokens instead of raw values, following the host theme/palette/icon-style/fonts through the SDK, or auditing a surface against the "defaults are the design" contract. Components are imported per subpath and styled by their own variants/tokens — a primitive's default config is the design; reach for className only for layout, never for hard-coded pixel values.
license: MIT
metadata:
  author: hoardodile
  version: "1.0.0"
---

# @hoardodile/ui

[`@hoardodile/ui`](https://www.npmjs.com/package/@hoardodile/ui) is the design-system component library for hoardodile — used by the host app, the
desktop shell and plugin iframes alike. It is a **published dependency**
(shadcn-style, built on [`@base-ui/react`](https://github.com/base-ui/react)),
so you import it per subpath rather than copying source into your project:

```bash
pnpm add @hoardodile/ui
```

Components already carry the design contract (colors, typography, focus rings,
motion), so **the default config is the design** — a primitive's default
`variant`/`size` is correct unless the situation genuinely needs otherwise.

> **IMPORTANT:** `@hoardodile/ui` is a **library, not a CLI**. There is no
> `npx shadcn@latest`-style add step; you import components and import
> `@hoardodile/ui/theme.css` once. Read the props of the version you import.

## Project Context

There is no CLI to introspect, so establish this yourself:

- **Installed version** — the `@hoardodile/ui` version in your lockfile.
  Components are thin; read the exported prop types for the version you use.
- **Surface** — are you **inside the host app** (the SDK pushes
  `resolvedTheme`/`palette`/`iconStyle`/`fonts` and applies them via
  `applyTheme`/`applyFonts`), or **standalone** (you wire
  `.light`/`.dark`/`.theme-<id>` + `data-icon-style` yourself)? Either way,
  import `@hoardodile/ui/theme.css` once at your entry.
- **Subpath, not root** — import from `@hoardodile/ui/components/*`,
  `@hoardodile/ui/icons/*`, `@hoardodile/ui/hooks/*`, `@hoardodile/ui/lib/*`
  so bundles stay small. The root entry re-exports a few app-owned pieces
  (`AppDialog`, `cn`, `setNavigationResolver`, `useMobileBackToClose`).

## Usage principles

1. **Use existing components first.** Check the catalog before hand-rolling a
   styled `div`. If a component exists, use it.
2. **Compose, don't reinvent.** A settings dialog is `ConfirmDialog`/`AppDialog`
   + `Label`/`Input` + `SectionLabel`; a toolbar is `PanelToolbar` + ghost
   `Button`s + `Separator`; a picker is a `DropdownSelect`/`Combobox`.
3. **Built-in variants before custom styles.** `variant="outline"`,
   `size="sm"` — reach for a variant/prop before a `className`.
4. **Use semantic tokens.** `bg-primary`, `text-muted-foreground`,
   `text-destructive` — never raw values like `bg-blue-500` or `#fff`.
5. **Defaults are the design.** A primitive's default `variant`/`size` is the
   contract. Leave it unless the situation calls for a change.
6. **Import per subpath** so only what you use ships.

## Design at a glance

The library is built on a real design system. These are the principles behind
the components and the sizes the system has already turned into variables —
use those instead of raw pixels.

### Design principles

1. **Hierarchy is tonal, not linear.** Depth comes from fills (canvas → fill →
   card), never borders or shadows. The system has exactly one shadow
   (`--shadow-card`), for floating cards; dialogs deepen it one step
   (`--shadow-dialog`).
2. **Whitespace separates; hairlines punctuate.** No vertical rules; hairlines
   are horizontal and 1px (`--border`); a 2px rule marks only structural seams
   (tab bars, panel sections).
3. **Accent is information, not decoration.** Hue enters only to mean something
   — entity colors, the duotone icon tone (`--icon-tone`). The neutral palette
   has none.
4. **Two voices: chrome and content.** Chrome speaks the system sans; reading
   content (pages, long text) speaks the doc serif (`--font-doc`, Georgia). A
   surface is chrome unless its job IS reading.
5. **Metadata is quiet and knows its place.** Counts/dates/times are muted
   (`--muted-foreground`) and right-aligned. Muted type is only for metadata
   and placeholders — user data is never muted.
6. **Media is the content.** Covers and avatars render as artwork at their
   intrinsic aspect ratio; no placeholder tiles; empty states are designed, not
   defaulted.
7. **Danger is a ritual, not a color.** No warning hues; destructive actions
   communicate through copy, iconography and confirmation. `--destructive`
   serves only bulk warning actions — the ritual stays in copy and the confirm
   button.
8. **Density with rhythm.** Lists are dense, single-line rows at fixed heights;
   repetition and hairlines make the rhythm, not cards and gaps.

### Tokens — the variable-ized sizes

Reference these instead of hard-coding pixels. (`--token` is the raw variable;
the utility form is how the design system exposes it in `className`.)

| Token / utility | Value | Where it applies |
| --- | --- | --- |
| `h-chip` / `--spacing-chip` | 28 | chips, pills |
| `h-control` / `--spacing-control` | 32 | buttons, inputs (default) |
| `h-nav` / `--spacing-nav` | 38 | chrome nav, caption strip |
| `w-sidebar` / `--spacing-sidebar` | 264 | fixed left rail |
| `w-panel` / `--spacing-panel` | 320 | contextual right panel |
| `max-w-reading` / `--container-reading` | 680 | reading content |
| `max-w-medium` / `--container-medium` | 800 | medium content |
| `max-w-content` / `--container-content` | 1200 | page content |
| `size-3/4/5` (`Icon size="sm/md/lg"`) | 12 / 16 / 20 | icon tiers (escape `size-[18px]`) |
| `--radius` family | 10px base × 0.6 / 0.8 / 1 / 1.2 / 1.8 / 2.2 / 2.6 | `sm` → `4xl` radius steps |
| `--shadow-card` | 0 1px 3px rgb(0 0 0 / 0.04) | floating cards only |
| `--shadow-dialog` | + 0 24px 48px -16px rgb(0 0 0 / 0.16) | dialogs above a scrim |
| spacing grid | 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 | 4px rhythm, never arbitrary |
| `--duration-1..4` | 100 / 160 / 240 / 320 ms | motion durations |
| `--ease-out` / `--ease-in` / `--ease-standard` | (cubic-bezier) | arrive / depart / on-screen |
| `md:` / `sidebar:` / `panel:` | 768 / 1150 / 1440 | CSS breakpoints (`MOBILE_INITIAL_SCALE` 0.8) |

The full tables — the ten color roles, typography, layout/measures, states,
overlays and motion — are in [`rules/design.md`](./rules/design.md).

## Critical Rules

These rules are **always enforced**. Each links to a file with
Incorrect/Correct code pairs.

### Styling & Tokens → [rules/styling.md](./rules/styling.md)

- **`className` for layout, not styling.** Never override a primitive's color,
  typography, or size.
- **No hard-coded pixel values.** No `size-10`, `w-10 h-10`, `px-3`,
  `text-lg`, `h-12` — use the component's `size`/`variant` prop or the
  design-token utilities (`h-chip`, `h-control`, `size-3/4/5`, `text-ui`,
  `text-xs`, `gap-*`).
- **Use `cn()` for conditional classes.** Don't write manual template-literal
  ternaries.
- **No manual `dark:` overrides.** Use semantic tokens.
- **No manual `z-index` on overlay components.** `AppDialog`, `Sheet`,
  `Popover`, `Tooltip` own their stacking.
- **No hand-rolled animations.** Use the package's skeleton/pop tokens.

### Component Composition → [rules/composition.md](./rules/composition.md)

- **Items always inside their Group** (`DropdownMenuItem` → `DropdownMenuGroup`,
  etc.).
- **`AppDialog`/`Sheet` always need a `Title`.** `DialogTitle`/`SheetTitle`;
  use `className="sr-only"` if visually hidden.
- **`Button` has no `isPending`/`isLoading`.** Compose `Spinner` + `disabled`.
- **Use components, not custom markup.** `Alert`, `Empty`, `Separator`,
  `Skeleton`, `Badge`, `toast()`.

### Icons → [rules/icons.md](./rules/icons.md)

- **Import from `@hoardodile/ui/icons/registry` only** — never Solar directly.
- **Render through `Icon` with `size="sm|md|lg"`** (default `md`). No sizing
  classes on icons.
- **Icons in a `Button` use `data-icon="inline-start"`/`"inline-end"`.**
- **Pass icons as objects, not string keys.**

### Forms & Inputs → [rules/forms.md](./rules/forms.md)

- Forms use the `Form`/`FormField` anatomy or `Label` + `Input`.
- Validation/disabled via `aria-invalid`/`data-invalid`, never by restyling.

### Base UI (`render`, not `asChild`) → [rules/base-ui.md](./rules/base-ui.md)

- **`@base-ui/react` uses `render`, not `asChild`.** For custom types/triggers,
  pass `render={<a href={url} />}` (add `nativeButton={false}` for non-button
  elements).

### Theme & Motion → [rules/theme.md](./rules/theme.md)

- **Import `@hoardodile/ui/theme.css` once; never redefine its tokens.**
- **Follow the host theme** via the SDK (`applyTheme`/`applyFonts`) or apply
  `.light`/`.dark`/`.theme-<id>` + `data-icon-style` yourself.
- **Don't hand-roll motion.** Use component props and transform/opacity only.

## Key Patterns

```tsx
import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Add } from "@hoardodile/ui/icons/actions"
import { cn } from "@hoardodile/ui/lib/utils"

// Variants/sizes — defaults first, change only what you need.
<Button variant="outline" size="sm">Open</Button>

// A latched toggle: active + the matching aria attribute.
<Button active aria-pressed={pinned} onClick={() => setPinned(!pinned)}>Pin</Button>

// Icons via the Icon component — sized by prop, not class.
<Icon icon={Add} size="sm" />

// Conditional classes via cn(), not a template literal.
<div className={cn("flex gap-2", open && "bg-muted")}>…</div>

// A link button: base-ui `render`, not asChild; nativeButton for a non-button.
<Button variant="link" render={<a href={url} />} nativeButton={false}>Docs</Button>

// Breakpoint-aware UI.
const belowMd = useBelowMd()
```

## Component Selection

| Need | Use |
| --- | --- |
| Primary/secondary action | `Button` (`variant` `default`/`outline`/`secondary`/`ghost`/`destructive`/`danger`/`link`; `size` `default`/`xs`/`sm`/`lg`/`icon`/`icon-xs`/`icon-sm`/`icon-lg`; `active` latched toggle) |
| Inline smaller action | `ChipButton` |
| Single-line text | `Input` (`size`: `sm`/`md`/`lg`) |
| Multi-line text | `Textarea` |
| Field label | `Label` |
| Toggle | `Switch` / `Toggle` |
| Pick one / many | `Checkbox` / `RadioGroup` / `Slider` |
| Select a value | `DropdownSelect` / `DropdownMultiSelect` / `Combobox` |
| Badge / count / tag | `Badge` / `CountBadge` / `TagChip` / `MetaChip` |
| Divider | `Separator` |
| Feedback | `toast()` + `<Toaster />` · `Alert` · `Progress` · `Skeleton` · `Spinner` |
| Empty state | `Empty` / `ManagementEmpty` / `ListEmptyRow` |
| Tabs | `PillTabs` / `SectionTabs` |
| Section label / heading | `SectionLabel` / `SectionHeader` / `GroupLabel` |
| Page shell | `PageScaffold` / `PageHeader` / `FlatSurface` / `PanelToolbar` |
| Dialog | `AppDialog` / `ConfirmDialog` / `ConfirmByTypingDialog` / `CloseConfirmDialog` |
| Side drawer / sheet | `Sheet` / `MobileDrawer` |
| Anchored overlay | `Popover` / `Tooltip` |
| Table | `Table` |
| Pagination | `Pagination` / `PaginationBar` |
| Filter / rail | `FilterRail` / `FilterRailSection` / `SearchField` |
| Color / font picker | `ColorPicker` / `FontPicker` |
| Icons | `Icon` + `@hoardodile/ui/icons/registry` / `actions` / `marks` |

## Key Fields — Subpaths

| Subpath | Contents |
| --- | --- |
| `@hoardodile/ui/theme.css` | tokens, palettes, `.dark`/`.theme-<id>` blocks |
| `@hoardodile/ui/components/*` | one entry per component |
| `@hoardodile/ui/icons/*` | `registry`, `actions`, `icon-style`, `marks` |
| `@hoardodile/ui/hooks/*` | `useBelowMd`, `useBelowSidebar`, `useBelowPanel`, `useMobileBackToClose`, `useIsMobile` (compat) |
| `@hoardodile/ui/lib/*` | `cn` (twMerge), `colors`, `pagination`, `merge-config` |
| `@hoardodile/ui/viewport` | breakpoint constants + `MOBILE_INITIAL_SCALE` |
| `@hoardodile/ui/res-card-template` | resource-card template renderer helpers |

Components are **thin** — read the props of the version you import (e.g.
`Spinner` is plain `ComponentProps<"svg">` with no `size` prop).

## Workflow

1. **Check the catalog first** — is there a component for the job? Don't wire a
   custom styled `div`.
2. **Import per subpath** and confirm the export exists for the
   `@hoardodile/ui` version in use.
3. **Compose** with variants/sizes; keep the default unless it's wrong.
4. **Follow the host theme** — import `theme.css`, let the SDK apply
   theme/palette/icon-style/fonts (or apply the classes/attribute yourself).
5. **Audit** against the Critical Rules: no `className` restyling, no hard-coded
   pixels, `cn()` for conditionals, semantic tokens, `render` not `asChild`,
   registry icons with `Icon` + `size` (no sizing classes).

`plugins/pdf` and `plugins/gallery` in the hoardodile repo are the current
official reference implementations — read them before writing your own chrome.

## Updating

There is no CLI `add`/`--diff`. On a `@hoardodile/ui` upgrade, re-read the
imported components' props from the installed `dist` types and re-verify
variants/sizes and composition against the rules before shipping.

## Quick Reference

```bash
# Add the library.
pnpm add @hoardodile/ui
```

```tsx
// Entry: the design system tokens.
import "@hoardodile/ui/theme.css"

import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Add } from "@hoardodile/ui/icons/actions"
import { cn } from "@hoardodile/ui/lib/utils"
import { useBelowMd } from "@hoardodile/ui/hooks/use-mobile"
```

```tsx
// Correct: variant + size + icon data-icon (no sizing class).
<Button variant="outline" size="sm">
  <Icon icon={Add} />
  Add
</Button>

// Defaults are the design — only override what the situation needs.
<Input size="sm" />
```

Standalone consumers must declare the `theme.css` import peer deps:
`shadcn`, `tw-animate-css`, and `tailwindcss` (as devDependencies), or the CSS
`@import` chain fails.

## Detailed References

- [rules/styling.md](./rules/styling.md) — semantic tokens, variants first, `className` for layout only, no hard-coded pixels, `gap-*`, `size-*`, `truncate`, `cn()`, z-index, animations
- [rules/composition.md](./rules/composition.md) — groups, overlays, `Title`, `Button` loading, use components not markup
- [rules/icons.md](./rules/icons.md) — registry only, `Icon` tiers, `data-icon`, no sizing classes
- [rules/forms.md](./rules/forms.md) — `Form`/`FormField`, control choice, validation/disabled states
- [rules/base-ui.md](./rules/base-ui.md) — `render` vs `asChild`, `nativeButton`, base prop shapes
- [rules/theme.md](./rules/theme.md) — `theme.css`, host-theme following, motion, peer deps
- [rules/design.md](./rules/design.md) — principles, ten color roles, typography, variable-ized size/measure tokens, layout/measures, states, overlays, motion

Design content derived from DESIGN.md, the hoardodile design system spec.
