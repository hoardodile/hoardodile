export type UseActiveGateOptions = {
	readonly enabled?: boolean
	readonly active?: boolean
	/** When true, tracking is paused (user idle). */
	readonly idle?: boolean
}

/**
 * Combine caller-level gates (page open, dialog open, iframe visible, …)
 * into a single tracking flag.
 */
export function useActiveGate(options: UseActiveGateOptions): boolean {
	const enabled = options.enabled ?? true
	const active = options.active ?? true
	const idle = options.idle ?? false
	return enabled && active && !idle
}
