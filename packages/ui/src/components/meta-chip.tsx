import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"

export type MetaChipProps = {
	/** muted: quiet gray chip (default); inverse: foreground on background;
	    bordered: outline-only state marker. */
	readonly tone?: "muted" | "inverse" | "bordered"
	readonly className?: string
	readonly children: ReactNode
}

/**
 * Meta chip — the tiny rounded-sm text-tiny state marker worn next to
 * names, versions, deltas and list rows across the app.
 */
export function MetaChip(props: MetaChipProps) {
	return (
		<span
			className={cn(
				"shrink-0 rounded-sm px-1.5 py-0.5 text-tiny leading-none",
				chipToneClassName(props.tone),
				props.className,
			)}
		>
			{props.children}
		</span>
	)
}

function chipToneClassName(tone: MetaChipProps["tone"]) {
	if (tone === "inverse") {
		return "bg-foreground text-background"
	}

	if (tone === "bordered") {
		return "border border-border-strong text-muted-foreground"
	}

	return "bg-muted text-secondary-foreground"
}
