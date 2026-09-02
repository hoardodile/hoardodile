# Forms & Inputs

## Contents

- Forms use `Form`/`FormField` or `Label` + `Input`
- Choosing form controls
- `InputGroup` requires `InputGroupInput`/`InputGroupTextarea`
- Buttons inside inputs use `InputGroup` + `InputGroupButton`/`InputGroupAddon`
- Field validation and disabled states

---

## Forms use `Form`/`FormField` or `Label` + `Input`

Use the form anatomy — never raw `div` with `space-y-*` for form layout:

```tsx
import { Form, FormField, FormLabel, FormControl } from "@hoardodile/ui/components/form"

<FormField
  name="email"
  render={({ field }) => (
    <FormItem>
      <FormLabel htmlFor="email">Email</FormLabel>
      <FormControl>
        <Input id="email" type="email" {...field} />
      </FormControl>
    </FormItem>
  )}
/>
```

For simple, non-routed forms, `Label` + `Input` in a `flex flex-col gap-4` is
fine.

---

## Choosing form controls

| Need | Control |
| --- | --- |
| Simple text | `Input` (`size`: `sm`/`md`/`lg`) |
| Multi-line text | `Textarea` |
| Boolean toggle (settings) | `Switch` |
| Boolean (in a form) | `Checkbox` |
| Single choice from a few | `RadioGroup` |
| Range | `Slider` |
| Searchable dropdown | `Combobox` |
| Predefined options | `DropdownSelect` / `DropdownMultiSelect` |

---

## `InputGroup` requires `InputGroupInput`/`InputGroupTextarea`

Never use raw `Input` or `Textarea` inside an `InputGroup`.

**Incorrect:**

```tsx
<InputGroup>
  <Input placeholder="Search…" />
</InputGroup>
```

**Correct:**

```tsx
import { InputGroup, InputGroupInput } from "@hoardodile/ui/components/input-group"

<InputGroup>
  <InputGroupInput placeholder="Search…" />
</InputGroup>
```

---

## Buttons inside inputs use `InputGroup` + `InputGroupButton`/`InputGroupAddon`

Never absolutely position a `Button` over an `Input` with custom math.

**Incorrect:**

```tsx
<div className="relative">
  <Input placeholder="Search…" className="pr-10" />
  <Button className="absolute right-0 top-0" size="icon">
    <Add data-icon="inline-start" />
  </Button>
</div>
```

**Correct:**

```tsx
import { InputGroup, InputGroupInput, InputGroupAddon } from "@hoardodile/ui/components/input-group"

<InputGroup>
  <InputGroupInput placeholder="Search…" />
  <InputGroupAddon>
    <Button size="icon">
      <Add data-icon="inline-start" />
    </Button>
  </InputGroupAddon>
</InputGroup>
```

---

## Field validation and disabled states

Use the semantic state attributes, not restyling: `data-invalid`/`data-disabled`
on the field container, `aria-invalid`/`disabled` on the control.

```tsx
// Invalid.
<FormField name="email" data-invalid render={({ field }) => (
  <FormItem>
    <FormLabel htmlFor="email">Email</FormLabel>
    <FormControl>
      <Input id="email" aria-invalid {...field} />
    </FormControl>
    <FormDescription>Invalid email address.</FormDescription>
  </FormItem>
)} />

// Disabled.
<FormField name="email" data-disabled render={({ field }) => (
  <FormItem>
    <FormLabel htmlFor="email">Email</FormLabel>
    <FormControl>
      <Input id="email" disabled {...field} />
    </FormControl>
  </FormItem>
)} />
```
