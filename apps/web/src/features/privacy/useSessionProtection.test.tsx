import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { authStatusQueryKey } from "@/features/auth"
import {
	acceptSession,
	isSessionLocked,
	setWebAuthPreference,
	webAuthKeys,
} from "@/features/auth/session"
import { readLastRoute } from "@/lib/last-route"
import { useSessionProtection } from "./useSessionProtection"

const { navigate } = vi.hoisted(() => ({
	navigate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }))

function visibility(value: DocumentVisibilityState) {
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value,
	})
	document.dispatchEvent(new Event("visibilitychange"))
}

function mount() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	queryClient.setQueryData(authStatusQueryKey, {
		authenticated: true,
		configured: true,
	})
	return renderHook(() => useSessionProtection(), {
		wrapper: ({ children }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		),
	})
}

beforeEach(() => navigate.mockClear())
afterEach(() => {
	vi.unstubAllGlobals()
	delete window.hoardodileDesktop
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: "visible",
	})
})

it("locks immediately without logout or broadcasting to other tabs", async () => {
	const fetch = vi.fn()
	vi.stubGlobal("fetch", fetch)
	window.history.replaceState(null, "", "/documents/12?mode=read#chapter")
	acceptSession("secret")
	setWebAuthPreference(webAuthKeys.autoLock, true)
	mount()
	await act(async () => visibility("hidden"))
	expect(isSessionLocked()).toBe(true)
	expect(readLastRoute()).toBe("/documents/12?mode=read#chapter")
	expect(navigate).toHaveBeenCalledWith({ to: "/unlock", replace: true })
	expect(fetch).not.toHaveBeenCalled()
})

it("ignores automatic browser locking on desktop", async () => {
	Object.defineProperty(window, "hoardodileDesktop", {
		configurable: true,
		value: { isDesktop: true },
	})
	localStorage.setItem(webAuthKeys.autoLock, "1")
	acceptSession()
	mount()
	await act(async () => visibility("hidden"))
	expect(isSessionLocked()).toBe(false)
	expect(navigate).not.toHaveBeenCalled()
})

it("a frozen page is locked before a bfcache restore can expose it", async () => {
	acceptSession("secret")
	mount()
	await act(async () => {
		window.dispatchEvent(
			new PageTransitionEvent("pagehide", { persisted: true }),
		)
		window.dispatchEvent(
			new PageTransitionEvent("pageshow", { persisted: true }),
		)
	})
	expect(isSessionLocked()).toBe(true)
	expect(navigate).toHaveBeenCalledWith({ to: "/unlock", replace: true })
})
