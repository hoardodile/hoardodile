import type { AnchorHTMLAttributes, MouseEvent } from "react"
import { getDesktopBridge } from "@/lib/desktop"

/**
 * Open a URL outside the app. Desktop: routed through the shell, which
 * accepts http(s) and opens the OS browser. Browser: new tab, same effect
 * as a new-tab anchor.
 */
export function openExternalUrl(url: string): void {
	const absolute = absolutizeUrl(url)
	const desktop = getDesktopBridge()
	if (desktop !== undefined) {
		desktop.openExternal(absolute)
		return
	}
	window.open(absolute, "_blank", "noopener,noreferrer")
}

/** Relative URLs resolve against the app origin; absolute ones pass through. */
function absolutizeUrl(url: string): string {
	try {
		return new URL(url, window.location.href).toString()
	} catch {
		return url
	}
}

export type ExternalLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
	readonly href: string
}

/**
 * The one sanctioned way to link outside the SPA — external sites and
 * non-app same-origin pages like `/LICENSE`. Keeps `<a>` semantics
 * (hover, context menu, keyboard, middle click) but routes the click
 * through {@link openExternalUrl} instead of letting a navigation replace
 * the app. The desktop shell's navigation policy is the backstop for any
 * link that bypasses this (e.g. JS-driven navigation).
 */
export function ExternalLink(props: ExternalLinkProps) {
	const { href, onClick, children, ...rest } = props
	return (
		<a
			{...rest}
			href={href}
			rel="noopener noreferrer"
			onClick={(event: MouseEvent<HTMLAnchorElement>) => {
				onClick?.(event)
				event.preventDefault()
				openExternalUrl(href)
			}}
		>
			{children}
		</a>
	)
}
