# Icons

**Always import glyphs from the registry — never Solar directly.**

```tsx
import { Icon } from "@hoardodile/ui/components/icon"
import { Add } from "@hoardodile/ui/icons/actions"
import { Box } from "@hoardodile/ui/icons/registry"
```

---

## Icons in a `Button` use `data-icon`

Add `data-icon="inline-start"` (prefix) or `data-icon="inline-end"` (suffix) to
the icon. No sizing classes on the icon.

**Incorrect:**

```tsx
<Button>
  <Add className="mr-2 size-4" />
  Add
</Button>
```

**Correct:**

```tsx
<Button>
  <Add data-icon="inline-start" />
  Add
</Button>

<Button>
  Next
  <More data-icon="inline-end" />
</Button>
```

---

## No sizing classes on icons inside components

`@hoardodile/ui` components size their own icons via CSS (e.g. `Button` sets
`[&_svg:not([class*='size-'])]:size-4` and handles the `data-icon` padding).
Don't add `size-4`, `w-4 h-4`, or other sizing classes to icons inside
`Button`, `DropdownMenuItem`, `Alert`, etc. Size via the `Icon` component's
`size` prop instead.

**Incorrect:**

```tsx
<Button>
  <Add className="size-4" data-icon="inline-start" />
  Add
</Button>

<DropdownMenuItem>
  <Box className="mr-2 size-4" />
  Details
</DropdownMenuItem>
```

**Correct:**

```tsx
<Button>
  <Add data-icon="inline-start" />
  Add
</Button>

<DropdownMenuItem>
  <Box />
  Details
</DropdownMenuItem>
```

---

## `Icon` sizing: three tiers only

`Icon` takes `size="sm" | "md" | "lg"` (default `md` → 12/16/20px). Escape a
tier only with `className="size-[18px]"`.

```tsx
<Icon icon={Box} size="sm" />
<Icon icon={Box} size="md" />
<Icon icon={Box} size="lg" />
```

`selected` maps to the filled `bold` weight — the only sanctioned use of Bold.

```tsx
<Icon icon={Box} selected />
```

---

## Shared chrome actions and marks

Recurring chrome actions come from `@hoardodile/ui/icons/actions`
(`Add`/`Remove`/`Check`/`More`) so two places that mean "add" render the same
icon. Plain ✓/×/+ come from `@hoardodile/ui/icons/marks` (`Check`, `Cross`,
`Plus`) — never Solar's Circle/Square composites.

```tsx
import { Add, Remove, Check, More } from "@hoardodile/ui/icons/actions"
```

---

## Pass icons as component objects, not string keys

`Icon` takes a component (`icon={Check}`), not a string name. Keep an icon as a
component through props rather than a lookup map.

**Incorrect:**

```tsx
const iconMap = { add: Add, remove: Remove }

function ActionIcon({ name }: { name: string }) {
  const Cmp = iconMap[name]
  return <Cmp />
}
```

**Correct:**

```tsx
function ActionIcon({ icon: Cmp }: { icon: ComponentType }) {
  return <Icon icon={Cmp} size="md" />
}

<ActionIcon icon={Add} />
```
