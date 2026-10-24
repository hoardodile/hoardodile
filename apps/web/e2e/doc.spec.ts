import { expect, test } from "@playwright/test"
import { login } from "./helpers"
import { apiLogin, trpcPost } from "./serverApi"

test("document editing, inline chips, history, find/replace and version comparison", async ({
	page,
	request,
}) => {
	test.setTimeout(120_000)
	await login(page)
	const cookie = await apiLogin(request)
	const created = (await trpcPost(request, cookie, "document.create", {
		kind: "document",
		title: "Editor upgrade smoke",
	})) as { result: { data: { id: string } } }
	const id = created.result.data.id
	await trpcPost(request, cookie, "document.patchDraft", {
		id,
		content: {
			version: 3,
			blocks: [
				{
					type: "paragraph",
					content: [
						{ type: "text", text: "old text ", styles: {} },
						{
							type: "tagChip",
							props: { color: "#E74C3C", text: "archive" },
						},
					],
				},
			],
		},
	})
	await trpcPost(request, cookie, "document.commitDraft", {
		id,
		message: "Baseline",
	})
	await page.goto(`/documents/${id}`)
	const editor = page.getByRole("textbox").and(page.locator(".bn-editor"))
	await expect(editor).toContainText("old text")
	await expect(
		editor.locator('[data-inline-content-type="tagChip"]'),
	).toHaveText("archive")
	await editor.click()
	await editor.press("ControlOrMeta+A")
	await editor.pressSequentially("new text")
	await expect(editor).toHaveText("new text")
	await page.getByTestId("document-undo").click()
	await expect(editor).toContainText("old text")
	await page.getByTestId("document-redo").click()
	await expect(editor).toHaveText("new text")

	await page.getByTestId("document-find-open").click()
	await page.getByTestId("document-find-input").fill("text")
	await page.getByTestId("document-find-toggle-replace").click()
	await page.getByTestId("document-find-replacement").fill("draft")
	await page.getByTestId("document-find-replace-all").click()
	await expect(editor).toHaveText("new draft")
	await page.getByTestId("document-find-close").click()

	await page.getByTestId("document-more").click()
	await page.getByTestId("document-enter-diff").click()
	const diff = page.locator('[data-doc-diff="true"]')
	await expect(diff.locator("del").first()).toContainText("old")
	await expect(diff.locator("ins").first()).toContainText("new")
	await page.getByTestId("document-exit-diff").click()
	await page.reload()
	await expect(editor).toHaveText("new draft")
})
