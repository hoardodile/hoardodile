import { type APIRequestContext, expect, test } from "@playwright/test"
import { login } from "./helpers"
import {
	apiLogin,
	createResource,
	deleteResources,
	uploadOrderedFile,
} from "./serverApi"
import { solidPng } from "./testArchive"

const FILE_PLUGIN_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
/**
 * The preinstalled gallery plugin (seeded via SEED_PLUGIN_PATHS): its
 * analyzer probes uploaded image bytes, which is what fills the cover
 * metadata the card sizes itself from. The built-in `file` fallback has no
 * analyzer, so its cards always render the square empty-cover floor.
 */
const GALLERY_PLUGIN_ID = "665cfbdd-1db6-48f5-9d53-1008b8cb84c3"
/** The card's own `right-2` / `top-2` inset, in CSS pixels. */
const INSET_PX = 8
/** Sub-pixel tolerance for rect comparisons. */
const TOLERANCE_PX = 1.5

/** Stages a PNG and creates a card resource from it (the ordered-file path). */
async function createImageResource(
	request: APIRequestContext,
	cookie: string,
	name: string,
	png: Buffer,
	contentPluginId = FILE_PLUGIN_ID,
): Promise<string> {
	const fileId = await uploadOrderedFile(
		request,
		cookie,
		png,
		`${name}.png`,
		"image/png",
	)
	return createResource(request, cookie, {
		files: [fileId],
		names: [`${name}.png`],
		name,
		contentPluginId,
	})
}

/**
 * Waits for the asynchronous meta pass to write the cover dimensions the
 * card sizes itself from. Returns the metadata, or `undefined` when the
 * instance never records any (a fallback-plugin card).
 */
async function waitForCoverMeta(
	request: APIRequestContext,
	cookie: string,
	id: string,
	timeoutMs = 20_000,
): Promise<{ readonly width?: number; readonly height?: number } | undefined> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		// `detailCard` is a query procedure: tRPC answers it on GET only.
		const res = await request.get(
			`http://127.0.0.1:${process.env.E2E_SERVER_PORT ?? "3001"}/trpc/resource.detailCard?input=${encodeURIComponent(
				JSON.stringify({ id }),
			)}`,
			{ headers: { cookie } },
		)
		if (res.ok()) {
			const body = (await res.json()) as {
				result?: {
					data?: { coverMeta?: Record<string, unknown>; json?: unknown }
				}
			}
			const data = body.result?.data
			const card = (data?.json ?? data) as
				| { coverMeta?: Record<string, unknown> }
				| undefined
			const meta = card?.coverMeta
			if (typeof meta?.width === "number") {
				return { width: meta.width, height: meta.height as number }
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 500))
	}
	return undefined
}

type Rect = {
	readonly top: number
	readonly right: number
	readonly bottom: number
	readonly left: number
	readonly width: number
	readonly height: number
}

/**
 * Measured geometry for one card. jsdom can only assert class names, so the
 * placement contract — the preview control shares the cover row with the
 * corner badges and the actions trigger, and therefore sits on the *card's*
 * edge rather than a centered narrow cover's — needs a real layout engine.
 *
 * Retries until the card and its control are both attached: the grid renders
 * through TanStack Query + virtualized-ish reflows, and a measurement can
 * otherwise land in the gap between the card mounting and the control
 * settling.
 */
async function measure(page: import("@playwright/test").Page, id: string) {
	await page.waitForFunction(
		(resourceId) => {
			const card = document.querySelector(
				`[data-resource-card-id="${resourceId}"]`,
			)
			return (
				card !== null &&
				card.querySelector(`[data-testid="resource-preview-${resourceId}"]`) !==
					null
			)
		},
		id,
		{ timeout: 30_000 },
	)
	return page.evaluate((resourceId) => {
		const card = document.querySelector(
			`[data-resource-card-id="${resourceId}"]`,
		)
		if (card === null) throw new Error(`card ${resourceId} not found`)
		const preview = card.querySelector(
			`[data-testid="resource-preview-${resourceId}"]`,
		)
		if (preview === null) throw new Error(`preview ${resourceId} not found`)
		const actions = card.querySelector(
			`[data-testid="resource-actions-${resourceId}"]`,
		)
		const tile = card.querySelector(
			`[data-testid="resource-thumb-tile-${resourceId}"]`,
		)
		const cover = tile?.querySelector("div") ?? null
		const row = preview.parentElement
		if (row === null) throw new Error("cover row not found")

		const rect = (el: Element | null) => {
			if (el === null) return null
			const r = el.getBoundingClientRect()
			return {
				top: r.top,
				right: r.right,
				bottom: r.bottom,
				left: r.left,
				width: r.width,
				height: r.height,
			}
		}
		const style = getComputedStyle(preview)
		return {
			card: rect(card) as Rect,
			row: rect(row) as Rect,
			tile: rect(tile),
			cover: rect(cover),
			preview: rect(preview) as Rect,
			actions: rect(actions),
			previewOpacity: style.opacity,
			previewPointerEvents: style.pointerEvents,
			previewInsideTile: tile?.contains(preview) ?? false,
			previewParentIsRow: preview.parentElement === row,
		}
	}, id)
}

test.describe("resource card preview control (real browser)", () => {
	test.setTimeout(90_000)

	test("anchors the preview button to the card's cover row, not a narrow cover", async ({
		page,
		request,
	}) => {
		await login(page)
		const cookie = await apiLogin(request)
		// A tall cover keeps its intrinsic width inside the 200px card floor,
		// so the fitted cover box is narrower than the card — exactly the case
		// the placement fix is about.
		const narrowId = await createImageResource(
			request,
			cookie,
			"e2e-preview-tall",
			solidPng(100, 400, [200, 40, 40]),
			GALLERY_PLUGIN_ID,
		)
		const wideId = await createImageResource(
			request,
			cookie,
			"e2e-preview-wide",
			solidPng(900, 600, [40, 120, 200]),
			GALLERY_PLUGIN_ID,
		)

		try {
			// The cover metadata the card sizes itself from is written by an
			// asynchronous meta pass; wait for the tall fixture's real
			// dimensions before measuring.
			const narrowMeta = await waitForCoverMeta(request, cookie, narrowId)
			expect(
				narrowMeta?.width,
				"the tall fixture must carry narrow cover metadata",
			).toBeLessThan(200)
			await waitForCoverMeta(request, cookie, wideId)

			await page.goto("/resources")
			for (const id of [narrowId, wideId]) {
				await expect(page.getByTestId(`resource-thumb-${id}`)).toBeAttached({
					timeout: 30_000,
				})
			}
			// Let the covers load so the fitted boxes carry their real size.
			await expect
				.poll(async () => {
					const narrow = await measure(page, narrowId)
					return narrow.cover !== null && narrow.cover.width > 0
				})
				.toBe(true)

			for (const id of [narrowId, wideId]) {
				const m = await measure(page, id)

				// The button is a child of the cover row (not of the thumb),
				// and the row spans the whole card — the precondition that
				// makes `right-2` the card's edge.
				expect(m.previewParentIsRow, `${id}: button parent`).toBe(true)
				expect(m.previewInsideTile, `${id}: button inside thumb`).toBe(false)
				expect(
					Math.abs(m.row.width - m.card.width),
					`${id}: cover row width ${m.row.width} vs card ${m.card.width}`,
				).toBeLessThanOrEqual(TOLERANCE_PX)
				expect(m.row.height, `${id}: cover row has height`).toBeGreaterThan(0)

				// The preview button and the actions trigger share the same
				// layer inset, and that inset is the row's edge.
				expect(
					Math.abs(m.actions!.right - m.preview.right),
					`${id}: preview right ${m.preview.right} vs actions ${m.actions?.right}`,
				).toBeLessThanOrEqual(TOLERANCE_PX)
				expect(
					Math.abs(m.card.right - m.preview.right - INSET_PX),
					`${id}: preview inset from the card edge`,
				).toBeLessThanOrEqual(TOLERANCE_PX)
				// Vertically it stays on the cover row.
				expect(m.preview.top).toBeGreaterThanOrEqual(m.row.top - TOLERANCE_PX)
				expect(m.preview.bottom).toBeLessThanOrEqual(
					m.row.bottom + TOLERANCE_PX,
				)
			}

			// The regression case: the tall cover's fitted box is narrower
			// than (and inset inside) the card, yet the button still sits on
			// the card's edge. Anchoring it to the cover box — the placement
			// before the fix — would move it left by the cover's own inset,
			// so the two candidate placements must differ by a measurable,
			// regression-sized amount rather than overlapping.
			const narrow = await measure(page, narrowId)
			expect(narrow.cover).not.toBeNull()
			const coverInset = narrow.card.right - narrow.cover!.right
			expect(
				coverInset,
				`narrow cover inset (cover ${narrow.cover?.width} vs card ${narrow.card.width})`,
			).toBeGreaterThan(TOLERANCE_PX)
			const buttonInset = narrow.card.right - narrow.preview.right
			expect(
				Math.abs(buttonInset - INSET_PX),
				"button stays on the card edge, not the cover edge",
			).toBeLessThanOrEqual(TOLERANCE_PX)
			// A cover-anchored button would measure `coverInset + INSET_PX`
			// from the card; that is a whole cover-inset away from the actual
			// measurement, so the old placement cannot pass the check above.
			expect(
				Math.abs(buttonInset - (coverInset + INSET_PX)),
				"the cover-anchored placement is measurably farther left",
			).toBeGreaterThan(INSET_PX)
		} finally {
			await deleteResources(request, cookie, [narrowId, wideId])
		}
	})

	test("reveals the preview button on hover and opens the lightbox on click", async ({
		page,
		request,
	}) => {
		await login(page)
		const cookie = await apiLogin(request)
		const id = await createImageResource(
			request,
			cookie,
			"e2e-preview-click",
			solidPng(240, 240, [40, 160, 90]),
		)

		try {
			await page.goto("/resources")
			await expect(page.getByTestId(`resource-thumb-${id}`)).toBeAttached({
				timeout: 30_000,
			})

			const button = page.getByTestId(`resource-preview-${id}`)
			// Hidden until hover on a desktop pointer — the button must never
			// occlude the cover by default.
			const before = await measure(page, id)
			expect(before.previewOpacity).toBe("0")

			await page.locator(`[data-resource-card-id="${id}"]`).hover()
			await expect
				.poll(async () => (await measure(page, id)).previewOpacity)
				.toBe("1")
			expect((await measure(page, id)).previewPointerEvents).toBe("auto")

			await button.click()
			await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30_000 })
			await page.keyboard.press("Escape")
			await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 })
		} finally {
			await deleteResources(request, cookie, [id])
		}
	})

	test("keeps the preview button visible without hover on a touch viewport", async ({
		page,
		request,
	}) => {
		await login(page)
		const cookie = await apiLogin(request)
		const id = await createImageResource(
			request,
			cookie,
			"e2e-preview-touch",
			solidPng(240, 240, [160, 40, 160]),
		)

		try {
			await page.setViewportSize({ width: 380, height: 800 })
			await page.goto("/resources")
			await expect(page.getByTestId(`resource-thumb-${id}`)).toBeAttached({
				timeout: 30_000,
			})

			// Below `md` the touch-visible classes keep the control revealed
			// (mirroring the actions trigger) — no hover exists on touch.
			await expect
				.poll(async () => (await measure(page, id)).previewOpacity, {
					timeout: 20_000,
				})
				.toBe("1")
			expect((await measure(page, id)).previewPointerEvents).toBe("auto")
		} finally {
			await deleteResources(request, cookie, [id])
		}
	})
})
