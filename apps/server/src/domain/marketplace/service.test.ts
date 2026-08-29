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
		expect(plugin.latest?.intro).toBeUndefined()
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
	})

	test("serves the snapshot cache for 10 minutes; forced refresh bypasses the release TTL", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat"],
		})
		f.addJson(rawUrl("me", "cat", "HEAD", "manifest.json"), MANIFEST)
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", RELEASE)

		const registryCalls = () =>
			f.fetcher.fetchToFile.mock.calls.filter(([url]) =>
				String(url).includes("registry.json"),
			).length

		await f.service.refresh(false)
		expect(registryCalls()).toBe(1)
		expect(apiCalls(f)).toBe(1)
		await f.service.refresh(false)
		expect(registryCalls()).toBe(1)

		// The snapshot layer expires after 10 minutes; the release layer
		// is still inside its one-hour window.
		f.advance(10 * 60_000 + 1)
		await f.service.refresh(false)
		expect(registryCalls()).toBe(2)
		expect(apiCalls(f)).toBe(1)

		// Forced refresh refreshes the snapshot layer AND the release
		// API immediately (the one-hour TTL is bypassed on user command).
		await f.service.refresh(true)
		expect(registryCalls()).toBe(3)
		expect(apiCalls(f)).toBe(2)
	})

	test("defaults the catalog caches to a day when no TTL is configured", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat"],
		})
		f.addJson(rawUrl("me", "cat", "HEAD", "manifest.json"), MANIFEST)
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", RELEASE)

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
		expect(apiCalls(f)).toBe(1)

		// 23 h later both the snapshot and the release layer are still
		// inside the day window — no refetch, no API call.
		f.advance(23 * 60 * 60_000)
		await defaulted.refresh(false)
		expect(registryCalls()).toBe(1)
		expect(apiCalls(f)).toBe(1)

		// Past a day the snapshot is rebuilt and the release TTL has also
		// lapsed, so the API is asked again.
		f.advance(60 * 60_000 + 1)
		await defaulted.refresh(false)
		expect(registryCalls()).toBe(2)
		expect(apiCalls(f)).toBe(2)
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

	test("a rate-limited API degrades to the cached release and cools down", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat"],
		})
		f.addJson(rawUrl("me", "cat", "HEAD", "manifest.json"), MANIFEST)
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", RELEASE)

		// Seed the cache, then make the API 403 — a forced refresh tries
		// the API anyway (bypassing the one-hour TTL).
		await f.service.refresh(false)
		expect(apiCalls(f)).toBe(1)
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

		const snapshot = await f.service.refresh(true)
		// Stale reuse: the entry stays healthy with the cached release,
		// flagged as rate-limited so the UI can say so.
		expect(snapshot.plugins[0]?.state).toBe("ok")
		expect(snapshot.plugins[0]?.latest?.version).toBe("1.2.3")
		expect(snapshot.plugins[0]?.rateLimited).toBe(true)
		expect(snapshot.errors).toEqual([])
		expect(apiCalls(f)).toBe(2)

		// Cooldown: another rebuild skips the API entirely.
		await f.service.refresh(true)
		expect(apiCalls(f)).toBe(2)

		// Once the cooldown lapses it retries (and still degrades).
		f.advance(60 * 60_000 + 1)
		const after = await f.service.refresh(true)
		expect(apiCalls(f)).toBe(3)
		expect(after.plugins[0]?.state).toBe("ok")
		expect(after.plugins[0]?.latest?.version).toBe("1.2.3")
		expect(after.plugins[0]?.rateLimited).toBe(true)
	})

	test("persists the release cache to disk across service restarts", async () => {
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

		// A fresh service instance (empty in-memory caches) sharing the
		// same preference store and cache file answers without any API call.
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
		const snapshot = await second.refresh(false)

		expect(snapshot.plugins[0]?.state).toBe("ok")
		expect(snapshot.plugins[0]?.latest?.version).toBe("1.2.3")
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
		expect(snapshot.plugins[0]?.errorKind).toBe("rate_limited")
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

	test("loads the release intro assets per locale", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat"],
		})
		f.addJson(rawUrl("me", "cat", "HEAD", "manifest.json"), MANIFEST)
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", {
			...RELEASE,
			assets: [
				...RELEASE.assets,
				{
					name: "intro.en.md",
					browser_download_url:
						"https://github.com/me/cat/releases/download/v1.2.3/intro.en.md",
				},
				{
					name: "intro.zh-CN.md",
					browser_download_url:
						"https://github.com/me/cat/releases/download/v1.2.3/intro.zh-CN.md",
				},
				{
					name: "unrelated.md",
					browser_download_url:
						"https://github.com/me/cat/releases/download/v1.2.3/unrelated.md",
				},
			],
		})
		f.add(
			"https://github.com/me/cat/releases/download/v1.2.3/intro.en.md",
			"# Intro en",
		)
		f.add(
			"https://github.com/me/cat/releases/download/v1.2.3/intro.zh-CN.md",
			"# 介绍 zh",
		)

		const snapshot = await f.service.refresh(false)

		expect(snapshot.plugins[0]?.latest?.intro).toEqual({
			en: "# Intro en",
			"zh-CN": "# 介绍 zh",
		})
		// Non-intro assets are never fetched.
		expect(
			f.fetcher.fetchToFile.mock.calls.some(([url]) =>
				String(url).includes("unrelated.md"),
			),
		).toBe(false)
	})

	test("a failing intro locale drops just that locale", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat"],
		})
		f.addJson(rawUrl("me", "cat", "HEAD", "manifest.json"), MANIFEST)
		f.addJson("https://api.github.com/repos/me/cat/releases/latest", {
			...RELEASE,
			assets: [
				...RELEASE.assets,
				{
					name: "intro.en.md",
					browser_download_url:
						"https://github.com/me/cat/releases/download/v1.2.3/intro.en.md",
				},
				{
					name: "intro.ja.md",
					browser_download_url:
						"https://github.com/me/cat/releases/download/v1.2.3/intro.ja.md",
				},
			],
		})
		f.add(
			"https://github.com/me/cat/releases/download/v1.2.3/intro.en.md",
			"# Intro en",
		)

		// `intro.ja.md` is missing → only the English intro survives.
		const snapshot = await f.service.refresh(false)
		expect(snapshot.plugins[0]?.latest?.intro).toEqual({ en: "# Intro en" })
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
		f.addJson(
			"https://api.github.com/repos/me/cat-viewer/releases/latest",
			RELEASE,
		)
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
		f.addJson("https://api.github.com/repos/me/other-viewer/releases/latest", {
			...RELEASE,
			tag_name: "v2.0.0",
		})

		const snapshot = await f.service.refresh(false)

		expect(snapshot.plugins).toHaveLength(2)
		const merged = snapshot.plugins.find((p) => p.repo === "me/other-viewer")
		expect(merged).toMatchObject({
			id: OTHER_ID,
			state: "ok",
		})
		expect(merged?.latest?.version).toBe("2.0.0")
	})

	test("the current registry wins when an installed origin matches a catalog id", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat-viewer"],
		})
		f.addJson(rawUrl("me", "cat-viewer", "HEAD", "manifest.json"), MANIFEST)
		f.addJson(
			"https://api.github.com/repos/me/cat-viewer/releases/latest",
			RELEASE,
		)
		// The same plugin id is listed by the current registry: the origin
		// repo is skipped (and never fetched) — catalog data wins.
		f.sources.listInstallSources.mockReturnValue([
			{ id: PLUGIN_ID, repo: "me/other-viewer" },
		])

		const snapshot = await f.service.refresh(false)

		expect(snapshot.plugins).toHaveLength(1)
		expect(snapshot.plugins[0]?.repo).toBe("me/cat-viewer")
		expect(apiCalls(f)).toBe(1)
	})

	test("does not refetch an origin repo the registry already lists", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat-viewer"],
		})
		f.addJson(rawUrl("me", "cat-viewer", "HEAD", "manifest.json"), MANIFEST)
		f.addJson(
			"https://api.github.com/repos/me/cat-viewer/releases/latest",
			RELEASE,
		)
		f.sources.listInstallSources.mockReturnValue([
			{ id: OTHER_ID, repo: "me/cat-viewer" },
		])

		const snapshot = await f.service.refresh(false)

		expect(snapshot.plugins).toHaveLength(1)
		expect(snapshot.plugins[0]?.repo).toBe("me/cat-viewer")
		expect(apiCalls(f)).toBe(1)
	})

	test("an origin repo that fails to load lands in the errors list", async () => {
		const f = fixture!
		f.prefs.set("marketplace.registryRepo", "me/registry")
		f.addJson(rawUrl("me", "registry", "HEAD", "registry.json"), {
			version: 1,
			plugins: ["me/cat-viewer"],
		})
		f.addJson(rawUrl("me", "cat-viewer", "HEAD", "manifest.json"), MANIFEST)
		f.addJson(
			"https://api.github.com/repos/me/cat-viewer/releases/latest",
			RELEASE,
		)
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
		f.addJson(
			"https://api.github.com/repos/me/cat-viewer/releases/latest",
			RELEASE,
		)
		f.sources.listInstallSources.mockReturnValue([
			{ id: OTHER_ID, repo: "me/other-viewer" },
		])
		f.addJson(rawUrl("me", "other-viewer", "HEAD", "manifest.json"), {
			...MANIFEST,
			id: "66666666-6666-4666-8666-666666666666",
		})
		f.addJson("https://api.github.com/repos/me/other-viewer/releases/latest", {
			...RELEASE,
			tag_name: "v2.0.0",
		})

		const snapshot = await f.service.refresh(false)

		expect(snapshot.plugins).toHaveLength(1)
		expect(snapshot.errors).toEqual([])
	})
})
