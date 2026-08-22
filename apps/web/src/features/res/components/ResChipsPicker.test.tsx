import { TooltipProvider } from "@hoardodile/ui/components/tooltip"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { describe, expect, test, vi } from "vitest"
import { resKeys } from "@/features/res/api"
import { ResChipsPicker } from "./ResChipsPicker"

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, ...props }: { readonly children: ReactNode }) => (
		<a {...props}>{children}</a>
	),
}))

vi.mock("@/features/res/components/ResSelectorDialog", () => ({
	ResSelectorDialog: vi.fn(
		(props: {
			readonly open: boolean
			readonly onConfirm: (ids: readonly string[]) => void
		}) =>
			props.open ? (
				<button
					type="button"
					data-testid="mock-confirm"
					onClick={() => props.onConfirm(["extra-res"])}
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
	for (const id of ["locked-res", "free-res", "extra-res"]) {
		qc.setQueryData(resKeys.detail(id), { id, name: `Res ${id}` })
	}
	return function Wrapper({ children }: { readonly children: ReactNode }) {
		return (
			<QueryClientProvider client={qc}>
				<TooltipProvider>{children}</TooltipProvider>
			</QueryClientProvider>
		)
	}
}

describe("ResChipsPicker lockedIds", () => {
	test("locked chip has no remove button", () => {
		render(
			<ResChipsPicker
				ids={["locked-res", "free-res"]}
				lockedIds={["locked-res"]}
				onChange={() => undefined}
				testId="picker"
			/>,
			{ wrapper: createWrapper() },
		)
		expect(screen.queryByTestId("picker-chip-locked-res-remove")).toBeNull()
		expect(screen.getByTestId("picker-chip-free-res-remove")).toBeDefined()
	})

	test("removing unlocked id keeps locked ids", async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		render(
			<ResChipsPicker
				ids={["locked-res", "free-res"]}
				lockedIds={["locked-res"]}
				onChange={onChange}
				testId="picker"
			/>,
			{ wrapper: createWrapper() },
		)
		await user.click(screen.getByTestId("picker-chip-free-res-remove"))
		expect(onChange).toHaveBeenCalledWith(["locked-res"])
	})

	test("selector confirm merges locked ids back in", async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		render(
			<ResChipsPicker
				ids={["locked-res"]}
				lockedIds={["locked-res"]}
				onChange={onChange}
				testId="picker"
			/>,
			{ wrapper: createWrapper() },
		)
		await user.click(screen.getByTestId("picker-add"))
		await user.click(screen.getByTestId("mock-confirm"))
		expect(onChange).toHaveBeenCalledWith(["locked-res", "extra-res"])
	})

	test("add button is a secondary Link button after the chips", () => {
		render(
			<ResChipsPicker
				ids={["free-res"]}
				onChange={() => undefined}
				testId="picker"
			/>,
			{ wrapper: createWrapper() },
		)
		const addButton = screen.getByTestId("picker-add")
		expect(addButton).toHaveAccessibleName()
		expect(addButton.textContent).toBe("Link")
		const chip = screen.getByTestId("picker-chip-free-res")
		expect(
			chip.compareDocumentPosition(addButton) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy()
	})

	test("add button shows in the empty editable state", () => {
		render(
			<ResChipsPicker ids={[]} onChange={() => undefined} testId="picker" />,
			{ wrapper: createWrapper() },
		)
		expect(screen.getByTestId("picker-add")).toBeDefined()
	})

	test("view-only mode has no add button", () => {
		render(<ResChipsPicker ids={["free-res"]} testId="picker" />, {
			wrapper: createWrapper(),
		})
		expect(screen.queryByTestId("picker-add")).toBeNull()
	})

	test("view-only chip is a link to the resource", () => {
		render(<ResChipsPicker ids={["free-res"]} testId="picker" />, {
			wrapper: createWrapper(),
		})
		const chip = screen.getByTestId("picker-chip-free-res")
		expect(chip.tagName).toBe("A")
		expect(chip).toHaveAttribute("to", "/resources/$id")
	})

	test("editable chip is not a link", () => {
		render(
			<ResChipsPicker
				ids={["free-res"]}
				onChange={() => undefined}
				testId="picker"
			/>,
			{ wrapper: createWrapper() },
		)
		expect(screen.getByTestId("picker-chip-free-res").tagName).not.toBe("A")
	})
})
