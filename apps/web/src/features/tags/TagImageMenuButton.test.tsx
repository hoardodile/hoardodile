import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { describe, expect, test } from "vitest"
import { TagImageMenuButton } from "./TagImageMenuButton"

function createWrapper() {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return function Wrapper({ children }: { readonly children: ReactNode }) {
		return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
	}
}

describe("TagImageMenuButton", () => {
	test("shows a thumb when art exists and offers the replace item", async () => {
		const user = userEvent.setup()
		render(
			<TagImageMenuButton
				tagId="t1"
				tagName="Harbor"
				imageMeta={{ kind: "image", width: 4, height: 8 }}
				updatedAt={42}
			/>,
			{ wrapper: createWrapper() },
		)

		const thumb = screen.getByTestId("tag-image-menu-t1").querySelector("img")
		expect(thumb?.getAttribute("src")).toContain(
			"/api/tags/t1/thumb/image?v=42",
		)

		await user.click(screen.getByTestId("tag-image-menu-t1"))
		expect(await screen.findByText("Replace image…")).toBeInTheDocument()
	})

	test("opens the crop panel from the menu item", async () => {
		const user = userEvent.setup()
		render(
			<TagImageMenuButton
				tagId="t1"
				tagName="Harbor"
				imageMeta={{ kind: "image", width: 4, height: 8 }}
				updatedAt={42}
			/>,
			{ wrapper: createWrapper() },
		)

		await user.click(screen.getByTestId("tag-image-menu-t1"))
		await user.click(await screen.findByTestId("tag-image-menu-item-t1"))

		expect(await screen.findByText("Harbor — Tag image")).toBeInTheDocument()
	})

	test("offers upload (no art) and renders the icon button", async () => {
		const user = userEvent.setup()
		render(<TagImageMenuButton tagId="t2" tagName="Plain" updatedAt={1} />, {
			wrapper: createWrapper(),
		})

		const trigger = screen.getByTestId("tag-image-menu-t2")
		expect(trigger.querySelector("img")).toBeNull()
		await user.click(trigger)
		expect(await screen.findByText("Upload image…")).toBeInTheDocument()
	})
})
