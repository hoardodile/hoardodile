import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@hoardodile/ui/lib/utils"

/**
 * Muted-fill textarea (the forms Textarea anatomy): fill background,
 * `rounded-lg`, no border, same anatomy as the inputs. The `size` tiers
 * only shift padding and text; the height stays row-driven.
 */
const textareaVariants = cva(
  "flex field-sizing-content min-h-16 w-full resize-none rounded-lg bg-muted px-3 py-2.5 text-ui text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-[3px] aria-invalid:ring-destructive/20",
  {
    variants: {
      size: {
        sm: "px-2.5 py-2 text-xs",
        md: "px-3 py-2.5",
        lg: "px-3.5 py-3",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

function Textarea({
  className,
  size,
  ...props
}: React.ComponentProps<"textarea"> & VariantProps<typeof textareaVariants>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(textareaVariants({ size }), className)}
      {...props}
    />
  )
}

export { Textarea, textareaVariants }
