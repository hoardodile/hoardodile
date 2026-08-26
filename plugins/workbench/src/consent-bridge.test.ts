import { requestDownloadConsent } from "@hoardodile/host-web"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createAssetVault } from "./consent-bridge"
import type { WorkbenchManifest } from "./context"

vi.mock("@hoardodile/host-web", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@hoardodile/host-web")>()
	return { ...actual, requestDownloadConsent: vi.fn(async () => true) }
})

const MANIFEST: WorkbenchManifest = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Test",
	permissions: { download: true },
}

/**
 * Mock the workbench dev-server vault endpoint: cache-first, force
 * stores, and a dedicated URL that 404s (`fetch-fail.example`).
 */
function mockVaultEndpoint() {
	const stored = new Map<string, string>()
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body))
			const force = String(url).includes("force=1")
			if (!force && stored.has(body.dest)) {
				return jsonResponse({
					status: "cached",
					path: body.dest,
					sizeBytes: stored.get(body.dest)!.length,
					sha256: "a".repeat(64),
				})
			}
			if (body.url.includes("fetch-fail.example")) {
				return {
					ok: false,
					status: 404,
					text: async () => "nope",
				} as unknown as Response
			}
			stored.set(body.dest, body.url)
			return jsonResponse({
				status: "downloaded",
				path: body.dest,
				sizeBytes: body.url.length,
				sha256: "b".repeat(64),
			})
		}) as unknown as typeof fetch,
	)
	return stored
}

function jsonResponse(payload: unknown): Response {
	return {
		ok: true,
		status: 200,
		text: async () => JSON.stringify(payload),
		json: async () => payload,
	} as unknown as Response
}

describe("createAssetVault (workbench consent bridge)", () => {
	beforeEach(() => {
		vi.mocked(requestDownloadConsent).mockClear()
		vi.unstubAllGlobals()
	})

	it("a batch asks ONE consent question and answers in request order", async () => {
		mockVaultEndpoint()
		const vault = createAssetVault(MANIFEST)
		const results = (await vault.download([
			{ url: "https://cdn.example/a.mjs", dest: "a.mjs" },
			{ url: "https://cdn.example/b.mjs", dest: "b.mjs" },
		])) as readonly { readonly path: string; readonly cached: boolean }[]

		expect(requestDownloadConsent).toHaveBeenCalledTimes(1)
		const entry = vi.mocked(requestDownloadConsent).mock.calls[0]![0]
		expect(entry.items.map((item) => item.dest)).toEqual(["a.mjs", "b.mjs"])
		expect(results.map((r) => r.path)).toEqual(["a.mjs", "b.mjs"])
		expect(results.map((r) => r.cached)).toEqual([false, false])
	})

	it("cached items resolve silently and keep their slot in the batch", async () => {
		mockVaultEndpoint()
		const vault = createAssetVault(MANIFEST)
		await vault.download({
			url: "https://cdn.example/prime.mjs",
			dest: "prime.mjs",
		})
		vi.mocked(requestDownloadConsent).mockClear()

		const results = (await vault.download([
			{ url: "https://cdn.example/a.mjs", dest: "a.mjs" },
			{ url: "https://cdn.example/prime.mjs", dest: "prime.mjs" },
			{ url: "https://cdn.example/b.mjs", dest: "b.mjs" },
		])) as readonly { readonly path: string; readonly cached: boolean }[]

		// Prime was cached; only the two misses asked the user — one ticket.
		expect(requestDownloadConsent).toHaveBeenCalledTimes(1)
		const entry = vi.mocked(requestDownloadConsent).mock.calls[0]![0]
		expect(entry.items.map((item) => item.dest)).toEqual(["a.mjs", "b.mjs"])
		expect(results.map((r) => r.path)).toEqual(["a.mjs", "prime.mjs", "b.mjs"])
		expect(results.map((r) => r.cached)).toEqual([false, true, false])
	})

	it("a fetch failure aborts the batch (already-done items stay)", async () => {
		mockVaultEndpoint()
		const vault = createAssetVault(MANIFEST)
		await expect(
			vault.download([
				{ url: "https://cdn.example/a.mjs", dest: "a.mjs" },
				{ url: "https://fetch-fail.example/x.mjs", dest: "x.mjs" },
			]),
		).rejects.toMatchObject({ name: "POLICY" })
	})

	it("denies without the manifest download permission", async () => {
		const vault = createAssetVault({
			...MANIFEST,
			permissions: { download: false },
		})
		await expect(
			vault.download({ url: "https://cdn.example/a.mjs", dest: "a.mjs" }),
		).rejects.toMatchObject({ name: "POLICY" })
		expect(requestDownloadConsent).not.toHaveBeenCalled()
	})
})
