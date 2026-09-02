# Styling & Tokens

## Contents

- Semantic colors, never raw values
- Built-in variants before custom styles
- `className` for layout only — a primitive's default is the design
- No hard-coded pixel values
- No `space-x-*` / `space-y-*`
- Prefer `size-*` over `w-* h-*` when equal
- Prefer `truncate` shorthand
- No manual `dark:` color overrides
- Use `cn()` for conditional classes
- No manual `z-index` on overlay components
- Use the package's skeleton/pop tokens, not custom animations

---

## Semantic colors, never raw values

**Incorrect:**

```tsx
<div className="bg-blue-500 text-white">
  <p className="text-gray-600">Secondary text</p>
</div>
```

**Correct:**

```tsx
<div className="bg-primary text-primary-foreground">
  <p className="text-muted-foreground">Secondary text</p>
</div>
```

For status/state indicators, use `Badge` variants or semantic tokens
(`text-destructive`), never a raw Tailwind color.

**Incorrect:**

```tsx
<span className="text-emerald-600">+20.1%</span>
<span className="text-red-600">-3.2%</span>
```

**Correct:**

```tsx
<Badge variant="secondary">+20.1%</Badge>
<span className="text-destructive">-3.2%</span>
```

---

## Built-in variants before custom styles

**Incorrect:**

```tsx
<Button className="border border-input bg-transparent hover:bg-accent">
  Click me
</Button>
```

**Correct:**

```tsx
<Button variant="outline">Click me</Button>
```

---

## `className` for layout only — a primitive's default is the design

A `@hoardodile/ui` primitive (`Button`, `Input`, `Badge`, `Label`, …) already
carries the design contract. Use `className` for **layout** (flex, gaps, widths
in a parent grid, margins) — **never** to override its colors, typography, or
size. The default `variant`/`size` is correct; change only what the situation
needs.

**Incorrect:**

```tsx
<Button className="bg-red-100 text-red-900 font-bold">Delete</Button>
```

**Correct:**

```tsx
<Button variant="destructive">Delete</Button>
```

To customize a component's appearance, prefer in order:
1. **Built-in variants** — `variant="outline"`, `variant="destructive"`, etc.
2. **Semantic tokens** — `bg-primary`, `text-muted-foreground`.
3. **Layout `className`** — `max-w-md`, `mx-auto`, `flex gap-2` (spacing/width
   in a parent, never the component's look).

---

## No hard-coded pixel values

Never reach for a raw pixel utility on a primitive or in chrome. Use the
`size`/`variant` props and the design-token utilities (`h-chip` 28 / `h-control`
32 / `h-nav` 38; `size-3/4/5` for icons; `text-ui`, `text-xs`, `gap-*`). The
one sanctioned escape from an icon tier is `className="size-[18px]"`.

**Incorrect:**

```tsx
<Input className="h-8 px-2" />
<Icon icon={Add} className="size-4" />
<Button className="h-10 w-28">Save</Button>
```

**Correct:**

```tsx
<Input size="sm" />
<Icon icon={Add} size="md" />
<Button size="default">Save</Button>
```

---

## No `space-x-*` / `space-y-*`

Use `gap-*`. `space-y-4` → `flex flex-col gap-4`; `space-x-2` → `flex gap-2`.

```tsx
<div className="flex flex-col gap-4">
  <Input size="sm" />
  <Input size="sm" />
  <Button>Submit</Button>
</div>
```

---

## Prefer `size-*` over `w-* h-*` when equal

`size-10` not `w-10 h-10` — for icons, avatars, skeletons, and any square.

---

## Prefer `truncate` shorthand

`truncate` not `overflow-hidden text-ellipsis whitespace-nowrap`.

---

## No manual `dark:` color overrides

`@hoardodile/ui/theme.css` defines `.light`/`.dark` variables, so use semantic
tokens and it handles both — `bg-background text-foreground`, not
`bg-white dark:bg-gray-950`.

---

## Use `cn()` for conditional classes

Use `cn()` from `@hoardodile/ui/lib/utils` for conditional or merged class
names. Don't write manual ternaries in a `className` string.

**Incorrect:**

```tsx
<div className={`flex items-center ${isActive ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
```

**Correct:**

```tsx
import { cn } from "@hoardodile/ui/lib/utils"

<div className={cn("flex items-center", isActive ? "bg-primary text-primary-foreground" : "bg-muted")}>
```

---

## No manual `z-index` on overlay components

`AppDialog`, `ConfirmDialog`, `Sheet`, `MobileDrawer`, `Popover`, `Tooltip`
handle their own stacking. Never add `z-50` or `z-[999]`.

---

## Use the package's skeleton/pop tokens, not custom animations

Use `Skeleton` for loading placeholders and the package's `--animate-skel`
pulse; use the quiet `--animate-pop` for the upload/confirm completion — no
hand-authored `@keyframes`, no `animate-pulse` gradient sweep, no animated
layout geometry.

**Incorrect:**

```tsx
<div className="animate-pulse bg-muted h-4 w-3/4" />
```

**Correct:**

```tsx
<Skeleton className="h-4 w-3/4" />
```
