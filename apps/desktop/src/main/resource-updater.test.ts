/**
 * @vitest-environment node
 *
 * The resource channel is the riskiest path to eyeball (downloads,
 * integrity checks, staging merge, swap, rollback, soak) — this suite
 * drives it end-to-end at the unit level with a mocked `net.fetch`, a
 * real temp resources tree and real tarballs.
 */

import { createHash } from "node:crypto"
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DesktopUpdateState } from "@hoardodile/shared/desktop"
import { net } from "electron"
import * as tar from "tar"
import { describe, expect, it, vi } from "vitest"
import {
	swapBackupRoot,
	swapMarkerPath,
	swapStagingRoot,
} from "./resource-support.ts"
import {
	feedUrl,
	type ResourceChannelDeps,
	reportFetchErrorAction,
	startResourceChannel,
} from "./resource-updater.ts"
import { contentHashTree } from "./shell-hash.ts"

vi.mock("electron", () => ({ net: { fetch: vi.fn() } }))
const mockFetch = vi.mocked(net.fetch)

const VERSION = "2.0.0"
const SHELL_HASH = "sha256:aaaa"
const ELECTRON_VERSION = "43.4.1"

const scratch: string[] = []

function cleanup(): void {
	for (const dir of scratch.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
	mockFetch.mockReset()
}

type Fixture = {
	readonly resourcesRoot: string
	readonly fixtureDir: string
	/** contentHashTree of each installed layer, keyed by layer name. */
	readonly identities: Record<string, string>
}

async function buildFixture(): Promise<Fixture> {
	const root = mkdtempSync(join(tmpdir(), "hd-updater-"))
	scratch.push(root)
	const resourcesRoot = join(root, "resources")
	const fixtureDir = join(root, "fixture")
	mkdirSync(join(resourcesRoot, "server", "web"), { recursive: true })
	mkdirSync(join(resourcesRoot, "server", "node_modules"), { recursive: true })
	mkdirSync(join(resourcesRoot, "node"), { recursive: true })
	mkdirSync(join(resourcesRoot, "plugins"), { recursive: true })
	mkdirSync(fixtureDir, { recursive: true })
	writeFileSync(join(resourcesRoot, "node", "node.exe"), "node-v1")
	writeFileSync(join(resourcesRoot, "server", "main.js"), "server-v1")
	writeFileSync(join(resourcesRoot, "server", "web", "index.html"), "web-v1")
	writeFileSync(
		join(resourcesRoot, "server", "node_modules", "native.js"),
		"native-v1",
	)
	writeFileSync(join(resourcesRoot, "plugins", "gallery.js"), "plugins-v1")
	writeFileSync(
		join(resourcesRoot, "resources-version.json"),
		JSON.stringify({ schema: 1, version: "1.0.0", nodeVersion: "24.0.0" }),
	)
	const identities = {
		node: contentHashTree(join(resourcesRoot, "node")),
		"server-dist": contentHashTree(join(resourcesRoot, "server"), {
			excludePrefixes: ["node_modules"],
		}),
		"server-node_modules": contentHashTree(
			join(resourcesRoot, "server", "node_modules"),
		),
		plugins: contentHashTree(join(resourcesRoot, "plugins")),
	}
	return { resourcesRoot, fixtureDir, identities }
}

/** Build a per-layer tarball from the installed tree (like the builder). */
async function buildLayerTar(
	fixture: Fixture,
	name: string,
	offset: string,
): Promise<{ fileName: string; sha256: string; size: number }> {
	const fileName = `layer-${name}.tar.gz`
	const file = join(fixture.fixtureDir, fileName)
	rmSync(file, { force: true })
	await tar.c(
		{
			gzip: true,
			file,
			cwd: fixture.resourcesRoot,
			filter:
				name === "server-dist"
					? (path) =>
							path !== "server/node_modules" &&
							!path.startsWith("server/node_modules/")
					: undefined,
		},
		name === "server-dist" ? ["server"] : [offset],
	)
	const buffer = readFileSync(file)
	return {
		fileName,
		sha256: createHash("sha256").update(buffer).digest("hex"),
		size: buffer.length,
	}
}

/**
 * Manifest with the real layer identities; pass `serverDistIdentity` to
 * force the client to download (identity mismatch) and
 * `serverDistSha256` to tamper the served checksum.
 */
async function manifestFor(
	fixture: Fixture,
	options: {
		readonly version?: string
		readonly shellHash?: string
		readonly electronVersion?: string
		readonly serverDistIdentity?: string
		readonly serverDistSha256?: string
	} = {},
): Promise<Record<string, unknown>> {
	const {
		version = VERSION,
		shellHash = SHELL_HASH,
		electronVersion = ELECTRON_VERSION,
		serverDistIdentity,
		serverDistSha256,
	} = options

	async function layer(name: string, root: string, archiveEntry: string) {
		const identity = contentHashTree(
			join(fixture.resourcesRoot, ...root.split("/")),
			{
				excludePrefixes: name === "server-dist" ? ["node_modules"] : [],
			},
		)
		const { fileName, sha256, size } = await buildLayerTar(
			fixture,
			name,
			archiveEntry,
		)
		return { name, identity, payload: { fileName, sha256, size } }
	}

	const nodeLayer = await layer("node", "node", "node")
	const pluginsLayer = await layer("plugins", "plugins", "plugins")
	const nodeModulesLayer = await layer(
		"server-node_modules",
		"server/node_modules",
		"server/node_modules",
	)
	let serverDistLayer = {
		name: "server-dist",
		identity: serverDistIdentity ?? `sha256:${"0".repeat(64)}`,
		payload: await buildLayerTar(fixture, "server-dist", "server"),
	}
	if (serverDistSha256 !== undefined) {
		serverDistLayer = {
			...serverDistLayer,
			payload: { ...serverDistLayer.payload, sha256: serverDistSha256 },
		}
	}
	const layers = [nodeLayer, pluginsLayer, nodeModulesLayer, serverDistLayer]

	return {
		schema: 1,
		version,
		platform: "win",
		arch: "x64",
		shellHash,
		electronVersion,
		installedYaml: "nsis",
		marker: {
			schema: 1,
			version,
			nodeVersion: "24.0.0",
			platform: "win",
			arch: "x64",
		},
		bundled: { node: "24.0.0", server: version, plugins: [] },
		layers,
	}
}

function fakeResponse(body: Uint8Array | string, status = 200): Response {
	const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => String(bytes.length) },
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(bytes)
				controller.close()
			},
		}),
		json: async () => JSON.parse(new TextDecoder().decode(bytes)),
	} as unknown as Response
}

function fakeFetch(
	fixture: Fixture,
	manifest: Record<string, unknown>,
	options: {
		readonly manifestStatus?: number
		readonly serveLayers?: boolean
	} = {},
): void {
	const { manifestStatus = 200, serveLayers = true } = options
	mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
		const url = String(input)
		if (url.endsWith("resources-pack-win-x64.json")) {
			if (manifestStatus !== 200) {
				return fakeResponse("", manifestStatus)
			}
			return fakeResponse(JSON.stringify(manifest))
		}
		if (serveLayers) {
			const name = url.split("/").pop() ?? ""
			const payload = (
				manifest.layers as Array<{ payload: { fileName: string } }>
			).find((layer) => layer.payload.fileName === name)?.payload
			if (payload !== undefined) {
				return fakeResponse(readFileSync(join(fixture.fixtureDir, name)))
			}
		}
		throw Object.assign(new Error("fetch failed"), { status: 404 })
	})
}

function makeDeps(
	fixture: Fixture,
	overrides: Partial<ResourceChannelDeps> = {},
): ResourceChannelDeps & {
	readonly emitted: DesktopUpdateState[]
} {
	const emitted: DesktopUpdateState[] = []
	return {
		enabled: true,
		dev: false,
		support: { available: true },
		resourcesRoot: fixture.resourcesRoot,
		cacheDir: join(fixture.fixtureDir, "cache"),
		appVersion: "1.0.0",
		electronVersion: ELECTRON_VERSION,
		platform: "win32" as NodeJS.Platform,
		arch: "x64",
		getResourceVersion: () => null,
		setResourceVersion: vi.fn(),
		stopSidecar: vi.fn(async () => {}),
		startSidecar: vi.fn(async () => {}),
		watchSidecarCrash: vi.fn(() => () => {}),
		reloadWindow: vi.fn(async () => {}),
		emit: vi.fn((state: DesktopUpdateState) => emitted.push(state)),
		localShellHash: () => SHELL_HASH,
		soakMs: 20,
		...overrides,
		emitted,
	}
}

function versionOf(resourcesRoot: string, entry: string): string | undefined {
	const target =
		entry === "resources-version.json"
			? join(resourcesRoot, entry)
			: join(resourcesRoot, entry, "main.js")
	if (!existsSync(target)) return undefined
	return readFileSync(target, "utf8")
}

describe("feedUrl", () => {
	it("joins without doubling or trailing slashes", () => {
		expect(feedUrl("a.json", "http://127.0.0.1:1/")).toBe(
			"http://127.0.0.1:1/a.json",
		)
		expect(feedUrl("a.json", "http://127.0.0.1:1")).toBe(
			"http://127.0.0.1:1/a.json",
		)
		expect(feedUrl("a/b.json", "https://github.com/x/")).toBe(
			"https://github.com/x/a/b.json",
		)
	})
})

describe("reportFetchErrorAction", () => {
	it("maps 404 to latest and anything else to error", () => {
		expect(
			reportFetchErrorAction(Object.assign(new Error("gone"), { status: 404 })),
		).toEqual({ kind: "latest" })
		const action = reportFetchErrorAction(new Error("boom"))
		expect(action).toEqual({ kind: "error", message: "boom" })
	})
})

describe("resource channel check", () => {
	it("fetches only the mismatching layer and copies the rest into staging", async () => {
		const fixture = await buildFixture()
		const manifest = await manifestFor(fixture)
		fakeFetch(fixture, manifest)
		const deps = makeDeps(fixture)
		const channel = startResourceChannel(deps)

		const verdict = await channel.check()
		expect(verdict).toBe("none")

		// Exactly two requests: the manifest and the ONE mismatching layer.
		const urls = mockFetch.mock.calls.map((call) => String(call[0]))
		expect(urls).toHaveLength(2)
		expect(urls[0]).toMatch(/resources-pack-win-x64\.json$/)
		expect(urls[1]).toMatch(/-server-dist\.tar\.gz$/)

		// Ready state.
		expect(deps.emitted.at(-1)).toEqual({
			status: "ready",
			channel: "resources",
			version: VERSION,
		})

		// Staging is complete: extracted server-dist + copied layers + marker.
		const staging = swapStagingRoot(fixture.resourcesRoot, VERSION)
		expect(readFileSync(join(staging, "server", "main.js"), "utf8")).toContain(
			"server-v1",
		)
		expect(
			existsSync(join(staging, "server", "node_modules", "native.js")),
		).toBe(true)
		expect(readFileSync(join(staging, "node", "node.exe"), "utf8")).toBe(
			"node-v1",
		)
		expect(
			JSON.parse(readFileSync(join(staging, "resources-version.json"), "utf8"))
				.version,
		).toBe(VERSION)

		// Nothing in the installed tree was touched.
		expect(versionOf(fixture.resourcesRoot, "server")).toContain("server-v1")

		cleanup()
	})

	it("reports latest on a 404 manifest and never fetches layers", async () => {
		const fixture = await buildFixture()
		const manifest = await manifestFor(fixture)
		fakeFetch(fixture, manifest, { manifestStatus: 404 })
		const deps = makeDeps(fixture)
		const channel = startResourceChannel(deps)

		await channel.check()
		expect(deps.emitted.at(-1)).toEqual({ status: "latest" })
		expect(mockFetch).toHaveBeenCalledTimes(1)

		cleanup()
	})

	it("reports error on a malformed manifest", async () => {
		const fixture = await buildFixture()
		fakeFetch(fixture, { hello: "world" })
		const deps = makeDeps(fixture)
		const channel = startResourceChannel(deps)

		await channel.check()
		const last = deps.emitted.at(-1)
		expect(last?.status).toBe("error")

		cleanup()
	})

	it("routes a shell or Electron change to full without downloading", async () => {
		const fixture = await buildFixture()
		const deps = makeDeps(fixture)
		for (const override of [
			{ shellHash: "sha256:bbbb" },
			{ electronVersion: "44.0.0" },
		]) {
			const manifest = await manifestFor(fixture, override)
			fakeFetch(fixture, manifest)
			const channel = startResourceChannel(deps)
			expect(await channel.check()).toBe("full")
			// Only the manifest request; no layer tarballs.
			expect(
				mockFetch.mock.calls.filter((call) =>
					String(call[0]).includes("-layer-"),
				),
			).toHaveLength(0)
			mockFetch.mockClear()
		}

		cleanup()
	})

	it("reports availability (no download) when disabled, and stages on manual", async () => {
		const fixture = await buildFixture()
		const manifest = await manifestFor(fixture)
		fakeFetch(fixture, manifest)
		const deps = makeDeps(fixture, { enabled: false })

		const channel = startResourceChannel(deps)
		// Disabled still probes the manifest, but only reports availability —
		// no layer download, no staging.
		expect(await channel.check()).toBe("none")
		expect(deps.emitted.at(-1)).toEqual({
			status: "available",
			version: VERSION,
		})
		expect(
			mockFetch.mock.calls.filter((call) =>
				String(call[0]).includes("-layer-"),
			),
		).toHaveLength(0)

		mockFetch.mockClear()
		deps.emitted.length = 0

		// A manual check bypasses the gate and stages → ready.
		await channel.check(true)
		expect(deps.emitted.at(-1)).toEqual({
			status: "ready",
			channel: "resources",
			version: VERSION,
		})

		cleanup()
	})

	it("reports availability (not full) for a shell change when disabled, never downloading", async () => {
		// A release that needs a full install must still surface the dot when
		// auto-update is off, but must not download a layer or run full.
		const fixture = await buildFixture()
		const manifest = await manifestFor(fixture, { shellHash: "sha256:bbbb" })
		fakeFetch(fixture, manifest)
		const deps = makeDeps(fixture, { enabled: false })

		const channel = startResourceChannel(deps)
		expect(await channel.check()).toBe("none")
		expect(deps.emitted.at(-1)).toEqual({
			status: "available",
			version: VERSION,
		})
		expect(
			mockFetch.mock.calls.filter((call) =>
				String(call[0]).includes("-layer-"),
			),
		).toHaveLength(0)

		cleanup()
	})

	it("reports latest (no dot) when disabled and the manifest is not newer", async () => {
		const fixture = await buildFixture()
		const manifest = await manifestFor(fixture, { version: "1.0.0" })
		fakeFetch(fixture, manifest)
		const deps = makeDeps(fixture, { enabled: false })

		const channel = startResourceChannel(deps)
		expect(await channel.check()).toBe("none")
		expect(deps.emitted.at(-1)).toEqual({ status: "latest" })

		cleanup()
	})

	it("never probes in dev runs", async () => {
		const fixture = await buildFixture()
		const manifest = await manifestFor(fixture)
		fakeFetch(fixture, manifest)
		const deps = makeDeps(fixture, { dev: true })

		const channel = startResourceChannel(deps)
		expect(await channel.check()).toBe("none")
		expect(mockFetch).not.toHaveBeenCalled()
		expect(deps.emitted).toHaveLength(0)

		cleanup()
	})

	it("reports error on a tampered layer and leaves no staging behind", async () => {
		const fixture = await buildFixture()
		const manifest = await manifestFor(fixture, {
			serverDistSha256: "0".repeat(64),
		})
		fakeFetch(fixture, manifest)
		const deps = makeDeps(fixture)
		const channel = startResourceChannel(deps)

		await channel.check()
		const last = deps.emitted.at(-1)
		expect(last?.status).toBe("error")

		// No staging, no tmp leftovers, tree untouched.
		expect(existsSync(swapStagingRoot(fixture.resourcesRoot, VERSION))).toBe(
			false,
		)
		expect(existsSync(join(join(deps.cacheDir, ".resources-tmp")))).toBe(false)
		expect(versionOf(fixture.resourcesRoot, "server")).toContain("server-v1")

		cleanup()
	})
})

describe("resource channel apply", () => {
	async function readyChannel() {
		const fixture = await buildFixture()
		const manifest = await manifestFor(fixture)
		fakeFetch(fixture, manifest)
		const deps = makeDeps(fixture)
		const channel = startResourceChannel(deps)
		await channel.check()
		return { fixture, deps, channel }
	}

	it("swaps, restarts, commits, then drops the backup after the soak", async () => {
		const { fixture, deps, channel } = await readyChannel()
		await channel.apply()

		expect(deps.stopSidecar).toHaveBeenCalledTimes(1)
		expect(deps.startSidecar).toHaveBeenCalledTimes(1)
		expect(deps.setResourceVersion).toHaveBeenCalledWith(VERSION)
		expect(deps.reloadWindow).toHaveBeenCalledTimes(1)
		expect(deps.emitted.at(-1)).toEqual({ status: "latest" })
		// Committed: no marker; backup held for the soak.
		expect(existsSync(swapMarkerPath(fixture.resourcesRoot))).toBe(false)
		expect(existsSync(swapBackupRoot(fixture.resourcesRoot))).toBe(true)

		await new Promise((resolve) => setTimeout(resolve, 60))
		expect(existsSync(swapBackupRoot(fixture.resourcesRoot))).toBe(false)

		cleanup()
	})

	it("rolls back and restarts the old tree when the new sidecar fails", async () => {
		const { fixture, deps, channel } = await readyChannel()
		vi.mocked(deps.startSidecar)
			.mockRejectedValueOnce(new Error("boot failed"))
			.mockRejectedValueOnce(new Error("not again"))

		await channel.apply()
		expect(deps.emitted.at(-1)).toMatchObject({ status: "error" })
		// Old tree restored; no marker/backup/staging leftovers.
		expect(versionOf(fixture.resourcesRoot, "server")).toContain("server-v1")
		expect(existsSync(swapMarkerPath(fixture.resourcesRoot))).toBe(false)
		expect(existsSync(swapBackupRoot(fixture.resourcesRoot))).toBe(false)
		expect(existsSync(swapStagingRoot(fixture.resourcesRoot, VERSION))).toBe(
			false,
		)

		cleanup()
	})

	it("reports error (and keeps the running tree) when the rollback restart also fails", async () => {
		const { fixture, deps, channel } = await readyChannel()
		vi.mocked(deps.startSidecar).mockRejectedValue(new Error("boom"))

		await channel.apply()
		expect(deps.emitted.at(-1)).toMatchObject({ status: "error" })
		// The old tree came back even though the sidecar could not boot.
		expect(versionOf(fixture.resourcesRoot, "server")).toContain("server-v1")

		cleanup()
	})

	it("keeps the backup when the sidecar crashes inside the soak", async () => {
		const { fixture, deps, channel } = await readyChannel()
		let crash: (() => void) | undefined
		vi.mocked(deps.watchSidecarCrash).mockImplementation((listener) => {
			crash = listener
			return () => {}
		})
		await channel.apply()
		expect(crash).toBeDefined()

		crash?.()
		await new Promise((resolve) => setTimeout(resolve, 60))
		// No rollback (the DB may already host the new schema) and the
		// backup is kept for manual/inspectable recovery.
		expect(existsSync(swapBackupRoot(fixture.resourcesRoot))).toBe(true)

		cleanup()
	})
})
