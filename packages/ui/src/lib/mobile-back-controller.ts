import {
	createMobileBackStack,
	type MobileBackRegistry,
} from "./mobile-back-stack"

export const MOBILE_BACK_KEY = "__hoardodileMobileBack"

export type BackLocation = { readonly href: string; readonly state: unknown }
export type BackAction = "PUSH" | "REPLACE" | "BACK" | "FORWARD" | "GO"
export type BackNavigation = {
	readonly location: BackLocation
	readonly action: BackAction
	readonly delta: number
}
export type BackDriver = {
	readonly read: () => BackLocation
	readonly push: (location: BackLocation) => void
	readonly replace: (location: BackLocation) => void
	readonly go: (delta: number) => void
	readonly listen: (listener: () => void) => () => void
}
type Route = BackLocation & {
	readonly id: string
	readonly base: number
	readonly revision: number
}
type Mark = {
	readonly version: 1
	readonly session: string
	readonly position: number
	readonly route: Route
	readonly overlays: readonly string[]
}
type Cursor = {
	readonly location: BackLocation
	readonly mark: Mark | undefined
}
type RouteWrite = {
	readonly location: BackLocation
	readonly replace: boolean
	readonly complete: () => void
}

export type MobileBackController = MobileBackRegistry & {
	readonly setEnabled: (enabled: boolean) => void
	readonly navigate: (
		location: BackLocation,
		replace: boolean,
		complete?: () => void,
	) => void
	readonly go: (delta: number, ignoreBlocker?: boolean) => void
	readonly subscribe: (listener: (event: BackNavigation) => void) => () => void
	readonly setBlocker: (
		blocker:
			| ((event: BackNavigation) => boolean | Promise<boolean>)
			| undefined,
	) => void
	readonly flush: () => void
	readonly dispose: () => void
	readonly location: BackLocation
	readonly snapshot: {
		readonly overlays: readonly string[]
		readonly pending: boolean
		readonly registrations: number
	}
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

function readMark(state: unknown): Mark | undefined {
	if (!record(state)) return
	const value = state[MOBILE_BACK_KEY]
	if (
		!record(value) ||
		value.version !== 1 ||
		typeof value.session !== "string" ||
		!Number.isSafeInteger(value.position) ||
		typeof value.position !== "number" ||
		value.position < 0 ||
		!record(value.route) ||
		typeof value.route.id !== "string" ||
		typeof value.route.href !== "string" ||
		typeof value.route.base !== "number" ||
		!Number.isSafeInteger(value.route.base) ||
		value.route.base < 0 ||
		value.route.base > value.position ||
		!Array.isArray(value.overlays) ||
		!value.overlays.every((id) => typeof id === "string")
	)
		return
	return {
		version: 1,
		session: value.session,
		position: value.position,
		route: {
			id: value.route.id,
			base: value.route.base,
			revision:
				typeof value.route.revision === "number" ? value.route.revision : 0,
			href: value.route.href,
			state: value.route.state,
		},
		overlays: value.overlays,
	}
}

function withMark(mark: Mark): BackLocation {
	return {
		href: mark.route.href,
		state: {
			...(record(mark.route.state) ? mark.route.state : {}),
			[MOBILE_BACK_KEY]: mark,
		},
	}
}

function sameTokens(a: readonly string[], b: readonly string[]) {
	return a.length === b.length && a.every((token, i) => token === b[i])
}

/**
 * One owner of physical history. React and the router submit intent; only this
 * controller writes/traverses. Internal traversals match a destination identity,
 * never an event counter or a timing guess about a router flush.
 */
export function createMobileBackController(options: {
	readonly driver: BackDriver
	readonly enabled?: boolean
	readonly schedule?: (callback: () => void) => void
	readonly onError?: (error: unknown) => void
}): MobileBackController {
	const { driver } = options
	const schedule = options.schedule ?? queueMicrotask
	const stack = createMobileBackStack()
	const subscribers = new Set<(event: BackNavigation) => void>()
	const known = new Map<number, Mark>()
	const instance = Math.random().toString(36).slice(2)
	const session = readMark(driver.read().state)?.session ?? instance
	let nextId = 0
	let enabled = options.enabled ?? false
	let disposed = false
	let scheduled = false
	let failed = false
	let epoch = 0
	let blocker:
		| ((event: BackNavigation) => boolean | Promise<boolean>)
		| undefined
	let deciding = false
	let ignoreTraversal:
		| { readonly session: string; readonly position: number }
		| undefined
	let pending:
		| {
				readonly position: number
				readonly session: string
				readonly done: () => void
		  }
		| undefined
	const writes: RouteWrite[] = []
	let cursor = read()
	let route = cursor.mark?.route ?? newRoute(cursor.location, 0)

	function newRoute(location: BackLocation, base: number): Route {
		return {
			...location,
			id: `${instance}:route:${++nextId}`,
			base,
			revision: 0,
		}
	}
	function read(): Cursor {
		const location = driver.read()
		const mark = readMark(location.state)
		// Native hash navigation can copy state into a new URL. It is a real
		// location change, not a duplicate delivery of an overlay traversal.
		return {
			location,
			mark: mark?.route.href === location.href ? mark : undefined,
		}
	}
	function remember(mark: Mark) {
		known.set(mark.position, mark)
	}
	if (cursor.mark !== undefined) remember(cursor.mark)

	function report(error: unknown) {
		failed = true
		pending = undefined
		if (writes.length > 0) {
			writes.length = 0
			notify({ location: route, action: "REPLACE", delta: 0 })
		}
		options.onError?.(error)
	}
	function write(mark: Mark, push: boolean) {
		try {
			const location = withMark(mark)
			if (push) {
				driver.push(location)
				for (const position of known.keys())
					if (position >= mark.position) known.delete(position)
			} else driver.replace(location)
			cursor = { location, mark }
			remember(mark)
			return true
		} catch (error) {
			report(error)
			return false
		}
	}
	function markRoute() {
		if (cursor.mark !== undefined) return true
		route = newRoute(cursor.location, 0)
		known.clear()
		return write(
			{ version: 1, session, position: 0, route, overlays: [] },
			false,
		)
	}
	function later() {
		if (scheduled || disposed) return
		scheduled = true
		schedule(() => {
			scheduled = false
			reconcile()
		})
	}
	function travel(position: number, done: () => void) {
		const mark = cursor.mark
		if (mark === undefined || position === mark.position) {
			done()
			return
		}
		pending = { position, session: mark.session, done }
		try {
			driver.go(position - mark.position)
		} catch (error) {
			report(error)
		}
	}
	function notify(event: BackNavigation) {
		for (const listener of subscribers) listener(event)
	}

	function reconcile() {
		if (disposed || failed || pending !== undefined || deciding) return
		const tokens = stack.tokens()
		const desired = enabled ? tokens : []
		const next = writes[0]
		if (next !== undefined) {
			if (cursor.mark !== undefined && cursor.mark.position !== route.base) {
				travel(route.base, later)
				return
			}
			const position = (cursor.mark?.position ?? 0) + (next.replace ? 0 : 1)
			const targetRoute = next.replace
				? {
						...next.location,
						id: route.id,
						base: position,
						revision: route.revision + 1,
					}
				: newRoute(next.location, position)
			const mark: Mark = {
				version: 1,
				session,
				position,
				route: targetRoute,
				overlays: [],
			}
			if (!write(mark, !next.replace)) return
			route = targetRoute
			writes.shift()
			next.complete()
			later()
			return
		}
		if (cursor.mark === undefined && desired.length === 0) return
		if (!markRoute()) return
		const mark = cursor.mark
		if (mark === undefined) return
		if (sameTokens(mark.overlays, desired)) return

		// Closed lower layers can remain physically below a live upper layer.
		// Update the current snapshot; traversing these tombstones later is
		// directional and does not consume another close callback.
		const retained = mark.overlays.filter((token) => desired.includes(token))
		if (retained.some((token, index) => desired[index] !== token)) {
			// A newly reopened ancestor belongs BELOW its still-live child.
			// Rebuild the snapshots from the route, preserving both UI states.
			travel(route.base, later)
			return
		}
		if (retained.length > 0 && retained.at(-1) === mark.overlays.at(-1)) {
			if (
				!sameTokens(retained, mark.overlays) &&
				!write({ ...mark, overlays: retained }, false)
			)
				return
		} else if (
			mark.overlays.length > 0 ||
			(mark.position !== route.base && retained.length === 0)
		) {
			const last = retained.at(-1)
			const target =
				last === undefined
					? route.base
					: ([...known.values()]
							.filter(
								(entry) =>
									entry.position < mark.position &&
									entry.route.id === route.id &&
									entry.overlays.at(-1) === last,
							)
							.at(-1)?.position ?? route.base)
			travel(target, later)
			return
		}
		const current = cursor.mark
		if (current === undefined) return
		const prefix = current.overlays.filter((token) => desired.includes(token))
		for (let index = prefix.length; index < desired.length; index++) {
			const position = (cursor.mark?.position ?? route.base) + 1
			if (
				!write(
					{
						version: 1,
						session,
						position,
						route,
						overlays: desired.slice(0, index + 1),
					},
					true,
				)
			)
				return
		}
	}

	function skipSameRoute(direction: number, consumed: boolean) {
		const mark = cursor.mark
		if (mark === undefined) return
		if (consumed) {
			const active = enabled ? stack.tokens() : []
			const top = active.at(-1)
			const target =
				top === undefined
					? route.base
					: ([...known.values()]
							.filter(
								(entry) =>
									entry.position <= mark.position &&
									entry.route.id === route.id &&
									entry.overlays.at(-1) === top,
							)
							.at(-1)?.position ?? route.base)
			if (target !== mark.position) {
				travel(target, later)
				return
			}
			later()
			return
		}
		// A forward tombstone at the end has nowhere to go. Stop there;
		// never bounce backward or wait for an impossible popstate.
		const candidates = [...known.values()]
			.filter((entry) =>
				direction > 0
					? entry.position > mark.position
					: entry.position < mark.position,
			)
			.sort((a, b) =>
				direction > 0 ? a.position - b.position : b.position - a.position,
			)
		const destination = candidates.find((entry) => entry.route.id !== route.id)
		if (destination !== undefined) {
			driver.go(destination.position - mark.position)
		} else if (direction < 0) {
			// The preceding page may predate this controller. Move to the base
			// first, then make ONE ordinary back traversal (which may exit).
			travel(route.base, () => driver.go(-1))
		} else {
			const tail = candidates.at(-1)
			if (tail !== undefined) travel(tail.position, () => {})
		}
	}

	async function onPop() {
		if (disposed) return
		failed = false
		const previous = cursor
		let target = read()
		let mark = target.mark
		// replace changes the route represented by ALL its synthetic snapshots.
		// Revisiting an old forward slot must not restore the replaced URL/state.
		const base = mark === undefined ? undefined : known.get(mark.route.base)
		if (
			mark !== undefined &&
			base?.session === mark.session &&
			base.route.id === mark.route.id &&
			base.route.revision > mark.route.revision
		) {
			mark = { ...mark, route: base.route }
			target = { mark, location: withMark(mark) }
			try {
				driver.replace(target.location)
			} catch (error) {
				report(error)
				return
			}
		}
		if (
			mark !== undefined &&
			previous.mark?.session === mark.session &&
			previous.mark.position === mark.position &&
			previous.mark.route.id === mark.route.id &&
			sameTokens(previous.mark.overlays, mark.overlays)
		)
			return
		cursor = target
		if (mark !== undefined) remember(mark)
		const operation = pending
		pending = undefined
		if (
			operation !== undefined &&
			mark?.position === operation.position &&
			mark.session === operation.session
		) {
			operation.done()
			return
		}
		const myEpoch = ++epoch
		deciding = false
		const ignoreBlocker =
			ignoreTraversal !== undefined &&
			mark?.session === ignoreTraversal.session &&
			mark.position === ignoreTraversal.position
		ignoreTraversal = undefined
		const delta =
			mark !== undefined && previous.mark?.session === mark.session
				? mark.position - previous.mark.position
				: -1
		if (mark?.route.id === route.id) {
			const tokens = enabled ? stack.tokens() : []
			const leaving = tokens.filter(
				(token) =>
					previous.mark?.overlays.includes(token) &&
					!mark.overlays.includes(token),
			)
			stack.close(leaving)
			if (leaving.length > 0 || writes.length > 0) {
				skipSameRoute(delta, true)
			} else if (tokens.length > 0 && sameTokens(tokens, mark.overlays)) {
				later()
			} else skipSameRoute(delta, false)
			return
		}
		const event: BackNavigation = {
			location: mark?.route ?? target.location,
			action: delta === -1 ? "BACK" : delta === 1 ? "FORWARD" : "GO",
			delta,
		}
		deciding = true
		let blocked = false
		try {
			blocked = ignoreBlocker ? false : ((await blocker?.(event)) ?? false)
		} catch (error) {
			blocked = true
			options.onError?.(error)
		}
		if (disposed || myEpoch !== epoch) return
		deciding = false
		if (blocked && previous.mark !== undefined) {
			pending = {
				position: previous.mark.position,
				session: previous.mark.session,
				done: later,
			}
			driver.go(-delta)
			return
		}
		stack.close(stack.tokens(), true)
		route = mark?.route ?? newRoute(target.location, 0)
		notify(event)
		later()
	}

	const unlisten = driver.listen(() => {
		void onPop()
	})
	return {
		set(overlay) {
			stack.set(overlay)
			failed = false
			later()
		},
		remove(id) {
			stack.remove(id)
			failed = false
			later()
		},
		setEnabled(value) {
			enabled = value
			failed = false
			later()
		},
		navigate(location, replace, complete = () => {}) {
			epoch++
			deciding = false
			failed = false
			stack.close(stack.tokens(), true)
			writes.push({ location, replace, complete })
			later()
		},
		go(delta, ignoreBlocker = false) {
			reconcile()
			ignoreTraversal =
				ignoreBlocker && cursor.mark !== undefined
					? {
							session: cursor.mark.session,
							position: cursor.mark.position + delta,
						}
					: undefined
			driver.go(delta)
		},
		subscribe(listener) {
			subscribers.add(listener)
			return () => {
				subscribers.delete(listener)
			}
		},
		setBlocker(value) {
			blocker = value
		},
		flush: reconcile,
		get location() {
			return { href: route.href, state: route.state }
		},
		get snapshot() {
			return {
				overlays: stack.tokens(),
				pending: pending !== undefined || deciding || writes.length > 0,
				registrations: stack.size,
			}
		},
		dispose() {
			disposed = true
			epoch++
			unlisten()
			stack.clear()
			known.clear()
			subscribers.clear()
			writes.length = 0
			pending = undefined
		},
	}
}
