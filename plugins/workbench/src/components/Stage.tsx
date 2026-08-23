import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@hoardodile/ui/components/empty"
import { Icon } from "@hoardodile/ui/components/icon"
import { Spinner } from "@hoardodile/ui/components/spinner"
import { Box } from "@hoardodile/ui/icons/registry"
import type { RefObject } from "react"
import type { WorkbenchViewport } from "../config.ts"

/**
 * The plugin iframe surface: a centered floating card on the canvas —
 * the design system's one shadowed surface (DESIGN.md — Surfaces). The
 * stage is the page's single scroll container, so an oversized custom
 * viewport scrolls instead of clipping.
 */
export function Stage(props: {
	readonly viewport: WorkbenchViewport
	readonly loading: boolean
	readonly frameRef: RefObject<HTMLDivElement | null>
	readonly emptyTitle?: string
	readonly emptyDescription?: string
}) {
	const { viewport, loading, frameRef, emptyTitle, emptyDescription } = props
	const fill = viewport.width === null || viewport.height === null

	return (
		<main className="min-h-0 flex-1 overflow-auto">
			<div className="flex min-h-full p-8">
				{emptyTitle !== undefined ? (
					<div className="m-auto">
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<Icon icon={Box} />
								</EmptyMedia>
								<EmptyTitle>{emptyTitle}</EmptyTitle>
								{emptyDescription !== undefined ? (
									<EmptyDescription>{emptyDescription}</EmptyDescription>
								) : null}
							</EmptyHeader>
						</Empty>
					</div>
				) : (
					<div
						className={fill ? "w-full flex-1 basis-0 self-stretch" : "m-auto"}
						style={
							fill
								? undefined
								: { width: viewport.width, height: viewport.height }
						}
					>
						<div className="relative h-full w-full overflow-hidden rounded-2xl border border-border bg-card shadow-card">
							{loading ? (
								<div className="absolute inset-0 flex items-center justify-center">
									<Spinner className="size-6 text-muted-foreground" />
								</div>
							) : null}
							<div ref={frameRef} className="absolute inset-0" />
						</div>
					</div>
				)}
			</div>
		</main>
	)
}
