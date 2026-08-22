# @hoardodile/ui

The design-system component library for hoardodile — the host app and
plugin iframes alike. Import components per-path so bundles stay small;
hooks live under `@hoardodile/ui/hooks/*` and shared CSS variables in
`@hoardodile/ui/theme.css`.

## Install

```bash
pnpm add @hoardodile/ui
```

### CSS toolchain

The theme stylesheet (`@hoardodile/ui/theme.css`) is Tailwind v4 CSS with
`@import` statements left for your build to resolve. Consuming it requires
the Tailwind toolchain in your own project:

```bash
pnpm add -D tailwindcss tw-animate-css shadcn
```

`tailwindcss` (plus your Tailwind plugin, e.g. `@tailwindcss/vite`),
`tw-animate-css` and `shadcn` are declared as optional peer dependencies so
package managers surface them; install them alongside `@hoardodile/ui` and
import the theme from your entry stylesheet:

```css
@import "@hoardodile/ui/theme.css";
```

The theme stylesheet carries a `@source` glob that points at the package's
compiled component outputs, so your Tailwind picks up the component classes
automatically — no `@source` configuration on your side. (This contract is
enforced by the `scan-contract` test in the package.)

## Import paths

| Entry | Contents |
| ----- | -------- |
| `@hoardodile/ui/components/*` | Components, one module each (`button`, `dialog`, `dropdown-menu`, `popover`, `app-dialog`, `dropdown-select`, `icon`, `surface`, `form`, …) |
| `@hoardodile/ui/icons/*` | The icon domain: `registry` (every Solar glyph, wrapped), `marks` (✓/×/+), `actions` (action-to-glyph vocabulary), `icon-style` |
| `@hoardodile/ui/hooks/*` | Hooks (`use-mobile`, `useMobileBackToClose`, `use-form-field`, `use-dialog-footer-actions`, …) |
| `@hoardodile/ui/lib/*` | Utilities (`cn`, …) |
| `@hoardodile/ui/theme.css` | Theme CSS: `.light` / `.dark` variables and per-palette `.theme-<id>` blocks |
| `@hoardodile/ui/viewport` | Shared mobile viewport constants (`MOBILE_BREAKPOINT_PX`, `MOBILE_QUERY`, …) |
| `@hoardodile/ui` | App-owned root pieces: `AppDialog`, `cn`, navigation resolver |

## Example

```tsx
import { Button } from "@hoardodile/ui/components/button"
import { AppDialog } from "@hoardodile/ui"

export function Picker({ open, onClose }) {
	return (
		<AppDialog open={open} onOpenChange={onClose} title="Pick">
			<Button onClick={onClose}>Done</Button>
		</AppDialog>
	)
}
```

## Theming

`@hoardodile/ui/theme.css` defines the design tokens both the host app
and plugin iframes consume. The plugin iframe applies the host theme via
`applyTheme` from `@hoardodile/sdk-web` — palette classes like
`theme-parchment` are defined here.

## Docs

- [Plugin development](https://docs.hoardodile.com/plugin-development/)
