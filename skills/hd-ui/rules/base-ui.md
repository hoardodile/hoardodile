# Base UI (@base-ui/react)

`@hoardodile/ui` is built on `@base-ui/react`, so the polymorphic prop is
**`render`**, not shadcn's `asChild`.

## Contents

- Composition: `render`, not `asChild`
- `nativeButton={false}` for non-button elements
- Don't wrap a trigger in an extra element
- Base prop shapes (verify for the version you import)

---

## Composition: `render`, not `asChild`

Base uses `render` to replace the default element. Radix-style `asChild` does
not apply.

**Incorrect:**

```tsx
<Button asChild>
  <a href={url}>Docs</a>
</Button>
```

**Correct:**

```tsx
<Button render={<a href={url} />} nativeButton={false}>Docs</Button>
```

This applies to trigger/close components too: `PopoverTrigger`,
`DropdownMenuTrigger`, `TooltipTrigger`, etc. use `render`.

---

## `nativeButton={false}` for non-button elements

When `render` changes a `Button`/trigger to a non-`<button>` element (`<a>`,
`<span>`), pass `nativeButton={false}` so base-ui doesn't render a real
`<button>`.

**Incorrect:**

```tsx
<Button render={<a href="/docs" />}>Read the docs</Button>
```

**Correct:**

```tsx
<Button render={<a href="/docs" />} nativeButton={false}>
  Read the docs
</Button>
```

---

## Don't wrap a trigger in an extra element

Never put a plain `div` between a trigger and its target element.

**Incorrect:**

```tsx
<PopoverTrigger>
  <div>
    <Button>Open</Button>
  </div>
</PopoverTrigger>
```

**Correct:**

```tsx
<PopoverTrigger render={<Button />}>Open</PopoverTrigger>
```

---

## Base prop shapes

Base primitives favor array `defaultValue`, a `multiple` boolean, an `items`
prop on select-like roots, and a plain scalar for a single slider thumb. The
`@hoardodile/ui` components wrap these primitives, so confirm the exact props
for the version you import:

```tsx
// Multiple selection — base uses a boolean, defaultValue is an array.
<ToggleGroup multiple defaultValue={["bold"]}>
  <ToggleGroupItem value="bold">Bold</ToggleGroupItem>
</ToggleGroup>

// Single slider thumb — base accepts a plain number.
<Slider defaultValue={50} max={100} step={1} />
```

> Verify `Combobox`/`DropdownSelect`/`Slider`/`RadioGroup`/`Toggle` props against
> the installed `dist` types — base and radix variants differ.
