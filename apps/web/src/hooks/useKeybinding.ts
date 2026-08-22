import { useEffect } from "react"

export type KeybindingSpec = {
	/** Lowercase `event.key` to match (e.g. `"s"`, `"k"`). */
	readonly key: string
	/** Require `ctrlKey || metaKey` to be set. Default `false`. */
	readonly ctrlOrMeta?: boolean
	/** Require `shiftKey`. Default `false`. */
	readonly shift?: boolean
	/** Require `altKey`. Default `false`. */
	readonly alt?: boolean
}

export type KeybindingHandler = (event: KeyboardEvent) => void

/**
 * Window-scoped keyboard shortcut. Fires `handler` on `keydown` events
 * matching `spec` and pre-empts the browser default (so combinations
 * like `Ctrl+S` don't open the page-save dialog). Pass `enabled=false`
 * to temporarily detach without changing the handler identity.
 */
export function useKeybinding(
	spec: KeybindingSpec,
	handler: KeybindingHandler,
	enabled: boolean = true,
): void {
	useEffect(() => {
		if (!enabled) return
		function onKeyDown(event: KeyboardEvent) {
			if (event.key.toLowerCase() !== spec.key.toLowerCase()) return
			const wantCtrl = spec.ctrlOrMeta === true
			const haveCtrl = event.ctrlKey || event.metaKey
			if (wantCtrl !== haveCtrl) return
			if ((spec.shift === true) !== event.shiftKey) return
			if ((spec.alt === true) !== event.altKey) return
			event.preventDefault()
			handler(event)
		}
		window.addEventListener("keydown", onKeyDown)
		return () => {
			window.removeEventListener("keydown", onKeyDown)
		}
	}, [spec.key, spec.ctrlOrMeta, spec.shift, spec.alt, handler, enabled])
}
