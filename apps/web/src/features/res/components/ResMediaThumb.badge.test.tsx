import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ComponentProps, ReactNode } from "react"
import { describe, expect, it } from "vitest"
import { pluginKeys } from "@/features/plugin/pluginApi"
import type { ResMediaThumbResource } from "./ResMediaThumb"
import { ResMediaThumb } from "./ResMediaThumb"

const PLUGIN_ID = "11111111-1111-1111-1111-111111111111"

function makeResource(): ResMediaThumbResource {
	return {
		id: "res-1",
		name: "Test Resource",
		contentPluginId: PLUGIN_ID,
		coverMeta: { kind: "image", width: 100, height: 400 },
		sourceMeta: { width: 100, height: 400 },
		searchMeta: { v: 1, facets: { video: false, audio: false } },
		fileStats: undefined,
		updatedAt: 1,
	}
}

function pluginRows(ui: unknown) {
	return [
		{
			id: PLUGIN_ID,
			manifest: {
				id: PLUGIN_ID,
				name: "Test Plugin",
				description: "A plugin for badge tests",
				version: "1.0.0",
				permissions: {},
				ui,
			},
			enabled: true,
			priority: 0,
			pinned: false,
			color: "",
			missing: false,
			builtin: false,
			dev: false,
			assetVersion: "1",
		},
	]
}

function renderThumb(
	props?: Partial<ComponentProps<typeof ResMediaThumb>>,
	rows: readonly unknown[] = pluginRows({
		card: {
			image: {
				tl: ["TLCORNER"],
				bl: ["BLCORNER"],
				br: ["BRCORNER"],
			},
		},
	}),
) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	queryClient.setQueryData(pluginKeys.listAll(), rows)
	return render(
		<QueryClientProvider client={queryClient}>
			<ResMediaThumb resource={makeResource()} {...props} />
		</QueryClientProvider>,
	)
}

/** The inner `ResThumb` tile — the element carrying the `resource-thumb-*` id. */
function innerThumb(): HTMLElement {
	return screen.getByTestId("resource-thumb-res-1")
}

/**
 * The cover box — the element the media thumb hands the fitted size and the
 * rounding, and the one the cover re-centers itself inside.
 */
function coverBox(): HTMLElement {
	return innerThumb().parentElement as HTMLElement
}

/** The tile box — the outer element, whose width the caller's row decides. */
function tileBox(): HTMLElement {
	return screen.getByTestId("resource-thumb-tile-res-1")
}

/** The badge overlay — the tile box's full-size layer, `inset-0`. */
function slotOverlay(): HTMLElement | null {
	return tileBox().querySelector<HTMLElement>(
		":scope > .pointer-events-none.inset-0",
	)
}

function slotLayer(text: string): HTMLElement {
	const badge = screen.getByText(text)
	const layer = badge.closest("div")
	if (!(layer instanceof HTMLElement)) throw new Error("slot layer not found")
	return layer
}

const TL_LAYER = "absolute top-2 left-2 z-10 flex flex-col items-start gap-1"
const BL_LAYER = "absolute bottom-2 left-2 z-10 flex flex-col items-start gap-1"
const BR_LAYER = "absolute right-2 bottom-2 z-10 flex flex-col items-end gap-1"

describe("ResMediaThumb corner badges", () => {
	it("lifts the slot layers onto the tile box, out of the cover", () => {
		renderThumb()

		const overlay = slotOverlay()
		expect(overlay).not.toBeNull()
		// The overlay is the tile box's second child — a sibling of the cover,
		// spanning the width the caller gives the tile rather than the cover's.
		expect(overlay?.parentElement).toBe(tileBox())
		expect(overlay?.parentElement).not.toBe(coverBox())
		expect(coverBox().parentElement).toBe(tileBox())
		expect(overlay).toHaveClass(
			"pointer-events-none",
			"absolute",
			"inset-0",
			"z-10",
		)
		// Each slot keeps its own corner offsets.
		expect(slotLayer("TLCORNER")).toHaveClass(...TL_LAYER.split(" "))
		expect(slotLayer("BLCORNER")).toHaveClass(...BL_LAYER.split(" "))
		expect(slotLayer("BRCORNER")).toHaveClass(...BR_LAYER.split(" "))
		expect(overlay?.contains(slotLayer("TLCORNER"))).toBe(true)
	})

	it("keeps the fitted size and re-centering on the cover box", () => {
		renderThumb({ maxWidth: 400, maxHeight: 600 })

		// The tile box stretches to the caller; the cover box owns the fitted
		// pixel size and centers itself, so a narrow cover stays centered
		// instead of sticking to the tile box's left edge.
		const box = tileBox()
		expect(box.className.split(/\s+/)).not.toContain("w-fit")
		expect(box.contains(coverBox())).toBe(true)
		expect(coverBox().className.split(/\s+/)).toContain("m-auto")
		expect(coverBox().style.width).toBe("100px")
		expect(coverBox().style.height).toBe("400px")
	})

	it("puts the caller's trailing badge last in the bottom-left stack", () => {
		const trailing: ReactNode = <span>PLUGINBADGE</span>
		renderThumb({ blTrailingBadge: trailing })

		// The trailing badge shares the `bl` stack — the layer anchored to the
		// tile's bottom-left — and sits below the plugin's own badges, never at
		// the stack's top or in another corner.
		const layer = slotLayer("BLCORNER")
		expect(layer).toHaveClass(...BL_LAYER.split(" "))
		expect(layer).toHaveTextContent("PLUGINBADGE")
		expect(layer.lastElementChild).toHaveTextContent("PLUGINBADGE")
		expect(layer.children).toHaveLength(2)
		expect(slotOverlay()?.contains(layer)).toBe(true)
	})

	it("anchors a lone trailing badge to the bottom-left when no slot badge exists", () => {
		const trailing: ReactNode = <span>PLUGINBADGE</span>
		renderThumb(
			{ blTrailingBadge: trailing },
			pluginRows({ card: { image: { br: ["BRCORNER"] } } }),
		)

		// The plugin declares no `bl` badge, so the trailing badge still gets
		// its own bottom-left layer (never the overlay's top-left corner).
		const badge = screen.getByText("PLUGINBADGE")
		const layer = badge.parentElement
		expect(layer).toHaveClass(...BL_LAYER.split(" "))
		expect(slotOverlay()?.contains(layer ?? null)).toBe(true)
	})

	it("renders an empty overlay when no badge is configured", () => {
		renderThumb(undefined, pluginRows({}))

		expect(slotOverlay()).toBeEmptyDOMElement()
	})
})
