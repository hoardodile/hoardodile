import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { useTranslation } from "react-i18next"
import { CharCardSkeleton } from "@/features/char/components/CharCardSkeleton"

/**
 * Section-shaped loading state for the search page: header rows plus
 * per-kind result skeletons, mirroring the loading anatomy.
 */
export function SearchSkeleton() {
	const { t } = useTranslation()
	return (
		<div className="mt-8 flex flex-col gap-8">
			<section>
				<SectionTitleSkeleton />
				<div className="mt-4 flex gap-4 overflow-hidden">
					<CharCardSkeleton />
					<CharCardSkeleton />
					<CharCardSkeleton />
				</div>
			</section>
			<section>
				<SectionTitleSkeleton />
				<div className="mt-4 flex gap-6 overflow-hidden">
					<ResCardSkeleton />
					<ResCardSkeleton />
					<ResCardSkeleton />
				</div>
			</section>
			<section>
				<SectionTitleSkeleton />
				<div className="mt-2">
					<ResultRowSkeleton />
					<ResultRowSkeleton />
					<ResultRowSkeleton />
				</div>
			</section>
			<span className="sr-only">{t("common.loading")}</span>
		</div>
	)
}

function SectionTitleSkeleton() {
	return (
		<div className="flex items-center gap-2">
			<Skeleton className="h-5 w-28" />
			<Skeleton className="h-3.5 w-8" />
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

function ResultRowSkeleton() {
	return (
		<div className="flex gap-3 border-b border-border py-3">
			<Skeleton className="size-10 shrink-0 rounded-lg" />
			<div className="min-w-0 flex-1">
				<Skeleton className="h-4 w-2/3" />
				<Skeleton className="mt-2 h-3 w-full" />
				<Skeleton className="mt-1 h-3 w-4/5" />
			</div>
			<Skeleton className="h-3 w-24 flex-none pt-0.5" />
		</div>
	)
}
