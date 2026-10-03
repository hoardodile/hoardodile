import { expect, test } from "@playwright/test"
import { login } from "./helpers"

const SPLASH = "#app-splash"

type SplashProbe = {
	readonly firstFrame:
		| {
				readonly complete: boolean
				readonly naturalWidth: number
				readonly srcScheme: string
				readonly background: string
				readonly classes: readonly string[]
				readonly framesToReady: number
		  }
		| undefined
	readonly transforms: readonly string[]
	readonly removed: boolean
}

declare global {
	interface Window {
		__splashProbe?: SplashProbe
	}
}

/**
 * Records the boot splash's history from the very first frames: the state
 * of the logo image once the element exists (layout + decode), any inline
 * `transform` ever applied (a morph would show up here), and whether the
 * overlay was removed. Uses only global DOM APIs so Playwright can
 * serialize it into the page.
 */
function installSplashProbe(): void {
	const probe: {
		firstFrame: SplashProbe["firstFrame"]
		transforms: string[]
		removed: boolean
	} = { firstFrame: undefined, transforms: [], removed: false }
	window.__splashProbe = probe

	let frame = 0
	const capture = () => {
		const el = document.getElementById("app-splash")
		if (el === null) {
			requestAnimationFrame(capture)
			return
		}
		const img = el.querySelector("img")
		if (img === null) {
			requestAnimationFrame(capture)
			return
		}
		// Wait for the logo to be renderable — with no `decoding="async"`
		// the browser holds the first paint until the data URI decodes, so
		// this lands within the first few frames.
		if (!img.complete || img.naturalWidth === 0) {
			frame += 1
			requestAnimationFrame(capture)
			return
		}
		probe.firstFrame = {
			complete: true,
			naturalWidth: img.naturalWidth,
			srcScheme: img.currentSrc.split(":")[0] ?? "",
			background: getComputedStyle(el).backgroundColor,
			classes: [...document.documentElement.classList],
			framesToReady: frame,
		}
		new MutationObserver(() => {
			if (el.style.transform !== "") {
				probe.transforms.push(el.style.transform)
			}
		}).observe(el, { attributes: true, attributeFilter: ["style"] })
	}

	const watchRemoval = () => {
		if (document.getElementById("app-splash") === null) {
			probe.removed = true
			return
		}
		requestAnimationFrame(watchRemoval)
	}

	requestAnimationFrame(capture)
	requestAnimationFrame(watchRemoval)
}

test.describe("boot splash", () => {
	test.use({ serviceWorkers: "block" })
	test("covers the settings and document sticky chrome during a slow hard refresh", async ({
		page,
	}) => {
		test.setTimeout(120_000)
		await page.setViewportSize({ width: 1600, height: 900 })
		await login(page)
		const response = await page.request.post("/trpc/document.create", {
			data: { kind: "document", title: "Splash stacking regression" },
		})
		expect(response.ok()).toBe(true)
		const body = await response.json()
		const doc = body.result.data.json ?? body.result.data
		await page.addInitScript(() => {
			const frames: { classes: string; covered: boolean }[] = []
			Object.assign(window, { __stickySplashFrames: frames })
			// Sample every frame while the overlay is up. The chrome this spec
			// documents (the document's sticky detail header) paints under the
			// splash well before the boot target resolves, so the window is the
			// overlay's lifetime, not a fixed frame count.
			function capture() {
				const splash = document.getElementById("app-splash")
				if (splash !== null) {
					for (const sticky of document.querySelectorAll("#root .sticky")) {
						const rect = sticky.getBoundingClientRect()
						if (
							rect.width === 0 ||
							rect.height === 0 ||
							rect.top >= innerHeight
						)
							continue
						const front = document.elementFromPoint(
							rect.left + 5,
							Math.max(0, rect.top) + 5,
						)
						frames.push({
							classes: sticky.className,
							covered: front?.closest("#app-splash") === splash,
						})
					}
				}
				requestAnimationFrame(capture)
			}
			requestAnimationFrame(capture)
		})
		for (const path of ["/settings", `/documents/${doc.id}`]) {
			// Warm the route, then keep bootstrap queries outstanding long enough
			// to inspect the real startup overlay on a full reload.
			await page.goto(path)
			if (path.startsWith("/documents/"))
				await expect(page.locator(".doc-detail-header")).toBeVisible()
			await page.route("**/trpc/**", async (route) => {
				if (!route.request().url().includes("nodeView"))
					await new Promise((resolve) => setTimeout(resolve, 900))
				await route.continue().catch(() => {})
			})
			await page.reload()
			await expect(page.locator(SPLASH)).toHaveCount(0)
			const frames = await page.evaluate(
				() =>
					Reflect.get(window, "__stickySplashFrames") as {
						classes: string
						covered: boolean
					}[],
			)
			expect(frames.length).toBeGreaterThan(0)
			expect(frames.every((frame) => frame.covered)).toBe(true)
			if (path.startsWith("/documents/")) {
				expect(
					frames.some((frame) => frame.classes.includes("doc-detail-header")),
				).toBe(true)
			}
			await page.unroute("**/trpc/**")
		}
	})

	test("index.html bakes the logo inline without async decode", async ({
		request,
	}) => {
		const html = await (await request.get("/")).text()
		expect(html).toContain('id="app-splash"')
		const splash = html.match(/<div id="app-splash"[\s\S]*?<\/div>/)?.[0] ?? ""
		// The very first paint needs the logo: inline data URI, decode
		// synchronously with the paint (no `decoding="async"` blank frame).
		expect(splash).toContain('src="data:image/png;base64,')
		expect(splash).not.toContain("decoding=")
	})

	test("first frame is theme/palette-matched and hands off without a morph", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem("theme", "dark")
			localStorage.setItem("themePalette", "sage")
		})
		await page.addInitScript(installSplashProbe)

		// A dev cold start can drag the module graph transform out past the
		// usual default timeout (see claim.setup.ts).
		await page.goto("/", { timeout: 120_000 })
		await expect(page).toHaveURL(/\/login$/)
		await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible()
		await expect(page.locator(SPLASH)).toHaveCount(0, { timeout: 60_000 })

		const probe = await page.evaluate(() => window.__splashProbe)
		expect(probe?.firstFrame).toBeDefined()
		expect(probe?.firstFrame?.complete).toBe(true)
		expect(probe?.firstFrame?.naturalWidth).toBeGreaterThan(0)
		expect(probe?.firstFrame?.srcScheme).toBe("data")
		// Paint waits for the data-URI decode (no `decoding="async"`), so
		// the logo is ready within the first few frames — not after a
		// network fetch.
		expect(probe?.firstFrame?.framesToReady).toBeLessThanOrEqual(5)
		// Dark sage `--background` (#0a100e) — the splash canvas must equal
		// the page's first painted background.
		expect(probe?.firstFrame?.background).toBe("rgb(10, 16, 14)")
		expect(probe?.firstFrame?.classes).toContain("dark")
		expect(probe?.firstFrame?.classes).toContain("theme-sage")
		// The removed morph animated the logo with transforms; the hard-cut
		// handoff must never set a transform or transition.
		expect(probe?.transforms).toEqual([])
	})

	test("reduced motion removes the overlay and still lands on sign-in", async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "reduce" })
		await page.addInitScript(installSplashProbe)

		await page.goto("/", { timeout: 120_000 })
		await expect(page).toHaveURL(/\/login$/)
		await expect(page.locator(SPLASH)).toHaveCount(0, { timeout: 60_000 })
		await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible()

		const probe = await page.evaluate(() => window.__splashProbe)
		expect(probe?.removed).toBe(true)
	})
})
