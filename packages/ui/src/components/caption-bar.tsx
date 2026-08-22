"use client"

import { Icon } from "@hoardodile/ui/components/icon"
import { Refresh } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useEffect, useState } from "react"

export type CaptionWindowControls = {
	minimize: () => void
	toggleMaximize: () => void
	close: () => void
	isMaximized: () => Promise<boolean>
	onMaximizedChange: (listener: (maximized: boolean) => void) => () => void
}

export type CaptionBarLabels = {
	readonly back: string
	readonly forward: string
	readonly reload: string
	readonly minimize: string
	readonly maximize: string
	readonly restore: string
	readonly close: string
}

const DEFAULT_LABELS: CaptionBarLabels = {
	back: "Back",
	forward: "Forward",
	reload: "Reload",
	minimize: "Minimize",
	maximize: "Maximize",
	restore: "Restore",
	close: "Close",
}

const captionChromeButtonClassName =
	"flex h-nav w-[46px] items-center justify-center text-secondary-foreground enabled:hover:bg-muted enabled:hover:text-foreground disabled:text-muted-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0"

export type CaptionHistoryControls = {
	readonly canGoBack: boolean
	readonly canGoForward: boolean
	back: () => void
	forward: () => void
	reload: () => void
}

export type CaptionBarProps = {
	readonly controls: CaptionWindowControls
	readonly labels?: Partial<CaptionBarLabels>
	/** Test seam; production uses the window history stack. */
	readonly history?: CaptionHistoryControls
	readonly className?: string
}

/**
 * Frameless-window caption strip (DESIGN.md: 38px `h-nav`). Back / forward
 * / reload on the left; drag region in the middle; Windows caption buttons
 * on the right. Shared by the first-run wizard and the SPA so the two
 * pages cannot drift.
 */
function CaptionBar({
	controls,
	labels,
	history,
	className,
}: CaptionBarProps) {
	const resolved = { ...DEFAULT_LABELS, ...labels }
	const windowHistory = useWindowHistoryControls()
	const nav = history ?? windowHistory
	const [maximized, setMaximized] = useState(false)

	useEffect(() => {
		let cancelled = false
		void controls.isMaximized().then((value) => {
			if (!cancelled) setMaximized(value)
		})
		const unsubscribe = controls.onMaximizedChange(setMaximized)
		return () => {
			cancelled = true
			unsubscribe()
		}
	}, [controls])

	// Chromium may restore focus to the last-focused caption button when
	// the window or session comes back, leaving a stray focus ring on the
	// chrome. Clear focus only when it sits on a caption button — never
	// blur an input the user is typing into. Runs at mount (restored focus
	// may already be present) and again on load (restored afterwards).
	useEffect(() => {
		function clearChromeFocus() {
			const el = document.activeElement
			if (
				el instanceof HTMLElement &&
				el.closest('[data-testid="desktop-caption-bar"]') !== null
			) {
				el.blur()
			}
		}
		clearChromeFocus()
		window.addEventListener("load", clearChromeFocus)
		return () => {
			window.removeEventListener("load", clearChromeFocus)
		}
	}, [])

	return (
		<div
			data-testid="desktop-caption-bar"
			className={cn(
				"flex h-nav shrink-0 select-none items-stretch bg-background text-foreground",
				className
			)}
		>
			<div className="flex shrink-0 [-webkit-app-region:no-drag]">
				<button
					type="button"
					title={resolved.back}
					aria-label={resolved.back}
					data-testid="desktop-caption-back"
					disabled={!nav.canGoBack}
					className={captionChromeButtonClassName}
					onClick={() => {
						nav.back()
					}}
				>
					<ChevronLeftGlyph />
				</button>
				<button
					type="button"
					title={resolved.forward}
					aria-label={resolved.forward}
					data-testid="desktop-caption-forward"
					disabled={!nav.canGoForward}
					className={captionChromeButtonClassName}
					onClick={() => {
						nav.forward()
					}}
				>
					<ChevronRightGlyph />
				</button>
				<button
					type="button"
					title={resolved.reload}
					aria-label={resolved.reload}
					data-testid="desktop-caption-reload"
					className={captionChromeButtonClassName}
					onClick={() => {
						nav.reload()
					}}
				>
					<Icon icon={Refresh} />
				</button>
			</div>
			<div
				data-testid="desktop-caption-drag"
				className="min-w-0 flex-1 [-webkit-app-region:drag]"
			/>
			{/* Double-click toggles maximize natively on Windows drag regions;
			    a JS handler here would double-toggle (native + JS). */}
			<div className="flex shrink-0 [-webkit-app-region:no-drag]">
				<button
					type="button"
					aria-label={resolved.minimize}
					data-testid="desktop-caption-minimize"
					className={captionChromeButtonClassName}
					onClick={() => {
						controls.minimize()
					}}
				>
					<MinimizeGlyph />
				</button>
				<button
					type="button"
					aria-label={maximized ? resolved.restore : resolved.maximize}
					data-testid="desktop-caption-maximize"
					className={captionChromeButtonClassName}
					onClick={() => {
						controls.toggleMaximize()
					}}
				>
					{maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
				</button>
				<button
					type="button"
					aria-label={resolved.close}
					data-testid="desktop-caption-close"
					className="flex h-nav w-[46px] items-center justify-center text-secondary-foreground hover:bg-[#c42b1c] hover:text-white"
					onClick={() => {
						controls.close()
					}}
				>
					<CloseGlyph />
				</button>
			</div>
		</div>
	)
}

type WindowNavigationSource = {
	readonly canGoBack: boolean
	readonly canGoForward: boolean
	addEventListener: (type: string, listener: () => void) => void
	removeEventListener: (type: string, listener: () => void) => void
}

function isWindowNavigationSource(
	value: unknown,
): value is WindowNavigationSource {
	if (typeof value !== "object" || value === null) return false
	if (!("canGoBack" in value) || typeof value.canGoBack !== "boolean") {
		return false
	}
	if (!("canGoForward" in value) || typeof value.canGoForward !== "boolean") {
		return false
	}
	if (
		!("addEventListener" in value) ||
		typeof value.addEventListener !== "function"
	) {
		return false
	}
	if (
		!("removeEventListener" in value) ||
		typeof value.removeEventListener !== "function"
	) {
		return false
	}
	return true
}

function readWindowNavigation(): WindowNavigationSource | undefined {
	if (typeof window === "undefined") return undefined
	const value = Reflect.get(window, "navigation")
	return isWindowNavigationSource(value) ? value : undefined
}

function useWindowHistoryControls(): CaptionHistoryControls {
	const [canGoBack, setCanGoBack] = useState(false)
	const [canGoForward, setCanGoForward] = useState(false)

	useEffect(() => {
		function sync() {
			const source = readWindowNavigation()
			if (source !== undefined) {
				setCanGoBack(source.canGoBack)
				setCanGoForward(source.canGoForward)
				return
			}
			setCanGoBack(window.history.length > 1)
			setCanGoForward(false)
		}

		sync()
		const source = readWindowNavigation()
		if (source !== undefined) {
			source.addEventListener("currententrychange", sync)
			return () => {
				source.removeEventListener("currententrychange", sync)
			}
		}
		window.addEventListener("popstate", sync)
		return () => {
			window.removeEventListener("popstate", sync)
		}
	}, [])

	// Plain browser reload. The app's own first frame (index.html splash)
	// covers the pre-paint gap, so routing this through the desktop shell
	// would only add unnecessary hops.
	function reload() {
		window.location.reload()
	}

	return {
		canGoBack,
		canGoForward,
		back() {
			window.history.back()
		},
		forward() {
			window.history.forward()
		},
		reload,
	}
}

function ChevronLeftGlyph() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M10 3.5L5 8l5 4.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
			/>
		</svg>
	)
}

function ChevronRightGlyph() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M6 3.5L11 8l-5 4.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
			/>
		</svg>
	)
}

function MinimizeGlyph() {
	return (
		<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
			<path d="M0 5h10" fill="none" stroke="currentColor" strokeWidth="1" />
		</svg>
	)
}

function MaximizeGlyph() {
	return (
		<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
			<rect
				x="0.5"
				y="0.5"
				width="9"
				height="9"
				fill="none"
				stroke="currentColor"
				strokeWidth="1"
			/>
		</svg>
	)
}

function RestoreGlyph() {
	return (
		<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
			<rect
				x="2.5"
				y="0.5"
				width="7"
				height="7"
				fill="none"
				stroke="currentColor"
				strokeWidth="1"
			/>
			<path
				d="M0.5 2.5h7v7h-7z"
				fill="none"
				stroke="currentColor"
				strokeWidth="1"
			/>
		</svg>
	)
}

function CloseGlyph() {
	return (
		<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
			<path
				d="M1 1l8 8M9 1L1 9"
				fill="none"
				stroke="currentColor"
				strokeWidth="1"
			/>
		</svg>
	)
}

export { CaptionBar }
