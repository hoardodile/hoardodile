import { expect, test } from "@playwright/test"
import { login } from "./helpers"
import {
	apiLogin,
	createResource,
	deleteResources,
	uploadArchive,
} from "./serverApi"
import { storedZip } from "./testArchive"

const FILE_PLUGIN_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

test.describe("thumbnails", () => {
	test.setTimeout(60_000)

	test("imageless resource shows the name tile, never an img", async ({
		page,
		request,
	}) => {
		await login(page)
		const cookie = await apiLogin(request)
		const fileId = await uploadArchive(
			request,
			cookie,
			storedZip([{ name: "notes.txt", data: Buffer.from("hello", "utf-8") }]),
			"notes.zip",
		)
		const id = await createResource(request, cookie, {
			archiveFileId: fileId,
			name: "notes",
			contentPluginId: FILE_PLUGIN_ID,
		})

		await page.goto("/resources")
		await expect(page.getByTestId(`resource-thumb-${id}`)).toBeAttached({
			timeout: 20_000,
		})
		// The cover route 404s: the empty tile carries the resource's
		// name and the img element is removed entirely.
		const emptyTile = page.getByTestId(`resource-thumb-empty-${id}`)
		await expect(emptyTile).toBeAttached({ timeout: 20_000 })
		await expect(emptyTile).toContainText("notes")
		await expect(
			page.getByTestId(`resource-thumb-img-${id}`),
		).not.toBeAttached()

		await deleteResources(request, cookie, [id])
	})
})
