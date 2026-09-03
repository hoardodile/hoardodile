import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { DEFAULT_MARKETPLACE_REPO } from "./schema.ts"
import {
	createMarketplaceService,
	normalizeRepoAddress,
	parseAtomFirstEntry,
} from "./service.ts"

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

/** A GitHub `releases.atom` feed with a single release entry (the latest). */
function atomFeed(tag: string, publishedAt = "2025-01-02T03:04:05Z"): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:github.com,2008:Repository/1234</id>
    <updated>${publishedAt}</updated>
    <link rel="alternate" type="text/html" href="https://github.com/me/cat/releases/tag/${tag}"/>
    <title>${tag}</title>
    <content type="html">Notes</content>
  </entry>
</feed>`
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
	const postInstall = vi.fn()

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
	const sourcesData: { readonly id?: string; readonly repo?: string }[] = []
	const sources = {
		recordInstallSource: vi.fn((id: string, repo: string) => {
			sourcesData.push({ id, repo })
		}),
		listInstallSources: vi.fn(() =>
			sourcesData.filter(
				(entry): entry is { readonly id: string; readonly repo: string } =>
					entry.id !== undefined && entry.repo !== undefined,
			),
		),
	}
	const service = createMarketplaceService({
		prefs,
		sources,
		fetcher,
		installer,
		rescan,
		postInstall,
		tmpDir: root,
		maxInstallBytes: 1024 * 1024,
		releaseCacheFile: join(root, "releases.json"),
		// Pin short windows so the deterministic-clock tests do not wait
		// out the production default (a day).
		cacheTtlMs: 10 * 60_000,
		releaseCacheTtlMs: 60 * 60_000,
		rateLimitCooldownMs: 60 * 60_000,
		now: () => clock,
	})

	return {
		root,
		add,
		addJson,
		routes,
		fetcher,
		installer,
		sources,
		rescan,
		postInstall,
		prefs: prefValues,
		service,
		clock: () => clock,
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

function atomUrl(repo: string): string {
	return `https://github.com/${repo}/releases.atom`
}

function apiCalls(f: ReturnType<typeof makeFixture>): number {
	return f.fetcher.fetchToFile.mock.calls.filter(([url]) =>
		url.includes("api.github.com"),
	).length
}

/** Fetcher that throws a 403 for the GitHub API but serves route bodies. */
function rateLimitFetcher(f: ReturnType<typeof makeFixture>) {
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

describe("parseAtomFirstEntry", () => {
	test("reads the latest tag from the first entry's alternate link", () => {
		const entry = parseAtomFirstEntry(
			atomFeed("v1.2.3", "2025-01-02T03:04:05Z"),
		)
		expect(entry).toEqual({
			tag: "v1.2.3",
			publishedAt: "2025-01-02T03:04:05Z",
		})
	})

	test("falls back to the title when the alternate link is missing", () => {
		const feed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>v1.4.0</title></entry></feed>`
		expect(parseAtomFirstEntry(feed)).toEqual({
			tag: "v1.4.0",
			publishedAt: null,
		})
	})

	test("ignores self-closing link elements and attribute order", () => {
		const feed = `<?xml version="1.0"?><feed><entry><link type="text/html" rel="alternate" href="https://github.com/me/cat/releases/tag/v2.0.0"/><title>Release</title></entry></feed>`
		expect(parseAtomFirstEntry(feed)?.tag).toBe("v2.0.0")
	})

	test("reads a title carrying an attribute and absent updated as null", () => {
		const feed = `<?xml version="1.0"?><feed><entry><title type="html">v2.1.0</title><updated>2025-03-01T00:00:00Z</updated></entry></feed>`
		expect(parseAtomFirstEntry(feed)).toEqual({
			tag: "v2.1.0",
			publishedAt: "2025-03-01T00:00:00Z",
		})
		const noDate = `<?xml version="1.0"?><feed><entry><title>v2.2.0</title></entry></feed>`
		expect(parseAtomFirstEntry(noDate)).toEqual({
			tag: "v2.2.0",
			publishedAt: null,
		})
	})

	test("returns undefined for a feed with no entry or malformed markup", () => {
		expect(parseAtomFirstEntry("<feed></feed>")).toBeUndefined()
		expect(parseAtomFirstEntry("not a feed")).toBeUndefined()
		expect(parseAtomFirstEntry(atomFeed(""))).toBeUndefined()
	})
})

describe("createMarketplaceService.refresh", () => {
	test("loads registry + manifest (HEAD→main fallback) + the free releases.atom tag into a snapshot", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat-viewer"],
		})
		// The registry has a registry.json on HEAD; the plugin repo's HEAD
		// 404s and its manifest is found on `main`.
		f.addJson(rawUrl("me", "cat-viewer", "main", "manifest.json"), MANIFEST)
		f.add(atomUrl("me/cat-viewer"), atomFeed("v1.2.3", "2025-01-02T03:04:05Z"))

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
		// The catalog carries the version-only latest — no asset, readme or notes.
		expect(plugin.latest).toMatchObject({
			tag: "v1.2.3",
			version: "1.2.3",
			publishedAt: "2025-01-02T03:04:05Z",
		})
		expect(plugin.latest?.assetUrl).toBeUndefined()
		expect(plugin.latest?.readme).toBeUndefined()
		expect(plugin.permissions.sourceMeta).toBe(true)
		// The full manifest rides the snapshot for the UI (i18n names,
		// search-category popover) — same projection the plugins page uses.
		expect(plugin.manifest.id).toBe(PLUGIN_ID)
		expect(plugin.manifest.version).toBe("1.2.3")
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
		// The list snapshot never touches the quota-hungry GitHub API.
		expect(apiCalls(f)).toBe(0)
	})

	test("serves the snapshot cache for 10 minutes; a forced refresh rebuilds it", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat"],
		})
		f.addJson(rawUrl("me", "cat", "HEAD", "manifest.json"), MANIFEST)
		f.add(atomUrl("me/cat"), atomFeed("v1.2.3"))

		const registryCalls = () =>
			f.fetcher.fetchToFile.mock.calls.filter(([url]) =>
				String(url).includes("registry.json"),
			).length

		await f.service.refresh(false)
		expect(registryCalls()).toBe(1)
		expect(apiCalls(f)).toBe(0)
		await f.service.refresh(false)
		expect(registryCalls()).toBe(1)

		// The snapshot layer expires after 10 minutes.
		f.advance(10 * 60_000 + 1)
		await f.service.refresh(false)
		expect(registryCalls()).toBe(2)

		// A forced refresh bypasses the snapshot cache and rebuilds it.
		await f.service.refresh(true)
		expect(registryCalls()).toBe(3)
	})

	test("defaults the catalog cache to a day when no TTL is configured", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat"],
		})
		f.addJson(rawUrl("me", "cat", "HEAD", "manifest.json"), MANIFEST)
		f.add(atomUrl("me/cat"), atomFeed("v1.2.3"))

		const registryCalls = () =>
			f.fetcher.fetchToFile.mock.calls.filter(([url]) =>
				String(url).includes("registry.json"),
			).length

		// A service built with no TTL deps inherits the one-day default.
		const defaulted = createMarketplaceService({
			prefs: {
				get: (key: string) =>
					f.prefs.has(key)
						? { key, value: f.prefs.get(key)!, updatedAt: 0 }
						: undefined,
				set: (key: string, value: string) => {
					f.prefs.set(key, value)
					return { key, value, updatedAt: 0 }
				},
				remove: (key: string) => {
					f.prefs.delete(key)
				},
			},
			sources: f.sources,
			fetcher: f.fetcher,
			installer: f.installer,
			rescan: f.rescan,
			postInstall: f.postInstall,
			tmpDir: f.root,
			maxInstallBytes: 1024 * 1024,
			releaseCacheFile: join(f.root, "releases.json"),
			now: () => f.clock(),
		})

		await defaulted.refresh(false)
		expect(registryCalls()).toBe(1)
		expect(apiCalls(f)).toBe(0)

		// 23 h later the snapshot is still inside the day window — no refetch.
		f.advance(23 * 60 * 60_000)
		await defaulted.refresh(false)
		expect(registryCalls()).toBe(1)

		// Past a day the snapshot is rebuilt — still no API quota consumed.
		f.advance(60 * 60_000 + 1)
		await defaulted.refresh(false)
		expect(registryCalls()).toBe(2)
		expect(apiCalls(f)).toBe(0)
	})

	test("shares a single in-flight refresh between concurrent callers", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat"],
		})
		f.addJson(rawUrl("me", "cat", "HEAD", "manifest.json"), MANIFEST)
		f.add(atomUrl("me/cat"), atomFeed("v1.2.3"))

		const [a, b] = await Promise.all([
			f.service.refresh(false),
			f.service.refresh(false),
		])
		expect(a.fetchedAt).toBe(b.fetchedAt)
		expect(apiCalls(f)).toBe(0)
	})

	test("a repo with no release (no atom entry) stays listed as no_release", async () => {
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
		expect(apiCalls(f)).toBe(0)
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
		expect(apiCalls(f)).toBe(0)
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
		f.add(atomUrl("me/cat"), atomFeed("v1.2.3"))
		await f.service.refresh(false)
		expect(apiCalls(f)).toBe(0)

		f.service.setConfig(null)
		expect(f.prefs.get("marketplace.registryRepo")).toBe("")
		expect(f.service.getConfig()).toEqual({ registryRepo: null })
		await expect(f.service.refresh(false)).rejects.toMatchObject({
			message: expect.stringContaining("not configured"),
		})
	})
})

describe("createMarketplaceService.detail", () => {
	test("fetches the authoritative release asset, sha256 sidecar, notes and per-locale readme", async () => {
		const f = fixture!
		const sidecar = `${PLUGIN_ID}-v1.2.3.zip.sha256`
		const zipUrl = `https://github.com/me/cat/releases/download/v1.2.3/${PLUGIN_ID}-v1.2.3.zip`
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", {
			tag_name: "v1.2.3",
			html_url: "https://github.com/me/cat/releases/tag/v1.2.3",
			published_at: "2025-01-02T03:04:05Z",
			body: "First release\n\nNotes here",
			assets: [
				{
					name: "unrelated.zip",
					browser_download_url:
						"https://github.com/me/cat/releases/download/v1.2.3/unrelated.zip",
				},
				{
					name: `${PLUGIN_ID}-v1.2.3.zip`,
					browser_download_url: zipUrl,
				},
				{
					name: sidecar,
					browser_download_url: `https://github.com/me/cat/releases/download/v1.2.3/${sidecar}`,
				},
				{
					name: "README.md",
					browser_download_url:
						"https://github.com/me/cat/releases/download/v1.2.3/README.md",
				},
				{
					name: "README.zh-CN.md",
					browser_download_url:
						"https://github.com/me/cat/releases/download/v1.2.3/README.zh-CN.md",
				},
				{
					name: "unrelated.md",
					browser_download_url:
						"https://github.com/me/cat/releases/download/v1.2.3/unrelated.md",
				},
			],
		})
		f.add(
			`https://github.com/me/cat/releases/download/v1.2.3/${sidecar}`,
			`  ${sha256("zip")}  `,
		)
		f.add(
			"https://github.com/me/cat/releases/download/v1.2.3/README.md",
			"# Readme",
		)
		f.add(
			"https://github.com/me/cat/releases/download/v1.2.3/README.zh-CN.md",
			"# 说明 zh",
		)

		const detail = await f.service.detail("me/cat", PLUGIN_ID)

		expect(detail.repo).toBe("me/cat")
		expect(detail.state).toBe("ok")
		expect(detail.latest).toMatchObject({
			tag: "v1.2.3",
			version: "1.2.3",
			assetName: `${PLUGIN_ID}-v1.2.3.zip`,
			assetUrl: zipUrl,
			sha256: sha256("zip"),
			notes: "First release\n\nNotes here",
		})
		expect(detail.latest?.readme).toEqual({
			en: "# Readme",
			"zh-CN": "# 说明 zh",
		})
		// Non-readme assets are never fetched.
		expect(
			f.fetcher.fetchToFile.mock.calls.some(([url]) =>
				String(url).includes("unrelated.md"),
			),
		).toBe(false)
	})

	test("a failing readme locale drops just that locale", async () => {
		const f = fixture!
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", {
			...RELEASE,
			assets: [
				...RELEASE.assets,
				{
					name: "README.md",
					browser_download_url:
						"https://github.com/me/cat/releases/download/v1.2.3/README.md",
				},
				{
					name: "README.ja.md",
					browser_download_url:
						"https://github.com/me/cat/releases/download/v1.2.3/README.ja.md",
				},
			],
		})
		f.add(
			"https://github.com/me/cat/releases/download/v1.2.3/README.md",
			"# Readme",
		)

		// `README.ja.md` is missing → only the English fallback survives.
		const detail = await f.service.detail("me/cat", PLUGIN_ID)
		expect(detail.latest?.readme).toEqual({ en: "# Readme" })
	})

	test("keeps only the shipped locale when there is no bare README.md", async () => {
		const f = fixture!
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", {
			...RELEASE,
			assets: [
				...RELEASE.assets,
				{
					name: "README.zh.md",
					browser_download_url:
						"https://github.com/me/cat/releases/download/v1.2.3/README.zh.md",
				},
			],
		})
		f.add(
			"https://github.com/me/cat/releases/download/v1.2.3/README.zh.md",
			"# 说明 zh",
		)

		const detail = await f.service.detail("me/cat", PLUGIN_ID)
		expect(detail.latest?.readme).toEqual({ zh: "# 说明 zh" })
	})

	test("a repo with no published release resolves to no_release", async () => {
		const f = fixture!
		f.fetcher.fetchToFile.mockImplementation(
			async (u: string, target: string) => {
				if (u.includes("api.github.com")) {
					throw new Error(`plugin download returned HTTP 404: ${u}`)
				}
				const body = f.routes.get(u)
				if (body === undefined) {
					throw new Error(`plugin download returned HTTP 404: ${u}`)
				}
				await writeFile(target, body)
				return { sizeBytes: Buffer.byteLength(body), sha256: sha256(body) }
			},
		)

		const detail = await f.service.detail("me/cat", PLUGIN_ID)
		expect(detail.state).toBe("no_release")
		expect(detail.latest).toBeUndefined()
	})

	test("a rate-limited API with no cached release surfaces the version from the releases.atom feed", async () => {
		const f = fixture!
		f.add(atomUrl("me/cat"), atomFeed("v1.2.3"))
		rateLimitFetcher(f)

		const detail = await f.service.detail("me/cat", PLUGIN_ID)
		// The version is real (a published release) though the asset is unknown.
		expect(detail.state).toBe("ok")
		expect(detail.latest?.tag).toBe("v1.2.3")
		expect(detail.latest?.version).toBe("1.2.3")
		expect(detail.latest?.assetUrl).toBeUndefined()
		expect(detail.latest?.publishedAt).toBe("2025-01-02T03:04:05Z")
		expect(detail.rateLimited).toBe(true)
		expect(detail.error).toBeUndefined()
		// The free releases feed (not the rate-limited API) supplied the tag.
		expect(f.fetcher.fetchToFile).toHaveBeenCalledWith(
			atomUrl("me/cat"),
			expect.any(String),
			expect.any(Object),
		)
	})

	test("a rate-limited API with a stale cached release and a newer feed tag surfaces the newer version-only release", async () => {
		const f = fixture!
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", RELEASE)
		await f.service.detail("me/cat", PLUGIN_ID) // seed v1.2.3 + asset
		f.add(atomUrl("me/cat"), atomFeed("v1.3.0"))
		rateLimitFetcher(f)
		// Expire the release TTL so the next detail re-fetches the API.
		f.advance(60 * 60_000 + 1)

		const detail = await f.service.detail("me/cat", PLUGIN_ID)
		// The newer feed tag wins over the stale cache: version known, asset not.
		expect(detail.state).toBe("ok")
		expect(detail.latest?.version).toBe("1.3.0")
		expect(detail.latest?.assetUrl).toBeUndefined()
		expect(detail.rateLimited).toBe(true)
	})

	test("a rate-limited API with a feed tag matching the cached release keeps the cached asset", async () => {
		const f = fixture!
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", RELEASE)
		await f.service.detail("me/cat", PLUGIN_ID) // seed v1.2.3 + asset
		// The feed agrees with the cached tag — the cache is still current, so
		// its asset is kept and an update stays possible from cache.
		f.add(atomUrl("me/cat"), atomFeed("v1.2.3"))
		rateLimitFetcher(f)
		f.advance(60 * 60_000 + 1)

		const detail = await f.service.detail("me/cat", PLUGIN_ID)
		expect(detail.state).toBe("ok")
		expect(detail.latest?.version).toBe("1.2.3")
		expect(detail.latest?.assetUrl).toBe(
			RELEASE.assets[0]!.browser_download_url,
		)
		expect(detail.rateLimited).toBe(true)
	})

	test("a rate-limited API with an empty atom feed degrades to the cached release", async () => {
		const f = fixture!
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", RELEASE)
		await f.service.detail("me/cat", PLUGIN_ID) // seed v1.2.3 + asset
		// The feed answers but carries no entry — nothing to learn from it,
		// so the detail keeps the cached payload (asset still usable).
		f.add(atomUrl("me/cat"), "<feed></feed>")
		rateLimitFetcher(f)
		f.advance(60 * 60_000 + 1)

		const detail = await f.service.detail("me/cat", PLUGIN_ID)
		expect(detail.state).toBe("ok")
		expect(detail.latest?.version).toBe("1.2.3")
		expect(detail.latest?.assetUrl).toBe(
			RELEASE.assets[0]!.browser_download_url,
		)
		expect(detail.rateLimited).toBe(true)
	})

	test("a rate-limited API with no cached release and no atom entry reports a rate-limited error", async () => {
		const f = fixture!
		rateLimitFetcher(f)

		const detail = await f.service.detail("me/cat", PLUGIN_ID)
		expect(detail.state).toBe("error")
		expect(detail.errorKind).toBe("rate_limited")
		expect(detail.error).toContain("rate limit")
		expect(detail.latest).toBeUndefined()
	})

	test("caches a fresh release per repo and persists it across restarts", async () => {
		const f = fixture!
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", RELEASE)
		await f.service.detail("me/cat", PLUGIN_ID)
		expect(apiCalls(f)).toBe(1)

		// A fresh instance (empty in-memory cache) sharing the same cache file
		// answers from the persisted disk cache without any API call.
		const second = createMarketplaceService({
			prefs: {
				get: (key: string) =>
					f.prefs.has(key)
						? { key, value: f.prefs.get(key)!, updatedAt: 0 }
						: undefined,
				set: (key: string, value: string) => {
					f.prefs.set(key, value)
					return { key, value, updatedAt: 0 }
				},
				remove: (key: string) => {
					f.prefs.delete(key)
				},
			},
			sources: f.sources,
			fetcher: f.fetcher,
			installer: f.installer,
			rescan: f.rescan,
			postInstall: f.postInstall,
			tmpDir: f.root,
			maxInstallBytes: 1024 * 1024,
			releaseCacheFile: join(f.root, "releases.json"),
			cacheTtlMs: 10 * 60_000,
			releaseCacheTtlMs: 60 * 60_000,
			rateLimitCooldownMs: 60 * 60_000,
			now: () => f.clock(),
		})
		const detail = await second.detail("me/cat", PLUGIN_ID)
		expect(detail.state).toBe("ok")
		expect(detail.latest?.version).toBe("1.2.3")
		expect(apiCalls(f)).toBe(1)
	})

	test("a rate-limited API arms a cooldown that suppresses re-hits until it lapses", async () => {
		const f = fixture!
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", RELEASE)
		// Seed a healthy cache, then make the API 403.
		const healthy = await f.service.detail("me/cat", PLUGIN_ID)
		expect(apiCalls(f)).toBe(1)
		expect(healthy.rateLimited).toBeUndefined()

		// Expire the release TTL so the next detail re-fetches; the stale
		// cached payload degrades to a rate-limited entry instead of erroring.
		f.advance(60 * 60_000 + 1)
		rateLimitFetcher(f)

		const degraded = await f.service.detail("me/cat", PLUGIN_ID)
		expect(apiCalls(f)).toBe(2)
		expect(degraded.state).toBe("ok")
		expect(degraded.latest?.version).toBe("1.2.3")
		expect(degraded.rateLimited).toBe(true)

		// Within the cooldown a re-open skips the API entirely (no re-quota burn).
		const again = await f.service.detail("me/cat", PLUGIN_ID)
		expect(apiCalls(f)).toBe(2)
		expect(again.rateLimited).toBe(true)

		// Once the cooldown lapses it retries (and still degrades while 403).
		f.advance(60 * 60_000 + 1)
		const after = await f.service.detail("me/cat", PLUGIN_ID)
		expect(apiCalls(f)).toBe(3)
		expect(after.state).toBe("ok")
		expect(after.latest?.version).toBe("1.2.3")
		expect(after.rateLimited).toBe(true)
	})

	test("rejects a non-normalized repo address before any fetch", async () => {
		const f = fixture!
		await expect(
			f.service.detail("https://gitlab.com/me/x", PLUGIN_ID),
		).rejects.toMatchObject({
			code: "VALIDATION",
			message: expect.stringContaining("GitHub repository address"),
		})
		expect(f.fetcher.fetchToFile).not.toHaveBeenCalled()
	})

	test("a release payload that fails validation maps to a failed error", async () => {
		const f = fixture!
		// The API answers, but the payload is missing the required fields.
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", {
			bogus: true,
		})

		const detail = await f.service.detail("me/cat", PLUGIN_ID)
		expect(detail.state).toBe("error")
		expect(detail.errorKind).toBe("failed")
		expect(detail.latest).toBeUndefined()
		expect(detail.error).toContain("fetching latest release failed")
	})
})

describe("createMarketplaceService.install", () => {
	test("downloads, installs with the expected id, rescans and records the normalized source repo", async () => {
		const f = fixture!
		const assetUrl = `https://github.com/me/cat/releases/download/v1.2.3/${PLUGIN_ID}-v1.2.3.zip`
		f.add(assetUrl, "zip-bytes")

		const result = await f.service.install({
			id: PLUGIN_ID,
			// The full https://github.com/… form normalizes to `owner/repo`.
			repo: "https://github.com/me/cat-viewer",
			assetUrl,
		})

		expect(result).toEqual({ pluginId: PLUGIN_ID })
		expect(f.installer.installFromZip).toHaveBeenCalledWith(expect.anything(), {
			expectedId: PLUGIN_ID,
		})
		expect(f.rescan).toHaveBeenCalledTimes(1)
		expect(f.sources.recordInstallSource).toHaveBeenCalledWith(
			PLUGIN_ID,
			"me/cat-viewer",
		)
		// The post-install hook fires after the rescan (best-effort).
		expect(f.postInstall).toHaveBeenCalledWith(PLUGIN_ID)
	})

	test("rejects a bad source repo before any fetch", async () => {
		await expect(
			fixture!.service.install({
				id: PLUGIN_ID,
				repo: "https://gitlab.com/me/x",
				assetUrl: "https://evil.example.com/plugin.zip",
			}),
		).rejects.toMatchObject({
			code: "VALIDATION",
			message: expect.stringContaining("GitHub repository address"),
		})
		expect(fixture!.fetcher.fetchToFile).not.toHaveBeenCalled()
		expect(fixture!.sources.recordInstallSource).not.toHaveBeenCalled()
	})

	test("rejects hosts outside the GitHub release family before any fetch", async () => {
		await expect(
			fixture!.service.install({
				id: PLUGIN_ID,
				repo: "me/cat-viewer",
				assetUrl: "https://evil.example.com/plugin.zip",
			}),
		).rejects.toMatchObject({
			code: "VALIDATION",
			message: expect.stringContaining("not an official GitHub release host"),
		})
		expect(fixture!.fetcher.fetchToFile).not.toHaveBeenCalled()
	})

	test("does not record the source when a later step fails", async () => {
		const f = fixture!
		const assetUrl = `https://github.com/me/cat/releases/download/v1.2.3/${PLUGIN_ID}-v1.2.3.zip`
		f.add(assetUrl, "zip-bytes")

		await expect(
			f.service.install({
				id: PLUGIN_ID,
				repo: "me/cat-viewer",
				assetUrl,
				sha256: sha256("other"),
			}),
		).rejects.toMatchObject({
			code: "VALIDATION",
			message: expect.stringContaining("checksum"),
		})
		expect(f.sources.recordInstallSource).not.toHaveBeenCalled()
	})

	test("fails on an sha256 mismatch without installing", async () => {
		const f = fixture!
		const assetUrl = `https://github.com/me/cat/releases/download/v1.2.3/${PLUGIN_ID}-v1.2.3.zip`
		f.add(assetUrl, "zip-bytes")

		await expect(
			f.service.install({
				id: PLUGIN_ID,
				repo: "me/cat-viewer",
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
				repo: "me/cat-viewer",
				assetUrl,
			}),
		).rejects.toThrow("expected plugin id")
		// The download happened, but nothing was committed.
		expect(f.installer.installFromZip).toHaveBeenCalledTimes(1)
		expect(f.rescan).not.toHaveBeenCalled()
	})
})

describe("createMarketplaceService origin merge", () => {
	const OTHER_ID = "55555555-5555-4555-8555-555555555555"

	test("merges installed plugins whose source repo left the current registry", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat-viewer"],
		})
		f.addJson(rawUrl("me", "cat-viewer", "HEAD", "manifest.json"), MANIFEST)
		f.add(atomUrl("me/cat-viewer"), atomFeed("v1.2.3"))
		// Installed from another registry: source repo not listed here and
		// its plugin id is absent from the current catalog.
		f.sources.listInstallSources.mockReturnValue([
			{ id: OTHER_ID, repo: "me/other-viewer" },
		])
		f.addJson(rawUrl("me", "other-viewer", "HEAD", "manifest.json"), {
			...MANIFEST,
			id: OTHER_ID,
			version: "2.0.0",
		})
		f.add(atomUrl("me/other-viewer"), atomFeed("v2.0.0"))

		const snapshot = await f.service.refresh(false)

		expect(snapshot.plugins).toHaveLength(2)
		const merged = snapshot.plugins.find((p) => p.repo === "me/other-viewer")
		expect(merged).toMatchObject({
			id: OTHER_ID,
			state: "ok",
		})
		expect(merged?.latest?.version).toBe("2.0.0")
		expect(apiCalls(f)).toBe(0)
	})

	test("the current registry wins when an installed origin matches a catalog id", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat-viewer"],
		})
		f.addJson(rawUrl("me", "cat-viewer", "HEAD", "manifest.json"), MANIFEST)
		f.add(atomUrl("me/cat-viewer"), atomFeed("v1.2.3"))
		// The same plugin id is listed by the current registry: the origin
		// repo is skipped (and never fetched) — catalog data wins.
		f.sources.listInstallSources.mockReturnValue([
			{ id: PLUGIN_ID, repo: "me/other-viewer" },
		])

		const snapshot = await f.service.refresh(false)

		expect(snapshot.plugins).toHaveLength(1)
		expect(snapshot.plugins[0]?.repo).toBe("me/cat-viewer")
		expect(apiCalls(f)).toBe(0)
	})

	test("does not refetch an origin repo the registry already lists", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat-viewer"],
		})
		f.addJson(rawUrl("me", "cat-viewer", "HEAD", "manifest.json"), MANIFEST)
		f.add(atomUrl("me/cat-viewer"), atomFeed("v1.2.3"))
		f.sources.listInstallSources.mockReturnValue([
			{ id: OTHER_ID, repo: "me/cat-viewer" },
		])

		const snapshot = await f.service.refresh(false)

		expect(snapshot.plugins).toHaveLength(1)
		expect(snapshot.plugins[0]?.repo).toBe("me/cat-viewer")
		expect(apiCalls(f)).toBe(0)
	})

	test("an origin repo that fails to load lands in the errors list", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat-viewer"],
		})
		f.addJson(rawUrl("me", "cat-viewer", "HEAD", "manifest.json"), MANIFEST)
		f.add(atomUrl("me/cat-viewer"), atomFeed("v1.2.3"))
		f.sources.listInstallSources.mockReturnValue([
			{ id: OTHER_ID, repo: "me/other-viewer" },
		])

		const snapshot = await f.service.refresh(false)

		expect(snapshot.plugins).toHaveLength(1)
		expect(snapshot.errors).toEqual([
			{
				repo: "me/other-viewer",
				message: expect.stringContaining("manifest.json"),
			},
		])
	})

	test("a repo whose manifest id changed no longer sources the installed plugin", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat-viewer"],
		})
		f.addJson(rawUrl("me", "cat-viewer", "HEAD", "manifest.json"), MANIFEST)
		f.add(atomUrl("me/cat-viewer"), atomFeed("v1.2.3"))
		f.sources.listInstallSources.mockReturnValue([
			{ id: OTHER_ID, repo: "me/other-viewer" },
		])
		f.addJson(rawUrl("me", "other-viewer", "HEAD", "manifest.json"), {
			...MANIFEST,
			id: "66666666-6666-4666-8666-666666666666",
		})

		const snapshot = await f.service.refresh(false)

		expect(snapshot.plugins).toHaveLength(1)
		expect(snapshot.errors).toEqual([])
	})
})
