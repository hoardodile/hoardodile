import { useSyncExternalStore } from "react"
import { getDesktopBridge, isHoardodileDesktop } from "@/lib/desktop"
import {
	clearLastRoute,
	consumeLastRouteRestore,
	isRestorablePath,
	readLastRoute,
	writeLastRoute,
} from "@/lib/last-route"

export const webAuthKeys = {
	requireUnlock: "web.requireUnlockOnOpen",
	autoLock: "web.autoLockEnabled",
} as const
const KNOWN_KEY = "auth.signedIn"
const LOCKED_KEY = "auth.locked"
const listeners = new Set<() => void>()
let initialized = false
let token: string | undefined
let mode: "cookie" | "page" = "cookie"
let verified = false
let locked = false
let known = false
let signedOut = false
let browserListenersInstalled = false
let generation = 0
let routePatterns: readonly string[] = []

export function configureSessionRoutes(patterns: readonly string[]): void {
	routePatterns = patterns
}
export function unlockDestination(): string {
	consumeLastRouteRestore()
	const href = readLastRoute()
	return href && isRestorablePath(href, routePatterns) ? href : "/"
}

function read(storage: Storage, key: string): string | null {
	try {
		return storage.getItem(key)
	} catch {
		return null
	}
}

function write(storage: Storage, key: string, value: string): void {
	try {
		storage.setItem(key, value)
	} catch {
		/* Private browsing may deny storage. */
	}
}

export function readWebAuthPreference(key: string): boolean {
	if (typeof window === "undefined") return false
	if (isHoardodileDesktop()) return false
	if (key === webAuthKeys.autoLock && read(localStorage, key) === null) {
		write(
			localStorage,
			key,
			read(localStorage, "privacy.autoLogoutEnabled") === "1" ? "1" : "0",
		)
	}
	return read(localStorage, key) === "1"
}

function emit(): void {
	for (const listener of listeners) listener()
}

export function setWebAuthPreference(key: string, value: boolean): void {
	write(localStorage, key, value ? "1" : "0")
	emit()
}

export function subscribeSession(listener: () => void): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

export function useAuthSession(): boolean {
	initialize()
	return useSyncExternalStore(subscribeSession, canAccessContent)
}

export function useWebAuthPreference(
	key: string,
): [boolean, (value: boolean) => void] {
	const value = useSyncExternalStore(subscribeSession, () =>
		readWebAuthPreference(key),
	)
	return [value, (next) => setWebAuthPreference(key, next)]
}

function initialize(): void {
	if (initialized) return
	initialized = true
	if (typeof window === "undefined") return
	mode = readWebAuthPreference(webAuthKeys.requireUnlock) ? "page" : "cookie"
	const desktop = getDesktopBridge()?.authentication?.initial
	const storedKnown =
		read(sessionStorage, KNOWN_KEY) ??
		(!isHoardodileDesktop() ? read(localStorage, KNOWN_KEY) : null)
	const previousRoute = readLastRoute()
	const legacyDesktop =
		isHoardodileDesktop() &&
		desktop === undefined &&
		storedKnown === null &&
		previousRoute !== undefined &&
		isContentHref(previousRoute)
	known = desktop?.signedIn ?? (storedKnown === "1" || legacyDesktop)
	signedOut = desktop ? !desktop.signedIn : storedKnown === "0"
	if (desktop?.signedIn && desktop.href) writeLastRoute(desktop.href)
	locked =
		known &&
		(mode === "page" ||
			(read(sessionStorage, LOCKED_KEY) ??
				(!isHoardodileDesktop() ? read(localStorage, LOCKED_KEY) : null)) ===
				"1")
	if (browserListenersInstalled) return
	browserListenersInstalled = true
	window.addEventListener("storage", (event) => {
		if (
			event.key === webAuthKeys.autoLock ||
			event.key === webAuthKeys.requireUnlock
		)
			emit()
	})
	window.addEventListener("pagehide", () => {
		if (mode === "page" && known)
			lockSession(
				window.location.pathname +
					window.location.search +
					window.location.hash,
			)
	})
}

export function sessionMode(): "cookie" | "page" {
	initialize()
	return mode
}
export function sessionToken(): string | undefined {
	initialize()
	return token
}
export function sessionGeneration(): number {
	return generation
}
export function canAccessContent(): boolean {
	initialize()
	return verified && !locked
}
export function needsUnlock(): boolean {
	initialize()
	return known
}
export function isSessionLocked(): boolean {
	initialize()
	return locked
}
export function isExplicitlySignedOut(): boolean {
	initialize()
	return signedOut
}

function persistKnown(value: boolean): void {
	known = value
	if (typeof window === "undefined") return
	write(sessionStorage, KNOWN_KEY, value ? "1" : "0")
	if (!isHoardodileDesktop()) write(localStorage, KNOWN_KEY, value ? "1" : "0")
	getDesktopBridge()?.authentication?.update({
		signedIn: value,
		href: value ? (readLastRoute() ?? "/") : "/",
	})
}

export function rememberAuthenticatedRoute(href: string): void {
	if (!canAccessContent() || !isContentHref(href)) return
	writeLastRoute(href)
	getDesktopBridge()?.authentication?.update({ signedIn: true, href })
}

export function isContentHref(href: string): boolean {
	if (
		!href.startsWith("/") ||
		href.startsWith("//") ||
		href.includes("\\") ||
		href.length > 4096
	)
		return false
	const url = new URL(href, "http://local")
	if (url.origin !== "http://local") return false
	const pathname = url.pathname
	return (
		pathname !== "/login" && pathname !== "/unlock" && pathname !== "/setup"
	)
}

export function acceptSession(sessionTokenValue?: string): void {
	initialize()
	token = sessionTokenValue
	mode = token === undefined ? "cookie" : "page"
	locked = false
	signedOut = false
	verified = true
	if (typeof window !== "undefined") write(sessionStorage, LOCKED_KEY, "0")
	if (typeof window !== "undefined" && !isHoardodileDesktop())
		write(localStorage, LOCKED_KEY, "0")
	persistKnown(true)
	emit()
}

export function observeAuthStatus(status: {
	authenticated: boolean
	configured: boolean
}): void {
	initialize()
	if (!status.configured) {
		clearSession()
	} else if (status.authenticated && !locked) {
		if (!verified) {
			verified = true
			persistKnown(true)
			emit()
		}
	}
}

export function renewSession(value: string, requestGeneration: number): void {
	if (
		requestGeneration === generation &&
		verified &&
		!locked &&
		mode === "page"
	)
		token = value
}

export function lockSession(href: string): void {
	initialize()
	if (!known || locked) return
	if (
		isContentHref(href) &&
		(href !== "/" || canAccessContent() || readLastRoute() === undefined)
	)
		writeLastRoute(href)
	locked = true
	verified = false
	token = undefined
	generation++
	write(sessionStorage, LOCKED_KEY, "1")
	if (!isHoardodileDesktop()) write(localStorage, LOCKED_KEY, "1")
	// Cover content outside React's root too (sandboxed plugin iframes).
	for (const id of ["root", "plugin-iframe-host"]) {
		const element = document.getElementById(id)
		if (element) element.style.visibility = "hidden"
	}
	emit()
	window.dispatchEvent(new Event("hoardodile-session-locked"))
}

export function clearSession(): void {
	initialize()
	token = undefined
	verified = false
	locked = false
	signedOut = true
	generation++
	persistKnown(false)
	if (typeof window !== "undefined") write(sessionStorage, LOCKED_KEY, "0")
	if (typeof window !== "undefined" && !isHoardodileDesktop())
		write(localStorage, LOCKED_KEY, "0")
	clearLastRoute()
	emit()
}

/** Test cleanup; production state is reset only by explicit sign-out. */
export function resetAuthSessionForTests(): void {
	initialized = false
	token = undefined
	mode = "cookie"
	verified = false
	locked = false
	known = false
	signedOut = false
	generation++
	emit()
}
