import { cn } from "@hoardodile/ui/lib/utils"
import type { ElementType } from "react"

function Skeleton({
  className,
  element: Element = "div",
  ...props
}: React.ComponentProps<"div"> & { readonly element?: ElementType }) {
  return (
    <Element
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
