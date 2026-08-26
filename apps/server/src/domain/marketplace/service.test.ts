import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { DEFAULT_MARKETPLACE_REPO } from "./schema.ts"
import { createMarketplaceService, normalizeRepoAddress } from "./service.ts"

const PLUGIN_ID = "44444444-4444-4444-8444-444444444444"
const MANIFEST = {
	id: PLUGIN_ID,
	name: "Cat Viewer",
	description: "Shows cats",
	version: "1.2.3",
	permissions: {
		sourceMeta: true,
		searchMeta: false,
		danmaku: false,
		message: false,
	},
}
const RELEASE = {
	tag_name: "v1.2.3",
	html_url: "https://github.com/me/cat-viewer/releases/tag/v1.2.3",
	published_at: "2025-01-02T03:04:05Z",
	body: "First release\n\nNotes here",
	assets: [
		{
			name: `${PLUGIN_ID}-v1.2.3.zip`,
			browser_download_url: `https://github.com/me/cat-viewer/releases/download/v1.2.3/${PLUGIN_ID}-v1.2.3.zip`,
		},
	],
}

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex")
}

function makeFixture() {
	const root = mkdtempSync(join(tmpdir(), "marketplace-test-"))
	const routes = new Map<string, string>()

	function add(url: string, body: string): void {
		routes.set(url, body)
	}

	function addJson(url: string, value: unknown): void {
		add(url, JSON.stringify(value))
	}

	const fetcher = {
		fetchToFile: vi.fn(async (url: string, target: string) => {
			const body = routes.get(url)
			if (body === undefined) {
				throw new Error(`plugin download returned HTTP 404: ${url}`)
			}
			await writeFile(target, body)
			return {
				sizeBytes: Buffer.byteLength(body),
				sha256: sha256(body),
			}
		}),
	}

	const installer = {
		installFromZip: vi.fn(
			async (_stream: unknown, opts?: { expectedId?: string }) => {
				if (opts?.expectedId !== PLUGIN_ID) {
					throw new Error(
						"plugin zip manifest id does not match the expected plugin id",
					)
				}
				return PLUGIN_ID
			},
		),
	}

	const rescan = vi.fn(async () => {})

	const prefValues = new Map<string, string>()
	const prefs = {
		get: (key: string) =>
			prefValues.has(key)
				? { key, value: prefValues.get(key)!, updatedAt: 0 }
				: undefined,
		set: (key: string, value: string) => {
			prefValues.set(key, value)
			return { key, value, updatedAt: 0 }
		},
		remove: (key: string) => {
			prefValues.delete(key)
		},
	}

	let clock = 0
	const service = createMarketplaceService({
		prefs,
		fetcher,
		installer,
		rescan,
		tmpDir: root,
		maxInstallBytes: 1024 * 1024,
		now: () => clock,
	})

	return {
		root,
		add,
		addJson,
		routes,
		fetcher,
		installer,
		rescan,
		prefs: prefValues,
		service,
		advance: (ms: number) => {
			clock += ms
		},
	}
}

let fixture: ReturnType<typeof makeFixture> | undefined
beforeEach(() => {
	fixture = makeFixture()
})
afterEach(() => {
	if (fixture !== undefined) {
		rmSync(fixture.root, { recursive: true, force: true })
		fixture = undefined
	}
})

function rawUrl(
	owner: string,
	repo: string,
	ref: string,
	path: string,
): string {
	return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`
}

function apiCalls(f: ReturnType<typeof makeFixture>): number {
	return f.fetcher.fetchToFile.mock.calls.filter(([url]) =>
		url.includes("api.github.com"),
	).length
}

describe("normalizeRepoAddress", () => {
	test.each([
		["me/repo", "me/repo"],
		["https://github.com/me/repo", "me/repo"],
		["https://github.com/me/repo.git", "me/repo"],
		["https://github.com/me/repo/", "me/repo"],
		["github.com/me/repo", "me/repo"],
		["https://www.github.com/me/repo", "me/repo"],
	])("normalizes %s → %s", (input, expected) => {
		expect(normalizeRepoAddress(input)).toBe(expected)
	})

	test.each([
		"",
		"https://gitlab.com/me/repo",
		"https://github.com/me/repo/tree/main",
		"me/repo/extra",
		"https://github.com/me",
		"https://example.com/me/repo",
	])("rejects %s", (input) => {
		expect(() => normalizeRepoAddress(input)).toThrow()
	})
})

describe("createMarketplaceService.refresh", () => {
	test("loads registry + manifest (HEAD→main fallback) + release into a snapshot", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat-viewer"],
		})
		// The registry has a registry.json on HEAD; the plugin repo's HEAD
		// 404s and its manifest is found on `main`.
		f.addJson(rawUrl("me", "cat-viewer", "main", "manifest.json"), MANIFEST)
		f.addJson(
			"https://api.github.com/repos/me/cat-viewer/releases/latest",
			RELEASE,
		)

		const snapshot = await f.service.refresh(false)

		expect(snapshot.registryRepo).toBe("me/registry")
		expect(snapshot.errors).toEqual([])
		expect(snapshot.plugins).toHaveLength(1)
		const plugin = snapshot.plugins[0]!
		expect(plugin).toMatchObject({
			id: PLUGIN_ID,
			repo: "me/cat-viewer",
			name: "Cat Viewer",
			description: "Shows cats",
			state: "ok",
		})
		expect(plugin.latest).toMatchObject({
			tag: "v1.2.3",
			version: "1.2.3",
			assetName: `${PLUGIN_ID}-v1.2.3.zip`,
		})
		expect(plugin.permissions.sourceMeta).toBe(true)
		expect(f.fetcher.fetchToFile).toHaveBeenCalledWith(
			rawUrl("me", "cat-viewer", "HEAD", "manifest.json"),
			expect.any(String),
			expect.any(Object),
		)
		expect(f.fetcher.fetchToFile).toHaveBeenCalledWith(
			rawUrl("me", "cat-viewer", "main", "manifest.json"),
			expect.any(String),
			expect.any(Object),
		)
	})

	test("serves the cache for 10 minutes and force bypasses it", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat"],
		})
		f.addJson(rawUrl("me", "cat", "HEAD", "manifest.json"), MANIFEST)
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", RELEASE)

		await f.service.refresh(false)
		expect(apiCalls(f)).toBe(1)
		await f.service.refresh(false)
		expect(apiCalls(f)).toBe(1)

		f.advance(10 * 60_000 + 1)
		await f.service.refresh(false)
		expect(apiCalls(f)).toBe(2)

		await f.service.refresh(true)
		expect(apiCalls(f)).toBe(3)
	})

	test("shares a single in-flight refresh between concurrent callers", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat"],
		})
		f.addJson(rawUrl("me", "cat", "HEAD", "manifest.json"), MANIFEST)
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", RELEASE)

		const [a, b] = await Promise.all([
			f.service.refresh(false),
			f.service.refresh(false),
		])
		expect(a.fetchedAt).toBe(b.fetchedAt)
		expect(apiCalls(f)).toBe(1)
	})

	test("a repo with no release stays listed as no_release", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat"],
		})
		f.addJson(rawUrl("me", "cat", "HEAD", "manifest.json"), MANIFEST)

		const snapshot = await f.service.refresh(false)

		expect(snapshot.plugins).toHaveLength(1)
		expect(snapshot.plugins[0]?.state).toBe("no_release")
		expect(snapshot.plugins[0]?.latest).toBeUndefined()
	})

	test("a rate-limited release fetch degrades to a per-plugin error", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat"],
		})
		f.addJson(rawUrl("me", "cat", "HEAD", "manifest.json"), MANIFEST)
		f.fetcher.fetchToFile.mockImplementation(
			async (u: string, target: string) => {
				if (u.includes("api.github.com")) {
					throw new Error(`plugin download returned HTTP 403: ${u}`)
				}
				const body = f.routes.get(u)
				if (body === undefined) {
					throw new Error(`plugin download returned HTTP 404: ${u}`)
				}
				await writeFile(target, body)
				return { sizeBytes: Buffer.byteLength(body), sha256: sha256(body) }
			},
		)

		const snapshot = await f.service.refresh(false)

		expect(snapshot.plugins).toHaveLength(1)
		expect(snapshot.plugins[0]?.state).toBe("error")
		expect(snapshot.plugins[0]?.error).toContain("rate limit")
	})

	test("a repo with no manifest lands in the errors list instead of the catalog", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/not-a-plugin"],
		})

		const snapshot = await f.service.refresh(false)

		expect(snapshot.plugins).toHaveLength(0)
		expect(snapshot.errors).toEqual([
			{
				repo: "me/not-a-plugin",
				message: expect.stringContaining("manifest.json"),
			},
		])
	})

	test("picks the id-tagged zip asset and reads the sha256 sidecar", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat"],
		})
		f.addJson(rawUrl("me", "cat", "HEAD", "manifest.json"), MANIFEST)
		const sidecarName = `${PLUGIN_ID}-v1.2.3.zip.sha256`
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", {
			tag_name: "v1.2.3",
			html_url: "https://github.com/me/cat/releases/tag/v1.2.3",
			published_at: null,
			body: null,
			assets: [
				{
					name: "unrelated.zip",
					browser_download_url:
						"https://github.com/me/cat/releases/download/v1.2.3/unrelated.zip",
				},
				{
					name: `${PLUGIN_ID}-v1.2.3.zip`,
					browser_download_url: `https://github.com/me/cat/releases/download/v1.2.3/${PLUGIN_ID}-v1.2.3.zip`,
				},
				{
					name: sidecarName,
					browser_download_url: `https://github.com/me/cat/releases/download/v1.2.3/${sidecarName}`,
				},
			],
		})
		f.add(
			`https://github.com/me/cat/releases/download/v1.2.3/${sidecarName}`,
			`  ${sha256("zip")}  `,
		)

		const snapshot = await f.service.refresh(false)

		expect(snapshot.plugins[0]?.latest?.assetName).toBe(
			`${PLUGIN_ID}-v1.2.3.zip`,
		)
		expect(snapshot.plugins[0]?.latest?.sha256).toBe(sha256("zip"))
	})

	test("throws when the registry file fails validation", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: [],
		})

		await expect(f.service.refresh(false)).rejects.toMatchObject({
			code: "VALIDATION",
		})
	})

	test("throws on a bad registry entry with its index", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["https://gitlab.com/me/x"],
		})

		await expect(f.service.refresh(false)).rejects.toMatchObject({
			code: "VALIDATION",
			details: { value: "https://gitlab.com/me/x" },
		})
	})

	test("throws when the registry repo has no registry.json", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")

		await expect(f.service.refresh(false)).rejects.toMatchObject({
			code: "VALIDATION",
			message: expect.stringContaining("no registry.json"),
		})
	})

	test("uses the built-in default registry when never configured", async () => {
		const f = fixture!
		expect(f.service.getConfig()).toEqual({
			registryRepo: DEFAULT_MARKETPLACE_REPO,
		})

		// The default repo's registry is unmocked → registry missing.
		await expect(f.service.refresh(false)).rejects.toMatchObject({
			code: "VALIDATION",
			message: expect.stringContaining(DEFAULT_MARKETPLACE_REPO),
		})
	})

	test("throws when the marketplace is explicitly disabled", async () => {
		fixture!.service.setConfig(null)
		await expect(fixture!.service.refresh(false)).rejects.toMatchObject({
			code: "VALIDATION",
			message: expect.stringContaining("not configured"),
		})
	})

	test("setConfig normalizes and null disables", async () => {
		const f = fixture!
		f.service.setConfig("https://github.com/me/registry")
		expect(f.prefs.get("marketplace.registryRepo")).toBe("me/registry")

		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat"],
		})
		f.addJson(rawUrl("me", "cat", "HEAD", "manifest.json"), MANIFEST)
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", RELEASE)
		await f.service.refresh(false)
		expect(apiCalls(f)).toBe(1)

		f.service.setConfig(null)
		expect(f.prefs.get("marketplace.registryRepo")).toBe("")
		expect(f.service.getConfig()).toEqual({ registryRepo: null })
		await expect(f.service.refresh(false)).rejects.toMatchObject({
			message: expect.stringContaining("not configured"),
		})
	})
})

describe("createMarketplaceService.install", () => {
	test("downloads, installs with the expected id and rescans", async () => {
		const f = fixture!
		const assetUrl = `https://github.com/me/cat/releases/download/v1.2.3/${PLUGIN_ID}-v1.2.3.zip`
		f.add(assetUrl, "zip-bytes")

		const result = await f.service.install({ id: PLUGIN_ID, assetUrl })

		expect(result).toEqual({ pluginId: PLUGIN_ID })
		expect(f.installer.installFromZip).toHaveBeenCalledWith(expect.anything(), {
			expectedId: PLUGIN_ID,
		})
		expect(f.rescan).toHaveBeenCalledTimes(1)
	})

	test("rejects hosts outside the GitHub release family before any fetch", async () => {
		await expect(
			fixture!.service.install({
				id: PLUGIN_ID,
				assetUrl: "https://evil.example.com/plugin.zip",
			}),
		).rejects.toMatchObject({
			code: "VALIDATION",
			message: expect.stringContaining("not an official GitHub release host"),
		})
		expect(fixture!.fetcher.fetchToFile).not.toHaveBeenCalled()
	})

	test("fails on an sha256 mismatch without installing", async () => {
		const f = fixture!
		const assetUrl = `https://github.com/me/cat/releases/download/v1.2.3/${PLUGIN_ID}-v1.2.3.zip`
		f.add(assetUrl, "zip-bytes")

		await expect(
			f.service.install({
				id: PLUGIN_ID,
				assetUrl,
				sha256: sha256("other"),
			}),
		).rejects.toMatchObject({
			code: "VALIDATION",
			message: expect.stringContaining("checksum"),
		})
		expect(f.installer.installFromZip).not.toHaveBeenCalled()
		expect(f.rescan).not.toHaveBeenCalled()
	})

	test("surfaces an expectedId mismatch from the installer", async () => {
		const f = fixture!
		const assetUrl = `https://github.com/me/cat/releases/download/v1.2.3/${PLUGIN_ID}-v1.2.3.zip`
		f.add(assetUrl, "zip-bytes")

		await expect(
			f.service.install({
				id: "99999999-9999-4999-8999-999999999999",
				assetUrl,
			}),
		).rejects.toThrow("expected plugin id")
		// The download happened, but nothing was committed.
		expect(f.installer.installFromZip).toHaveBeenCalledTimes(1)
		expect(f.rescan).not.toHaveBeenCalled()
	})
})
