import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, test, vi } from "vitest"
import { SearchField } from "./search-field"

describe("SearchField", () => {
	test("debounces keystrokes before committing", async () => {
		const user = userEvent.setup()
		const onCommit = vi.fn()
		render(
			<SearchField value="" onCommit={onCommit} testId="search" delayMs={50} />,
		)
		await user.type(screen.getByTestId("search"), "hello")
		expect(onCommit).not.toHaveBeenCalledWith("hello")
		await waitFor(() => {
			expect(onCommit).toHaveBeenCalledWith("hello")
		})
	})

	test("re-syncs with external resets", () => {
		const { rerender } = render(
			<SearchField value="foo" onCommit={() => {}} testId="search" />,
		)
		const input = screen.getByTestId("search") as HTMLInputElement
		expect(input.value).toBe("foo")
		rerender(<SearchField value="" onCommit={() => {}} testId="search" />)
		expect(input.value).toBe("")
	})

	test("commits only on Enter in commitOnEnterOnly mode", async () => {
		const user = userEvent.setup()
		const onCommit = vi.fn()
		const onSubmit = vi.fn()
		render(
			<SearchField
				value=""
				onCommit={onCommit}
				onSubmit={onSubmit}
				commitOnEnterOnly
				testId="search"
				delayMs={10}
			/>,
		)
		await user.type(screen.getByTestId("search"), "harbor")
		// Typing never commits on its own in this mode.
		await waitFor(() => {
			expect(onCommit).not.toHaveBeenCalled()
		})
		await user.keyboard("{Enter}")
		expect(onSubmit).toHaveBeenCalledWith("harbor")
		expect(onCommit).not.toHaveBeenCalled()
	})

	test("commits immediately and submits on Enter in debounced mode", async () => {
		const user = userEvent.setup()
		const onCommit = vi.fn()
		const onSubmit = vi.fn()
		render(
			<SearchField
				value=""
				onCommit={onCommit}
				onSubmit={onSubmit}
				testId="search"
				delayMs={10}
			/>,
		)
		await user.type(screen.getByTestId("search"), "harbor")
		await user.keyboard("{Enter}")
		expect(onCommit).toHaveBeenCalledWith("harbor")
		expect(onSubmit).toHaveBeenCalledWith("harbor")
	})

	test("submits the draft through the form", async () => {
		const user = userEvent.setup()
		const onSubmit = vi.fn()
		render(<SearchField value="" onSubmit={onSubmit} testId="search" />)
		await user.type(screen.getByTestId("search"), "harbor")
		await user.keyboard("{Enter}")
		expect(onSubmit).toHaveBeenCalledWith("harbor")
	})

	test("renders the global-search-input testid by default", () => {
		render(<SearchField value="" />)
		expect(screen.getByTestId("global-search-input")).not.toBeNull()
	})
})
