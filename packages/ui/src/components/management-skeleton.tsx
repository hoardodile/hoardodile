import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { Surface } from "@hoardodile/ui/components/surface"

export type ManagementSkeletonProps = {
	readonly chipCount?: number
}

/**
 * Loading placeholder for a chip-based management panel.
 */
export function ManagementSkeleton(props: ManagementSkeletonProps) {
	const chipCount = props.chipCount ?? 2
	return (
		<Surface as="section" size="compact" className="space-y-3">
			<Skeleton className="h-4 w-28" />
			<div className="flex flex-wrap gap-1.5">
				{Array.from({ length: chipCount }).map((_, i) => (
					<Skeleton key={i} className="h-8 w-24 rounded-md" />
				))}
			</div>
		</Surface>
	)
}
