import { expect, test } from "@playwright/test"
import { login } from "./helpers"
import { apiLogin, createResource, uploadOrderedFile } from "./serverApi"
import { solidPng } from "./testArchive"

const SERVER = `http://127.0.0.1:${process.env.E2E_SERVER_PORT ?? "3001"}`
// The preinstalled gallery plugin (see playwright.config.ts DEV_PLUGIN_PATHS).
const GALLERY_PLUGIN_ID = "665cfbdd-1db6-48f5-9d53-1008b8cb84c3"

test.describe("message anchor jump (real browser)", () => {
	test.setTimeout(180_000)

	test("clicking an anchor chip navigates in-app without reloading the page", async ({
		page,
		request,
	}) => {
		// Probe: every frame reports the host→iframe `anchorJump` pushes it
		// receives. Sandboxed plugin iframes are opaque origins, so the
		// parent cannot read the frame window directly — the frame reports
		// back via postMessage instead.
		await page.addInitScript(() => {
			window.addEventListener("message", (event) => {
				if (event.source !== window.parent) return
				const data = event.data as { type?: string; key?: string }
				if (data.type === "push" && data.key === "anchorJump") {
					window.parent.postMessage({ __e2eAnchorJump: true }, "*")
				}
			})
		})

		const cookie = await apiLogin(request)
		const fileId = await uploadOrderedFile(
			request,
			cookie,
			solidPng(4, 4, [30, 30, 220]),
			"pixel.png",
			"image/png",
		)
		const resId = await createResource(request, cookie, {
			files: [fileId],
			names: ["pixel.png"],
			name: "e2e-anchor-target",
			contentPluginId: GALLERY_PLUGIN_ID,
		})
		const created = await request.post(`${SERVER}/trpc/comment.create`, {
			headers: { cookie },
			data: {
				body: "e2e anchor repro",
				anchorResId: resId,
				anchor: { data: { pageIndex: 1 } },
			},
		})
		const createdText = await created.text()
		expect(
			created.ok(),
			`comment.create failed: ${created.status()} ${createdText}`,
		).toBe(true)

		await login(page)
		await page.goto("/messages")
		await expect(page.getByTestId("comment-anchor-chip")).toBeVisible({
			timeout: 30_000,
		})

		// A full document navigation recreates the window and wipes the
		// marker; an in-app router navigation keeps it.
		await page.evaluate(() => {
			;(window as unknown as { __e2eNoReload?: boolean }).__e2eNoReload = true
			;(
				window as unknown as {
					__e2eAnchorJumpCount: number
				}
			).__e2eAnchorJumpCount = 0
			window.addEventListener("message", (event) => {
				const data = event.data as { __e2eAnchorJump?: boolean }
				if (data.__e2eAnchorJump === true) {
					;(
						window as unknown as { __e2eAnchorJumpCount: number }
					).__e2eAnchorJumpCount += 1
				}
			})
		})
		await page.getByTestId("comment-anchor-chip").click()
		await expect(page).toHaveURL(new RegExp(`/resources/${resId}`))
		await expect(page).toHaveURL(/pluginState=/)
		await expect(page.getByTestId("resource-detail-title")).toBeVisible({
			timeout: 30_000,
		})
		const survived = await page.evaluate(
			() =>
				(window as unknown as { __e2eNoReload?: boolean }).__e2eNoReload ===
				true,
		)
		expect(survived).toBe(true)
		// The encoded payload must reach the plugin iframe once it is
		// presented — not just open the page.
		await expect
			.poll(
				() =>
					page.evaluate(
						() =>
							(
								window as unknown as {
									__e2eAnchorJumpCount: number
								}
							).__e2eAnchorJumpCount,
					),
				{ timeout: 20_000 },
			)
			.toBeGreaterThan(0)
	})
})
