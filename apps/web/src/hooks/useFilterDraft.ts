import { isEqual } from "es-toolkit"
import { useCallback, useState } from "react"

function pick<T extends object>(source: T, keys: readonly (keyof T)[]): T {
	const next = {} as T
	for (const key of keys) next[key] = source[key]
	return next
}

export type FilterDraft<T extends object> = {
	readonly draft: T
	/** Stage a partial change (like `patchState`, but local only). */
	readonly change: (partial: Partial<T>) => void
	/** Whether the draft holds staged edits not yet applied to the URL. */
	readonly hasChanges: boolean
	/** Apply the staged draft via the caller's writer (page resets to 1). */
	readonly apply: () => void
	/** Reset the draft to the defaults AND apply them immediately. */
	readonly clear: () => void
}

/**
 * Apply-on-demand staging for the filter rail. The draft holds exactly
 * the filter keys of {@link applied} (the URL-backed state): rail edits
 * only touch the draft, and {@link FilterDraft.apply} writes the whole
 * draft (page 1) through the caller's `patchState`.
 *
 * The draft re-syncs from `applied` whenever it holds no pending edits,
 * so external navigations (pinned links, back/forward) reset the rail;
 * staged edits survive until applied or cleared.
 */
export function useFilterDraft<T extends object>(
	applied: T,
	keys: readonly (keyof T)[],
	defaults: T,
	applyDraft: (draft: T) => void,
): FilterDraft<T> {
	const [draft, setDraft] = useState<T>(() => pick(applied, keys))
	const [appliedAtSync, setAppliedAtSync] = useState<T>(() =>
		pick(applied, keys),
	)

	if (!isEqual(pick(applied, keys), appliedAtSync)) {
		// Applied changed. If the draft has no pending edits it was tracking
		// the old applied state, so re-seed it from the new one; otherwise
		// keep the staged edits.
		if (isEqual(draft, appliedAtSync)) {
			const next = pick(applied, keys)
			setDraft(next)
		}
		setAppliedAtSync(pick(applied, keys))
	}

	const change = useCallback((partial: Partial<T>) => {
		setDraft((prev) => ({ ...prev, ...partial }))
	}, [])

	const hasChanges = !isEqual(draft, appliedAtSync)

	const apply = useCallback(() => {
		applyDraft(draft)
	}, [applyDraft, draft])

	const clear = useCallback(() => {
		applyDraft(defaults)
	}, [applyDraft, defaults])

	return { draft, change, hasChanges, apply, clear }
}
