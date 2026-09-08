import { getMobileBackController } from "@hoardodile/ui/lib/mobile-back-browser"
import type {
	BackLocation,
	MobileBackController,
} from "@hoardodile/ui/lib/mobile-back-controller"
import {
	createHistory,
	type HistoryLocation,
	type RouterHistory,
} from "@tanstack/react-router"
import { randomUUID } from "./randomUUID"

type Blocker = Parameters<RouterHistory["block"]>[0]

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parse(location: BackLocation): HistoryLocation {
	const url = new URL(location.href, window.location.origin)
	const state = object(location.state) ? location.state : {}
	const key =
		typeof state.__TSR_key === "string" ? state.__TSR_key : randomUUID()
	return {
		href: url.pathname + url.search + url.hash,
		pathname: url.pathname,
		search: url.search,
		hash: url.hash,
		state: {
			...state,
			key,
			__TSR_key: key,
			__TSR_index:
				typeof state.__TSR_index === "number" ? state.__TSR_index : 0,
		},
	}
}

/**
 * TanStack's public history contract, backed by the same physical driver as
 * overlays. Synthetic entries never notify the router or its leave blockers.
 */
export function createMobileBackHistory(
	controller: MobileBackController = getMobileBackController(),
): RouterHistory {
	let current = parse(controller.location)
	let blockers: Blocker[] = []
	controller.navigate({ href: current.href, state: current.state }, true)
	controller.flush()
	const history = createHistory({
		getLocation: () => current,
		getLength: () => window.history.length,
		pushState(href, state) {
			current = parse({ href, state })
			controller.navigate({ href, state }, false)
		},
		replaceState(href, state) {
			current = parse({ href, state })
			controller.navigate({ href, state }, true)
		},
		go: (delta) => controller.go(delta),
		back: (ignoreBlocker) => controller.go(-1, ignoreBlocker),
		forward: (ignoreBlocker) => controller.go(1, ignoreBlocker),
		createHref: (href) => href,
		notifyOnIndexChange: false,
		getBlockers: () => blockers,
		setBlockers: (next) => {
			blockers = next
		},
		flush: () => controller.flush(),
		destroy() {
			unsubscribe()
			controller.setBlocker(undefined)
			window.removeEventListener("beforeunload", beforeUnload, {
				capture: true,
			})
		},
	})
	controller.setBlocker(async (event) => {
		for (const blocker of blockers) {
			if (
				await blocker.blockerFn({
					currentLocation: current,
					nextLocation: parse(event.location),
					action: event.action,
				})
			)
				return true
		}
		return false
	})
	const unsubscribe = controller.subscribe((event) => {
		current = parse(event.location)
		history.notify(
			event.action === "GO"
				? { type: "GO", index: event.delta }
				: { type: event.action },
		)
	})
	function beforeUnload(event: BeforeUnloadEvent) {
		if (
			!blockers.some((blocker) =>
				typeof blocker.enableBeforeUnload === "function"
					? blocker.enableBeforeUnload()
					: blocker.enableBeforeUnload !== false,
			)
		)
			return
		event.preventDefault()
		event.returnValue = ""
	}
	window.addEventListener("beforeunload", beforeUnload, { capture: true })
	history.go = (delta, options) => controller.go(delta, options?.ignoreBlocker)
	return history
}
