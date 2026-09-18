import { readFileSync } from "node:fs"
import {
	type APIRequestContext,
	expect,
	type Page,
	test,
} from "@playwright/test"
import yauzl from "yauzl"
import { login } from "./helpers"
import {
	apiLogin,
	createResource,
	fetchServerLogs,
	trpcPost,
	uploadOrderedFile,
} from "./serverApi"
import { solidPng } from "./testArchive"

/**
 * Regression coverage for the manual-test-unfriendly edge cases introduced
 * with the scroll-restore rework, the client log, and the AppErrorPage.
 *
 * These run against the real browser and the real server: the scroll
 * container is the app's `[data-app-scroll]` element (TanStack's window
 * scroll restoration never touches it), the restore loop runs on real
 * rAF timing, and the client-log push lands in the server's pino files.
 */
const SERVER = `http://127.0.0.1:${process.env.E2E_SERVER_PORT ?? "3001"}`
// The preinstalled gallery plugin (see playwright.config.ts SEED_PLUGIN_PATHS).
const GALLERY_PLUGIN_ID = "665cfbdd-1db6-48f5-9d53-1008b8cb84c3"

/** Read a zip buffer into entry name → bytes (the yauzl engine, same as the server). */
function readZipEntries(buffer: Buffer): Promise<Map<string, Buffer>> {
	const out = new Map<string, Buffer>()
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
			if (err !== null || zipfile === undefined) {
				reject(err ?? new Error("missing zipfile"))
				return
			}
			zipfile.readEntry()
			zipfile.on("entry", (entry: yauzl.Entry) => {
				zipfile.openReadStream(entry, (streamErr, stream) => {
					if (streamErr !== null) {
						reject(streamErr)
						return
					}
					const chunks: Buffer[] = []
					stream.on("data", (chunk: Buffer) => chunks.push(chunk))
					stream.on("end", () => {
						out.set(entry.fileName, Buffer.concat(chunks))
						zipfile.readEntry()
					})
				})
			})
			zipfile.on("end", () => resolve(out))
			zipfile.on("error", reject)
		})
	})
}

test.describe("scroll restoration (real browser)", () => {
	test.setTimeout(120_000)

	async function seedCharacters(request: APIRequestContext, count: number) {
		const cookie = await apiLogin(request)
		for (let start = 0; start < count; start += 10) {
			const batch = Array.from(
				{ length: Math.min(10, count - start) },
				(_, i) => ({
					name: `e2e-scroll-${start + i}`,
				}),
			)
			await Promise.all(
				batch.map((data) =>
					request.post(`${SERVER}/trpc/character.create`, {
						headers: { cookie },
						data,
					}),
				),
			)
			// Sequenced batches: the parallel inserts share one connection.
			await new Promise((done) => setTimeout(done, 250))
		}
	}

	/** Seed `count` gallery image resources (each its own staged file). */
	async function seedResources(request: APIRequestContext, count: number) {
		const cookie = await apiLogin(request)
		for (let i = 0; i < count; i += 1) {
			const fileId = await uploadOrderedFile(
				request,
				cookie,
				solidPng(4, 4, [220, 30, 30]),
				"pixel.png",
				"image/png",
			)
			await createResource(request, cookie, {
				files: [fileId],
				names: ["pixel.png"],
				name: `e2e-res-detail-${i}`,
				contentPluginId: GALLERY_PLUGIN_ID,
			})
		}
	}

	/** Scroll the app container and return the position it actually holds. */
	async function scrollTo(page: Page, target: number): Promise<number> {
		return await page.evaluate((value) => {
			const el = document.querySelector<HTMLElement>("[data-app-scroll]")
			if (el === null) throw new Error("no [data-app-scroll] container")
			const max = el.scrollHeight - el.clientHeight
			const top = Math.min(Math.max(max * 0.7, 200), value)
			el.scrollTop = top
			el.dispatchEvent(new Event("scroll"))
			return el.scrollTop
		}, target)
	}

	function scrollTopOf(page: Page) {
		return page.evaluate(
			() =>
				document.querySelector<HTMLElement>("[data-app-scroll]")?.scrollTop ??
				-1,
		)
	}

	test("push resets, back restores, forward resets", async ({
		page,
		request,
	}) => {
		await seedCharacters(request, 60)
		await login(page)
		await page.goto("/characters")
		await expect(page.locator("[data-testid='character-list'] li")).toHaveCount(
			30,
			{ timeout: 30_000 },
		)

		// A deep scroll whose stored value must never resurrect on a push.
		const deep = await scrollTo(page, 1500)
		expect(deep).toBeGreaterThan(200)

		// Push to Resources: a fresh page starts at the top.
		await page.getByRole("link", { name: "Resources" }).click()
		await expect(page).toHaveURL(/\/resources$/)
		await expect.poll(() => scrollTopOf(page)).toBe(0)

		// Push back to Characters — the stored 1500 must NOT revive ("路由到
		// 新页面时位置没被重置" was exactly this).
		await page.getByRole("link", { name: "Characters" }).click()
		await expect(page).toHaveURL(/\/characters$/)
		await expect.poll(() => scrollTopOf(page)).toBe(0)

		// Browser back now restores the exact stored position — including the
		// fast double-back case where the intermediate resolution is skipped.
		await page.goBack()
		await expect(page).toHaveURL(/\/resources$/)
		await page.goBack()
		await expect(page).toHaveURL(/\/characters$/)
		await expect.poll(() => scrollTopOf(page), { timeout: 10_000 }).toBe(deep)

		// Browser forward resets again.
		await page.goForward()
		await expect(page).toHaveURL(/\/resources$/)
		await expect.poll(() => scrollTopOf(page)).toBe(0)
	})

	test("refreshing the page restores the position", async ({ page }) => {
		await login(page)
		await page.goto("/characters")
		await expect(page.locator("[data-testid='character-list'] li")).toHaveCount(
			30,
			{ timeout: 30_000 },
		)
		const deep = await scrollTo(page, 1500)
		await page.reload()
		await expect(page.locator("[data-testid='character-list'] li")).toHaveCount(
			30,
			{ timeout: 30_000 },
		)
		await expect.poll(() => scrollTopOf(page), { timeout: 10_000 }).toBe(deep)
	})

	test("clicking the active nav row keeps the position", async ({ page }) => {
		await login(page)
		await page.goto("/characters")
		await expect(page.locator("[data-testid='character-list'] li")).toHaveCount(
			30,
			{ timeout: 30_000 },
		)
		const deep = await scrollTo(page, 1200)
		await page.getByRole("link", { name: "Characters" }).click()
		await expect(page).toHaveURL(/\/characters$/)
		await page.waitForTimeout(400)
		await expect.poll(() => scrollTopOf(page)).toBe(deep)
	})

	test("pushing from the resources grid to a resource detail resets the scroll", async ({
		page,
		request,
	}) => {
		test.setTimeout(180_000)
		await seedResources(request, 40)
		await login(page)
		await page.goto("/resources?size=40")
		await expect(page.locator("[data-resource-card-id]")).toHaveCount(40, {
			timeout: 30_000,
		})

		// A deep scroll whose position must not leak into the detail page.
		const deep = await scrollTo(page, 1500)
		expect(deep).toBeGreaterThan(0)

		await page.locator('[data-testid^="resource-open-"]').last().click()
		await expect(page).toHaveURL(/\/resources\/[^?]+/)
		await expect(page.getByTestId("resource-detail-title")).toBeVisible({
			timeout: 30_000,
		})
		// The detail route is scroll-untracked (the plugin owns its own
		// position): it must still start at the top instead of inheriting
		// the grid's scrollTop.
		await expect.poll(() => scrollTopOf(page), { timeout: 10_000 }).toBe(0)
	})
})

test.describe("designed error page", () => {
	test("a matchMedia crash surfaces AppErrorPage, not the TanStack default", async ({
		page,
	}) => {
		// Break a browser API used by the provider stack and the shell; the
		// crash must surface the designed error page (with the standalone
		// frame when the shell itself is gone) instead of a white screen.
		await page.addInitScript(() => {
			window.matchMedia = (() => {
				throw new Error("e2e matchMedia crashed")
			}) as typeof window.matchMedia
		})
		await page.goto("/")
		await expect(page.getByText("Something went wrong")).toBeVisible({
			timeout: 60_000,
		})
		await expect(page.getByTestId("app-error-reload")).toBeVisible()
		// The raw error is one click away, and the identity is shown.
		await page.getByTestId("app-error-details-toggle").click()
		await expect(page.getByTestId("app-error-details")).toContainText(
			"matchMedia",
		)
	})
})

test.describe("client log → diagnostics → server log", () => {
	test.setTimeout(120_000)

	test("console errors are captured, archived and pushed to the server log", async ({
		page,
		request,
	}) => {
		const marker = `e2e-client-marker-${Date.now()}`
		await login(page)
		const cookie = await apiLogin(request)

		// Two capture paths: the patched console and the window error hook.
		await page.evaluate((mark) => {
			console.error(mark, new Error(mark))
			window.dispatchEvent(
				new ErrorEvent("error", {
					message: mark,
					error: new Error(mark),
				}),
			)
		}, marker)

		// About → Report an issue: the form opens with the version prefilled.
		await page.goto("/settings/about")
		const report = page.getByTestId("me-feedback-bug")
		await expect(report).toBeVisible()
		const [popup] = await Promise.all([
			page.waitForEvent("popup"),
			report.click(),
		])
		await popup.waitForLoadState()
		// A signed-out browser is bounced through GitHub's login page with
		// the target encoded in `return_to` — assert the decoded direction.
		const opened = decodeURIComponent(popup.url())
		expect(opened).toContain("template=bug_report_selfhosted.yml")
		expect(opened).toContain("version=")

		// About → Download logs: the privacy dialog first, then a real zip
		// with the frontend log (carrying the marker) and the server's own
		// rolling log files.
		const downloadPromise = page.waitForEvent("download")
		await page.getByTestId("me-feedback-download-logs").click()
		await expect(page.getByTestId("me-logs-archive-confirm")).toBeVisible()
		await page.getByTestId("me-logs-archive-confirm").click()
		const download = await downloadPromise
		expect(download.suggestedFilename()).toMatch(/^hoardodile-logs-.*\.zip$/)
		const downloadPath = await download.path()
		expect(downloadPath).not.toBeNull()
		const archive = await readZipEntries(readFileSync(downloadPath!))
		expect(archive.has("frontend.log")).toBe(true)
		expect([...archive.keys()].some((name) => name.startsWith("app."))).toBe(
			true,
		)
		const frontend = new TextDecoder().decode(archive.get("frontend.log"))
		expect(frontend).toContain("hoardodile v")
		expect(frontend).toContain(marker)

		// The 15s sender interval lands the marker in the server's app.log.
		// The authenticated diagnostics.logs query reads the same rolling
		// files the user downloads — host-agnostic, so it also holds against
		// the Docker image (external-server mode: no local STORAGE_ROOT).
		await expect
			.poll(
				async () => {
					try {
						return await fetchServerLogs(request, cookie)
					} catch {
						return ""
					}
				},
				{ timeout: 40_000 },
			)
			.toContain(marker)
	})
})

/**
 * One sidebar state, recorded on a single animation frame. The stale-tree
 * flash lived for a couple of frames between two paints, so a settled-DOM
 * assertion could never see it — every distinct frame is kept instead.
 */
type TreeFrame = {
	readonly t: number
	readonly path: string
	readonly canvasTitle: string
	readonly tree: string
}

type SamplerWindow = {
	__treeFrames: TreeFrame[]
	__treeSampling: boolean
}

/** Record every distinct sidebar + canvas-title state on each frame. */
async function startTreeSampling(page: Page): Promise<void> {
	await page.evaluate(() => {
		const sampler = window as unknown as SamplerWindow
		sampler.__treeFrames = []
		sampler.__treeSampling = true
		let last = ""
		function tick() {
			if (!sampler.__treeSampling) return
			const sidebar = document.querySelector(
				'[data-testid="documents-sidebar"]',
			)
			const tree = (sidebar?.textContent ?? "(no sidebar)")
				.replace(/\s+/g, " ")
				.trim()
			const input = document.querySelector<HTMLInputElement>(
				'[data-testid="document-title"]',
			)
			const canvasTitle =
				input?.value ??
				document.querySelector('[data-testid="document-title-readonly"]')
					?.textContent ??
				"(none)"
			const frame = `${window.location.pathname}|${canvasTitle}|${tree}`
			if (frame !== last) {
				last = frame
				sampler.__treeFrames.push({
					t: Math.round(performance.now()),
					path: window.location.pathname,
					canvasTitle,
					tree,
				})
			}
			requestAnimationFrame(tick)
		}
		requestAnimationFrame(tick)
	})
}

async function stopTreeSampling(page: Page): Promise<TreeFrame[]> {
	return page.evaluate(() => {
		const sampler = window as unknown as SamplerWindow
		sampler.__treeSampling = false
		return sampler.__treeFrames
	})
}

/**
 * Document tree freshness. The sidebar used to read its nodes out of a
 * per-document payload (`detailPage`), whose cached copy survives a rename:
 * opening that document — a hover preload counts as "opened" for the router
 * — repainted the pre-change tree until the refetch landed. The tree now has
 * one cache of its own, so no navigation can resurrect an outdated snapshot.
 */
test.describe("document tree freshness", () => {
	for (const target of ["hover-preloaded", "previously-opened"] as const) {
		test(`a rename is not repainted away by the next ${target} document`, async ({
			page,
			request,
		}) => {
			const renamed = `Renamed-${Date.now()}-${target}`
			await login(page)
			const cookie = await apiLogin(request)
			const alpha = await createTreeDocument(request, cookie, `Alpha ${target}`)
			const beta = await createTreeDocument(request, cookie, `Beta ${target}`)

			await page.goto("/documents")
			await expect(page.getByTestId(`documents-open-${alpha}`)).toBeVisible()

			if (target === "hover-preloaded") {
				// Never opened: the router's intent preload is what has to
				// cache (and later go stale on) this document.
				await page.getByTestId(`documents-open-${beta}`).hover()
				await page.waitForTimeout(300)
			} else {
				await page.getByTestId(`documents-open-${beta}`).click()
				await expect(page.getByTestId("document-title")).toHaveValue(
					`Beta ${target}`,
				)
			}

			await page.getByTestId(`documents-open-${alpha}`).click()
			await expect(page.getByTestId("document-title")).toHaveValue(
				`Alpha ${target}`,
			)
			await page.getByTestId(`documents-more-${alpha}`).click()
			await page.getByTestId(`documents-rename-${alpha}`).click()
			await page.getByTestId(`documents-rename-input-${alpha}`).fill(renamed)
			await page.getByTestId(`documents-rename-confirm-${alpha}`).click()
			await expect(page.getByTestId(`documents-open-${alpha}`)).toHaveText(
				renamed,
			)

			// Widen the window a stale tree would be visible in, so the
			// assertion cannot depend on machine speed. tRPC batches its
			// procedures into one URL, hence the loose glob.
			let slowed = 0
			await page.route("**/trpc/**document.*", async (route) => {
				slowed += 1
				await new Promise((resolve) => setTimeout(resolve, 400))
				await route.continue()
			})

			await startTreeSampling(page)
			await page.getByTestId(`documents-open-${beta}`).click()
			await expect(page.getByTestId("document-title")).toHaveValue(
				`Beta ${target}`,
			)
			await page.waitForTimeout(1_000)

			const frames = await stopTreeSampling(page)
			const landed = frames.findIndex((f) => f.path.endsWith(`/${beta}`))
			expect(landed, "the click never reached the target document").not.toBe(-1)
			expect(slowed, "the target document was never fetched").toBeGreaterThan(0)
			const stale = frames
				.slice(landed)
				.filter((frame) => !frame.tree.includes(renamed))
			expect(stale, "sidebar repainted the pre-rename tree").toEqual([])
		})
	}
})

/** Create a root document over the API; returns its id. */
async function createTreeDocument(
	request: APIRequestContext,
	cookie: string,
	title: string,
): Promise<string> {
	const body = (await trpcPost(request, cookie, "document.create", {
		kind: "document",
		title,
	})) as { result?: { data?: { id?: string } } }
	const id = body.result?.data?.id
	if (typeof id !== "string") {
		throw new Error(`document.create returned no id: ${JSON.stringify(body)}`)
	}
	return id
}
