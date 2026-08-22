import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { renderRouter } from "@/test/render-router"

function mockFetchResponse(body: unknown, status = 200) {
	return Promise.resolve(
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		}),
	)
}

function configuredStatus(overrides: Partial<{ authenticated: boolean }> = {}) {
	return { authenticated: false, configured: true, ...overrides }
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.stubGlobal(
		"fetch",
		vi.fn(() => mockFetchResponse(configuredStatus())),
	)
})

describe("login route", () => {
	it("blocks submit with an empty password and surfaces a validation error", async () => {
		const user = userEvent.setup()
		renderRouter({ initialEntries: ["/login"] })

		await screen.findByRole("heading", { name: /sign in/i })

		await user.click(screen.getByTestId("login-submit"))

		const message = await screen.findByRole("alert")
		expect(message).toHaveTextContent(/.+/)
	})

	it("calls the login mutation with the entered password on valid submit", async () => {
		const user = userEvent.setup()
		let callCount = 0
		vi.stubGlobal(
			"fetch",
			vi.fn((input: string, init?: RequestInit) => {
				if (input === "/auth/login" && init?.method === "POST") {
					callCount++
					return mockFetchResponse(configuredStatus({ authenticated: true }))
				}
				return mockFetchResponse(configuredStatus())
			}),
		)
		renderRouter({ initialEntries: ["/login"] })

		await screen.findByRole("heading", { name: /sign in/i })

		const password = screen.getByLabelText(/password/i)
		await user.type(password, "hunter2")
		await user.click(screen.getByTestId("login-submit"))

		await waitFor(() => {
			expect(callCount).toBeGreaterThan(0)
		})
	})

	it("flips back to the setup form when login reports the server is unconfigured", async () => {
		const user = userEvent.setup()
		let loginAttempted = false
		vi.stubGlobal(
			"fetch",
			vi.fn((input: string, init?: RequestInit) => {
				if (input === "/auth/login" && init?.method === "POST") {
					loginAttempted = true
					return mockFetchResponse({ error: "not configured" }, 401)
				}
				// Any number of status fetches may happen before the submit
				// (SSE connect, cache-gc refetch); only the login result may
				// flip the form back into setup mode.
				return mockFetchResponse({
					authenticated: false,
					configured: !loginAttempted,
				})
			}),
		)
		renderRouter({ initialEntries: ["/login"] })

		await screen.findByRole("heading", { name: /sign in/i })

		const password = screen.getByLabelText(/password/i)
		await user.type(password, "hunter2")
		await user.click(screen.getByTestId("login-submit"))

		await screen.findByRole("heading", { name: /set a password/i })
		expect(screen.getByTestId("setup-submit")).toBeVisible()
		// The failed attempt must not surface as a wrong-password error.
		expect(screen.queryByRole("alert")).not.toBeInTheDocument()
	})

	it("shows the demo password hint and prefills the field", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				mockFetchResponse({
					authenticated: false,
					configured: true,
					demoPassword: true,
				}),
			),
		)
		renderRouter({ initialEntries: ["/login"] })

		const hint = await screen.findByTestId("login-demo-hint")
		expect(hint).toHaveTextContent(/demo library/i)
		expect(hint).toHaveTextContent(/password is demo/i)
		await waitFor(() => {
			expect(screen.getByLabelText(/password/i)).toHaveValue("demo")
		})
	})

	it("does not show the demo hint on a normal host", async () => {
		renderRouter({ initialEntries: ["/login"] })

		await screen.findByRole("heading", { name: /sign in/i })
		expect(screen.queryByTestId("login-demo-hint")).not.toBeInTheDocument()
	})
})

describe("login route setup mode", () => {
	function mockUnconfigured() {
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				mockFetchResponse({ authenticated: false, configured: false }),
			),
		)
	}

	it("shows the setup form instead of sign-in when the server is unconfigured", async () => {
		mockUnconfigured()
		renderRouter({ initialEntries: ["/login"] })

		await screen.findByRole("heading", { name: /set a password/i })
		expect(screen.getByTestId("setup-submit")).toBeVisible()
		expect(screen.queryByTestId("login-submit")).not.toBeInTheDocument()
	})

	it("surfaces a mismatch between the two password fields", async () => {
		mockUnconfigured()
		const user = userEvent.setup()
		renderRouter({ initialEntries: ["/login"] })

		await screen.findByRole("heading", { name: /set a password/i })

		const fields = screen.getAllByLabelText(/password/i)
		await user.type(fields[0] ?? document.body, "hunter2")
		await user.type(fields[1] ?? document.body, "different")
		await user.click(screen.getByTestId("setup-submit"))

		const message = await screen.findByRole("alert")
		expect(message).toHaveTextContent(/do not match/i)
	})

	it("claims the server via /auth/setup and then signs in with the same password", async () => {
		mockUnconfigured()
		const user = userEvent.setup()
		const calls: Array<{ input: string; init?: RequestInit }> = []
		vi.stubGlobal(
			"fetch",
			vi.fn((input: string, init?: RequestInit) => {
				calls.push({ input, init })
				if (input === "/auth/setup" && init?.method === "POST") {
					return mockFetchResponse({ ok: true })
				}
				if (input === "/auth/login" && init?.method === "POST") {
					return mockFetchResponse(configuredStatus({ authenticated: true }))
				}
				return mockFetchResponse({ authenticated: false, configured: false })
			}),
		)
		renderRouter({ initialEntries: ["/login"] })

		await screen.findByRole("heading", { name: /set a password/i })

		const fields = screen.getAllByLabelText(/password/i)
		await user.type(fields[0] ?? document.body, "hunter2")
		await user.type(fields[1] ?? document.body, "hunter2")
		await user.click(screen.getByTestId("setup-submit"))

		await waitFor(() => {
			expect(calls.some((c) => c.input === "/auth/setup")).toBe(true)
		})
		await waitFor(() => {
			expect(calls.some((c) => c.input === "/auth/login")).toBe(true)
		})

		const setupCall = calls.find((c) => c.input === "/auth/setup")
		expect(JSON.parse(String(setupCall?.init?.body))).toEqual({
			password: "hunter2",
		})
	})
})
