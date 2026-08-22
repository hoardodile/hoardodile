import type { Category, Tag } from "@hoardodile/schemas"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { DualTagPicker } from "@/components/common/DualTagPicker"

vi.mock("@/trpc/factory", () => ({
	trpcQuery: vi.fn(
		async (
			namespace: string,
			procedure: string,
			_input: unknown,
		): Promise<unknown> => {
			if (namespace === "tag" && procedure === "listAll") {
				return tags
			}
			if (namespace === "category" && procedure === "listAll") {
				return categories
			}
			throw new Error(`unexpected query ${namespace}.${procedure}`)
		},
	),
	trpcMutation: vi.fn(),
}))

const commonCat: Category = {
	id: "cat-common",
	name: "Common",
	intro: "",
	color: "",
	kind: "common",
	position: 0,
	pinned: false,
	createdAt: 1,
	updatedAt: 1,
}
const categories = [commonCat]

const makeTag = (id: string, catId: string, displayTagId = id): Tag => ({
	id,
	name: id,
	intro: "",
	color: "",
	position: 0,
	pinned: false,
	catId,
	displayTagId,
	createdAt: 1,
	updatedAt: 1,
})
const tags = [
	makeTag("member", commonCat.id, "display"),
	makeTag("display", commonCat.id),
]

function createWrapper() {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return function Wrapper({ children }: { readonly children: ReactNode }) {
		return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
	}
}

describe("DualTagPicker sibling collapse", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test("members render as (and toggle) their display tag", async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		render(<DualTagPicker value={[]} onChange={onChange} kind="common" />, {
			wrapper: createWrapper(),
		})

		// The first "Common" is the picker's category chip (the showcase
		// category chip only appears once a tag is selected).
		await user.click((await screen.findAllByText("Common"))[0]!)
		await waitFor(() => expect(screen.getByText("display")).toBeDefined())
		// The member's own name never appears.
		expect(screen.queryByText("member")).toBeNull()

		await user.click(screen.getByText("display"))
		expect(onChange).toHaveBeenCalledWith(["display"])
	})

	test("a selected member id renders as its display chip", async () => {
		render(
			<DualTagPicker
				value={["member"]}
				onChange={() => undefined}
				kind="common"
			/>,
			{ wrapper: createWrapper() },
		)

		// The picker's category chip is the first "Common"; the showcase
		// renders its own category chip at the bottom.
		await userEvent.setup().click((await screen.findAllByText("Common"))[0]!)
		// The display tag shows in the category's Selected block and the
		// bottom showcase; the member's own name never appears.
		await waitFor(() => {
			expect(screen.getAllByText("display").length).toBeGreaterThan(0)
		})
		expect(screen.queryByText("member")).toBeNull()
	})
})

describe("DualTagPicker single mode", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test("picks a tag directly with onChange([id])", async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		render(
			<DualTagPicker
				value={[]}
				onChange={onChange}
				kind="common"
				single
				testId="rule"
			/>,
			{ wrapper: createWrapper() },
		)

		await user.click(await screen.findByTestId("rule-cat-cat-common"))
		await waitFor(() =>
			expect(screen.getByTestId("rule-tag-display")).toBeDefined(),
		)
		await user.click(screen.getByTestId("rule-tag-display"))
		expect(onChange).toHaveBeenCalledWith(["display"])
		// Single mode has no Selected block or bottom showcase.
		expect(screen.queryByText("Selected")).toBeNull()
	})

	test("collapseSiblings=false keeps sibling members as real tags", async () => {
		render(
			<DualTagPicker
				value={[]}
				onChange={() => undefined}
				kind="common"
				single
				collapseSiblings={false}
				testId="rule"
			/>,
			{ wrapper: createWrapper() },
		)

		await userEvent
			.setup()
			.click(await screen.findByTestId("rule-cat-cat-common"))
		await waitFor(() =>
			expect(screen.getByTestId("rule-tag-member")).toBeDefined(),
		)
		expect(screen.getByTestId("rule-tag-display")).toBeDefined()
	})
})
