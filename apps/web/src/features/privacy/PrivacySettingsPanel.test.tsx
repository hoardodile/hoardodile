import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { prefKeys } from "@/lib/keys"
import { prefSyncStore } from "@/lib/prefSyncStore"
import { AutoSignOutControls } from "./PrivacySettingsPanel"

describe("PrivacySettingsPanel", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	afterEach(() => {
		prefSyncStore.clear()
		localStorage.clear()
	})

	it("toggles the auto-logout switch and writes the pref", async () => {
		const user = userEvent.setup()
		render(<AutoSignOutControls />)

		// Off by default — the first click turns it on.
		await user.click(screen.getByTestId("privacy-auto-logout-switch"))
		expect(localStorage.getItem(prefKeys.privacyAutoLogoutEnabled)).toBe("1")
	})

	it("writes the idle timeout and auto-logout delay as server-readable numbers", async () => {
		const user = userEvent.setup()
		render(<AutoSignOutControls />)

		await user.click(screen.getByTestId("privacy-idle-timeout"))
		await user.click(await screen.findByText("1 hour"))
		expect(localStorage.getItem(prefKeys.authSessionIdleTimeoutSeconds)).toBe(
			"3600",
		)

		await user.click(screen.getByTestId("privacy-auto-logout-delay"))
		await user.click(await screen.findByText("Immediately"))
		expect(localStorage.getItem(prefKeys.privacyAutoLogoutDelayMs)).toBe("0")
	})
})
