import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { renderWithI18n } from "../test/i18n"
import {
	AppDialog,
	DialogFooterActions,
	DialogFooterLeadingActions,
} from "./app-dialog"

const FOLLOWS = Node.DOCUMENT_POSITION_FOLLOWING

/**
 * The leading (left-edge) footer action placement follows DESIGN.md:
 * with a primary action the bar splits ([remove] [cancel] [save]); with no
 * primary it never splits ([cancel] [remove]).
 */
describe("AppDialog footer actions", () => {
	it("places the leading action before Cancel when a primary action is present", async () => {
		renderWithI18n(
			<AppDialog
				open
				title="Dialog"
				onOpenChange={() => {}}
				footer={
					<button type="button" data-testid="cancel">
						Cancel
					</button>
				}
			>
				<DialogFooterActions>
					<button type="button" data-testid="save">
						Save
					</button>
				</DialogFooterActions>
				<DialogFooterLeadingActions>
					<button type="button" data-testid="remove">
						Remove
					</button>
				</DialogFooterLeadingActions>
			</AppDialog>,
		)

		const remove = await screen.findByTestId("remove")
		const cancel = screen.getByTestId("cancel")
		// Remove documents before Cancel ⇒ remove is at the left edge.
		expect(remove.compareDocumentPosition(cancel) & FOLLOWS).toBe(FOLLOWS)
	})

	it("places the leading action after Cancel when there is no primary action", async () => {
		renderWithI18n(
			<AppDialog
				open
				title="Dialog"
				onOpenChange={() => {}}
				footer={
					<button type="button" data-testid="cancel">
						Cancel
					</button>
				}
			>
				<DialogFooterLeadingActions>
					<button type="button" data-testid="remove">
						Remove
					</button>
				</DialogFooterLeadingActions>
			</AppDialog>,
		)

		const remove = await screen.findByTestId("remove")
		const cancel = screen.getByTestId("cancel")
		// Cancel documents before Remove ⇒ remove sits to the right of Cancel.
		expect(cancel.compareDocumentPosition(remove) & FOLLOWS).toBe(FOLLOWS)
	})
})

/**
 * A dialog with no footer owns its own bottom edge: the footer bar supplies
 * the card's 20px bottom padding, so a body-only dialog (an informational
 * panel, a details view) must carry it instead or its content ends flush
 * against the border.
 */
describe("AppDialog body padding", () => {
	const body = () =>
		document.querySelector('[data-slot="dialog-body"]') as HTMLElement

	it("keeps the card's bottom padding when there is no footer", () => {
		renderWithI18n(
			<AppDialog open title="Details" onOpenChange={() => {}}>
				<p>Body only</p>
			</AppDialog>,
		)

		expect(body().className).toContain("pb-5")
		expect(
			document.querySelector('[data-slot="dialog-footer"]'),
		).not.toBeInTheDocument()
	})

	it("defers to the footer bar when one is present", () => {
		renderWithI18n(
			<AppDialog
				open
				title="Details"
				onOpenChange={() => {}}
				footer={
					<button type="button" data-testid="cancel">
						Cancel
					</button>
				}
			>
				<p>Body plus footer</p>
			</AppDialog>,
		)

		expect(body().className).not.toContain("pb-5")
		expect(document.querySelector('[data-slot="dialog-footer"]')).toBeTruthy()
	})

	it("defers to a footer contributed by the body itself", () => {
		renderWithI18n(
			<AppDialog open title="Details" onOpenChange={() => {}}>
				{/* A panel's declarative action still creates the footer bar,
				    so the body must not add a second gap below it. */}
				<DialogFooterActions>
					<button type="button" data-testid="save">
						Save
					</button>
				</DialogFooterActions>
			</AppDialog>,
		)

		expect(body().className).not.toContain("pb-5")
		expect(document.querySelector('[data-slot="dialog-footer"]')).toBeTruthy()
	})
})
