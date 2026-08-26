/**
 * Boot splash gate: keep the in-document spinner (index.html `#app-splash`,
 * visually identical to the desktop loading page) until the initial route
 * has resolved AND the queries running under it have data. The first
 * visible frame is then the finished page — the desktop tray reopen (and
 * any cold load) never flashes the route-pending or section skeletons.
 * A deadline makes removal unconditional so a hung query can never leave
 * the spinner up forever.
 */

export const BOOT_SPLASH_DEADLINE_MS = 1500

export type BootSplashDeps = {
	readonly router: {
		readonly subscribe: (
			event: "onResolved",
			callback: () => void,
		) => () => void
	}
	readonly queryClient: {
		readonly getQueryCache: () => {
			readonly subscribe: (listener: () => void) => () => void
			readonly getAll: () => readonly {
				readonly state: { readonly fetchStatus: string }
			}[]
		}
	}
	readonly remove: () => void
	readonly deadlineMs?: number
}

export function holdSplashUntilReady(deps: BootSplashDeps): void {
	const { router, queryClient, remove } = deps
	const deadlineMs = deps.deadlineMs ?? BOOT_SPLASH_DEADLINE_MS
	let resolved = false
	let done = false

	function isQuiescent(): boolean {
		// `fetchStatus` (not the derived `isFetching`): a paused query (offline)
		// must not hold the splash either — the deadline is the last resort.
		return !queryClient
			.getQueryCache()
			.getAll()
			.some((query) => query.state.fetchStatus === "fetching")
	}

	function unsubscribeAll(): void {
		routerReleaser()
		cacheReleaser()
	}

	function finish(): void {
		if (done) return
		done = true
		unsubscribeAll()
		remove()
	}

	function maybeFinish(): void {
		if (resolved && isQuiescent()) finish()
	}

	const routerReleaser = router.subscribe("onResolved", () => {
		resolved = true
		maybeFinish()
	})
	const cacheReleaser = queryClient.getQueryCache().subscribe(() => {
		if (resolved) maybeFinish()
	})

	// Safety net: never hold the first frame hostage to a hanging query.
	setTimeout(finish, deadlineMs)
}
