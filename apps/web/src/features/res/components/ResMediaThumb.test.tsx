import type { CoverKindUiMap } from "@hoardodile/sdk-types"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"
import { pluginKeys } from "@/features/plugin/pluginApi"
import { AUDIO_TILE_HEIGHT } from "./ResAudioPlayer"
import type { ResMediaThumbResource } from "./ResMediaThumb"
import { ResMediaThumb } from "./ResMediaThumb"

const PLUGIN_ID = "11111111-1111-1111-1111-111111111111"

function makeResource(
	overrides?: Partial<ResMediaThumbResource>,
): ResMediaThumbResource {
	return {
		id: "res-1",
		name: "Test Resource",
		contentPluginId: PLUGIN_ID,
		coverMeta: { kind: "image", width: 100, height: 100 },
		sourceMeta: {},
		searchMeta: { v: 1, facets: { video: true, audio: true } },
		fileStats: undefined,
		updatedAt: 1,
		...overrides,
	}
}

function renderWithTemplate(
	template: string,
	resourceOverrides?: Partial<ResMediaThumbResource>,
) {
	const consoleError = vi
		.spyOn(console, "error")
		.mockImplementation(() => undefined)

	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})

	queryClient.setQueryData(pluginKeys.listAll(), [
		{
			id: PLUGIN_ID,
			manifest: {
				id: PLUGIN_ID,
				name: "Test Plugin",
				description: "A plugin for testing",
				version: "1.0.0",
				permissions: {},
				ui: {
					card: {
						image: {
							tl: [template],
						},
					},
					search: {
						kinds: [
							{ key: "video", label: "Video", icon: "{{icon('Video')}}" },
							{ key: "audio", label: "Audio", icon: "{{icon('Music')}}" },
						],
					},
				},
			},
			enabled: true,
			priority: 0,
			missing: false,
			builtin: false,
			dev: false,
		},
	])

	render(
		<QueryClientProvider client={queryClient}>
			<ResMediaThumb resource={makeResource(resourceOverrides)} />
		</QueryClientProvider>,
	)

	const keyWarning = consoleError.mock.calls.find(
		(call) =>
			typeof call[0] === "string" &&
			call[0].includes('Each child in a list should have a unique "key"'),
	)
	consoleError.mockRestore()
	return keyWarning
}

/**
 * Render the thumb with a plugin manifest whose `ui.card` carries only the
 * given blocks (e.g. `{ default: { tl: [...] } }`), so the slot-selection
 * fallback can be asserted on rendered badge text.
 */
function renderWithCardBlocks(
	card: CoverKindUiMap,
	resourceOverrides?: Partial<ResMediaThumbResource>,
) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	queryClient.setQueryData(pluginKeys.listAll(), [
		{
			id: PLUGIN_ID,
			manifest: {
				id: PLUGIN_ID,
				name: "Test Plugin",
				description: "A plugin for testing",
				version: "1.0.0",
				permissions: {},
				ui: { card },
			},
			enabled: true,
			priority: 0,
			missing: false,
			builtin: false,
			dev: false,
		},
	])
	return render(
		<QueryClientProvider client={queryClient}>
			<ResMediaThumb resource={makeResource(resourceOverrides)} />
		</QueryClientProvider>,
	)
}

function renderThumb(
	resourceOverrides?: Partial<ResMediaThumbResource>,
	props?: Partial<ComponentProps<typeof ResMediaThumb>>,
) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	queryClient.setQueryData(pluginKeys.listAll(), [])
	return render(
		<QueryClientProvider client={queryClient}>
			<ResMediaThumb resource={makeResource(resourceOverrides)} {...props} />
		</QueryClientProvider>,
	)
}

describe("ResMediaThumb", () => {
	it("renders search-kind icons without a missing key warning", () => {
		expect(renderWithTemplate("{{searchKindIcons()}}")).toBeUndefined()
	})

	it("renders joined search-kind icons without a missing key warning", () => {
		expect(
			renderWithTemplate(
				"{{join(' ', searchKindIcons(), bytes(file.sizeBytes))}}",
				{
					fileStats: { count: 1, sizeBytes: 1024 },
				},
			),
		).toBeUndefined()
	})

	it("falls back to the default card block when the cover kind block is absent", () => {
		renderWithCardBlocks(
			{
				default: { tl: ["{{source.width}}x{{source.height}}"] },
			},
			{
				// A user-pinned image cover flips `coverMeta.kind` to "image";
				// the manifest only declares `default`, which must still render.
				coverMeta: { kind: "image", width: 100, height: 100 },
				sourceMeta: { width: 1920, height: 1080 },
			},
		)
		expect(screen.getByText("1920x1080")).toBeInTheDocument()
	})

	it("prefers the kind-specific card block over the default block", () => {
		renderWithCardBlocks(
			{
				image: { tl: ["KIND-{{source.width}}"] },
				default: { tl: ["DEFAULT-{{source.width}}"] },
			},
			{ sourceMeta: { width: 800 } },
		)
		expect(screen.getByText("KIND-800")).toBeInTheDocument()
		expect(screen.queryByText("DEFAULT-800")).toBeNull()
	})

	it("renders no corner badges when neither the kind block nor default exists", () => {
		renderWithCardBlocks(
			{ image: { bl: ["{{source.width}}"] } },
			{
				coverMeta: { kind: "video" },
				sourceMeta: { width: 800 },
			},
		)
		expect(screen.queryByText("800")).toBeNull()
	})

	it("gives artwork-less audio the resident player instead of a thumbnail", () => {
		renderThumb({ coverMeta: { kind: "audio" } })
		const tile = screen.getByTestId("resource-audio-tile-res-1")
		expect(screen.queryByTestId("resource-thumb-res-1")).toBeNull()
		// The tile owns a deliberate rectangle: audio has no intrinsic
		// geometry to scale, so the height is fixed and the width follows
		// the card.
		const box = tile.parentElement
		expect(box?.style.height).toBe(`${AUDIO_TILE_HEIGHT}px`)
		expect(box?.style.width).toBe("100%")
	})

	it("keeps the thumbnail and overlays the player when audio has artwork", () => {
		renderThumb({ coverMeta: { kind: "audio", width: 300, height: 300 } })
		expect(screen.queryByTestId("resource-thumb-res-1")).not.toBeNull()
		expect(screen.queryByTestId("resource-audio-tile-res-1")).toBeNull()
		expect(screen.queryByTestId("resource-audio-toggle-res-1")).not.toBeNull()
	})

	it("leaves non-audio covers untouched", () => {
		renderThumb()
		expect(screen.queryByTestId("resource-thumb-res-1")).not.toBeNull()
		expect(screen.queryByTestId("resource-audio-res-1")).toBeNull()
	})

	it("shows the resource name instead of an image when there is no cover", () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		})
		queryClient.setQueryData(pluginKeys.listAll(), [
			{
				id: PLUGIN_ID,
				manifest: {
					id: PLUGIN_ID,
					name: "Test Plugin",
					description: "A plugin for testing",
					version: "1.0.0",
					permissions: {},
				},
				enabled: true,
				priority: 0,
				missing: false,
				builtin: false,
				dev: false,
			},
		])
		render(
			<QueryClientProvider client={queryClient}>
				<ResMediaThumb resource={makeResource({ coverMeta: undefined })} />
			</QueryClientProvider>,
		)
		// jsdom never loads (or errors) images, so drive the 404 path by
		// firing the error event the real route's 404 would produce.
		fireEvent.error(screen.getByTestId("resource-thumb-img-res-1"))
		const empty = screen.getByTestId("resource-thumb-empty-res-1")
		expect(empty).toHaveTextContent("Test Resource")
		expect(screen.getByText("Test Resource")).toHaveClass(
			"text-base",
			"font-bold",
		)
		expect(screen.queryByTestId("resource-thumb-img-res-1")).toBeNull()
		// The media thumb hands the tile an `absolute` stretch layer; the
		// base `relative` must merge away or the box collapses to zero
		// height and clips the empty content.
		const thumbRoot = screen.getByTestId("resource-thumb-res-1")
		expect(thumbRoot.className.split(/\s+/)).toContain("absolute")
		expect(thumbRoot.className.split(/\s+/)).not.toContain("relative")
		expect(thumbRoot).toHaveClass("bg-muted")
	})

	it("still mounts a cover img when coverMeta is the empty sentinel", () => {
		renderThumb({ coverMeta: { empty: true } })
		expect(screen.getByTestId("resource-thumb-img-res-1")).toBeInTheDocument()
		fireEvent.error(screen.getByTestId("resource-thumb-img-res-1"))
		expect(screen.queryByTestId("resource-thumb-img-res-1")).toBeNull()
		expect(screen.getByTestId("resource-thumb-empty-res-1")).toHaveTextContent(
			"Test Resource",
		)
	})

	it("keeps the preview button hover-only by default", () => {
		renderThumb(undefined, { onPreviewRequest: () => {} })
		const button = screen.getByRole("button", { name: "Test Resource" })
		expect(button).toHaveClass("opacity-0", "pointer-events-none")
		expect(button).not.toHaveClass("opacity-100")
	})

	it("shows the preview button on touch screens when opted in", () => {
		renderThumb(undefined, {
			onPreviewRequest: () => {},
			previewButtonTouchVisible: true,
		})
		const button = screen.getByRole("button", { name: "Test Resource" })
		expect(button).toHaveClass("opacity-100", "pointer-events-auto")
		// Desktop (`md:` and up) keeps the hover-reveal behavior.
		expect(button).toHaveClass(
			"md:opacity-0",
			"md:pointer-events-none",
			"md:group-hover:opacity-100",
			"md:group-hover:pointer-events-auto",
		)
	})

	it("fires onPreviewRequest from the touch-visible button", () => {
		const onPreviewRequest = vi.fn()
		renderThumb(undefined, {
			onPreviewRequest,
			previewButtonTouchVisible: true,
		})
		fireEvent.click(screen.getByRole("button", { name: "Test Resource" }))
		expect(onPreviewRequest).toHaveBeenCalledTimes(1)
	})
})
