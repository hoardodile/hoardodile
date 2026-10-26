import { act, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import {
	acceptSession,
	lockSession,
	setWebAuthPreference,
	webAuthKeys,
} from "@/features/auth/session"
import { armLastRouteRestore, writeLastRoute } from "@/lib/last-route"
import { renderRouter } from "@/test/render-router"

vi.mock("@/features/prefs/prefSyncHydrator", () => ({
	hydrateSystemPrefs: vi.fn().mockResolvedValue(undefined),
	invalidateSystemPrefsHydration: vi.fn(),
}))

afterEach(() => {
	vi.unstubAllGlobals()
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: "visible",
	})
})

function mockServer(authenticated = false) {
	const fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
		if (input === "/auth/login" || input === "/auth/unlock") {
			const body: { password: string } = JSON.parse(String(init?.body))
			if (body.password !== "correct")
				return new Response(JSON.stringify({ error: "unauthorized" }), {
					status: 401,
				})
			authenticated = true
		}
		return new Response(JSON.stringify({ authenticated, configured: true }), {
			headers: { "content-type": "application/json" },
		})
	})
	vi.stubGlobal("fetch", fetch)
	return fetch
}

it("keeps the unlock form visible after leaving an authenticated page and returning", async () => {
	mockServer(true)
	acceptSession()
	setWebAuthPreference(webAuthKeys.autoLock, true)
	const href = "/settings/web?from=reading#session"
	window.history.replaceState(null, "", href)
	const { router, container } = renderRouter({ initialEntries: [href] })
	container.id = "root"
	await waitFor(() => expect(router.state.status).toBe("idle"))
	for (const value of ["hidden", "visible", "hidden", "visible"]) {
		await act(async () => {
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				value,
			})
			document.dispatchEvent(new Event("visibilitychange"))
		})
		expect(await screen.findByTestId("unlock-heading")).toBeVisible()
	}
	expect(router.state.location.pathname).toBe("/unlock")
	const user = userEvent.setup()
	await user.type(screen.getByLabelText("Password", { exact: true }), "correct")
	await user.click(screen.getByTestId("unlock-submit"))
	await waitFor(() => expect(router.state.location.href).toBe(href))
	expect(container).toBeVisible()
})

it("keeps failed verification on the distinct unlock screen and returns to the original route after success", async () => {
	const user = userEvent.setup()
	const fetch = mockServer()
	acceptSession()
	lockSession("/settings/web?from=reading#session")
	const { router } = renderRouter({ initialEntries: ["/unlock"] })
	await screen.findByTestId("unlock-heading")
	expect(screen.queryByTestId("login-submit")).not.toBeInTheDocument()
	await user.type(screen.getByLabelText("Password", { exact: true }), "wrong")
	await user.click(screen.getByTestId("unlock-submit"))
	await screen.findByRole("alert")
	expect(router.state.location.pathname).toBe("/unlock")
	await user.clear(screen.getByLabelText("Password", { exact: true }))
	await user.type(screen.getByLabelText("Password", { exact: true }), "correct")
	await user.click(screen.getByTestId("unlock-submit"))
	await waitFor(() =>
		expect(router.state.location.href).toBe(
			"/settings/web?from=reading#session",
		),
	)
	expect(fetch.mock.calls.some(([input]) => input === "/auth/unlock")).toBe(
		true,
	)
})

it("a new login discards any old restore target and enters Home", async () => {
	const user = userEvent.setup()
	mockServer()
	writeLastRoute("/settings/web")
	armLastRouteRestore(["/settings/web"])
	const { router } = renderRouter({ initialEntries: ["/login"] })
	await screen.findByTestId("sign-in-heading")
	await user.type(screen.getByLabelText("Password", { exact: true }), "correct")
	await user.click(screen.getByTestId("login-submit"))
	await waitFor(() => expect(router.state.location.pathname).toBe("/"))
})

it("renders a known lock screen immediately when the server is unreachable", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			throw new Error("offline")
		}),
	)
	acceptSession()
	lockSession("/documents/one")
	const { router, container } = renderRouter({ initialEntries: ["/unlock"] })
	container.id = "root"
	expect(await screen.findByTestId("unlock-heading")).toBeVisible()
	for (let cycle = 0; cycle < 2; cycle++) {
		for (const value of ["hidden", "visible"]) {
			await act(async () => {
				Object.defineProperty(document, "visibilityState", {
					configurable: true,
					value,
				})
				document.dispatchEvent(new Event("visibilitychange"))
			})
		}
		expect(screen.getByTestId("unlock-heading")).toBeVisible()
		expect(screen.getByTestId("unlock-submit")).toBeVisible()
	}
	await act(async () => {
		window.dispatchEvent(
			new PageTransitionEvent("pageshow", { persisted: true }),
		)
	})
	expect(screen.getByTestId("unlock-heading")).toBeVisible()
	expect(router.state.location.pathname).toBe("/unlock")
	expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument()
})
