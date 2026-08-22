import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { authStatusQueryKey } from "@/features/auth"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"
import { prefSyncStore } from "@/lib/prefSyncStore"
import { useAutoLogout } from "./useAutoLogout"

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }))

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}))

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})
}

function stubFetch(statusBody: unknown) {
	const fetchMock = vi.fn((_input: string, init?: RequestInit) => {
		if (init?.method === "POST") {
			return Promise.resolve(jsonResponse({ ok: true }))
		}
		return Promise.resolve(jsonResponse(statusBody))
	})
	vi.stubGlobal("fetch", fetchMock)
	return fetchMock
}

function setVisibility(state: DocumentVisibilityState): void {
	Object.defineProperty(document, "visibilityState", {
		value: state,
		configurable: true,
	})
	document.dispatchEvent(new Event("visibilitychange"))
}

function renderAutoLogout(authenticated = true) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	})
	queryClient.setQueryData(authStatusQueryKey, {
		authenticated,
		configured: true,
	})
	const utils = renderHook(() => useAutoLogout(), {
		wrapper: ({ children }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		),
	})
	return { queryClient, ...utils }
}

describe("useAutoLogout", () => {
	let root: HTMLElement

	beforeEach(() => {
		vi.useFakeTimers()
		navigateMock.mockReset()
		navigateMock.mockResolvedValue(undefined)
		root = document.createElement("div")
		root.id = "root"
		document.body.appendChild(root)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
		prefSyncStore.clear()
		localStorage.clear()
		root.remove()
		setVisibility("visible")
	})

	it("does nothing when the tab is hidden briefly", async () => {
		stubFetch({ authenticated: true, configured: true })
		const { queryClient } = renderAutoLogout()

		act(() => setVisibility("hidden"))
		await act(() => vi.advanceTimersByTimeAsync(30_000))
		act(() => setVisibility("visible"))
		await act(async () => {})

		expect(navigateMock).not.toHaveBeenCalled()
		expect(queryClient.getQueryData(authStatusQueryKey)).toEqual({
			authenticated: true,
			configured: true,
		})
	})

	it("signs out via the hidden timer when the delay elapses", async () => {
		prefSync.set(prefKeys.privacyAutoLogoutEnabled, "1")
		const fetchMock = stubFetch({ authenticated: true, configured: true })
		const { queryClient } = renderAutoLogout()

		act(() => setVisibility("hidden"))
		await act(() => vi.advanceTimersByTimeAsync(61_000))

		await vi.waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({ to: "/login" })
		})
		expect(
			fetchMock.mock.calls.some(
				([input, init]) => init?.method === "POST" && input === "/auth/logout",
			),
		).toBe(true)
		expect(queryClient.getQueryData(authStatusQueryKey)).toEqual({
			authenticated: false,
			configured: true,
		})
	})

	it("re-validates the session on return and signs out when it died server-side", async () => {
		stubFetch({ authenticated: false, configured: true })
		const { queryClient } = renderAutoLogout()

		act(() => setVisibility("hidden"))
		await act(() => vi.advanceTimersByTimeAsync(30_000))
		act(() => setVisibility("visible"))

		await vi.waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({ to: "/login" })
		})
		expect(queryClient.getQueryData(authStatusQueryKey)).toEqual({
			authenticated: false,
			configured: true,
		})
	})

	it("does nothing when not authenticated", async () => {
		const fetchMock = stubFetch({ authenticated: true, configured: true })
		renderAutoLogout(false)

		act(() => setVisibility("hidden"))
		await act(() => vi.advanceTimersByTimeAsync(61_000))
		act(() => setVisibility("visible"))
		await act(async () => {})

		expect(navigateMock).not.toHaveBeenCalled()
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("never signs out automatically when disabled, but still validates on return", async () => {
		prefSync.set(prefKeys.privacyAutoLogoutEnabled, "0")
		stubFetch({ authenticated: true, configured: true })
		renderAutoLogout()

		act(() => setVisibility("hidden"))
		await act(() => vi.advanceTimersByTimeAsync(120_000))
		act(() => setVisibility("visible"))
		await act(async () => {})

		expect(navigateMock).not.toHaveBeenCalled()
	})

	it("hides the app root while the sign-out round-trip is in flight", async () => {
		prefSync.set(prefKeys.privacyAutoLogoutEnabled, "1")
		stubFetch({ authenticated: true, configured: true })
		let resolveNavigate: (() => void) | undefined
		navigateMock.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveNavigate = resolve
				}),
		)
		renderAutoLogout()

		act(() => setVisibility("hidden"))
		await act(() => vi.advanceTimersByTimeAsync(61_000))

		// The timer fired, sign-out started: the root must already be hidden
		// while navigation is still pending.
		expect(root.style.visibility).toBe("hidden")

		await act(async () => {
			resolveNavigate?.()
		})
		expect(root.style.visibility).toBe("")
	})

	it("re-checks the session on pageshow after a bfcache restore", async () => {
		prefSync.set(prefKeys.privacyAutoLogoutEnabled, "1")
		stubFetch({ authenticated: true, configured: true })
		renderAutoLogout()

		act(() => setVisibility("hidden"))
		// Frozen time passes while the page is in bfcache (timers stay
		// paused; only the clock moves).
		act(() => vi.setSystemTime(Date.now() + 120_000))
		act(() => {
			window.dispatchEvent(
				new PageTransitionEvent("pageshow", { persisted: true }),
			)
		})

		await vi.waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({ to: "/login" })
		})
		expect(root.style.visibility).toBe("")
	})

	it("signs out when a logout is broadcast from another tab", async () => {
		const sender = new BroadcastChannel("hoardodile-auth")
		stubFetch({ authenticated: true, configured: true })
		const { queryClient } = renderAutoLogout()

		act(() => {
			sender.postMessage({ type: "logout" })
		})

		await vi.waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({ to: "/login" })
		})
		expect(queryClient.getQueryData(authStatusQueryKey)).toEqual({
			authenticated: false,
			configured: true,
		})
	})
})
