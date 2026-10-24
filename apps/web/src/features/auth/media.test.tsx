import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { CharThumb } from "@/features/char/components/CharThumb"
import { authenticatedReadUrl } from "./media"
import { acceptSession, lockSession } from "./session"

afterEach(() => vi.unstubAllGlobals())

function installTokens() {
	const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
		const body: { paths: string[] } = JSON.parse(String(init?.body))
		return new Response(
			JSON.stringify(
				body.paths.map((path) => ({
					path,
					sealed: "scoped-read-token",
					expiresAt: Date.now() + 120_000,
				})),
			),
			{ headers: { "content-type": "application/json" } },
		)
	})
	vi.stubGlobal("fetch", fetch)
	return fetch
}

it("batches native reads and preserves query options without exposing the page credential", async () => {
	acceptSession("private-page-credential")
	const fetch = installTokens()
	const paths = await Promise.all([
		authenticatedReadUrl("/api/resources/a/cover?size=original&format=video"),
		authenticatedReadUrl("/api/resources/a/cover?size=thumb"),
		authenticatedReadUrl("/api/resources/a/files/folder/photo.png"),
	])
	expect(fetch).toHaveBeenCalledOnce()
	expect(paths[0]).toContain(
		"size=original&format=video&readToken=scoped-read-token",
	)
	expect(paths.join()).not.toContain("private-page-credential")
	expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).paths).toHaveLength(
		2,
	)
	lockSession("/resources")
	await expect(authenticatedReadUrl("/api/resources/a/cover")).rejects.toThrow(
		"locked",
	)
})

it("does not mark a thumbnail broken while its read capability is still loading", async () => {
	acceptSession("secret")
	installTokens()
	render(
		<CharThumb
			charId="character-1"
			variant="avatar"
			cacheKey={1}
			alt="Avatar"
		/>,
	)
	expect(
		screen.getByTestId("character-thumb-character-1-avatar"),
	).toHaveAttribute("data-state", "pending")
	await waitFor(() =>
		expect(screen.getByRole("img", { hidden: true })).toHaveAttribute(
			"src",
			expect.stringContaining("readToken="),
		),
	)
	expect(
		screen.getByTestId("character-thumb-character-1-avatar"),
	).not.toHaveAttribute("data-state", "empty")
})
