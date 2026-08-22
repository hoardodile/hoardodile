import { TooltipProvider } from "@hoardodile/ui/components/tooltip"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { describe, expect, test, vi } from "vitest"
import { CharChipsPicker } from "./CharChipsPicker"

vi.mock("./CharSelectorDialog", () => ({
	useCharactersByIds: vi.fn((ids: readonly string[]) => ({
		isLoading: false,
		data: ids.map((id) => ({ id, name: `Char ${id}`, updatedAt: 0 })),
	})),
	CharSelectorDialog: vi.fn(
		(props: {
			readonly open: boolean
			readonly onConfirm: (ids: readonly string[]) => void
		}) =>
			props.open ? (
				<button
					type="button"
					data-testid="mock-confirm"
					onClick={() => props.onConfirm(["extra-char"])}
				>
					confirm
				</button>
			) : null,
	),
}))

function createWrapper() {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return function Wrapper({ children }: { readonly children: ReactNode }) {
		return (
			<QueryClientProvider client={qc}>
				<TooltipProvider>{children}</TooltipProvider>
			</QueryClientProvider>
		)
	}
}

describe("CharChipsPicker lockedIds", () => {
	test("locked chip has no remove button", () => {
		render(
			<CharChipsPicker
				ids={["locked-char", "free-char"]}
				lockedIds={["locked-char"]}
				onChange={() => undefined}
				testId="picker"
			/>,
			{ wrapper: createWrapper() },
		)
		expect(screen.queryByTestId("picker-chip-locked-char-remove")).toBeNull()
		expect(screen.getByTestId("picker-chip-free-char-remove")).toBeDefined()
	})

	test("removing unlocked id keeps locked ids", async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		render(
			<CharChipsPicker
				ids={["locked-char", "free-char"]}
				lockedIds={["locked-char"]}
				onChange={onChange}
				testId="picker"
			/>,
			{ wrapper: createWrapper() },
		)
		await user.click(screen.getByTestId("picker-chip-free-char-remove"))
		expect(onChange).toHaveBeenCalledWith(["locked-char"])
	})

	test("selector confirm merges locked ids back in", async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		render(
			<CharChipsPicker
				ids={["locked-char"]}
				lockedIds={["locked-char"]}
				onChange={onChange}
				testId="picker"
			/>,
			{ wrapper: createWrapper() },
		)
		await user.click(screen.getByTestId("picker-linkCharacters"))
		await user.click(screen.getByTestId("mock-confirm"))
		expect(onChange).toHaveBeenCalledWith(["locked-char", "extra-char"])
	})

	test("add button is a secondary Link button after the chips", () => {
		render(
			<CharChipsPicker
				ids={["free-char"]}
				onChange={() => undefined}
				testId="picker"
			/>,
			{ wrapper: createWrapper() },
		)
		const addButton = screen.getByTestId("picker-linkCharacters")
		expect(addButton).toHaveAccessibleName()
		expect(addButton.textContent).toBe("Link")
		const chip = screen.getByTestId("picker-chip-free-char")
		expect(
			chip.compareDocumentPosition(addButton) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy()
	})

	test("add button shows in the empty editable state", () => {
		render(
			<CharChipsPicker ids={[]} onChange={() => undefined} testId="picker" />,
			{ wrapper: createWrapper() },
		)
		expect(screen.getByTestId("picker-linkCharacters")).toBeDefined()
	})

	test("view-only mode has no add button", () => {
		render(<CharChipsPicker ids={["free-char"]} testId="picker" />, {
			wrapper: createWrapper(),
		})
		expect(screen.queryByTestId("picker-linkCharacters")).toBeNull()
	})
})
