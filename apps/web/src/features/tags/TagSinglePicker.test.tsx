import type { Category } from "@hoardodile/schemas"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { TagWithCounts } from "@/features/cat/panelModel"
import { TagSinglePicker } from "./TagSinglePicker"

vi.mock("@/trpc/factory", () => ({
	trpcQuery: vi.fn(
		async (namespace: string, procedure: string): Promise<unknown> => {
			if (namespace === "category" && procedure === "listAll") {
				return categories
			}
			if (namespace === "tag" && procedure === "listAll") {
				return tags
			}
			throw new Error(`unexpected query ${namespace}.${procedure}`)
		},
	),
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
const resCat: Category = {
	id: "cat-res",
	name: "Res",
	intro: "",
	color: "",
	kind: "resource",
	position: 0,
	pinned: false,
	createdAt: 1,
	updatedAt: 1,
}
const charCat: Category = {
	id: "cat-char",
	name: "Char",
	intro: "",
	color: "",
	kind: "character",
	position: 0,
	pinned: false,
	createdAt: 1,
	updatedAt: 1,
}
const categories = [commonCat, resCat, charCat]

const tag = (id: string, catId: string, name: string): TagWithCounts => ({
	id,
	name,
	intro: "",
	color: "",
	position: 0,
	pinned: false,
	catId,
	displayTagId: id,
	createdAt: 1,
	updatedAt: 1,
	resCount: 0,
	charCount: 0,
})
const tags = [
	tag("tag-adventure", commonCat.id, "Adventure"),
	tag("tag-quest", commonCat.id, "Quest"),
	tag("tag-ship", resCat.id, "Ship"),
	tag("tag-person", charCat.id, "Person"),
]

function createWrapper() {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return function Wrapper({ children }: { readonly children: ReactNode }) {
		return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
	}
}

describe("TagSinglePicker", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test("shows category tabs and picks a tag from the active category", async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		render(
			<TagSinglePicker
				value=""
				onChange={onChange}
				placeholder="Pick a tag"
				testId="picker"
			/>,
			{ wrapper: createWrapper() },
		)

		await user.click(screen.getByTestId("picker"))
		await waitFor(() =>
			expect(screen.getByTestId("picker-cat-cat-common")).toBeDefined(),
		)
		expect(screen.getByTestId("picker-cat-cat-res")).toBeDefined()
		expect(screen.getByTestId("picker-cat-cat-char")).toBeDefined()
		await user.click(screen.getByTestId("picker-tag-tag-adventure"))
		expect(onChange).toHaveBeenCalledWith("tag-adventure")
	})

	test("search filters the active category's tags", async () => {
		const user = userEvent.setup()
		render(
			<TagSinglePicker
				value=""
				onChange={() => undefined}
				placeholder="Pick a tag"
				testId="picker"
			/>,
			{ wrapper: createWrapper() },
		)

		await user.click(screen.getByTestId("picker"))
		await user.type(screen.getByTestId("picker-search"), "ue")
		await waitFor(() =>
			expect(screen.queryByTestId("picker-tag-tag-adventure")).toBeNull(),
		)
		expect(screen.getByTestId("picker-tag-tag-quest")).toBeDefined()
	})

	test("kind filters categories to the kind plus common", async () => {
		const user = userEvent.setup()
		render(
			<TagSinglePicker
				value=""
				onChange={() => undefined}
				kind="resource"
				placeholder="Pick a tag"
				testId="picker"
			/>,
			{ wrapper: createWrapper() },
		)

		await user.click(screen.getByTestId("picker"))
		await waitFor(() =>
			expect(screen.getByTestId("picker-cat-cat-common")).toBeDefined(),
		)
		expect(screen.getByTestId("picker-cat-cat-res")).toBeDefined()
		expect(screen.queryByTestId("picker-cat-cat-char")).toBeNull()
	})

	test("switching categories swaps the shown tags", async () => {
		const user = userEvent.setup()
		render(
			<TagSinglePicker
				value=""
				onChange={() => undefined}
				placeholder="Pick a tag"
				testId="picker"
			/>,
			{ wrapper: createWrapper() },
		)

		await user.click(screen.getByTestId("picker"))
		await user.click(screen.getByTestId("picker-cat-cat-res"))
		await waitFor(() =>
			expect(screen.getByTestId("picker-tag-tag-ship")).toBeDefined(),
		)
		expect(screen.queryByTestId("picker-tag-tag-adventure")).toBeNull()
	})

	test("picking a tag closes the dialog", async () => {
		const user = userEvent.setup()
		render(
			<TagSinglePicker
				value=""
				onChange={() => undefined}
				placeholder="Pick a tag"
				testId="picker"
			/>,
			{ wrapper: createWrapper() },
		)

		await user.click(screen.getByTestId("picker"))
		await user.click(await screen.findByTestId("picker-tag-tag-adventure"))
		await waitFor(() =>
			expect(screen.queryByTestId("picker-tag-tag-adventure")).toBeNull(),
		)
	})
})
