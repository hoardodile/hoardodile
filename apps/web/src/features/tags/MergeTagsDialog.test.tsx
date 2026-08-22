import type { Category } from "@hoardodile/schemas"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { TagWithCounts } from "@/features/cat/panelModel"
import { MergeTagsDialog } from "./MergeTagsDialog"

const mergeMutationFn = vi.fn()

vi.mock("@/trpc/factory", () => ({
	trpcQuery: vi.fn(
		async (
			namespace: string,
			procedure: string,
			_input: unknown,
		): Promise<unknown> => {
			if (namespace === "category" && procedure === "listAll") {
				return categories
			}
			if (namespace === "category" && procedure === "listAllWithCounts") {
				return categories
			}
			if (namespace === "tag" && procedure === "listAll") {
				return tags
			}
			if (namespace === "tag" && procedure === "listAllWithCounts") {
				return tags
			}
			if (namespace === "tag" && procedure === "mergePreview") {
				return {
					sourceId: "tag-dup",
					targetId: "tag-keep",
					resourceCount: 2,
					characterCount: 1,
					siblingRuleCount: 0,
					parentRuleCount: 0,
				}
			}
			throw new Error(`unexpected query ${namespace}.${procedure}`)
		},
	),
	trpcMutation: vi.fn(() => ({
		mutationFn: mergeMutationFn,
	})),
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
const categories = [commonCat, resCat]

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
	tag("tag-dup", commonCat.id, "Adventure"),
	tag("tag-keep", commonCat.id, "Adventure"),
	tag("tag-res", resCat.id, "Manga"),
]

function createWrapper() {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return function Wrapper({ children }: { readonly children: ReactNode }) {
		return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
	}
}

describe("MergeTagsDialog", () => {
	beforeEach(() => {
		mergeMutationFn.mockReset()
		mergeMutationFn.mockResolvedValue({
			targetId: "tag-keep",
			movedResources: 2,
			movedCharacters: 1,
			movedSiblingRules: 0,
			movedParentRules: 0,
		})
	})

	test("picks the target from the same-kind picker, preview shows what would move, confirm merges", async () => {
		const user = userEvent.setup()
		const onOpenChange = vi.fn()
		render(
			<MergeTagsDialog
				source={tags[0] as TagWithCounts}
				open
				onOpenChange={onOpenChange}
			/>,
			{ wrapper: createWrapper() },
		)

		// The source rides the directed arrow; the target opens the
		// same-kind picker (only the common category is offered).
		expect(screen.getByText("Adventure")).toBeDefined()
		await user.click(screen.getByTestId("tag-merge-target"))
		expect(
			await screen.findByTestId("tag-merge-target-cat-cat-common"),
		).toBeDefined()
		expect(screen.queryByTestId("tag-merge-target-cat-cat-res")).toBeNull()
		await user.click(screen.getByTestId("tag-merge-target-tag-tag-keep"))

		await waitFor(() =>
			expect(screen.getByTestId("tag-merge-preview").textContent).toContain(
				"2",
			),
		)
		await user.click(screen.getByTestId("tag-merge-confirm"))
		await waitFor(() =>
			expect(mergeMutationFn).toHaveBeenCalledWith(
				{ sourceId: "tag-dup", targetId: "tag-keep" },
				expect.anything(),
			),
		)
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
	})

	test("confirm stays disabled until a target is chosen", async () => {
		render(
			<MergeTagsDialog
				source={tags[0] as TagWithCounts}
				open
				onOpenChange={() => undefined}
			/>,
			{ wrapper: createWrapper() },
		)
		expect(screen.getByTestId("tag-merge-confirm")).toBeDisabled()
	})

	test("pre-selected target from a rename collision is honored", async () => {
		const user = userEvent.setup()
		render(
			<MergeTagsDialog
				source={tags[0] as TagWithCounts}
				open
				onOpenChange={() => undefined}
				initialTargetId="tag-keep"
			/>,
			{ wrapper: createWrapper() },
		)
		await waitFor(() =>
			expect(screen.getByTestId("tag-merge-preview")).toBeDefined(),
		)
		await user.click(screen.getByTestId("tag-merge-confirm"))
		await waitFor(() =>
			expect(mergeMutationFn).toHaveBeenCalledWith(
				{ sourceId: "tag-dup", targetId: "tag-keep" },
				expect.anything(),
			),
		)
	})
})
