import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { Surface } from "@hoardodile/ui/components/surface"
import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"
import { PageHeader } from "./page-header"

/** Content widths (DESIGN.md — Layout): the three fixed measures
    index/detail pages are held to, centered beyond them. The measure is
    the content width — padding never counts toward it (DESIGN.md),
    so it lives on the outer wrapper, not on the measure element. Desktop
    padding is `px-10 pt-10 pb-16`; mobile
    and tablet keep their own tighter gutters. */
export type PageScaffoldWidth = "reading" | "medium" | "content"

const widthClasses: Record<PageScaffoldWidth, string> = {
	reading: "max-w-reading",
	medium: "max-w-medium",
	content: "max-w-content",
}

type PageScaffoldProps = {
	readonly children: ReactNode
	/** Center the page at one of the three content measures; omitted when
	    the page's own component owns the measure. */
	readonly width?: PageScaffoldWidth
	/** Drop the desktop bottom padding — pages ending in a sticky ActionBar. */
	readonly bottomPad?: boolean
	readonly className?: string
}

function frameClassName(props: PageScaffoldProps) {
	return cn(
		"pb-4 pt-2 px-3 md:px-4 md:pt-4.5 lg:px-10",
		props.bottomPad !== false && "lg:pb-16",
		props.className,
	)
}

export function PageScaffold(props: PageScaffoldProps) {
	if (props.width === undefined) {
		return (
			<div className={cn("flex w-full flex-col", frameClassName(props))}>
				{props.children}
			</div>
		)
	}

	return (
		<div className={frameClassName(props)}>
			<div
				className={cn(
					"mx-auto flex w-full flex-col",
					widthClasses[props.width],
				)}
			>
				{props.children}
			</div>
		</div>
	)
}

type SurfaceProps = {
	readonly children: ReactNode
	readonly className?: string
}

export function FlatSurface(props: SurfaceProps) {
	return (
		<Surface as="section" size="compact" className={props.className}>
			{props.children}
		</Surface>
	)
}

type PillProps = {
	readonly children: ReactNode
	readonly tone?: "primary" | "secondary" | "accent" | "muted"
	readonly className?: string
}

export function InfoPill(props: PillProps) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-md px-2 py-1 text-xs font-medium",
				pillToneClassName(props.tone),
				props.className,
			)}
		>
			{props.children}
		</span>
	)
}

export function RoutePendingFallback() {
	return (
		<PageScaffold>
			<PageHeader
				title={
					// Span elements: the header wraps title in h1 and description
					// in p, and a block div inside either is invalid HTML.
					<Skeleton element="span" className="block h-8 w-64 max-w-full" />
				}
				description={
					<Skeleton element="span" className="block h-4 w-full max-w-lg" />
				}
			/>
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				<Skeleton className="h-32 rounded-lg" />
				<Skeleton className="h-32 rounded-lg" />
				<Skeleton className="h-32 rounded-lg md:col-span-2 xl:col-span-1" />
			</div>
		</PageScaffold>
	)
}

function pillToneClassName(tone: PillProps["tone"]) {
	if (tone === "primary") {
		return "bg-primary/10 text-primary"
	}

	if (tone === "secondary") {
		return "bg-secondary text-secondary-foreground"
	}

	if (tone === "accent") {
		return "bg-accent text-accent-foreground"
	}

	return "bg-muted text-muted-foreground"
}
