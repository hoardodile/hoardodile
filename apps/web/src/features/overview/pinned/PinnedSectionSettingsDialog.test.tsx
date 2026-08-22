import { TooltipProvider } from "@hoardodile/ui/components/tooltip"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { PinnedSectionSettingsDialog } from "./PinnedSectionSettingsDialog"
import type { PinnedSectionItem } from "./types"

function createMockTrpcClient(
	spies: {
		characterListCards?: () => Promise<unknown>
		resourceListCards?: () => Promise<unknown>
	} = {},
): TRPCClient {
	return new Proxy(
		{},
		{
			get(_, namespace: string) {
				return new Proxy(
					{},
					{
						get(_, procedure: string) {
							return {
								query: async () => {
									if (namespace === "character" && procedure === "listCards") {
										return (
											spies.characterListCards?.() ?? {
												rows: [],
												total: 0,
												page: 1,
												size: 6,
											}
										)
									}
									if (namespace === "resource" && procedure === "listCards") {
										return (
											spies.resourceListCards?.() ?? {
												rows: [],
												total: 0,
												page: 1,
												size: 6,
											}
										)
									}
									if (
										(namespace === "category" || namespace === "tag") &&
										procedure === "listAll"
									) {
										return []
									}
									if (
										namespace === "character" &&
										procedure === "listRelationshipTypes"
									) {
										return []
									}
									if (namespace === "trait" && procedure === "listAll") {
										return []
									}
									return undefined
								},
								mutate: async () => undefined,
							}
						},
					},
				)
			},
		},
	) as unknown as TRPCClient
}

beforeEach(() => {
	localStorage.clear()
	prefSync.set(prefKeys.overviewPinnedCharacters, "[]")
	prefSync.set(prefKeys.overviewPinnedResources, "[]")
	setTrpcClient(createMockTrpcClient())
})

function renderDialog(props: {
	open?: boolean
	entityType?: "resource" | "character"
	items?: readonly PinnedSectionItem[]
	currentFilters?: { query?: string }
	onChange?: (items: readonly PinnedSectionItem[]) => void
	onOpenChange?: (open: boolean) => void
}) {
	const {
		open = true,
		entityType = "character",
		items = [],
		currentFilters = { query: "current" },
		onChange = vi.fn(),
		onOpenChange = vi.fn(),
	} = props

	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})

	return render(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<PinnedSectionSettingsDialog
					open={open}
					onOpenChange={onOpenChange}
					sectionTitle="Characters"
					entityType={entityType}
					items={items}
					currentFilters={currentFilters}
					onChange={onChange}
				/>
			</TooltipProvider>
		</QueryClientProvider>,
	)
}

async function selectItemByTitle(
	user: ReturnType<typeof userEvent.setup>,
	title: string,
) {
	// Exact match: a fuzzy /One/i would also catch the footer's "Done".
	await user.click(
		screen.getByRole("button", { name: new RegExp(`^${title}$`, "i") }),
	)
}

describe("PinnedSectionSettingsDialog", () => {
	it("renders empty state when no items", async () => {
		renderDialog({})
		expect(screen.getByText("No pinned views yet")).toBeInTheDocument()
		expect(screen.getByTestId("pinned-add-button")).toBeInTheDocument()
	})

	it("does not fetch pinned queries while closed", async () => {
		const characterListCards = vi.fn(async () => ({
			rows: [],
			total: 0,
			page: 1,
			size: 6,
		}))
		setTrpcClient(
			createMockTrpcClient({
				characterListCards,
			}),
		)
		renderDialog({
			open: false,
			items: [{ id: "pin-1", title: "One" }],
		})
		await waitFor(() => expect(characterListCards).not.toHaveBeenCalled())
	})

	it("adds a new item with current filters without saving", async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		renderDialog({
			currentFilters: { query: "filter-a" },
			onChange,
		})

		await user.click(screen.getByTestId("pinned-add-button"))

		expect(screen.getByDisplayValue("")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Preview/i })).toBeInTheDocument()
		expect(onChange).not.toHaveBeenCalled()
	})

	it("disables add when maximum is reached", async () => {
		const items: PinnedSectionItem[] = Array.from({ length: 6 }, (_, i) => ({
			id: `pin-${i}`,
			title: `Pin ${i}`,
		}))
		renderDialog({ items })

		expect(screen.getByTestId("pinned-add-button")).toBeDisabled()
	})

	it("shows saved config values in the editor when selected", async () => {
		const user = userEvent.setup()
		renderDialog({
			items: [
				{
					id: "pin-1",
					title: "Saved",
					showWhenEmpty: true,
					size: 12,
				},
			],
		})

		await selectItemByTitle(user, "Saved")
		expect(screen.getByDisplayValue("Saved")).toBeInTheDocument()
		expect(screen.getByDisplayValue("12")).toBeInTheDocument()
		expect(
			screen.getByRole("switch", {
				name: "Show when empty",
			}),
		).toBeChecked()
	})

	it("updates draft title and size without saving", async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		renderDialog({
			items: [{ id: "pin-1", title: "Old", size: 6 }],
			onChange,
		})

		await selectItemByTitle(user, "Old")
		const titleInput = screen.getByDisplayValue("Old")
		fireEvent.change(titleInput, { target: { value: "New" } })

		const sizeInput = screen.getByDisplayValue("6")
		fireEvent.change(sizeInput, { target: { value: "4" } })

		await waitFor(() => {
			expect(screen.getByDisplayValue("New")).toBeInTheDocument()
			expect(screen.getByDisplayValue("4")).toBeInTheDocument()
		})
		expect(onChange).not.toHaveBeenCalled()
	})

	it("toggles show when empty in draft without saving", async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		renderDialog({
			items: [{ id: "pin-1", title: "One", showWhenEmpty: false }],
			onChange,
		})

		await selectItemByTitle(user, "One")
		await user.click(
			screen.getByRole("switch", {
				name: "Show when empty",
			}),
		)

		await waitFor(() => {
			expect(
				screen.getByRole("switch", {
					name: "Show when empty",
				}),
			).toBeChecked()
		})
		expect(onChange).not.toHaveBeenCalled()
	})

	it("toggles enabled in draft without saving", async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		renderDialog({
			items: [{ id: "pin-1", title: "One", enabled: true }],
			onChange,
		})

		const toggle = screen.getByRole("switch", {
			name: /Enable or disable/i,
		})
		await user.click(toggle)

		await waitFor(() => {
			expect(toggle).not.toBeChecked()
		})
		expect(onChange).not.toHaveBeenCalled()
	})

	it("deletes the selected item after confirming", async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		renderDialog({
			items: [
				{ id: "pin-1", title: "One" },
				{ id: "pin-2", title: "Two" },
			],
			onChange,
		})

		await selectItemByTitle(user, "One")
		await user.click(screen.getByRole("button", { name: /Delete/i }))
		await user.click(screen.getByTestId("pinned-delete-confirm"))

		await waitFor(() => {
			expect(screen.queryByDisplayValue("One")).not.toBeInTheDocument()
		})
		expect(screen.getByRole("button", { name: /Two/i })).toBeInTheDocument()
		expect(onChange).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ id: "pin-2" })]),
		)
		expect(onChange).not.toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ id: "pin-1" })]),
		)
	})

	it("saves all draft changes without closing the dialog", async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		const onOpenChange = vi.fn()
		renderDialog({
			items: [{ id: "pin-1", title: "Old", size: 6 }],
			onChange,
			onOpenChange,
		})

		await selectItemByTitle(user, "Old")
		const titleInput = screen.getByDisplayValue("Old")
		fireEvent.change(titleInput, { target: { value: "New" } })

		await user.click(screen.getByRole("button", { name: "Save section" }))

		await waitFor(() => {
			expect(onChange).toHaveBeenLastCalledWith(
				expect.arrayContaining([
					expect.objectContaining({ id: "pin-1", title: "New", size: 6 }),
				]),
			)
		})
		expect(onOpenChange).not.toHaveBeenCalled()
	})

	it("opens a search preview dialog with the item filters", async () => {
		const user = userEvent.setup()
		renderDialog({
			items: [{ id: "pin-1", title: "One", query: "preview-query" }],
		})

		await user.click(screen.getByRole("button", { name: /Preview/i }))

		await waitFor(() => {
			expect(screen.getByText("Preview filters")).toBeInTheDocument()
		})
		expect(screen.getByDisplayValue("preview-query")).toBeInTheDocument()
	})

	it("cancels without saving", async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		const onOpenChange = vi.fn()
		renderDialog({
			items: [{ id: "pin-1", title: "One" }],
			onChange,
			onOpenChange,
		})

		await selectItemByTitle(user, "One")
		const titleInput = screen.getByDisplayValue("One")
		fireEvent.change(titleInput, { target: { value: "Changed" } })

		await user.click(screen.getByRole("button", { name: "Cancel" }))

		expect(onChange).not.toHaveBeenCalled()
		expect(onOpenChange).toHaveBeenCalledWith(false)
	})

	it("shows the per-item auto-refresh selector for a random item", async () => {
		const user = userEvent.setup()
		renderDialog({
			items: [{ id: "pin-1", title: "One", random: true }],
		})

		await selectItemByTitle(user, "One")

		const select = screen.getByTestId("pinned-item-refresh-interval")
		expect(select).toHaveTextContent("Always")
		expect(screen.getByText(/fresh random set/)).toBeInTheDocument()
	})

	it("hides the per-item auto-refresh selector for a non-random item", async () => {
		const user = userEvent.setup()
		renderDialog({
			items: [{ id: "pin-1", title: "One" }],
		})

		await selectItemByTitle(user, "One")

		expect(
			screen.queryByTestId("pinned-item-refresh-interval"),
		).not.toBeInTheDocument()
	})

	it("writes the chosen refresh interval to the item on save", async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		renderDialog({
			items: [{ id: "pin-1", title: "One", random: true }],
			onChange,
		})

		await selectItemByTitle(user, "One")
		await user.click(screen.getByTestId("pinned-item-refresh-interval"))
		await user.click(
			await screen.findByRole("menuitemradio", { name: "Every hour" }),
		)
		await user.click(screen.getByRole("button", { name: "Save section" }))

		await waitFor(() => {
			expect(onChange).toHaveBeenLastCalledWith(
				expect.arrayContaining([
					expect.objectContaining({ id: "pin-1", refreshSec: 3600 }),
				]),
			)
		})
	})

	it("no longer shows the global auto-refresh section", () => {
		renderDialog({
			items: [{ id: "pin-1", title: "One", random: true }],
		})

		expect(
			screen.queryByTestId("pinned-refresh-interval"),
		).not.toBeInTheDocument()
	})
})
