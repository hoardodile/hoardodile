# Theme & Motion

## Contents

- Import `theme.css` once — never redefine it
- Follow the host theme (in-app via the SDK)
- Follow the host theme (standalone)
- Font preference cascade
- Motion: use the component's props, transform/opacity only
- Standalone peer dependencies

---

## Import `theme.css` once — never redefine it

`@hoardodile/ui/theme.css` is the single source of the tokens and palettes.
Import it once at your entry and **never redefine its CSS variables** — the
package owns them. Changing a palette or token belongs to the package, not your
surface.

```tsx
// app entry or plugin entry.
import "@hoardodile/ui/theme.css"
```

---

## Follow the host theme (in-app via the SDK)

Inside the host app (plugin iframe), the SDK pushes `resolvedTheme`/`palette`/
`iconStyle`/`fonts` and applies them for you:

- `@hoardodile/sdk-react`: `createPluginRoot` wires `ThemeSync`/`FontSync`.
- `@hoardodile/sdk-web` (bare): subscribe to `themeChanged`/`fontsChanged` and
  call `applyTheme`/`applyFonts`.

`applyTheme` sets `.light`/`.dark` plus `.theme-<palette>` (skipped for
`mono`) and `data-icon-style` on `document.documentElement`. Just compose
components — they pick up the theme.

---

## Follow the host theme (standalone)

Apply the same CSS contract yourself from the user's settings:
`document.documentElement` gets `.light`/`.dark`, a `.theme-<palette>` class
(skipped for `mono`, which lives unclassed in `:root`/`.dark`), and
`data-icon-style` (`duotone`/`grayscale`/`linear`).

```tsx
document.documentElement.classList.toggle("dark", resolvedTheme === "dark")
document.documentElement.classList.toggle(`theme-${palette}`, palette !== "mono")
document.documentElement.dataset.iconStyle = iconStyle
```

For a plain **render-through-the-SDK** surface, prefer `applyTheme`/`applyFonts`.

### The five palettes

`theme.css` ships five palettes, each light + dark. A colored palette defines
`--icon-tone` (the duotone icon second layer); **Mono defines none** and stays
neutral. `mono` lives unclassed in `:root`/`.dark` — `.theme-mono` re-registers
it only for a local opt-in. The user picks from the registry; they never author
palettes.

```
mono (no accent hue) · sage · parchment · azure · hoardodile
```

---

## Font preference cascade

User font prefs cascade by CSS variable, never by editing `theme.css`:
`--font-app` on `<html>`; document slots override per-slot via `--font-doc-*`
inline on the page; every slot falls back
`var(--font-doc-ui-body, var(--font-app, var(--font-sans)))`. An empty family
`ui.inheritFont: false` removes the variable so the surface keeps its own
fonts.

---

## Motion: use the component's props, transform/opacity only

Don't hand-roll motion. Prefer the component props and keep animations to
transform + opacity:

- `contentMotion="minimal"` on dialogs over heavy surfaces (WebGL, video).
- `suppressAutoFocus` is the default (focus goes to the dialog container, not
  the first focusable — avoids caret/scroll/soft-keyboard hijack).
- Never animate layout geometry (width/height/margin/padding); the host
  collapses transitions under `prefers-reduced-motion`.

**Incorrect:**

```tsx
<AppDialog … className="transition-all duration-500">
```

**Correct:**

```tsx
<AppDialog … contentMotion="minimal" />
```

---

## Standalone peer dependencies

`@hoardodile/ui/theme.css` `@import`s `tailwindcss`, `tw-animate-css` and
`shadcn/tailwind.css`. In the monorepo those resolve via hoisting; a standalone
consumer must declare `shadcn` + `tw-animate-css` (and `tailwindcss`) as
devDependencies or the CSS `@import` chain fails.
