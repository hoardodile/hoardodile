import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { webAuthKeys } from "@/features/auth/session"
import { WebSessionControls } from "./WebSessionControls"

it("stores browser-only switches locally without scheduling server writes", async () => {
	const fetch = vi.fn()
	vi.stubGlobal("fetch", fetch)
	const user = userEvent.setup()
	render(<WebSessionControls />)
	await user.click(screen.getByTestId("web-requireUnlock-switch"))
	await user.click(screen.getByTestId("web-autoLock-switch"))
	expect(localStorage.getItem(webAuthKeys.requireUnlock)).toBe("1")
	expect(localStorage.getItem(webAuthKeys.autoLock)).toBe("1")
	expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
	expect(fetch).not.toHaveBeenCalled()
})

it("migrates the local automatic sign-out choice once and ignores its old delay", () => {
	localStorage.setItem("privacy.autoLogoutEnabled", "1")
	localStorage.setItem("privacy.autoLogoutDelayMs", "900000")
	render(<WebSessionControls />)
	expect(screen.getByTestId("web-autoLock-switch")).toBeChecked()
	expect(localStorage.getItem(webAuthKeys.autoLock)).toBe("1")
})
