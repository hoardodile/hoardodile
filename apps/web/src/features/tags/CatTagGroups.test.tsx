import type { Tag } from "@hoardodile/schemas"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, test, vi } from "vitest"
import { CatTagGroups } from "./CatTagGroups"

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, ...props }: { readonly children: ReactNode }) => (
		<a {...props}>{children}</a>
	),
}))

function makeTag(
	id: string,
	name: string,
	opts: { readonly virtual?: boolean } = {},
): Tag {
	return {
		id,
		name,
		intro: "",
		color: "",
		position: 0,
		pinned: false,
		catId: "cat-1",
		displayTagId: id,
		...(opts.virtual === true ? { virtual: true } : {}),
		createdAt: 0,
		updatedAt: 0,
	}
}

const groups = [
	{
		catId: "cat-1",
		catName: "Common",
		catColor: "",
		tags: [makeTag("t1", "Real"), makeTag("t2", "Parent", { virtual: true })],
	},
]

describe("CatTagGroups", () => {
	test("virtual tags render weakened with the virtual marker", () => {
		render(<CatTagGroups type="resource" groups={groups} />)
		expect(screen.getByTestId("virtual-tag-t2")).toBeDefined()
		expect(screen.getByText("virtual")).toBeDefined()
		expect(screen.queryByTestId("virtual-tag-t1")).toBeNull()
		expect(screen.getByText("Real")).toBeDefined()
	})
})
