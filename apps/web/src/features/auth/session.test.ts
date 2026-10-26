import { afterEach, expect, it, vi } from "vitest"
import { credentialedFetch } from "@/lib/http"
import { readLastRoute } from "@/lib/last-route"
import { fetchAuthStatus, login, unlock } from "./api"
import {
	acceptSession,
	canAccessContent,
	clearSession,
	configureSessionRoutes,
	isSessionLocked,
	lockSession,
	needsUnlock,
	resetAuthSessionForTests,
	sessionGeneration,
	sessionToken,
	unlockDestination,
	webAuthKeys,
} from "./session"

function response(body: unknown, status = 200, headers?: HeadersInit) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	})
}

afterEach(() => {
	vi.unstubAllGlobals()
	delete window.hoardodileDesktop
	resetAuthSessionForTests()
})

it("a legacy desktop content route implies unlock continuity, while a new library remains signed out", () => {
	localStorage.setItem("app.lastRoute", "/documents/legacy")
	Object.defineProperty(window, "hoardodileDesktop", {
		configurable: true,
		value: { isDesktop: true, authentication: { update: vi.fn() } },
	})
	expect(needsUnlock()).toBe(true)
	resetAuthSessionForTests()
	Object.defineProperty(window, "hoardodileDesktop", {
		configurable: true,
		value: {
			isDesktop: true,
			authentication: {
				initial: { signedIn: false, href: "/" },
				update: vi.fn(),
			},
		},
	})
	expect(needsUnlock()).toBe(false)
})

it("keeps the credential in memory, and refresh requires unlock rather than login", async () => {
	localStorage.setItem(webAuthKeys.requireUnlock, "1")
	const fetch = vi.fn(async () =>
		response({ authenticated: true, configured: true, sessionToken: "secret" }),
	)
	vi.stubGlobal("fetch", fetch)
	await login({ password: "hunter2" })
	expect(sessionToken()).toBe("secret")
	expect(canAccessContent()).toBe(true)
	expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(
		"secret",
	)
	lockSession("/documents/12?mode=read#chapter")
	resetAuthSessionForTests()
	expect(sessionToken()).toBeUndefined()
	expect(needsUnlock()).toBe(true)
	expect(isSessionLocked()).toBe(true)
	configureSessionRoutes(["/documents/$id", "/"])
	expect(unlockDestination()).toBe("/documents/12?mode=read#chapter")
})

it("does not inherit cookies in page mode and rejects an old server's cookie-only login", async () => {
	localStorage.setItem(webAuthKeys.requireUnlock, "1")
	const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
		response({ authenticated: false, configured: true }),
	)
	vi.stubGlobal("fetch", fetch)
	await fetchAuthStatus()
	expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit" })
	await expect(login({ password: "hunter2" })).rejects.toThrow(
		"Missing page session",
	)
	expect(canAccessContent()).toBe(false)
})

it("unlock verifies the password and accepts a new cookie even while the old page is locked", async () => {
	acceptSession()
	lockSession("/settings/web")
	const fetch = vi.fn(async () =>
		response({ authenticated: true, configured: true }),
	)
	vi.stubGlobal("fetch", fetch)
	await unlock({ password: "hunter2" })
	expect(fetch).toHaveBeenCalledWith(
		"/auth/unlock",
		expect.objectContaining({ credentials: "include" }),
	)
	expect(canAccessContent()).toBe(true)
	expect(readLastRoute()).toBe("/settings/web")
})

it("hides sensitive surfaces once and preserves the visible unlock screen on repeated locks", () => {
	const root = document.createElement("div")
	root.id = "root"
	const plugins = document.createElement("div")
	plugins.id = "plugin-iframe-host"
	document.body.append(root, plugins)
	const notified = vi.fn()
	window.addEventListener("hoardodile-session-locked", notified)
	try {
		acceptSession("secret")
		const generation = sessionGeneration()
		lockSession("/documents/12?mode=read#chapter")
		expect(root).not.toBeVisible()
		expect(plugins).not.toBeVisible()
		expect(sessionToken()).toBeUndefined()
		expect(sessionGeneration()).toBe(generation + 1)
		root.style.visibility = ""
		lockSession("/documents/other")
		expect(root).toBeVisible()
		expect(plugins).not.toBeVisible()
		expect(sessionGeneration()).toBe(generation + 1)
		expect(notified).toHaveBeenCalledTimes(1)
		expect(readLastRoute()).toBe("/documents/12?mode=read#chapter")
	} finally {
		window.removeEventListener("hoardodile-session-locked", notified)
		root.remove()
		plugins.remove()
	}
})

it("failed unlock keeps the page locked and requests cannot revive a locked credential", async () => {
	acceptSession("before")
	let resolveRequest: (response: Response) => void = () => {}
	vi.stubGlobal(
		"fetch",
		vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					resolveRequest = resolve
				}),
		),
	)
	const inFlight = credentialedFetch("/trpc/auth.me")
	lockSession("/settings")
	resolveRequest(response({}, 200, { "x-hoardodile-session": "late-secret" }))
	await expect(inFlight).rejects.toThrow("locked")
	expect(sessionToken()).toBeUndefined()
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => response({ error: "unauthorized" }, 401)),
	)
	await expect(unlock({ password: "wrong" })).rejects.toThrow()
	expect(isSessionLocked()).toBe(true)
})

it("explicit sign-out clears continuity and never restores a prior page", () => {
	acceptSession("secret")
	lockSession("/documents/12")
	clearSession()
	resetAuthSessionForTests()
	expect(needsUnlock()).toBe(false)
	expect(readLastRoute()).toBeUndefined()
})

it("a closed cookie-mode tab still opens locked, while another active tab remains independent", () => {
	acceptSession()
	lockSession("/settings/web")
	sessionStorage.clear()
	resetAuthSessionForTests()
	expect(needsUnlock()).toBe(true)
	expect(isSessionLocked()).toBe(true)
	acceptSession()
	// A storage signal from another tab changes preferences, never this tab's authentication.
	localStorage.setItem("auth.locked", "1")
	window.dispatchEvent(
		new StorageEvent("storage", { key: "auth.locked", newValue: "1" }),
	)
	expect(canAccessContent()).toBe(true)
})

it("rejects external, authentication and unknown return addresses", () => {
	configureSessionRoutes(["/", "/documents/$id", "/login", "/unlock"])
	acceptSession()
	for (const path of [
		"//example.com",
		"/\\example.com",
		"/login",
		"/unlock",
		"/unknown",
	]) {
		lockSession(path)
		expect(unlockDestination()).toBe("/")
	}
})
