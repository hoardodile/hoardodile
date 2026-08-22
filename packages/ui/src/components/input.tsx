import { Input as InputPrimitive } from "@base-ui/react/input"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@hoardodile/ui/lib/utils"

/**
 * Muted-fill control (the ControlStub / forms anatomy): fill background,
 * `rounded-lg`, no border — the same anatomy as the search field. Three
 * height tiers ride the control tokens: `sm` h-chip, `md` h-control,
 * `lg` h-10.
 */
const inputVariants = cva(
  "w-full min-w-0 rounded-lg bg-muted text-ui text-foreground outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-[3px] aria-invalid:ring-destructive/20",
  {
    variants: {
      size: {
        sm: "h-chip px-2.5 text-xs",
        md: "h-control px-3",
        lg: "h-10 px-3.5",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

function Input({
  className,
  size,
  type,
  ...props
}: Omit<React.ComponentProps<"input">, "size"> &
  VariantProps<typeof inputVariants>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(inputVariants({ size }), className)}
      {...props}
    />
  )
}

export { Input, inputVariants }
