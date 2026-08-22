import { type ComponentType, createElement, useSyncExternalStore } from "react"
import type { IconType } from "../components/icon.tsx"

/**
 * Icon-mode-aware glyph wrapper (Settings → Icons in the host app).
 *
 * The active icon style lives as `data-icon-style` on `document.documentElement`
 * — the host app writes it from its preference store, plugin iframes receive
 * it through the `themeChanged` push — so this module needs no context or
 * injected state: a single shared `MutationObserver` watches the attribute
 * and every wrapped component re-renders through `useSyncExternalStore`
 * when it flips.
 *
 * Only `linear` needs a component swap: the boldDuotone glyphs change to
 * their thin-line linear counterparts. `grayscale` is pure CSS (theme.css
 * recolors the `.hd-icon` hook), so the store only tracks the mode.
 */
export type IconStyleValue = "duotone" | "grayscale" | "linear"

/**
 * The parallel Solar weights an icon registers — named after Solar's own
 * weights (DESIGN.md — Iconography). Every icon carries all of them;
 * adding a mode here forces every registry entry to fill it in.
 */
export type IconMode = "bold" | "boldDuotone" | "linear"

/** All three mode glyphs of one icon. Mandatory and complete by type. */
export type IconVariants = Record<IconMode, IconType>

function readIconMode(): IconMode {
	return document.documentElement.dataset.iconStyle === "linear"
		? "linear"
		: "boldDuotone"
}

// Never read `document` at module load — pure-logic consumers (node test
// environments) import this module without a DOM. The first subscribe
// (component mount) snapshots the current value.
let currentMode: IconMode = "boldDuotone"
let observer: MutationObserver | undefined
const listeners = new Set<() => void>()

function ensureObserver(): void {
	if (observer !== undefined || typeof document === "undefined") return
	observer = new MutationObserver(() => {
		const next = readIconMode()
		if (next === currentMode) return
		currentMode = next
		for (const cb of listeners) cb()
	})
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-icon-style"],
	})
}

function subscribeIconStyle(callback: () => void): () => void {
	ensureObserver()
	currentMode = readIconMode()
	listeners.add(callback)
	return () => {
		listeners.delete(callback)
	}
}

function getIconStyleSnapshot(): IconMode {
	return currentMode
}

/**
 * Wraps a Solar glyph family so its render follows the host's icon style.
 *
 * `createIcon({ bold, boldDuotone, linear })` — the three parallel weights
 * of one icon. Without a `mode` prop the wrapper renders the glyph for the
 * active icon style; an explicit `mode` overrides it (selected states pass
 * `"bold"` through `Icon`).
 *
 * Every wrapped render merges the `hd-icon` hook class, so the duotone /
 * grayscale CSS in theme.css applies to direct renders too. Returns
 * `undefined`-free components callable through the `Icon` wrapper or bare
 * JSX alike.
 */
export function createIcon(
	variants: IconVariants,
): ComponentType<Record<string, unknown>> {
	function Icon(props: Record<string, unknown>) {
		const current = useSyncExternalStore(
			subscribeIconStyle,
			getIconStyleSnapshot,
			() => "boldDuotone",
		)
		const { mode, ...rest } = props as { readonly mode?: IconMode } & Record<
			string,
			unknown
		>
		const Component = variants[(mode ?? current) as IconMode]
		const className =
			typeof rest.className === "string"
				? `hd-icon ${rest.className}`
				: "hd-icon"
		return createElement(Component, { ...rest, className })
	}
	return Icon
}
