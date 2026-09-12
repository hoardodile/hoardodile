import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router"
import { act, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { pluginKeys } from "@/features/plugin/pluginApi"
import { resKeys } from "@/features/res/api"
import type { RouterContext } from "@/routes/__root"
import { stubResCard } from "@/test/stubs/cards"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { ResCard } from "./ResCard"

const GALLERY_PLUGIN_ID = "665cfbdd-1db6-48f5-9d53-1008b8cb84c3"

function createMockTrpcClient(pluginRows: readonly unknown[] = []): TRPCClient {
	return new Proxy(
		{},
		{
			get(_, namespace: string) {
				return new Proxy(
					{},
					{
						get(_, procedure: string) {
							return {
								query: async () => {
									if (namespace === "plugin" && procedure === "listAll")
										return pluginRows
									return undefined
								},
								mutate: async () => undefined,
							}
						},
					},
				)
			},
		},
	) as unknown as TRPCClient
}

async function renderCard(
	element: React.ReactElement,
	pluginRows: readonly unknown[] = [],
) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	})
	queryClient.setQueryData(pluginKeys.listAll(), pluginRows)
	const rootRoute = createRootRouteWithContext<RouterContext>()({
		component: () => <Outlet />,
	})
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => element,
	})
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute]),
		context: { queryClient, trpc: {} as RouterContext["trpc"] },
		history: createMemoryHistory({ initialEntries: ["/"] }),
		defaultPendingMs: 0,
	})

	await act(async () => {
		await router.load()
	})
	await act(async () => {
		render(
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		)
	})
	return queryClient
}

function cardContainer(id: string): HTMLElement {
	const el = document.querySelector(`[data-resource-card-id="${id}"]`)
	if (!(el instanceof HTMLElement)) throw new Error("card not found")
	return el
}

function thumbBox(container: HTMLElement): HTMLElement {
	// The card wraps the thumb in its own cover row, so the old
	// `.group.overflow-hidden` selector no longer identifies the cover box.
	// The card structure is: card root → cover row → tile box → cover box;
	// the cover box is the element that owns the fitted style.
	const el = container.querySelector<HTMLElement>(":scope > div > div > div")
	if (el === null) throw new Error("thumb not found")
	return el
}

beforeEach(() => {
	setTrpcClient(createMockTrpcClient())
})

const BADGE_PLUGIN_ID = "77777777-7777-4777-8777-777777777777"

/** A pinned plugin whose `ui.card.image` declares a bottom-left badge. */
function badgePluginRow(id: string) {
	return {
		id,
		manifest: {
			id,
			name: "Badge Plugin",
			description: "A pinned plugin for badge tests",
			version: "1.0.0",
			permissions: {},
			ui: { card: { image: { bl: ["TAGB-{{source.width}}"] } } },
		},
		enabled: true,
		priority: 0,
		pinned: true,
		color: "",
		missing: false,
		builtin: false,
		dev: false,
		assetVersion: "1",
	}
}

describe("ResCard sizing", () => {
	it("keeps the default min/max width bounds and intrinsic thumb sizing", async () => {
		const resource = stubResCard("res-1", "Some resource", {
			coverMeta: { kind: "image", width: 800, height: 600 },
		})
		await renderCard(<ResCard resource={resource} />)

		const card = cardContainer("res-1")
		expect(card.style.minWidth).toBe("200px")
		expect(card.style.maxWidth).toBe("400px")
		// Intrinsic: scaled down to fit 400x600, never upscaled.
		const thumb = thumbBox(card)
		expect(thumb.style.width).toBe("400px")
		expect(thumb.style.height).toBe("300px")
		// The name wrapper keeps its regular intrinsic-width behavior.
		const name = screen.getByTestId("resource-item-res-1")
		expect(name.parentElement?.className.split(/\s+/)).not.toContain("w-0")
	})

	it("fit-height mode caps the thumb height, derives width from the aspect ratio, and clamps the name to the card", async () => {
		const resource = stubResCard("res-1", "Some resource", {
			coverMeta: { kind: "image", width: 100, height: 300 },
		})
		await renderCard(<ResCard resource={resource} thumbFitHeight={240} />)

		const card = cardContainer("res-1")
		// The min-width floor stays so the name has room to read; the max
		// width cap goes away so wide covers keep their aspect ratio.
		expect(card.style.minWidth).toBe("200px")
		expect(card.style.maxWidth).toBe("")
		// Height capped at 240, width follows the cover's aspect ratio.
		const thumb = thumbBox(card)
		expect(thumb.style.height).toBe("240px")
		expect(thumb.style.width).toBe("80px")
		// The name must not stretch the card beyond the thumbnail: its
		// intrinsic-width contribution is zeroed so truncate applies.
		const name = screen.getByTestId("resource-item-res-1")
		const nameClasses = name.parentElement?.className.split(/\s+/)
		expect(nameClasses).toContain("w-0")
		expect(nameClasses).toContain("min-w-full")
	})

	it("fit-height mode never upscales a short cover", async () => {
		const resource = stubResCard("res-1", "Some resource", {
			coverMeta: { kind: "image", width: 400, height: 150 },
		})
		await renderCard(<ResCard resource={resource} thumbFitHeight={240} />)

		const thumb = thumbBox(cardContainer("res-1"))
		expect(thumb.style.height).toBe("150px")
		expect(thumb.style.width).toBe("400px")
	})

	it("fit-height mode fills the tile so wide covers leave no blank space", async () => {
		const resource = stubResCard("res-1", "Some resource", {
			coverMeta: { kind: "image", width: 800, height: 500 },
		})
		await renderCard(<ResCard resource={resource} thumbFitHeight={240} />)

		// The tile box keeps the cover's aspect ratio…
		const thumb = thumbBox(cardContainer("res-1"))
		expect(thumb.style.height).toBe("240px")
		expect(thumb.style.width).toBe("384px")
		// …and the image fills it instead of rendering at its clamped
		// natural size (which would leave blank space on the right).
		const img = screen.getByTestId("resource-thumb-img-res-1")
		expect(img).toHaveClass("h-full", "w-full", "object-cover")
		expect(img.style.maxWidth).toBe("")
	})

	it("fit-height mode clamps ultra-wide covers at the max width, rescaling height", async () => {
		const resource = stubResCard("res-1", "Some resource", {
			coverMeta: { kind: "image", width: 1600, height: 400 },
		})
		await renderCard(<ResCard resource={resource} thumbFitHeight={240} />)

		const thumb = thumbBox(cardContainer("res-1"))
		expect(thumb.style.width).toBe("400px")
		expect(thumb.style.height).toBe("100px")
	})

	it("caps the whole card at the compact floor when there is no cover", async () => {
		const resource = stubResCard("res-1", "Some resource")
		await renderCard(<ResCard resource={resource} />)

		// Without cover dimensions the card itself stays at the 200px floor
		// instead of stretching across the grid cell; the empty tile fills it.
		const card = cardContainer("res-1")
		expect(card.style.minWidth).toBe("200px")
		expect(card.style.maxWidth).toBe("200px")
	})

	it("widens to cover dimensions once backfilled meta arrives", async () => {
		const resource = stubResCard("res-1", "Some resource", {
			contentPluginId: GALLERY_PLUGIN_ID,
		})
		const queryClient = await renderCard(<ResCard resource={resource} />)

		const card = cardContainer("res-1")
		expect(card.style.maxWidth).toBe("200px")

		queryClient.setQueryData(
			resKeys.detailCard("res-1"),
			stubResCard("res-1", "Some resource", {
				contentPluginId: GALLERY_PLUGIN_ID,
				coverMeta: { kind: "image", width: 800, height: 600 },
				sourceMeta: { width: 800, height: 600 },
			}),
		)

		await waitFor(() => {
			expect(card.style.maxWidth).toBe("400px")
		})
		const thumb = thumbBox(card)
		expect(thumb.style.width).toBe("400px")
		expect(thumb.style.height).toBe("300px")
	})

	it("fit-height mode falls back to the configured height without cover metadata", async () => {
		const resource = stubResCard("res-1", "Some resource")
		await renderCard(<ResCard resource={resource} thumbFitHeight={240} />)

		const thumb = thumbBox(cardContainer("res-1"))
		expect(thumb.style.height).toBe("240px")
		expect(thumb.style.width).toBe("240px")
	})
})

/**
 * The thumb's badge overlay: a full-size `z-10` layer inside the tile box
 * that spans the card's cover row. It is the badge slot's parent.
 */
function badgeOverlayOf(card: HTMLElement): HTMLElement {
	const badge = screen.getByText("TAGB-100")
	const overlay = badge.parentElement?.parentElement ?? null
	if (overlay === null || !card.contains(overlay))
		throw new Error("badge overlay not found")
	return overlay
}

describe("ResCard corner badges", () => {
	it("spans the badge layer over the cover row, past the cover itself", async () => {
		// A cover far narrower than the card's 200px floor: the badge layer
		// must still follow the card, not the cover.
		const resource = stubResCard("res-1", "Some resource", {
			contentPluginId: BADGE_PLUGIN_ID,
			coverMeta: { kind: "image", width: 100, height: 400 },
			sourceMeta: { width: 100, height: 400 },
		})
		await renderCard(<ResCard resource={resource} />, [
			badgePluginRow(BADGE_PLUGIN_ID),
		])

		const card = cardContainer("res-1")
		const cover = thumbBox(card)
		const overlay = badgeOverlayOf(card)
		// The cover keeps its intrinsic width (it centers in the wider card),
		// while the overlay's containing block is the tile box that spans the
		// whole cover row — so the badge reaches the card's right edge.
		expect(cover.style.width).toBe("100px")
		expect(overlay).not.toBe(cover)
		expect(overlay.parentElement).not.toBe(cover)
		expect(cover.parentElement?.parentElement).toBe(
			overlay.parentElement?.parentElement,
		)
		expect(overlay).toHaveClass(
			"pointer-events-none",
			"absolute",
			"inset-0",
			"z-10",
		)
		expect(overlay).toHaveTextContent("TAGB-100")
	})

	it("centers the narrow cover inside the card's cover row", async () => {
		const resource = stubResCard("res-1", "Some resource", {
			coverMeta: { kind: "image", width: 100, height: 400 },
			sourceMeta: { width: 100, height: 400 },
		})
		await renderCard(<ResCard resource={resource} />)

		const card = cardContainer("res-1")
		const cover = thumbBox(card)
		// Card root → cover row (the card's full width) → tile box (also full
		// width, so the badge layer can span it) → cover box, which shrinks to
		// the cover and centers itself with `m-auto` instead of sticking to
		// the row's left edge.
		const tile = screen.getByTestId("resource-thumb-tile-res-1")
		const row = tile.parentElement
		expect(cover.className.split(/\s+/)).toContain("m-auto")
		expect(cover.parentElement).toBe(tile)
		expect(tile.className.split(/\s+/)).toContain("max-w-full")
		expect(row?.className.split(/\s+/)).toContain("w-full")
		expect(row?.parentElement).toBe(card)
	})

	it("renders an empty badge overlay for a card without corner badges", async () => {
		const resource = stubResCard("res-1", "Some resource", {
			coverMeta: { kind: "image", width: 800, height: 600 },
		})
		await renderCard(<ResCard resource={resource} />)

		const row = thumbBox(cardContainer("res-1")).parentElement
		const overlay = row?.querySelector(".pointer-events-none.inset-0")
		expect(overlay).not.toBeNull()
		expect(overlay).toBeEmptyDOMElement()
	})
})

describe("ResCard source chip", () => {
	it("renders a clickable chip when source fields are set", async () => {
		const resource = stubResCard("res-1", "Some resource", {
			sourceName: "ExampleSite",
			sourceUrl: "https://example.com/item",
		})
		await renderCard(<ResCard resource={resource} />)

		expect(screen.getByText("ExampleSite")).toBeInTheDocument()
		expect(screen.getByTestId("source-chip-link")).toHaveAttribute(
			"href",
			"https://example.com/item",
		)
	})

	it("renders no chip when no source fields are set", async () => {
		const resource = stubResCard("res-1", "Some resource")
		await renderCard(<ResCard resource={resource} />)

		expect(screen.queryByTestId("source-chip-link")).not.toBeInTheDocument()
	})
})
