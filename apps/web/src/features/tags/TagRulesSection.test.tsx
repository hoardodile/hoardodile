import type { Category } from "@hoardodile/schemas"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { TagWithCounts } from "@/features/cat/panelModel"
import { TagRulesSection } from "./TagRulesSection"

const createPairFn = vi.fn()
const removePairFn = vi.fn()
const setDisplayFn = vi.fn()
const createParentFn = vi.fn()
const removeParentFn = vi.fn()

const mutationFns: Record<string, ReturnType<typeof vi.fn>> = {
	siblingRuleCreate: createPairFn,
	siblingRuleRemove: removePairFn,
	siblingSetDisplay: setDisplayFn,
	parentRuleCreate: createParentFn,
	parentRuleRemove: removeParentFn,
}

let siblingGroupRows: unknown[]
let parentRuleRows: unknown[]

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
			if (namespace === "tag" && procedure === "siblingGroups") {
				return siblingGroupRows
			}
			if (namespace === "tag" && procedure === "parentRules") {
				return parentRuleRows
			}
			if (namespace === "character" && procedure === "list") {
				return { rows: [characterRow], total: 1, page: 1, size: 200 }
			}
			if (namespace === "character" && procedure === "listCards") {
				return {
					rows: [
						{
							id: "char-1",
							name: "Aria",
							updatedAt: 1,
							createdAt: 1,
							pinnedTraits: [],
							pinnedTags: [],
							relations: [],
						},
					],
					total: 1,
					page: 1,
					size: 200,
				}
			}
			if (namespace === "character" && procedure === "listRelationshipTypes") {
				return []
			}
			if (namespace === "trait" && procedure === "listAll") {
				return []
			}
			if (namespace === "character" && procedure === "byIds") {
				return [characterRow]
			}
			throw new Error(`unexpected query ${namespace}.${procedure}`)
		},
	),
	trpcMutation: vi.fn((_namespace: string, procedure: string) => ({
		mutationFn: mutationFns[procedure] ?? vi.fn(),
	})),
}))

// The character dialog's full CharSearch surface is covered by its own
// tests — the rules flow only needs the confirm handshake. The trigger's
// chip record comes from `byIds`, a mutation the factory mock does not
// intercept, so the hook is resolved directly.
vi.mock(
	"@/features/char/components/CharSelectorDialog",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("@/features/char/components/CharSelectorDialog")
			>()
		return {
			...actual,
			useCharactersByIds: vi.fn(() => ({
				isLoading: false,
				data: [characterRow],
			})),
			CharSelectorDialog: vi.fn(
				(props: {
					readonly open: boolean
					readonly onSelect: (id: string) => void
					readonly confirmTestId?: string
				}) =>
					props.open ? (
						<button
							type="button"
							data-testid={props.confirmTestId}
							onClick={() => props.onSelect("char-1")}
						>
							confirm
						</button>
					) : null,
			),
		}
	},
)

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
	tag("tag-keep", commonCat.id, "Quest"),
	tag("tag-child", commonCat.id, "Child"),
	tag("tag-res", resCat.id, "ResTag"),
]

const characterRow = {
	id: "char-1",
	name: "Aria",
	intro: "",
	createdAt: 1,
	updatedAt: 1,
	tagIds: [],
}

function createWrapper() {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return function Wrapper({ children }: { readonly children: ReactNode }) {
		return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
	}
}

describe("TagRulesSection", () => {
	beforeEach(() => {
		createPairFn.mockReset()
		removePairFn.mockReset()
		setDisplayFn.mockReset()
		createParentFn.mockReset()
		removeParentFn.mockReset()
		createPairFn.mockResolvedValue({})
		removePairFn.mockResolvedValue({})
		setDisplayFn.mockResolvedValue({})
		createParentFn.mockResolvedValue({})
		removeParentFn.mockResolvedValue({})
		siblingGroupRows = [
			{
				displayTagId: "tag-keep",
				memberTagIds: ["tag-dup", "tag-keep"],
				memberCharacters: [],
				resCount: 2,
				charCount: 1,
			},
		]
		parentRuleRows = [
			{ childKind: "tag", childId: "tag-child", parentId: "tag-keep" },
		]
	})

	test("renders the group under the display tag's kind tab", async () => {
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		expect(
			await screen.findByTestId("tag-rules-display-tag-keep"),
		).toBeDefined()
		// The tree starts collapsed — members appear once the root expands.
		expect(screen.queryByTestId("tag-rules-member-tag-dup")).toBeNull()
		await user.click(screen.getByTestId("tag-rules-alias-expand-tag-keep"))
		expect(await screen.findByTestId("tag-rules-member-tag-dup")).toBeDefined()
	})

	test("groups are hidden on kind tabs other than the display's", async () => {
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-display-tag-keep")
		await user.click(screen.getByTestId("tag-rules-kind-tab-resource"))
		await waitFor(() =>
			expect(screen.queryByTestId("tag-rules-display-tag-keep")).toBeNull(),
		)
		expect(screen.getByTestId("tag-rules-empty")).toBeDefined()
	})

	test("promoting a member and removing a pair call the right mutations", async () => {
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-display-tag-keep")
		fireEvent.click(screen.getByTestId("tag-rules-alias-expand-tag-keep"))
		await screen.findByTestId("tag-rules-member-tag-dup")

		// Base UI menus don't respond to userEvent's pointer sequence in
		// jsdom — the raw click opens them.
		fireEvent.click(screen.getByTestId("tag-rules-member-more-tag-dup"))
		fireEvent.click(screen.getByTestId("tag-rules-promote-tag-dup"))
		await waitFor(() =>
			expect(setDisplayFn).toHaveBeenCalledWith(
				{ id: "tag-dup" },
				expect.anything(),
			),
		)

		fireEvent.click(screen.getByTestId("tag-rules-member-more-tag-dup"))
		fireEvent.click(screen.getByTestId("tag-rules-remove-tag-dup"))
		await waitFor(() =>
			expect(removePairFn).toHaveBeenCalledWith(
				{ badKind: "tag", badId: "tag-dup" },
				expect.anything(),
			),
		)
	})

	test("renders parent rules with their chips", async () => {
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-tree-root-tag-keep")
		// The tree starts collapsed — children appear once the root expands.
		await user.click(screen.getByTestId("tag-rules-parent-expand-tag-keep"))
		expect(
			await screen.findByTestId("tag-rules-parent-tag-tag-child-tag-keep"),
		).toBeDefined()
		expect(screen.getByText("Child")).toBeDefined()
	})

	test("parent rules follow the active kind tab", async () => {
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-tree-root-tag-keep")
		await user.click(screen.getByTestId("tag-rules-parent-expand-tag-keep"))
		await screen.findByTestId("tag-rules-parent-tag-tag-child-tag-keep")
		await user.click(screen.getByTestId("tag-rules-kind-tab-resource"))
		await waitFor(() =>
			expect(
				screen.queryByTestId("tag-rules-parent-tag-tag-child-tag-keep"),
			).toBeNull(),
		)
		expect(screen.getByTestId("tag-rules-parents-empty")).toBeDefined()
	})

	test("adding a pair posts the chosen bad and good tags", async () => {
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-display-tag-keep")

		// The editor dialog embeds the pickers — no nested dialogs: pick
		// the synonym, then the display tag, then confirm.
		await user.click(screen.getByTestId("tag-rules-add-alias-button"))
		await user.click(await screen.findByTestId("tag-rules-synonym-tag-tag-dup"))
		await user.click(await screen.findByTestId("tag-rules-good-tag-tag-keep"))
		await user.click(screen.getByTestId("tag-rules-alias-dialog-confirm"))
		await waitFor(() =>
			expect(createPairFn).toHaveBeenCalledWith(
				{ badKind: "tag", badId: "tag-dup", goodId: "tag-keep" },
				expect.anything(),
			),
		)
	})

	test("the character tab offers characters and links them with badKind", async () => {
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-display-tag-keep")
		await user.click(screen.getByTestId("tag-rules-kind-tab-character"))

		// The editor's endpoint segment switches to the embedded character
		// search — one click on the card selects, then confirm.
		await user.click(screen.getByTestId("tag-rules-add-alias-button"))
		await user.click(
			await screen.findByTestId("tag-rules-synonym-tab-character"),
		)
		await user.click(await screen.findByTestId("character-select-char-1"))
		await user.click(await screen.findByTestId("tag-rules-good-tag-tag-child"))
		await user.click(screen.getByTestId("tag-rules-alias-dialog-confirm"))
		await waitFor(() =>
			expect(createPairFn).toHaveBeenCalledWith(
				{ badKind: "character", badId: "char-1", goodId: "tag-child" },
				expect.anything(),
			),
		)
	})

	test("character group members render and unlink with badKind", async () => {
		siblingGroupRows = [
			{
				displayTagId: "tag-keep",
				memberTagIds: ["tag-dup", "tag-keep"],
				memberCharacters: [{ id: "char-1", name: "Aria", updatedAt: 1 }],
				resCount: 2,
				charCount: 2,
			},
		]
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-display-tag-keep")
		fireEvent.click(screen.getByTestId("tag-rules-alias-expand-tag-keep"))

		// A sibling group whose display tag is common-kind shows on the
		// common tab; the character member rides along.
		expect(
			await screen.findByTestId("tag-rules-char-member-char-1"),
		).toBeDefined()
		expect(screen.getByText("Aria")).toBeDefined()
		fireEvent.click(screen.getByTestId("tag-rules-char-member-more-char-1"))
		fireEvent.click(screen.getByTestId("tag-rules-char-remove-char-1"))
		await waitFor(() =>
			expect(removePairFn).toHaveBeenCalledWith(
				{ badKind: "character", badId: "char-1" },
				expect.anything(),
			),
		)
	})

	test("character child parent rules render and remove with childKind", async () => {
		const user = userEvent.setup()
		parentRuleRows = [
			{
				childKind: "character",
				childId: "char-1",
				parentId: "tag-child",
			},
		]
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-tree-root-tag-child")
		await user.click(screen.getByTestId("tag-rules-kind-tab-character"))
		await user.click(screen.getByTestId("tag-rules-parent-expand-tag-child"))

		expect(
			await screen.findByTestId("tag-rules-parent-character-char-1-tag-child"),
		).toBeDefined()
		fireEvent.click(screen.getByTestId("tag-rules-parent-more-char-1"))
		fireEvent.click(screen.getByTestId("tag-rules-parent-remove-char-1"))
		await waitFor(() =>
			expect(removeParentFn).toHaveBeenCalledWith(
				{ childKind: "character", childId: "char-1", parentId: "tag-child" },
				expect.anything(),
			),
		)
	})

	test("a character child rule with a common-kind parent shows on the common tab", async () => {
		parentRuleRows = [
			{
				childKind: "character",
				childId: "char-1",
				parentId: "tag-child",
			},
		]
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-tree-root-tag-child")
		await user.click(screen.getByTestId("tag-rules-parent-expand-tag-child"))

		// The rule's parent tag is common-kind — the character child
		// rides along on the parent's tab (like sibling groups' character
		// members), so the tree renders without leaving the common tab.
		expect(
			await screen.findByTestId("tag-rules-parent-character-char-1-tag-child"),
		).toBeDefined()
		expect(screen.queryByTestId("tag-rules-parents-empty")).toBeNull()
	})

	test("a common-display group with character members also shows on the character tab", async () => {
		const user = userEvent.setup()
		siblingGroupRows = [
			{
				displayTagId: "tag-keep",
				memberTagIds: ["tag-dup", "tag-keep"],
				memberCharacters: [{ id: "char-1", name: "Aria", updatedAt: 1 }],
				resCount: 2,
				charCount: 2,
			},
		]
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-display-tag-keep")
		await user.click(screen.getByTestId("tag-rules-kind-tab-character"))
		await user.click(screen.getByTestId("tag-rules-alias-expand-tag-keep"))

		// The character member surfaces its group on the character tab —
		// mirroring parent rules, whose character children show there
		// alongside the tab of the tags they touch.
		expect(
			await screen.findByTestId("tag-rules-char-member-char-1"),
		).toBeDefined()
		expect(screen.getByTestId("tag-rules-display-tag-keep")).toBeDefined()
		expect(screen.queryByTestId("tag-rules-empty")).toBeNull()
	})

	test("a common-display group with a resource-kind member shows on the resource tab", async () => {
		const user = userEvent.setup()
		siblingGroupRows = [
			{
				displayTagId: "tag-keep",
				memberTagIds: ["tag-dup", "tag-keep", "tag-res"],
				memberCharacters: [],
				resCount: 2,
				charCount: 0,
			},
		]
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-display-tag-keep")
		await user.click(screen.getByTestId("tag-rules-kind-tab-resource"))

		// Any member tag's kind opens the tab — a pair added on the
		// resource tab whose display tag is common stays visible here
		// instead of disappearing onto the common tab.
		expect(
			await screen.findByTestId("tag-rules-display-tag-keep"),
		).toBeDefined()
		expect(screen.queryByTestId("tag-rules-empty")).toBeNull()
	})

	test("the common tab offers the character entry in the editor", async () => {
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-display-tag-keep")

		await user.click(screen.getByTestId("tag-rules-add-alias-button"))
		expect(
			await screen.findByTestId("tag-rules-synonym-tab-character"),
		).toBeDefined()
		expect(screen.getByTestId("tag-rules-synonym-tab-tag")).toBeDefined()
	})

	test("the resource tab hides the character entry in the editor", async () => {
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-display-tag-keep")
		await user.click(screen.getByTestId("tag-rules-kind-tab-resource"))

		// No character segment without the character kind — the endpoint
		// column is the tag picker straight away.
		await user.click(screen.getByTestId("tag-rules-add-alias-button"))
		await user.click(await screen.findByTestId("tag-rules-synonym-cat-cat-res"))
		expect(
			await screen.findByTestId("tag-rules-synonym-tag-tag-res"),
		).toBeDefined()
		expect(screen.queryByTestId("tag-rules-synonym-tab-character")).toBeNull()
	})

	test("collapsing a branch hides its children again", async () => {
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-alias-expand-tag-keep")
		await user.click(screen.getByTestId("tag-rules-alias-expand-tag-keep"))
		await screen.findByTestId("tag-rules-member-tag-dup")
		await user.click(screen.getByTestId("tag-rules-alias-expand-tag-keep"))
		await waitFor(() =>
			expect(screen.queryByTestId("tag-rules-member-tag-dup")).toBeNull(),
		)
	})

	test("search narrows the alias tree to matching rows", async () => {
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-display-tag-keep")
		await user.type(screen.getByTestId("tag-rules-alias-search"), "Quest")
		await waitFor(() =>
			expect(screen.queryByTestId("tag-rules-member-tag-dup")).toBeNull(),
		)
		// The matching display row stays.
		expect(screen.getByTestId("tag-rules-display-tag-keep")).toBeDefined()
	})

	test("search with no match shows the empty-match row", async () => {
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-display-tag-keep")
		await user.type(screen.getByTestId("tag-rules-alias-search"), "zzz")
		expect(await screen.findByTestId("tag-rules-alias-no-match")).toBeDefined()
	})

	test("searching parents reveals matching children of collapsed branches", async () => {
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-tree-root-tag-keep")
		await user.type(screen.getByTestId("tag-rules-parent-search"), "Child")
		expect(
			await screen.findByTestId("tag-rules-parent-tag-tag-child-tag-keep"),
		).toBeDefined()
	})

	test("a display row's Add alias opens the editor with the display slot preset", async () => {
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-display-tag-keep")
		fireEvent.click(screen.getByTestId("tag-rules-display-more-tag-keep"))
		fireEvent.click(screen.getByTestId("tag-rules-add-alias-tag-keep"))
		await screen.findByTestId("tag-rules-alias-dialog")

		// Only the synonym is picked — the display slot already carries
		// the row's display tag.
		await user.click(await screen.findByTestId("tag-rules-synonym-tag-tag-dup"))
		await user.click(screen.getByTestId("tag-rules-alias-dialog-confirm"))
		await waitFor(() =>
			expect(createPairFn).toHaveBeenCalledWith(
				{ badKind: "tag", badId: "tag-dup", goodId: "tag-keep" },
				expect.anything(),
			),
		)
	})

	test("a node's Add child opens the editor with the parent slot preset", async () => {
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-tree-root-tag-keep")
		fireEvent.click(screen.getByTestId("tag-rules-node-more-tag-keep"))
		fireEvent.click(screen.getByTestId("tag-rules-add-child-tag-keep"))
		await screen.findByTestId("tag-rules-rule-dialog")

		// Only the child is picked — the parent slot already carries the
		// node the menu was opened from.
		await user.click(await screen.findByTestId("tag-rules-child-tag-tag-dup"))
		await user.click(screen.getByTestId("tag-rules-rule-dialog-confirm"))
		await waitFor(() =>
			expect(createParentFn).toHaveBeenCalledWith(
				{ childKind: "tag", childId: "tag-dup", parentId: "tag-keep" },
				expect.anything(),
			),
		)
	})

	test("the editor resets its picks after closing", async () => {
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-display-tag-keep")
		await user.click(screen.getByTestId("tag-rules-add-alias-button"))
		await user.click(await screen.findByTestId("tag-rules-synonym-tag-tag-dup"))
		await user.click(await screen.findByTestId("tag-rules-good-tag-tag-keep"))
		fireEvent.keyDown(document, { key: "Escape" })
		await waitFor(() =>
			expect(screen.queryByTestId("tag-rules-alias-dialog")).toBeNull(),
		)

		// Reopening starts from a clean slate — confirm stays disabled
		// until both slots are picked again.
		await user.click(screen.getByTestId("tag-rules-add-alias-button"))
		expect(screen.getByTestId("tag-rules-alias-dialog-confirm")).toBeDisabled()
	})

	test("adding a parent rule reveals its branch", async () => {
		const user = userEvent.setup()
		// The mocked mutation feeds the added rule back into the refetched
		// query, so the tree can grow.
		createParentFn.mockImplementation(async () => {
			parentRuleRows = [
				...parentRuleRows,
				{ childKind: "tag", childId: "tag-dup", parentId: "tag-keep" },
			]
			return {}
		})
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-tree-root-tag-keep")

		// The root stays collapsed, yet the fresh rule's branch is
		// auto-expanded after the add.
		await user.click(screen.getByTestId("tag-rules-add-parent-button"))
		await user.click(await screen.findByTestId("tag-rules-child-tag-tag-dup"))
		await user.click(await screen.findByTestId("tag-rules-parent-tag-tag-keep"))
		await user.click(screen.getByTestId("tag-rules-rule-dialog-confirm"))
		expect(
			await screen.findByTestId("tag-rules-parent-tag-tag-dup-tag-keep"),
		).toBeDefined()
	})

	test("the editor's Back returns to the endpoint step", async () => {
		const user = userEvent.setup()
		render(<TagRulesSection />, { wrapper: createWrapper() })
		await screen.findByTestId("tag-rules-display-tag-keep")
		await user.click(screen.getByTestId("tag-rules-add-alias-button"))
		await user.click(await screen.findByTestId("tag-rules-synonym-tag-tag-dup"))

		// Step two leads with the picked endpoint and the Back button.
		expect(screen.queryByTestId("tag-rules-synonym-tab-tag")).toBeNull()
		await user.click(screen.getByTestId("tag-rules-synonym-back"))
		expect(screen.getByTestId("tag-rules-synonym-tab-tag")).toBeDefined()
		// The pick survives the trip back.
		expect(screen.getAllByText("Adventure").length).toBeGreaterThanOrEqual(1)
	})
})
