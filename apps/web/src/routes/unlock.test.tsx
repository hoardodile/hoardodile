import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { acceptSession, lockSession } from "@/features/auth/session"
import { armLastRouteRestore, writeLastRoute } from "@/lib/last-route"
import { renderRouter } from "@/test/render-router"

vi.mock("@/features/prefs/prefSyncHydrator", () => ({
	hydrateSystemPrefs: vi.fn().mockResolvedValue(undefined),
	invalidateSystemPrefsHydration: vi.fn(),
}))

afterEach(() => vi.unstubAllGlobals())

function mockServer() {
	let authenticated = false
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
	const { router } = renderRouter({ initialEntries: ["/unlock"] })
	await screen.findByTestId("unlock-heading")
	expect(router.state.location.pathname).toBe("/unlock")
	expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument()
})
