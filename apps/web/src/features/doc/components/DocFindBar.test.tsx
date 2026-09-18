/**
 * @vitest-environment jsdom
 */

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"
import { DocFindBar, type DocFindBarProps } from "./DocFindBar"

function renderBar(overrides: Partial<DocFindBarProps> = {}) {
	const props: DocFindBarProps = {
		query: "cat",
		replacement: "",
		caseSensitive: false,
		currentIndex: 2,
		total: 5,
		replaceOpen: false,
		readOnly: false,
		inputRef: createRef<HTMLInputElement>(),
		replacementRef: createRef<HTMLInputElement>(),
		onQueryChange: vi.fn(),
		onReplacementChange: vi.fn(),
		onToggleCase: vi.fn(),
		onToggleReplace: vi.fn(),
		onNext: vi.fn(),
		onPrevious: vi.fn(),
		onReplace: vi.fn(),
		onReplaceAll: vi.fn(),
		onUndo: vi.fn(),
		onRedo: vi.fn(),
		onClose: vi.fn(),
		...overrides,
	}
	render(<DocFindBar {...props} />)
	return props
}

describe("DocFindBar", () => {
	it("shows the active match position out of the total", () => {
		renderBar()
		expect(screen.getByTestId("document-find-count")).toHaveTextContent("2 / 5")
	})

	it("says so when the query matches nothing", () => {
		renderBar({ currentIndex: 0, total: 0 })
		expect(screen.getByTestId("document-find-count")).toHaveTextContent(
			"No matches",
		)
	})

	it("stays quiet while the query is empty", () => {
		renderBar({ query: "", currentIndex: 0, total: 0 })
		expect(screen.getByTestId("document-find-count")).toHaveTextContent("")
	})

	it("disables navigation without matches", () => {
		renderBar({ currentIndex: 0, total: 0 })
		expect(screen.getByTestId("document-find-next")).toBeDisabled()
		expect(screen.getByTestId("document-find-prev")).toBeDisabled()
	})

	it("walks matches with Enter and Shift+Enter", async () => {
		const user = userEvent.setup()
		const props = renderBar()
		const input = screen.getByTestId("document-find-input")

		await user.click(input)
		await user.keyboard("{Enter}")
		expect(props.onNext).toHaveBeenCalledTimes(1)

		await user.keyboard("{Shift>}{Enter}{/Shift}")
		expect(props.onPrevious).toHaveBeenCalledTimes(1)
	})

	it("closes on Escape", async () => {
		const user = userEvent.setup()
		const props = renderBar()

		await user.click(screen.getByTestId("document-find-input"))
		await user.keyboard("{Escape}")
		expect(props.onClose).toHaveBeenCalledTimes(1)
	})

	it("replaces from the replacement field's Enter", async () => {
		const user = userEvent.setup()
		const props = renderBar({ replaceOpen: true })

		await user.click(screen.getByTestId("document-find-replacement"))
		await user.keyboard("{Enter}")
		expect(props.onReplace).toHaveBeenCalledTimes(1)
	})

	it("keeps the replace row collapsed until it is toggled open", async () => {
		const user = userEvent.setup()
		const props = renderBar()

		// Compact by default: one row, no replacement field.
		expect(screen.queryByTestId("document-find-replacement")).toBeNull()
		expect(screen.queryByTestId("document-find-replace")).toBeNull()

		const toggle = screen.getByTestId("document-find-toggle-replace")
		expect(toggle).toHaveAttribute("aria-expanded", "false")

		await user.click(toggle)
		expect(props.onToggleReplace).toHaveBeenCalledTimes(1)
	})

	it("shows the expanded replace row", () => {
		renderBar({ replaceOpen: true })
		expect(screen.getByTestId("document-find-toggle-replace")).toHaveAttribute(
			"aria-expanded",
			"true",
		)
		expect(screen.getByTestId("document-find-replacement")).toBeInTheDocument()
		expect(screen.getByTestId("document-find-replace-all")).toBeInTheDocument()
	})

	it("hides every replace control when the body is read-only", () => {
		renderBar({ readOnly: true, replaceOpen: true })
		expect(screen.queryByTestId("document-find-toggle-replace")).toBeNull()
		expect(screen.queryByTestId("document-find-replacement")).toBeNull()
		expect(screen.queryByTestId("document-find-replace")).toBeNull()
		expect(screen.queryByTestId("document-find-replace-all")).toBeNull()
		// Searching still works where the body cannot be edited.
		expect(screen.getByTestId("document-find-input")).toBeInTheDocument()
	})

	it("keeps replace unavailable without matches", () => {
		renderBar({ currentIndex: 0, total: 0, replaceOpen: true })
		expect(screen.getByTestId("document-find-replace")).toBeDisabled()
		expect(screen.getByTestId("document-find-replace-all")).toBeDisabled()
	})

	it("toggles case sensitivity", async () => {
		const user = userEvent.setup()
		const props = renderBar({ caseSensitive: true })

		const toggle = screen.getByTestId("document-find-match-case")
		expect(toggle).toHaveAttribute("aria-pressed", "true")

		await user.click(toggle)
		expect(props.onToggleCase).toHaveBeenCalledTimes(1)
	})

	it("routes the editor's undo shortcuts from the fields to the document", async () => {
		const user = userEvent.setup()
		const props = renderBar({ replaceOpen: true })

		await user.click(screen.getByTestId("document-find-replacement"))
		await user.keyboard("{Control>}z{/Control}")
		expect(props.onUndo).toHaveBeenCalledTimes(1)

		await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}")
		expect(props.onRedo).toHaveBeenCalledTimes(1)
	})
})
