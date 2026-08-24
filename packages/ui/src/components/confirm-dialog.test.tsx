import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { testI18n, renderWithI18n } from "../test/i18n"
import { ConfirmDialog } from "./confirm-dialog"

function renderDialog(
	overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {},
) {
	const onOpenChange = vi.fn()
	const onConfirm = vi.fn()
	renderWithI18n(
		<ConfirmDialog
			open
			onOpenChange={onOpenChange}
			title="Title"
			confirmLabel="Confirm"
			isPending={false}
			onConfirm={onConfirm}
			{...overrides}
		/>,
	)
	return { onOpenChange, onConfirm }
}

describe("ConfirmDialog", () => {
	it("defaults the cancel button to the shared cancel copy", async () => {
		const { onOpenChange } = renderDialog()
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
		expect(onOpenChange).toHaveBeenCalledWith(false)
	})

	it("uses the localized cancel copy in another language", async () => {
		await testI18n.changeLanguage("zh")
		renderDialog()
		expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument()
		await testI18n.changeLanguage("en")
	})
})
