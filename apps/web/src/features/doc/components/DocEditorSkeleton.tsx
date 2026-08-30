import { Skeleton } from "@hoardodile/ui/components/skeleton"

/**
 * Content-shaped loading placeholder for the document body. It reserves the
 * editor column's reading-measure space (the ancestor wrapper already applies
 * `--doc-reading-width`), so the sticky detail header and title paint over a
 * recognizable skeleton instead of a blank void while the lazy BlockNote
 * editor chunk loads. The lines use `bg-foreground/20` because the default
 * `bg-muted` blends into the themed document backgrounds (Sage / Parchment /
 * Hoardodile).
 */
export function DocEditorSkeleton() {
	return (
		<div
			role="status"
			aria-label="Loading document"
			data-testid="document-editor-skeleton"
			className="flex min-h-[50svh] w-full flex-col pb-6"
		>
			<div aria-hidden="true" className="flex flex-col gap-3">
				<Skeleton className="h-5 w-2/5 bg-foreground/20" />
				<Skeleton className="h-4 w-full bg-foreground/20" />
				<Skeleton className="h-4 w-[92%] bg-foreground/20" />
				<Skeleton className="h-4 w-[76%] bg-foreground/20" />
				<Skeleton className="h-4 w-full bg-foreground/20" />
				<Skeleton className="h-4 w-[64%] bg-foreground/20" />
				<Skeleton className="h-4 w-[82%] bg-foreground/20" />
				<Skeleton className="h-4 w-[70%] bg-foreground/20" />
			</div>
		</div>
	)
}
