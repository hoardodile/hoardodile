import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"

import { cn } from "@hoardodile/ui/lib/utils"

export type SeparatorSize = "hairline" | "seam"

/**
 * Horizontal/vertical divider: hairlines are 1px and quiet; the 2px
 * `seam` tier marks only structural seams (tab bars, panel sections,
 * pinned action bars).
 */
function Separator({
  className,
  orientation = "horizontal",
  size = "hairline",
  ...props
}: SeparatorPrimitive.Props & {
  readonly size?: SeparatorSize
}) {
  const thickness =
    size === "seam"
      ? "data-horizontal:h-0.5 data-vertical:w-0.5"
      : "data-horizontal:h-px data-vertical:w-px"
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:w-full data-vertical:self-stretch",
        thickness,
        className
      )}
      {...props}
    />
  )
}

export { Separator }
