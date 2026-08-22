import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/components/common/ThemeProvider"
import { PasswordSection } from "./PasswordSection"

function mockFetchResponse(body: unknown, status = 200) {
	return Promise.resolve(
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		}),
	)
}

function renderPasswordSection() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	})
	render(
		<ThemeProvider>
			<QueryClientProvider client={queryClient}>
				<PasswordSection />
			</QueryClientProvider>
		</ThemeProvider>,
	)
	return { queryClient }
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.stubGlobal(
		"fetch",
		vi.fn(() => mockFetchResponse({ ok: true })),
	)
})

describe("PasswordSection", () => {
	it("posts the current and new password on valid submit", async () => {
		const user = userEvent.setup()
		const calls: Array<{ input: string; init?: RequestInit }> = []
		vi.stubGlobal(
			"fetch",
			vi.fn((input: string, init?: RequestInit) => {
				calls.push({ input, init })
				return mockFetchResponse({ ok: true })
			}),
		)
		renderPasswordSection()

		await user.click(screen.getByTestId("change-password"))
		await screen.findByTestId("change-password-dialog")

		await user.type(screen.getByLabelText("Current password"), "old-pass")
		await user.type(screen.getByLabelText("New password"), "new-pass")
		await user.type(screen.getByLabelText("Confirm new password"), "new-pass")
		await user.click(screen.getByTestId("password-save"))

		await waitFor(() => {
			expect(calls.some((c) => c.input === "/auth/password")).toBe(true)
		})
		const call = calls.find((c) => c.input === "/auth/password")
		expect(JSON.parse(String(call?.init?.body))).toEqual({
			currentPassword: "old-pass",
			newPassword: "new-pass",
		})
	})

	it("surfaces a mismatch between the two new-password fields", async () => {
		const user = userEvent.setup()
		renderPasswordSection()

		await user.click(screen.getByTestId("change-password"))
		await screen.findByTestId("change-password-dialog")

		await user.type(screen.getByLabelText("Current password"), "old-pass")
		await user.type(screen.getByLabelText("New password"), "new-pass")
		await user.type(screen.getByLabelText("Confirm new password"), "other")
		await user.click(screen.getByTestId("password-save"))

		const message = await screen.findByRole("alert")
		expect(message).toHaveTextContent(/do not match/i)
	})

	it("marks the current password field when the server rejects it", async () => {
		const user = userEvent.setup()
		vi.stubGlobal(
			"fetch",
			vi.fn(() => mockFetchResponse({ error: "incorrect password" }, 403)),
		)
		renderPasswordSection()

		await user.click(screen.getByTestId("change-password"))
		await screen.findByTestId("change-password-dialog")

		await user.type(screen.getByLabelText("Current password"), "wrong")
		await user.type(screen.getByLabelText("New password"), "new-pass")
		await user.type(screen.getByLabelText("Confirm new password"), "new-pass")
		await user.click(screen.getByTestId("password-save"))

		const message = await screen.findByRole("alert")
		expect(message).toHaveTextContent(/incorrect/i)
	})
})
