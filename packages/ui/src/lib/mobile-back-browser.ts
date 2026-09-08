import { MOBILE_QUERY } from "../viewport"
import {
	createMobileBackController,
	type MobileBackController,
} from "./mobile-back-controller"

const controllers = new WeakMap<Window, MobileBackController>()

/** Explicit/lazy initialization, never a module-import history patch. */
export function getMobileBackController(
	win: Window = window,
): MobileBackController {
	const existing = controllers.get(win)
	if (existing !== undefined) return existing
	let media: MediaQueryList | undefined
	try {
		media = win.matchMedia(MOBILE_QUERY)
	} catch {
		// This optional browser feature initializes before the React error
		// boundary. A broken media API must not prevent the app from mounting
		// its own error page; leave back-to-close disabled in this case.
	}
	const controller = createMobileBackController({
		enabled: media?.matches ?? false,
		driver: {
			read: () => ({
				href: win.location.pathname + win.location.search + win.location.hash,
				state: win.history.state,
			}),
			push: (location) =>
				win.history.pushState(location.state, "", location.href),
			replace: (location) =>
				win.history.replaceState(location.state, "", location.href),
			go: (delta) => win.history.go(delta),
			listen(listener) {
				win.addEventListener("popstate", listener)
				return () => win.removeEventListener("popstate", listener)
			},
		},
		onError(error) {
			console.error("[mobile-back] History operation failed", error)
		},
	})
	const onChange = () => controller.setEnabled(media?.matches ?? false)
	media?.addEventListener("change", onChange)
	const dispose = controller.dispose
	const browserController: MobileBackController = {
		...controller,
		get location() {
			return controller.location
		},
		get snapshot() {
			return controller.snapshot
		},
		dispose() {
			media?.removeEventListener("change", onChange)
			controllers.delete(win)
			dispose()
		},
	}
	controllers.set(win, browserController)
	return browserController
}
