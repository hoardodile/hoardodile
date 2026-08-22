import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { FontProvider } from "@/components/common/FontProvider"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"
import { DocAppearanceSettingsDialog } from "./DocAppearanceSettingsDialog"

function renderDialog() {
	return render(
		<FontProvider>
			<DocAppearanceSettingsDialog open onOpenChange={() => undefined} />
		</FontProvider>,
	)
}

describe("prefKeys doc font slots", () => {
	it("exposes heading and inherit keys alongside the body keys", () => {
		expect(prefKeys.docUiFont).toBe("document.uiFont")
		expect(prefKeys.docUiFontInherit).toBe("document.uiFontInherit")
		expect(prefKeys.docUiHeadingFont).toBe("document.uiHeadingFont")
		expect(prefKeys.docUiHeadingFontInherit).toBe(
			"document.uiHeadingFontInherit",
		)
		expect(prefKeys.docEditorFont).toBe("document.editorFont")
		expect(prefKeys.docEditorFontInherit).toBe("document.editorFontInherit")
	})
})

describe("DocAppearanceSettingsDialog", () => {
	it("keeps the editor font as a single picker and splits the page font into Body/Headings tabs", () => {
		renderDialog()

		expect(
			screen.getByRole("heading", { name: "Editor Font" }),
		).toBeInTheDocument()
		expect(
			screen.getByRole("heading", { name: "Page Font" }),
		).toBeInTheDocument()
		// Only the page font section has tabs.
		expect(screen.getAllByRole("tab", { name: "Body" })).toHaveLength(1)
		expect(screen.getAllByRole("tab", { name: "Headings" })).toHaveLength(1)

		expect(screen.getByTestId("doc-editor-font-picker")).toBeInTheDocument()
		expect(screen.getByTestId("doc-ui-font-picker")).toBeInTheDocument()
		// Every picker carries an inherit switch; the picker stays visible
		// regardless of the switch state.
		expect(screen.getAllByRole("switch").length).toBeGreaterThanOrEqual(2)
	})

	it("keeps the page heading picker editable while inheriting", async () => {
		const user = userEvent.setup()
		renderDialog()

		await user.click(screen.getByRole("tab", { name: "Headings" }))
		const picker = screen.getByTestId("doc-ui-heading-font-picker")
		expect(picker).toBeInTheDocument()
		// The default serif stack applies until the user touches the pref.
		// Switch to inheriting — the stack stays stored in the background.
		await user.click(
			within(picker).getByRole("switch", { name: "Inherit global font" }),
		)
		expect(prefSync.get(prefKeys.docUiHeadingFontInherit)).toBe("1")

		// The picker stays interactive while inheriting.
		await user.click(within(picker).getByRole("button", { name: "Georgia" }))
		const stored = prefSync.get(prefKeys.docUiHeadingFont)
		expect(JSON.parse(stored ?? "[]")).toEqual(["Times New Roman", "serif"])
	})

	it("writes the inherit switch to its own pref without clearing the stack", async () => {
		const user = userEvent.setup()
		prefSync.set(prefKeys.docEditorFont, '["inter"]')
		renderDialog()

		// Stack present → not inheriting initially.
		const picker = screen.getByTestId("doc-editor-font-picker")
		const inheritSwitch = within(picker).getByRole("switch", {
			name: "Inherit global font",
		})
		expect(inheritSwitch).not.toBeChecked()
		await user.click(inheritSwitch)

		expect(prefSync.get(prefKeys.docEditorFontInherit)).toBe("1")
		// The stored stack survives the toggle.
		expect(JSON.parse(prefSync.get(prefKeys.docEditorFont) ?? "[]")).toEqual([
			"inter",
		])
	})
})
