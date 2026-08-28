import { expect, test } from "@playwright/test"
import { login } from "./helpers"
import { apiLogin, trpcPost } from "./serverApi"
import { idFromTrpcJson } from "./trpcResourceCreate"

test.describe("tags integration on create pages", () => {
	test.setTimeout(60_000)

	test("character /new page renders the tag picker", async ({ page }) => {
		await login(page)
		await page.goto("/characters/new")
		await expect(page.getByTestId("create-character-tags")).toBeVisible()
	})

	test("resource /new page renders the tag picker", async ({ page }) => {
		await login(page)
		await page.goto("/resources/new")
		await expect(page.getByTestId("create-resource-tags")).toBeVisible()
	})
})

test.describe("tag management panel", () => {
	test.setTimeout(60_000)

	test("the card's More menu carries the image entry right under Edit", async ({
		page,
		request,
	}) => {
		await login(page)
		const cookie = await apiLogin(request)

		const catBody = await trpcPost(request, cookie, "category.create", {
			name: "E2E Menu",
			kind: "common",
		})
		const catId = idFromTrpcJson(catBody)
		const tagBody = await trpcPost(request, cookie, "tag.create", {
			name: "MenuTag",
			catId,
		})
		const tagId = idFromTrpcJson(tagBody)

		await page.goto("/settings/custom")
		// The panel opens on the first category; pick our own so the tag
		// card is in view regardless of what earlier specs created. The
		// category rail rows carry the same aria-disabled sortable
		// semantics as the tag cards — force the click.
		await page.getByTestId(`category-tab-${catId}`).click({ force: true })
		await page.getByTestId(`tag-chip-${tagId}`).waitFor({ timeout: 15_000 })

		// The More trigger sits on an aria-disabled sortable row (dnd-kit
		// semantics), so the enabled-check needs force.
		await page.getByTestId(`tag-chip-${tagId}`).click({ force: true })
		await page.getByTestId(`tag-edit-image-${tagId}`).click()
		await expect(page.getByText("MenuTag — Tag image")).toBeVisible()
	})
})
