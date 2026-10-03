import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { expect, test } from "@playwright/test"
import { login } from "./helpers"
import { solidPng } from "./testArchive"
import { idFromTrpcJson } from "./trpcResourceCreate"

// 1x1 PNG used as the upload payload. Tiny so the staging step is fast.
const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII="
const TINY_PNG = Buffer.from(TINY_PNG_BASE64, "base64")

test.describe("resources create flow", () => {
	test.use({ serviceWorkers: "block" })
	test.setTimeout(60_000)

	test("persists the edited order after incremental staging, removal and duplicate names", async ({
		page,
	}) => {
		await login(page)
		await page.goto("/resources/new")
		const file = (name: string) => ({
			name,
			mimeType: "image/png",
			buffer: solidPng(100, 300, [100, 120, 140]),
		})
		const picker = page.getByTestId("create-resource-files")
		await picker.setInputFiles([file("b.png"), file("a.png")])
		await expect(page.getByTestId("upload-staging-progress")).toHaveText(
			"2 / 2",
		)
		await picker.setInputFiles([file("c.png"), file("a.png")])
		await expect(page.getByTestId("upload-staging-progress")).toHaveText(
			"4 / 4",
		)
		const thumbs = page.locator('[data-testid^="upload-file-thumb-"]')
		await thumbs.nth(0).hover()
		await thumbs
			.nth(0)
			.getByRole("button", { name: /remove file/i })
			.click()
		const from = await thumbs.nth(1).boundingBox()
		const to = await thumbs.nth(0).boundingBox()
		if (from === null || to === null) throw new Error("missing upload tile")
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
		await page.mouse.down()
		await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
			steps: 20,
		})
		await page.mouse.up()
		await expect(thumbs.nth(0)).toContainText("c.png")
		const createdResponse = page.waitForResponse(
			(response) =>
				response.url().includes("resource.create") &&
				response.request().method() === "POST",
		)
		await page.getByTestId("create-resource-submit").click()
		const response = await createdResponse
		expect(response.ok()).toBe(true)
		const body = await response.json()
		const id = idFromTrpcJson(body)
		expect(id).toBeDefined()
		const expected = ["c.png", "a.png", "a-1.png"]
		const files = await page.request.get(
			`/trpc/resource.listFiles?input=${encodeURIComponent(JSON.stringify({ id }))}`,
		)
		expect(files.ok()).toBe(true)
		const listing = await files.json()
		expect(
			(listing.result.data.json ?? listing.result.data).map(
				(entry: { filename: string }) => entry.filename,
			),
		).toEqual(expected)
		if (process.env.E2E_EXTERNAL_BASE_URL === undefined) {
			const dbPath = process.env.E2E_DB_PATH
			if (dbPath === undefined)
				throw new Error("missing temporary database path")
			const versionsRoot = join(dirname(dbPath), "storage", "versions")
			// New resources commit to the latest writable version; that host
			// storage field is intentionally absent from the public response.
			const latest = (await readdir(versionsRoot))
				.filter((name) => /^\d+$/.test(name))
				.sort((a, b) => Number(b) - Number(a))[0]
			if (latest === undefined)
				throw new Error("missing temporary storage version")
			const manifest = join(
				versionsRoot,
				latest,
				"resources",
				id!,
				"data",
				".order",
			)
			expect(JSON.parse(await readFile(manifest, "utf8"))).toEqual(expected)
		}
	})

	test("submit is disabled until staging completes", async ({ page }) => {
		await login(page)
		await page.goto("/resources/new")

		await expect(page.getByTestId("create-resource-submit")).toBeDisabled()

		await page.getByTestId("create-resource-files").setInputFiles({
			name: "pixel.png",
			mimeType: "image/png",
			buffer: TINY_PNG,
		})
		// Staging keeps the button disabled; it enables once every file is
		// fully staged into the pool.
		await expect(page.getByTestId("upload-staging-progress")).toHaveText(
			"1 / 1",
		)
		await expect(page.getByTestId("create-resource-submit")).toBeEnabled()
	})
})
