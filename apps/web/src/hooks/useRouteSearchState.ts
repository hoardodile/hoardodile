import { useLocation, useNavigate } from "@tanstack/react-router"
import { useCallback, useState } from "react"

export type UrlPatchOptions = {
	/**
	 * When `true`, push a new history entry instead of replacing the current
	 * one. Use for user-initiated navigations (e.g. pagination) so browser
	 * back/forward steps through page changes.
	 */
	readonly push?: boolean
}

export type SetPatch<T extends Record<string, unknown>> = (
	patch: Partial<T>,
	options?: UrlPatchOptions,
) => void

/**
 * Mirror the closest matched route's search params into a typed state
 * tuple. Writes go through `navigate(replace)` by default; pass
 * `{ push: true }` to push a new history entry instead.
 *
 * Use at the call site for surfaces that are mounted as a route (e.g.
 * `/resources`, `/characters`) so a hard refresh restores the same view.
 * For the same component hosted inside a dialog, use
 * {@link useLocalPatchState} instead.
 */
export function useRouteSearchState<T extends Record<string, unknown>>(
	defaults: T,
): [T, SetPatch<T>] {
	const location = useLocation()
	const navigate = useNavigate()
	// Router search is structurally typed by the matched route; at this
	// generic boundary we trust the caller's `defaults` shape and fill
	// missing keys. A schema validator would force every caller to pass
	// one, which is heavier than the safety it would buy here.
	const merged: T = {
		...defaults,
		...(typeof location.search === "object" && location.search !== null
			? location.search
			: {}),
	}
	const patch = useCallback(
		function patchFn(partial: Partial<T>, options?: UrlPatchOptions) {
			navigate({
				to: ".",
				search: function mergeSearch(
					prev: Record<string, unknown> | undefined,
				) {
					return { ...(prev ?? {}), ...partial }
				},
				replace: options?.push !== true,
				resetScroll: false,
			})
		},
		[navigate],
	)
	return [merged, patch]
}

/**
 * Companion to {@link useRouteSearchState} for surfaces hosted inside
 * dialogs/popovers where URL state is inappropriate. Returns the same
 * `[state, patch]` tuple shape so consumers can be agnostic about the
 * backing strategy. The `push` option on the setter is accepted but
 * ignored — local state has no history semantics.
 */
export function useLocalPatchState<T extends Record<string, unknown>>(
	defaults: T,
): [T, SetPatch<T>] {
	const [state, setState] = useState<T>(defaults)
	const patch = useCallback(function patchFn(partial: Partial<T>) {
		setState(function applyPatch(prev) {
			return { ...prev, ...partial }
		})
	}, [])
	return [state, patch]
}
