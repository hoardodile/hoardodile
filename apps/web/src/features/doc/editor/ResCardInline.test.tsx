import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { resKeys } from "@/features/res/api"
import { stubResCard } from "@/test/stubs/cards"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { ResCardView } from "./ResCardInline"

const RES_ID = "res-inline-1"

/**
 * The inline embed's view, rendered on its own: mounting the real editor and
 * driving a slash menu would test BlockNote, not this layout contract.
 */
function renderInline(resId: string) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	})
	queryClient.setQueryData(
		resKeys.detailCard(resId),
		stubResCard(resId, "Inline resource", {
			// No content plugin: the preview opens the app's own dialog
			// fallback instead of mounting a plugin iframe (that path needs
			// the pool host, which is outside this layout contract).
			contentPluginId: null,
			coverMeta: { kind: "image", width: 100, height: 400 },
			sourceMeta: { width: 100, height: 400 },
		}),
	)
	return render(
		<QueryClientProvider client={queryClient}>
			<ResCardView resId={resId} />
		</QueryClientProvider>,
	)
}

beforeEach(() => {
	// The component fetches through the detail-card query (answered from the
	// cache above) and the thumb asks for the plugin list, which needs a
	// list-shaped answer rather than `undefined`.
	setTrpcClient(
		new Proxy(
			{},
			{
				get: () =>
					new Proxy(
						{},
						{
							get: () => ({
								query: async () => [],
								mutate: async () => undefined,
							}),
						},
					),
			},
		) as unknown as TRPCClient,
	)
})

describe("inline resCard preview control", () => {
	it("places the preview button beside the thumb, not inside its cover box", async () => {
		renderInline(RES_ID)

		const tile = await screen.findByTestId(`resource-thumb-tile-${RES_ID}`)
		const button = screen.getByTestId(`resource-preview-${RES_ID}`)

		// The inline embed has no card layout around it, so the button's
		// containing block is the wrapper hugging the tile — that wrapper
		// must own the `relative`, and the button must stay outside the tile.
		expect(tile.contains(button)).toBe(false)
		expect(button.parentElement?.className.split(/\s+/)).toEqual(
			expect.arrayContaining(["relative", "inline-block"]),
		)
		expect(button.className.split(/\s+/)).toEqual(
			expect.arrayContaining(["absolute", "right-2", "top-2", "z-10"]),
		)
	})

	it("keeps the button hover-only so a document embed never swallows the mousedown", async () => {
		renderInline(RES_ID)

		const button = await screen.findByTestId(`resource-preview-${RES_ID}`)
		expect(button).toHaveClass("opacity-0", "pointer-events-none")
		expect(button).not.toHaveClass("md:opacity-0")
	})

	it("ships a closed, clickable button for an enabled embed", async () => {
		renderInline(RES_ID)

		const button = await screen.findByTestId(`resource-preview-${RES_ID}`)
		// Closed by default: only an explicit click may open the lightbox.
		// Opening it needs the plugin iframe pool (`ResPreviewDialog` renders
		// media through a sandboxed plugin), so the click-through is asserted
		// in the browser suite instead of a jsdom mount.
		expect(screen.queryByRole("dialog")).toBeNull()
		expect(button).toHaveAttribute("type", "button")
		expect(button).not.toBeDisabled()
	})

	it("renders the placeholder, and no preview control, without an id", () => {
		renderInline("")

		expect(screen.queryByTestId(/resource-preview-/)).not.toBeInTheDocument()
		expect(screen.getByText("Empty resource")).toBeInTheDocument()
	})
})
