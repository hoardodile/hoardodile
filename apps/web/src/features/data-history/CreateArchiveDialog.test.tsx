import { render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
import { CreateArchiveDialog } from "./CreateArchiveDialog"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}))

describe("CreateArchiveDialog", () => {
	function renderDialog() {
		return render(
			<CreateArchiveDialog
				open
				onOpenChange={() => {}}
				onConfirm={() => {}}
				pending={false}
			/>,
		)
	}

	test("renders the automatic-snapshot freeze hint", () => {
		renderDialog()
		expect(
			screen.getByText("dataHistory.confirm.archiveAutoHint"),
		).toBeInTheDocument()
	})
})
