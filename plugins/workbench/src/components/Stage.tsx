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
import { cn } from "@hoardodile/ui/lib/utils"
import type { RefObject } from "react"
import type { WorkbenchPresentationMode } from "../config.ts"

/**
 * The plugin iframe surface. The frame container (`frameRef`) stays at a
 * stable tree position across presentation modes so switching modes never
 * remounts the plugin — only the ancestor chrome changes:
 *
 * - `bare` — the plugin fills the whole stage edge-to-edge (no padding, no
 *   rounded corners, no card border/shadow).
 * - `desktop` — the app-preview card: a centered padded card filling the
 *   stage (`rounded-2xl` + hairline + `shadow-card`).
 * - `mobile` — a phone-width (375px) card, centered.
 *
 * The stage is the page's single scroll container for the card modes, so an
 * oversized viewport scrolls instead of clipping.
 */
export function Stage(props: {
	readonly mode: WorkbenchPresentationMode
	readonly loading: boolean
	readonly frameRef: RefObject<HTMLDivElement | null>
	readonly emptyTitle?: string
	readonly emptyDescription?: string
}) {
	const { mode, loading, frameRef, emptyTitle, emptyDescription } = props
	const bare = mode === "bare"
	const cardSurface = bare
		? "absolute inset-0"
		: mode === "mobile"
			? "m-auto h-[667px] w-[375px] max-w-full rounded-2xl border border-border bg-card shadow-card"
			: "w-full flex-1 basis-0 self-stretch rounded-2xl border border-border bg-card shadow-card"

	return (
		<main
			className={cn(
				"relative min-h-0 flex-1",
				bare ? "overflow-hidden" : "overflow-auto",
			)}
		>
			{emptyTitle !== undefined ? (
				<div className="flex min-h-full p-8">
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
				</div>
			) : (
				<div className={cn("flex min-h-full", !bare && "p-8")}>
					<div className={cn("relative overflow-hidden", cardSurface)}>
						{loading ? (
							<div className="absolute inset-0 flex items-center justify-center">
								<Spinner className="size-6 text-muted-foreground" />
							</div>
						) : null}
						<div ref={frameRef} className="absolute inset-0" />
					</div>
				</div>
			)}
		</main>
	)
}
