import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it } from "vitest"
import { EntityCard } from "./EntityCard"

it.each([
	{ reorderMode: false, dragDisabled: true },
	{ reorderMode: true, dragDisabled: true },
	{ reorderMode: true, dragDisabled: false },
])(
	"keeps card actions accessible (reorder=$reorderMode, dragDisabled=$dragDisabled)",
	async ({ reorderMode, dragDisabled }) => {
		const user = userEvent.setup()
		render(
			<EntityCard
				item={{ id: "tag-1" }}
				reorderMode={reorderMode}
				dragDisabled={dragDisabled}
				chip={<span>Test tag</span>}
				meta={null}
				testIdPrefix="tag"
				renderEditDialog={() => null}
				renderDeleteButton={() => null}
			/>,
		)
		expect(screen.getByTestId("tag-row-tag-1")).not.toHaveAttribute(
			"aria-disabled",
			"true",
		)
		if (!dragDisabled) {
			expect(screen.getByTestId("tag-row-tag-1")).toHaveAttribute(
				"aria-roledescription",
				"sortable",
			)
		}
		await user.click(screen.getByRole("button", { name: "More" }))
		expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeVisible()
	},
)
