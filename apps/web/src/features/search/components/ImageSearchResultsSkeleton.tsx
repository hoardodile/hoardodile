import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { useTranslation } from "react-i18next"

/** Loading state for the image-search results view. */
export function ImageSearchResultsSkeleton() {
	const { t } = useTranslation()
	return (
		<div className="mt-8 flex flex-col gap-8">
			<section>
				<div className="flex items-center gap-2">
					<Skeleton className="h-5 w-28" />
					<Skeleton className="h-3.5 w-8" />
				</div>
				<div className="mt-4 flex gap-6 overflow-hidden">
					<ResCardSkeleton />
					<ResCardSkeleton />
					<ResCardSkeleton />
				</div>
			</section>
			<span className="sr-only">{t("common.loading")}</span>
		</div>
	)
}

function ResCardSkeleton() {
	return (
		<div className="flex w-50 shrink-0 flex-col gap-2">
			<Skeleton className="aspect-square w-full rounded-xl" />
			<Skeleton className="h-4 w-3/4" />
			<div className="flex gap-1.5">
				<Skeleton className="h-4.5 w-14 rounded-full" />
				<Skeleton className="h-4.5 w-18 rounded-full" />
			</div>
			<div className="flex justify-between">
				<Skeleton className="h-2.5 w-14" />
				<Skeleton className="h-2.5 w-24" />
			</div>
		</div>
	)
}
