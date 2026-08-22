import type { ReactNode } from "react"

/**
 * Settings sheet — the single floating card that holds a whole settings
 * page. Bare canvas made sections feel unanchored, so all sections of a
 * page live inside one sheet (`rounded-2xl`, hairline, the system's only
 * shadow); siblings separate with full-bleed hairlines instead of floating
 * on the canvas.
 */
export function SettingsSheet({
	children,
	className,
}: {
	readonly children: ReactNode
	readonly className?: string
}) {
	return (
		<div
			className={`rounded-2xl border border-border bg-card p-8 shadow-card ${className ?? ""}`}
		>
			{children}
		</div>
	)
}

/** Full-bleed hairline + air between sibling sections inside a sheet. */
export function SectionDivider() {
	return <div aria-hidden="true" className="my-8 -mx-8 h-px bg-border" />
}
