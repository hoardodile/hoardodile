import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { hardResetAndReload } from "@/lib/client-reset"
import { SystemCachePanel } from "./SystemCachePanel"

vi.mock("@/lib/client-reset", () => ({
	hardResetAndReload: vi.fn().mockResolvedValue(undefined),
}))

const mockedReset = vi.mocked(hardResetAndReload)

describe("SystemCachePanel", () => {
	beforeEach(() => {
		mockedReset.mockClear()
	})

	it("does not touch browser state until confirmed", async () => {
		const user = userEvent.setup()
		render(<SystemCachePanel />)

		await user.click(screen.getByRole("button", { name: "Clear all" }))
		await screen.findByRole("dialog")
		expect(mockedReset).not.toHaveBeenCalled()
	})

	it("wipes browser-side local data on confirm", async () => {
		const user = userEvent.setup()
		render(<SystemCachePanel />)

		await user.click(screen.getByRole("button", { name: "Clear all" }))
		const dialog = await screen.findByRole("dialog")
		await user.click(within(dialog).getByRole("button", { name: "Clear all" }))

		expect(mockedReset).toHaveBeenCalledTimes(1)
		expect(mockedReset).toHaveBeenCalledWith("Browser data cleared. Reloading…")
	})
})
