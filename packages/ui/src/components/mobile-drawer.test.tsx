import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { MobileDrawer } from "./mobile-drawer"

function renderDrawer(open: boolean) {
	return render(
		<MobileDrawer open={open} onOpenChange={() => {}} title="Drawer">
			<div data-testid="drawer-content">content</div>
		</MobileDrawer>,
	)
}

describe("MobileDrawer children gating", () => {
	it("does not render children while closed before the first open", () => {
		renderDrawer(false)
		expect(screen.queryByTestId("drawer-content")).not.toBeInTheDocument()
	})

	it("renders children once open", () => {
		renderDrawer(true)
		expect(screen.getByTestId("drawer-content")).toBeInTheDocument()
	})

	it("keeps children mounted after closing again", () => {
		const { rerender } = render(
			<MobileDrawer open={false} onOpenChange={() => {}}>
				<div data-testid="drawer-content">content</div>
			</MobileDrawer>,
		)
		expect(screen.queryByTestId("drawer-content")).not.toBeInTheDocument()
		rerender(
			<MobileDrawer open={true} onOpenChange={() => {}}>
				<div data-testid="drawer-content">content</div>
			</MobileDrawer>,
		)
		expect(screen.getByTestId("drawer-content")).toBeInTheDocument()
		rerender(
			<MobileDrawer open={false} onOpenChange={() => {}}>
				<div data-testid="drawer-content">content</div>
			</MobileDrawer>,
		)
		expect(screen.getByTestId("drawer-content")).toBeInTheDocument()
	})

	it("sizes the body as a constrained flex column", () => {
		const { container } = renderDrawer(true)
		const body = container.querySelector("aside > div:last-child")
		for (const token of ["flex", "min-h-0", "flex-1", "flex-col"]) {
			expect(body?.classList.contains(token)).toBe(true)
		}
	})
})
