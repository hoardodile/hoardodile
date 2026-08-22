import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { FilterDraft } from "@/hooks/useFilterDraft"
import { CharFilterBar } from "./CharFilterBar"
import type { CharFilterDraft } from "./CharFilterRail"
import { CHARACTER_SEARCH_DEFAULTS } from "./CharSearch"

vi.mock("@/trpc/factory", () => ({
	trpcQuery: vi.fn(async () => []),
	trpcMutation: vi.fn(),
}))

const emptyDraft: CharFilterDraft = {
	query: "",
	tagIds: [],
	tagMode: "and",
	random: false,
	trash: false,
	searchIntro: false,
	traitFilters: [],
	relationshipTypeIds: [],
}

function makeDraft(): FilterDraft<CharFilterDraft> {
	return {
		draft: { ...emptyDraft },
		change: vi.fn(),
		hasChanges: false,
		apply: vi.fn(),
		clear: vi.fn(),
	}
}

function createWrapper() {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: 0 } },
	})
	return function Wrapper({ children }: { readonly children: ReactNode }) {
		return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
	}
}

describe("CharFilterBar panel placement", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test("opens the rail drawer from the Filters button and stages edits", async () => {
		const user = userEvent.setup()
		const patchState = vi.fn()
		const filterDraft = makeDraft()
		render(
			<CharFilterBar
				state={CHARACTER_SEARCH_DEFAULTS}
				patchState={patchState}
				railPlacement="panel"
				filterDraft={filterDraft}
			/>,
			{ wrapper: createWrapper() },
		)

		// Drawer starts closed; the rail is only mounted once opened.
		expect(screen.queryByTestId("filter-rail-apply")).toBeNull()

		await user.click(screen.getByTestId("character-filter-panel-toggle"))
		await waitFor(() => {
			expect(screen.getByTestId("filter-rail-apply")).not.toBeNull()
		})

		// The apply button carries the Search label.
		expect(screen.getByText("Search")).not.toBeNull()

		// Toggling a rail checkbox stages a draft edit, nothing else.
		await user.click(screen.getByTestId("character-filter-trash"))
		expect(filterDraft.change).toHaveBeenCalledWith({ trash: true })
		expect(patchState).not.toHaveBeenCalled()

		// The apply button applies the staged draft.
		await user.click(screen.getByTestId("filter-rail-apply"))
		expect(filterDraft.apply).toHaveBeenCalledTimes(1)
		expect(patchState).not.toHaveBeenCalled()
	})

	test("Enter in the search field applies the draft", async () => {
		const user = userEvent.setup()
		const filterDraft = makeDraft()
		render(
			<CharFilterBar
				state={CHARACTER_SEARCH_DEFAULTS}
				patchState={vi.fn()}
				railPlacement="panel"
				filterDraft={filterDraft}
			/>,
			{ wrapper: createWrapper() },
		)

		const input = screen.getByTestId("character-search-input")
		await user.type(input, "harbor")
		await user.keyboard("{Enter}")

		expect(filterDraft.apply).toHaveBeenCalledTimes(1)
		// Typing alone never applied anything.
		expect(filterDraft.apply).toHaveBeenCalledTimes(1)
	})

	test("clear all resets the draft", async () => {
		const user = userEvent.setup()
		const filterDraft = makeDraft()
		render(
			<CharFilterBar
				state={CHARACTER_SEARCH_DEFAULTS}
				patchState={vi.fn()}
				railPlacement="panel"
				filterDraft={filterDraft}
			/>,
			{ wrapper: createWrapper() },
		)

		await user.click(screen.getByTestId("character-filter-panel-toggle"))
		await user.click(await screen.findByTestId("filter-rail-clear-all"))
		expect(filterDraft.clear).toHaveBeenCalledTimes(1)
	})

	test("the live-search checkbox toggles the mode", async () => {
		const user = userEvent.setup()
		const onLiveSearchChange = vi.fn()
		render(
			<CharFilterBar
				state={CHARACTER_SEARCH_DEFAULTS}
				patchState={vi.fn()}
				railPlacement="panel"
				filterDraft={makeDraft()}
				liveSearch={false}
				onLiveSearchChange={onLiveSearchChange}
				liveFilterDraft={makeDraft()}
			/>,
			{ wrapper: createWrapper() },
		)

		await user.click(screen.getByTestId("character-filter-panel-toggle"))
		await user.click(await screen.findByTestId("live-search-toggle"))
		expect(onLiveSearchChange).toHaveBeenCalledWith(true)
	})

	test("live search patches immediately and hides the apply button", async () => {
		const user = userEvent.setup()
		const filterDraft = makeDraft()
		const liveFilterDraft = makeDraft()
		render(
			<CharFilterBar
				state={CHARACTER_SEARCH_DEFAULTS}
				patchState={vi.fn()}
				railPlacement="panel"
				filterDraft={filterDraft}
				liveSearch
				onLiveSearchChange={vi.fn()}
				liveFilterDraft={liveFilterDraft}
			/>,
			{ wrapper: createWrapper() },
		)

		await user.click(screen.getByTestId("character-filter-panel-toggle"))
		expect(await screen.findByTestId("character-filter-trash")).not.toBeNull()
		// Live mode drops the staged apply button entirely.
		expect(screen.queryByTestId("filter-rail-apply")).toBeNull()

		// A rail edit goes straight into the live draft (applied state).
		await user.click(screen.getByTestId("character-filter-trash"))
		expect(liveFilterDraft.change).toHaveBeenCalledWith({ trash: true })
		expect(filterDraft.change).not.toHaveBeenCalled()
	})
})
