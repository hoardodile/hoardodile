import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { CharChipsPickerProps } from "@/features/char/components/CharChipsPicker"
import type { ResChipsPickerProps } from "@/features/res/components/ResChipsPicker"
import { CommentComposer } from "./CommentComposer"

const mocks = vi.hoisted(() => ({
	charPickerProps: vi.fn(),
	resPickerProps: vi.fn(),
	charConfirm: [] as readonly string[],
	resConfirm: [] as readonly string[],
}))

vi.mock("@/features/char/components/CharChipsPicker", () => ({
	CharChipsPicker: (props: CharChipsPickerProps) => {
		mocks.charPickerProps(props)
		return <div data-testid="char-chips-picker" />
	},
}))

vi.mock("@/features/res/components/ResChipsPicker", () => ({
	ResChipsPicker: (props: ResChipsPickerProps) => {
		mocks.resPickerProps(props)
		return <div data-testid="res-chips-picker" />
	},
}))

vi.mock("@/features/char/components/CharSelectorDialog", () => ({
	CharSelectorDialog: (props: {
		readonly open: boolean
		readonly onConfirm: (ids: readonly string[]) => void
	}) =>
		props.open ? (
			<button
				type="button"
				data-testid="char-dialog-confirm"
				onClick={() => props.onConfirm(mocks.charConfirm)}
			>
				confirm
			</button>
		) : null,
}))

vi.mock("@/features/res/components/ResSelectorDialog", () => ({
	ResSelectorDialog: (props: {
		readonly open: boolean
		readonly onConfirm: (ids: readonly string[]) => void
	}) =>
		props.open ? (
			<button
				type="button"
				data-testid="res-dialog-confirm"
				onClick={() => props.onConfirm(mocks.resConfirm)}
			>
				confirm
			</button>
		) : null,
}))

beforeEach(() => {
	mocks.charPickerProps.mockClear()
	mocks.resPickerProps.mockClear()
	mocks.charConfirm = []
	mocks.resConfirm = []
})

function createWrapper() {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return function Wrapper({ children }: { readonly children: ReactNode }) {
		return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
	}
}

describe("CommentComposer attach UX", () => {
	test("no initial ids: add buttons show, chip rows hidden", () => {
		render(<CommentComposer testId="composer" />, {
			wrapper: createWrapper(),
		})
		expect(screen.getByTestId("composer-add-character-row")).toBeDefined()
		expect(screen.getByTestId("composer-add-resource-row")).toBeDefined()
		expect(screen.queryByTestId("char-chips-picker")).toBeNull()
		expect(screen.queryByTestId("res-chips-picker")).toBeNull()
	})

	test("add button opens the selector dialog directly", async () => {
		const user = userEvent.setup()
		render(<CommentComposer testId="composer" />, {
			wrapper: createWrapper(),
		})
		expect(screen.queryByTestId("char-dialog-confirm")).toBeNull()
		await user.click(screen.getByTestId("composer-add-character-row"))
		expect(screen.getByTestId("char-dialog-confirm")).toBeDefined()
	})

	test("confirming with a selection reveals the chip row and hides the add button", async () => {
		const user = userEvent.setup()
		mocks.charConfirm = ["char-1"]
		render(<CommentComposer testId="composer" />, {
			wrapper: createWrapper(),
		})
		await user.click(screen.getByTestId("composer-add-character-row"))
		await user.click(screen.getByTestId("char-dialog-confirm"))
		expect(screen.getByTestId("char-chips-picker")).toBeDefined()
		expect(mocks.charPickerProps).toHaveBeenCalledWith(
			expect.objectContaining({ ids: ["char-1"] }),
		)
		expect(screen.queryByTestId("composer-add-character-row")).toBeNull()
		// The resource add button is unaffected.
		expect(screen.getByTestId("composer-add-resource-row")).toBeDefined()
	})

	test("confirming with an empty selection changes nothing", async () => {
		const user = userEvent.setup()
		mocks.resConfirm = []
		render(<CommentComposer testId="composer" />, {
			wrapper: createWrapper(),
		})
		await user.click(screen.getByTestId("composer-add-resource-row"))
		await user.click(screen.getByTestId("res-dialog-confirm"))
		expect(screen.queryByTestId("res-chips-picker")).toBeNull()
		expect(screen.getByTestId("composer-add-resource-row")).toBeDefined()
	})

	test("initial locked ids render as chip rows with no add buttons", () => {
		render(
			<CommentComposer
				testId="composer"
				initialCharacterIds={["char-1"]}
				lockInitialCharacterLinks
				initialResourceIds={["res-1"]}
				lockInitialResourceLinks
			/>,
			{ wrapper: createWrapper() },
		)
		expect(mocks.charPickerProps).toHaveBeenCalledWith(
			expect.objectContaining({
				ids: ["char-1"],
				lockedIds: ["char-1"],
			}),
		)
		expect(mocks.resPickerProps).toHaveBeenCalledWith(
			expect.objectContaining({
				ids: ["res-1"],
				lockedIds: ["res-1"],
			}),
		)
		expect(screen.queryByTestId("composer-add-character-row")).toBeNull()
		expect(screen.queryByTestId("composer-add-resource-row")).toBeNull()
	})
})
