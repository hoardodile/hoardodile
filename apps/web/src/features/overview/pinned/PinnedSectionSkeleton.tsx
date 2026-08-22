import { Icon } from "@hoardodile/ui/components/icon"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { Pin } from "@hoardodile/ui/icons/registry"
import type { ReactNode } from "react"
import { OverviewSectionCard } from "../components/OverviewSectionCard"

export function PinnedSectionSkeleton({
	children,
	"data-testid": testId,
}: {
	readonly children: ReactNode
	readonly "data-testid"?: string
}) {
	return (
		<OverviewSectionCard
			className="min-w-0"
			title={
				<div className="flex items-center gap-2">
					<Icon icon={Pin} className="text-primary" />
					<Skeleton className="h-4 w-24" />
				</div>
			}
			data-testid={testId}
		>
			{children}
		</OverviewSectionCard>
	)
}
