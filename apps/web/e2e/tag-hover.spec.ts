import { expect, test } from "@playwright/test"
import { login } from "./helpers"
import { apiLogin, putTagImage, TINY_PNG, trpcPost } from "./serverApi"
import { idFromTrpcJson } from "./trpcResourceCreate"

/**
 * Black-box coverage of the tag link + art + hover preview card:
 * fixtures are created through the real API (tRPC + the image-slot HTTP
 * surface), then the read-only chip surfaces are exercised in the
 * browser — hover preview content, keyboard access, the external link
 * row, and the guarantee that clicking the chip itself still navigates.
 */
test.describe("tag hover preview", () => {
	test.setTimeout(60_000)

	// The character-detail tag chips live in the 320px right panel, which
	// only the 1440px+ layout claims — pin a wide viewport so the chips
	// are on screen (the hover card targets whatever the user sees).
	test.use({ viewport: { width: 1600, height: 900 } })

	test("a tag with art, link and intro shows the hover card and keeps chip navigation", async ({
		page,
		request,
	}) => {
		await login(page)
		const cookie = await apiLogin(request)

		const catBody = await trpcPost(request, cookie, "category.create", {
			name: "E2E Hover",
			kind: "common",
		})
		const catId = idFromTrpcJson(catBody)
		expect(catId).toBeTruthy()

		const tagBody = await trpcPost(request, cookie, "tag.create", {
			name: "HoverTag",
			intro: "A tiny e2e tag",
			catId,
			link: "www.example.com/hover",
		})
		const tagId = idFromTrpcJson(tagBody)
		expect(tagId).toBeTruthy()

		const charBody = await trpcPost(request, cookie, "character.create", {
			name: "HoverChar",
		})
		const charId = idFromTrpcJson(charBody)
		expect(charId).toBeTruthy()

		await trpcPost(request, cookie, "tag.attachToCharacter", {
			entityId: charId,
			tagId,
		})
		await putTagImage(request, cookie, tagId as string, TINY_PNG)

		await page.goto(`/characters/${charId}`)
		const chip = page.getByRole("link", { name: "HoverTag" })
		await expect(chip).toBeVisible({ timeout: 15_000 })

		// Hover opens the card with art, intro and the hostname link — the
		// name is not repeated (the trigger says it) and the art src points
		// at the tag thumb with the cache-buster.
		await chip.hover()
		const card = page.getByLabel(`Tag preview: HoverTag`)
		await expect(card).toBeVisible()
		await expect(page.getByText("A tiny e2e tag")).toBeVisible()
		const linkRow = page.getByTestId(`tag-hover-link-${tagId}`)
		await expect(linkRow).toHaveText("example.com")
		await expect(linkRow).toHaveAttribute(
			"href",
			"https://www.example.com/hover",
		)
		await expect(card).not.toContainText("HoverTag")
		const art = page.locator('[data-slot="preview-card-content"] img')
		await expect(art).toBeAttached()
		await expect(art).toHaveAttribute(
			"src",
			new RegExp(`/api/tags/${tagId}/thumb/image\\?v=`),
		)

		// Moving the pointer away closes the card (keyboard access is
		// covered by the jsdom unit suite — browser focus + the preview
		// close animation race each other across the safe-polygon delay).
		await page.mouse.move(10, 10)
		await expect(card).toBeHidden()

		// Clicking the chip navigates to the tag-filtered character list —
		// the preview must never swallow the click-through.
		await chip.click()
		await expect(page).toHaveURL(/\/characters\?tagIds=/)
		await expect
			.poll(() => decodeURIComponent(page.url()))
			.toContain(`tagIds=["${tagId}"]`)
	})
})
