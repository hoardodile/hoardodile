# Component Composition

## Contents

- Items always inside their Group component
- Callouts use `Alert`
- Empty states use `Empty`
- Toast notifications use `toast()` + `<Toaster />`
- Choosing between overlay components
- `AppDialog`/`Sheet` always need a `Title`
- `Button` has no `isPending` or `isLoading` prop
- Tab triggers always inside the tab list
- Use `Separator` instead of raw `hr` / border divs
- Use `Skeleton` for loading placeholders
- Use `Badge`/`TagChip` instead of custom styled spans

---

## Items always inside their Group component

Never render items directly inside the content container.

**Incorrect:**

```tsx
<DropdownMenuContent>
  <DropdownMenuItem>Rename</DropdownMenuItem>
  <DropdownMenuItem>Delete</DropdownMenuItem>
</DropdownMenuContent>
```

**Correct:**

```tsx
<DropdownMenuContent>
  <DropdownMenuGroup>
    <DropdownMenuItem>Rename</DropdownMenuItem>
    <DropdownMenuItem>Delete</DropdownMenuItem>
  </DropdownMenuGroup>
</DropdownMenuContent>
```

---

## Callouts use `Alert`

```tsx
<Alert>
  <AlertTitle>Warning</AlertTitle>
  <AlertDescription>Something needs attention.</AlertDescription>
</Alert>
```

---

## Empty states use `Empty`

```tsx
<Empty>
  <SecondEmpty…/>
  <Button>Create Resource</Button>
</Empty>
```

For the list/page variants and the management screen, prefer
`ManagementEmpty` / `ListEmptyRow` over hand-built empty markup.

---

## Toast notifications use `toast()` + `<Toaster />`

Mount `<Toaster />` once (or a `ToastProvider`/`createToastManager` for a
custom manager) and call `toast(...)` from `@hoardodile/ui/components/toast`:

```tsx
import { toast } from "@hoardodile/ui/components/toast"

toast({ title: "Changes saved." })
```

---

## Choosing between overlay components

| Use case | Component |
|----------|-----------|
| Focused task that requires input | `AppDialog` |
| Destructive/confirming action | `ConfirmDialog` / `ConfirmByTypingDialog` |
| Side panel with details or filters | `Sheet` |
| Mobile-first bottom panel | `MobileDrawer` |
| Small contextual content on click | `Popover` |
| Quick info on hover | `Tooltip` |

---

## `AppDialog`/`Sheet` always need a `Title`

`DialogTitle`/`SheetTitle` are required for accessibility; use
`className="sr-only"` if visually hidden. `AppDialog`/`ConfirmDialog` set this
up for you via their `title` prop.

```tsx
<AppDialog open={open} onOpenChange={setOpen} title="Edit Profile">
  …
</AppDialog>
```

---

## `Button` has no `isPending` or `isLoading` prop

Compose with `Spinner` + `disabled` (and `data-icon` if the spinner sits at an
icon slot):

```tsx
<Button disabled>
  <Spinner />
  Saving…
</Button>
```

---

## Tab triggers always inside the tab list

Never render a tab trigger directly in the `Tabs`/`SectionTabs` container —
wrap it in the list. `PillTabs`/`SectionTabs` take an `items` array:

```tsx
const [tab, setTab] = useState<"account" | "password">("account")

<PillTabs
  value={tab}
  onChange={setTab}
  items={[
    { value: "account", label: "Account" },
    { value: "password", label: "Password" },
  ]}
/>
```

> Check the exact `PillTabs`/`SectionTabs` API for the version you import.

---

## Use existing components instead of custom markup

| Instead of | Use |
|---|---|
| `<hr>` or `<div className="border-t">` | `<Separator />` |
| `<div className="animate-pulse">` styled divs | `<Skeleton className="h-4 w-3/4" />` |
| `<span className="rounded-full bg-green-100 …">` | `<Badge variant="secondary" />` |
| a custom empty-state block | `<Empty />` or `<ManagementEmpty />` |
