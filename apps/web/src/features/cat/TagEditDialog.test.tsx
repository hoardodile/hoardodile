import type { Category } from "@hoardodile/schemas"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { TagWithCounts } from "./panelModel"
import { TagEditDialog } from "./TagEditDialog"

const updateMutationFn = vi.fn()

vi.mock("@/trpc/factory", () => ({
	trpcQuery: vi.fn(
		async (
			namespace: string,
			procedure: string,
			_input: unknown,
		): Promise<unknown> => {
			if (namespace === "category" && procedure === "listAllWithCounts") {
				return categories
			}
			if (namespace === "tag" && procedure === "listAllWithCounts") {
				return tags
			}
			throw new Error(`unexpected query ${namespace}.${procedure}`)
		},
	),
	trpcMutation: vi.fn(() => ({
		mutationFn: updateMutationFn,
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
const categories = [commonCat]

const tag: TagWithCounts = {
	id: "tag-1",
	name: "Harbor",
	intro: "A quiet place",
	color: "#123456",
	link: "www.example.com/harbor",
	position: 0,
	pinned: false,
	catId: commonCat.id,
	displayTagId: "tag-1",
	createdAt: 1,
	updatedAt: 1,
	resCount: 0,
	charCount: 0,
}
const tags = [tag]

function createWrapper() {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return function Wrapper({ children }: { readonly children: ReactNode }) {
		return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
	}
}

describe("TagEditDialog", () => {
	beforeEach(() => {
		updateMutationFn.mockReset()
		updateMutationFn.mockResolvedValue(tag)
	})

	test("prefills the link field and keeps save disabled until something changes", async () => {
		const user = userEvent.setup()
		const onOpenChange = vi.fn()
		render(<TagEditDialog tag={tag} open onOpenChange={onOpenChange} />, {
			wrapper: createWrapper(),
		})

		const link = screen.getByTestId("tag-link-tag-1") as HTMLInputElement
		expect(link.value).toBe("www.example.com/harbor")
		const save = screen.getByTestId("tag-save-tag-1")
		expect(save).toBeDisabled()

		await user.click(link)
		await user.clear(link)
		await user.type(link, "other.example.com")
		await waitFor(() => expect(save).toBeEnabled())
	})

	test("saves the trimmed link in the update payload", async () => {
		const user = userEvent.setup()
		const onOpenChange = vi.fn()
		render(<TagEditDialog tag={tag} open onOpenChange={onOpenChange} />, {
			wrapper: createWrapper(),
		})

		const link = screen.getByTestId("tag-link-tag-1") as HTMLInputElement
		await user.clear(link)
		await user.type(link, "  https://new.example.com/art  ")

		const save = screen.getByTestId("tag-save-tag-1")
		await waitFor(() => expect(save).toBeEnabled())
		await user.click(save)

		await waitFor(() => {
			const call = updateMutationFn.mock.calls[0]?.[0]
			expect(call).toMatchObject({
				id: "tag-1",
				catId: commonCat.id,
				link: "https://new.example.com/art",
			})
		})
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
	})
})
