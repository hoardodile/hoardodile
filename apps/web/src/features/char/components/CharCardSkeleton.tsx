import { Skeleton } from "@hoardodile/ui/components/skeleton"

export function CharCardSkeleton() {
	return (
		<div className="flex w-50 flex-col gap-2">
			<Skeleton className="aspect-square w-full rounded-xl" />
			<Skeleton className="h-5 w-3/4" />
			<div className="flex flex-wrap gap-1.5">
				<Skeleton className="h-5 w-14 rounded-full" />
				<Skeleton className="h-5 w-18 rounded-full" />
			</div>
			<Skeleton className="ml-auto h-3 w-1/2" />
		</div>
	)
}
