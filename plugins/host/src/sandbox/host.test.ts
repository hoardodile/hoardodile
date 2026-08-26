import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { PluginPermissions } from "@hoardodile/sdk-types"
import { afterEach, describe, expect, test, vi } from "vitest"
import type { ResourceAPI } from "../types.ts"
import {
	createPluginSandbox,
	DEFAULT_SANDBOX_CONFIG,
	PLUGIN_MAX_API_CALLS_PER_HOOK,
	PLUGIN_MAX_LOGS_PER_HOOK,
	PLUGIN_MAX_RESULT_BYTES,
	type PluginSandbox,
	type PluginSandboxConfig,
} from "./host.ts"

function fixture(name: string): string {
	return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
}

function noPermissions(): PluginPermissions {
	return {
		sourceMeta: false,
		searchMeta: false,
		danmaku: false,
		message: false,
		imageHashes: false,
		container: false,
		download: false,
	}
}

function containerPermissions(): PluginPermissions {
	return { ...noPermissions(), container: true }
}

function downloadPermissions(): PluginPermissions {
	return { ...noPermissions(), download: true }
}

function fastConfig(overrides: Partial<PluginSandboxConfig> = {}) {
	return {
		...DEFAULT_SANDBOX_CONFIG,
		watchdogMs: 300,
		hardTimeoutMs: 5_000,
		maxRespawns: 10,
		...overrides,
	} satisfies PluginSandboxConfig
}

function createStubApi(overrides: Partial<ResourceAPI> = {}): ResourceAPI {
	return {
		logInfo() {},
		logWarn() {},
		logError() {},
		context: { detect: undefined },
		listFileNames: async () => ["a.jpg", "b.jpg"],
		readFile: async (_path, range) => {
			const bytes = new Uint8Array([1, 2, 3, 4, 250])
			if (range === undefined) return bytes
			return bytes.slice(range.start ?? 0, range.end)
		},
		statFile: async () => ({ sizeBytes: 42 }),
		statFiles: async (paths) => paths.map(() => ({ sizeBytes: 42 })),
		sniff: async () => ({
			mime: "image/png",
			ext: ".png",
			kind: "image",
			source: "magic",
		}),
		probe: async () => ({
			kind: "image",
			mime: "image/png",
			width: 10,
			height: 20,
			animated: false,
		}),
		hashBytes: async () => "ab",
		computeImageHashes: async () => undefined,
		listContainer: async () => ({ entries: [] }),
		extractArchive: async () => ({ entries: [] }),
		download: async () => {
			throw new Error("stub: download not configured")
		},
		statAsset: async () => undefined,
		readAsset: async () => new Uint8Array(),
		deleteAsset: async () => ({ existed: false }),
		...overrides,
	}
}

describe("plugin sandbox", () => {
	let sandbox: PluginSandbox | undefined

	afterEach(async () => {
		await sandbox?.disposeAll()
		sandbox = undefined
		vi.restoreAllMocks()
	})

	test("round-trip: hooks run in the worker, API calls bridge back, binary transfers intact", async () => {
		sandbox = createPluginSandbox()
		const plugin = await sandbox.loadPlugin({
			id: "echo",
			mainPath: fixture("echo-plugin.mjs"),
			eager: true,
		})
		expect(plugin).toBeDefined()
		if (plugin === undefined) return

		await expect(plugin.detect(createStubApi())).resolves.toEqual({ ok: true })

		// Uint8Array crosses host→worker via transferable with content intact.
		expect(plugin.sourceMeta).toBeDefined()
		await expect(plugin.sourceMeta?.(createStubApi())).resolves.toEqual({
			bytes: [1, 2, 3, 4, 250],
		})

		// Hook presence mirrors the plugin's actual exports.
		expect(plugin.listFiles).toBeDefined()
		expect(plugin.searchMeta).toBeUndefined()
		expect(plugin.coverLocal).toBeUndefined()
	})

	test("detect payload flows to later hooks via api.context", async () => {
		sandbox = createPluginSandbox()
		const plugin = await sandbox.loadPlugin({
			id: "context",
			mainPath: fixture("context-plugin.mjs"),
			eager: true,
		})
		if (plugin === undefined) throw new Error("plugin load failed")

		// No prior detect in this session: the context is absent.
		await expect(plugin.sourceMeta?.(createStubApi())).resolves.toEqual({
			fromContext: false,
		})

		// A successful detect with a payload seeds the session context —
		// the payload also survives the RPC round-trip.
		await expect(plugin.detect(createStubApi())).resolves.toEqual({
			ok: true,
			files: ["a.jpg", "b.jpg"],
			archive: false,
		})
		await expect(plugin.sourceMeta?.(createStubApi())).resolves.toEqual({
			fromContext: true,
			files: ["a.jpg", "b.jpg"],
			archive: false,
		})
	})

	test("loads a plugin whose path has escaped, spaced and mixed-case segments", async () => {
		// The sandbox spans symlinked roots (macOS /tmp), 8.3 short names
		// (Windows runner temp dirs, e.g. RUNNER~1), spaces and casing —
		// the gate's URL encoding and the fs-read grants must agree with
		// the ESM loader's canonical form for all of them.
		const root = mkdtempSync(join(tmpdir(), "hoardodile Sandbox Space~A-"))
		const pluginDir = join(root, "Plugin")
		mkdirSync(pluginDir, { recursive: true })
		copyFileSync(fixture("echo-plugin.mjs"), join(pluginDir, "main.js"))
		try {
			sandbox = createPluginSandbox()
			const plugin = await sandbox.loadPlugin({
				id: "escaped",
				mainPath: join(pluginDir, "main.js"),
				eager: true,
			})
			if (plugin === undefined) throw new Error("plugin load failed")
			await expect(plugin.detect(createStubApi())).resolves.toEqual({
				ok: true,
			})
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("50 concurrent invocations each keep their own ResourceAPI binding", async () => {
		sandbox = createPluginSandbox()
		const plugin = await sandbox.loadPlugin({
			id: "echo",
			mainPath: fixture("echo-plugin.mjs"),
			eager: true,
		})
		if (plugin?.listFiles === undefined) throw new Error("plugin load failed")
		const { listFiles } = plugin

		const results = await Promise.all(
			Array.from({ length: 50 }, (_, i) =>
				listFiles(createStubApi({ statFile: async () => ({ sizeBytes: i }) })),
			),
		)
		for (let i = 0; i < 50; i++) {
			expect(results[i]).toEqual([String(i)])
		}
	})

	test("non-eager load probes hooks, idles the worker, and respawns on first call", async () => {
		sandbox = createPluginSandbox()
		const plugin = await sandbox.loadPlugin({
			id: "echo-lazy",
			mainPath: fixture("echo-plugin.mjs"),
			eager: false,
		})
		// Hook list is known even though the worker was already idled.
		expect(plugin?.listFiles).toBeDefined()
		expect(plugin?.coverLocal).toBeUndefined()

		await expect(plugin?.detect(createStubApi())).resolves.toEqual({
			ok: true,
		})
	})

	test("unloadPlugin terminates the worker; the next call respawns it", async () => {
		sandbox = createPluginSandbox()
		const plugin = await sandbox.loadPlugin({
			id: "echo",
			mainPath: fixture("echo-plugin.mjs"),
			eager: true,
		})
		if (plugin === undefined) throw new Error("plugin load failed")
		await expect(plugin.detect(createStubApi())).resolves.toEqual({ ok: true })

		sandbox.unloadPlugin("echo")

		await expect(plugin.detect(createStubApi())).resolves.toEqual({ ok: true })
	})

	test("hook exceptions propagate with the plugin's message", async () => {
		sandbox = createPluginSandbox()
		const plugin = await sandbox.loadPlugin({
			id: "thrower",
			mainPath: fixture("thrower-plugin.mjs"),
			eager: true,
		})
		await expect(plugin?.detect(createStubApi())).rejects.toThrow(
			"hook exploded",
		)
	})

	test("host-side API errors reach the plugin as rejections", async () => {
		sandbox = createPluginSandbox()
		const plugin = await sandbox.loadPlugin({
			id: "api-error",
			mainPath: fixture("api-error-plugin.mjs"),
			eager: true,
		})
		const api = createStubApi({
			readFile: async () => {
				throw new Error("no such file")
			},
		})
		await expect(plugin?.detect(api)).resolves.toEqual({
			ok: false,
			reasons: ["api said: no such file"],
		})
	})

	test("plugin logs reach the server console scoped by plugin id", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		sandbox = createPluginSandbox()
		const plugin = await sandbox.loadPlugin({
			id: "logger",
			mainPath: fixture("logging-plugin.mjs"),
			eager: true,
		})
		await expect(plugin?.detect(createStubApi())).resolves.toEqual({
			ok: true,
		})
		expect(logSpy).toHaveBeenCalledWith("[plugin:logger] hello", { i: 1 })
		expect(warnSpy).toHaveBeenCalledWith("[plugin:logger] careful")
		expect(errorSpy).toHaveBeenCalledWith("[plugin:logger] bad news")
	})

	test("byte-range arguments cross the RPC boundary", async () => {
		sandbox = createPluginSandbox()
		const plugin = await sandbox.loadPlugin({
			id: "range",
			mainPath: fixture("range-plugin.mjs"),
			eager: true,
		})
		await expect(plugin?.sourceMeta?.(createStubApi())).resolves.toEqual({
			bytes: [2, 3, 4],
		})
	})

	test("watchdog kills a spinning plugin without stalling the host", async () => {
		sandbox = createPluginSandbox(fastConfig())
		const plugin = await sandbox.loadPlugin({
			id: "spin",
			mainPath: fixture("spin-plugin.mjs"),
			eager: true,
		})
		await expect(plugin?.detect(createStubApi())).rejects.toThrow(
			/no activity/i,
		)
		// The sandbox itself stays usable afterwards.
		const ok = await sandbox.loadPlugin({
			id: "echo",
			mainPath: fixture("echo-plugin.mjs"),
			eager: true,
		})
		await expect(ok?.detect(createStubApi())).resolves.toEqual({ ok: true })
	})

	test("watchdog does not fire while the hook keeps calling the API", async () => {
		sandbox = createPluginSandbox(fastConfig({ watchdogMs: 250 }))
		const plugin = await sandbox.loadPlugin({
			id: "chatty",
			mainPath: fixture("chatty-plugin.mjs"),
			eager: true,
		})
		// Runs ~500ms with constant API activity — longer than the watchdog.
		await expect(plugin?.detect(createStubApi())).resolves.toEqual({
			ok: true,
		})
	})

	test("watchdog tolerates a host-side API call slower than the activity window", async () => {
		sandbox = createPluginSandbox(fastConfig({ watchdogMs: 250 }))
		const plugin = await sandbox.loadPlugin({
			id: "slow-api",
			mainPath: fixture("slow-api-plugin.mjs"),
			eager: true,
		})
		const api = createStubApi({
			readFile: async () => {
				// Host work outlasts the watchdog with zero worker-side activity.
				await new Promise((resolve) => setTimeout(resolve, 500))
				return new Uint8Array([1])
			},
		})
		await expect(plugin?.detect(api)).resolves.toEqual({ ok: true })
	})

	test("hard timeout stops a hook that stays active but never returns", async () => {
		sandbox = createPluginSandbox(
			fastConfig({ watchdogMs: 250, hardTimeoutMs: 600 }),
		)
		const plugin = await sandbox.loadPlugin({
			id: "stuck",
			mainPath: fixture("stuck-plugin.mjs"),
			eager: true,
		})
		await expect(plugin?.detect(createStubApi())).rejects.toThrow(
			/hard timeout/i,
		)
	})

	test("a plugin that throws at import time yields undefined (failing semantics)", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		sandbox = createPluginSandbox()
		await expect(
			sandbox.loadPlugin({
				id: "crash",
				mainPath: fixture("crash-plugin.mjs"),
				eager: true,
			}),
		).resolves.toBeUndefined()
	})

	test("a worker that exits rejects pending calls; subsequent calls respawn", async () => {
		sandbox = createPluginSandbox(fastConfig())
		const plugin = await sandbox.loadPlugin({
			id: "exit",
			mainPath: fixture("exit-plugin.mjs"),
			eager: true,
		})
		if (plugin === undefined) throw new Error("plugin load failed")
		await expect(plugin.detect(createStubApi())).rejects.toThrow(/exited/i)
		// The worker respawns lazily and repeats the behaviour — no wedge.
		await expect(plugin.detect(createStubApi())).rejects.toThrow(/exited/i)
	})

	test("respawn limiting degrades a repeatedly crashing plugin", async () => {
		sandbox = createPluginSandbox(fastConfig({ maxRespawns: 2 }))
		const plugin = await sandbox.loadPlugin({
			id: "exit",
			mainPath: fixture("exit-plugin.mjs"),
			eager: true,
		})
		if (plugin === undefined) throw new Error("plugin load failed")
		await expect(plugin.detect(createStubApi())).rejects.toThrow(/exited/i)
		// Second spawn is still within budget and crashes again.
		await expect(plugin.detect(createStubApi())).rejects.toThrow(/exited/i)
		// Budget exhausted — the plugin is degraded while the window is open.
		await expect(plugin.detect(createStubApi())).rejects.toThrow(/unavailable/i)
	})

	test("a degraded plugin recovers once the crash window slides clean", async () => {
		// Pin the clock — crash timing must not depend on machine load.
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000)
		sandbox = createPluginSandbox(
			fastConfig({ maxRespawns: 2, respawnWindowMs: 300 }),
		)
		const plugin = await sandbox.loadPlugin({
			id: "exit",
			mainPath: fixture("exit-plugin.mjs"),
			eager: true,
		})
		if (plugin === undefined) throw new Error("plugin load failed")
		await expect(plugin.detect(createStubApi())).rejects.toThrow(/exited/i)
		await expect(plugin.detect(createStubApi())).rejects.toThrow(/exited/i)
		await expect(plugin.detect(createStubApi())).rejects.toThrow(/unavailable/i)
		// The window slides clean — the next call gets a fresh worker again.
		nowSpy.mockReturnValue(1_000_000 + 301)
		await expect(plugin.detect(createStubApi())).rejects.toThrow(/exited/i)
	})

	// -- capability boundary --

	test("static node: imports are denied by the module policy — load fails closed", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		sandbox = createPluginSandbox()
		await expect(
			sandbox.loadPlugin({
				id: "hostile",
				mainPath: fixture("hostile-plugin.mjs"),
				eager: true,
			}),
		).resolves.toBeUndefined()
	})

	test("computed dynamic node: imports are denied inside a hook", async () => {
		sandbox = createPluginSandbox()
		const plugin = await sandbox.loadPlugin({
			id: "hostile-dynamic",
			mainPath: fixture("hostile-dynamic-plugin.mjs"),
			eager: true,
		})
		if (plugin === undefined) throw new Error("plugin load failed")
		await expect(plugin.detect(createStubApi())).rejects.toThrow(
			/denied by policy/,
		)
	})

	test("the fetch global is scrubbed inside the sandbox", async () => {
		sandbox = createPluginSandbox()
		const plugin = await sandbox.loadPlugin({
			id: "fetch",
			mainPath: fixture("fetch-plugin.mjs"),
			eager: true,
		})
		if (plugin === undefined) throw new Error("plugin load failed")
		await expect(plugin.detect(createStubApi())).rejects.toThrow(
			/fetch is disabled/i,
		)
	})

	test("oversized hook results are rejected instead of cloned into the host", async () => {
		sandbox = createPluginSandbox(fastConfig({ maxResultBytes: 1024 }))
		const plugin = await sandbox.loadPlugin({
			id: "huge",
			mainPath: fixture("huge-result-plugin.mjs"),
			eager: true,
		})
		if (plugin === undefined) throw new Error("plugin load failed")
		await expect(plugin.detect(createStubApi())).rejects.toThrow(/exceeds/)
	})

	test("an unknown permission flag fails closed: plugins refuse to load", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		sandbox = createPluginSandbox({
			...DEFAULT_SANDBOX_CONFIG,
			permissionFlag: "--definitely-not-a-permission-flag",
		})
		await expect(
			sandbox.loadPlugin({
				id: "noline",
				mainPath: fixture("echo-plugin.mjs"),
				eager: true,
			}),
		).resolves.toBeUndefined()
	})

	test("a plugin dir whose path contains spaces loads and runs", async () => {
		const dir = mkdtempSync(join(tmpdir(), "hoardodile sandbox space "))
		copyFileSync(fixture("echo-plugin.mjs"), join(dir, "main.js"))
		sandbox = createPluginSandbox()
		const plugin = await sandbox.loadPlugin({
			id: "spacey",
			mainPath: join(dir, "main.js"),
			eager: true,
		})
		if (plugin === undefined) throw new Error("plugin load failed")
		await expect(plugin.detect(createStubApi())).resolves.toEqual({ ok: true })
	})

	test("the default budgets are exported and wired into the config", () => {
		expect(DEFAULT_SANDBOX_CONFIG.maxResultBytes).toBe(PLUGIN_MAX_RESULT_BYTES)
		expect(PLUGIN_MAX_RESULT_BYTES).toBe(256 * 1024 * 1024)
		expect(DEFAULT_SANDBOX_CONFIG.maxLogsPerHook).toBe(PLUGIN_MAX_LOGS_PER_HOOK)
		expect(DEFAULT_SANDBOX_CONFIG.maxApiCallsPerHook).toBe(
			PLUGIN_MAX_API_CALLS_PER_HOOK,
		)
	})

	test("container API methods are denied without the manifest permission", async () => {
		sandbox = createPluginSandbox()
		const plugin = await sandbox.loadPlugin({
			id: "container-denied",
			mainPath: fixture("container-plugin.mjs"),
			eager: true,
			permissions: noPermissions(),
		})
		if (plugin === undefined) throw new Error("plugin load failed")
		await expect(plugin.detect(createStubApi())).rejects.toThrow(
			/container permission denied/,
		)
	})

	test("container API methods run when the manifest grants it", async () => {
		sandbox = createPluginSandbox()
		const plugin = await sandbox.loadPlugin({
			id: "container-allowed",
			mainPath: fixture("container-plugin.mjs"),
			eager: true,
			permissions: containerPermissions(),
		})
		if (plugin === undefined) throw new Error("plugin load failed")
		await expect(plugin.detect(createStubApi())).resolves.toEqual({
			ok: true,
			entries: 0,
		})
	})

	test("asset API methods are denied without the manifest download permission", async () => {
		sandbox = createPluginSandbox()
		const plugin = await sandbox.loadPlugin({
			id: "asset-denied",
			mainPath: fixture("asset-plugin.mjs"),
			eager: true,
			permissions: noPermissions(),
		})
		if (plugin === undefined) throw new Error("plugin load failed")
		await expect(plugin.detect(createStubApi())).rejects.toThrow(
			/download permission denied/,
		)
	})

	test("asset API methods route to the wired handler with the owning plugin id", async () => {
		const seen: unknown[] = []
		sandbox = createPluginSandbox(
			fastConfig({
				pluginAssets: {
					download: async (pluginId, request) => {
						seen.push([pluginId, request])
						const requests = Array.isArray(request) ? request : [request]
						return requests.map((req) => ({
							path: req.dest,
							sizeBytes: 3,
							sha256: "a".repeat(64),
							cached: false,
						}))
					},
					statAsset: async (pluginId, path) => {
						seen.push([pluginId, path])
						return undefined
					},
					readAsset: async () => new Uint8Array([1]),
					deleteAsset: async () => ({ existed: true }),
				},
			}),
		)
		const plugin = await sandbox.loadPlugin({
			id: "asset-allowed",
			mainPath: fixture("asset-plugin.mjs"),
			eager: true,
			permissions: downloadPermissions(),
		})
		if (plugin === undefined) throw new Error("plugin load failed")
		await expect(plugin.detect(createStubApi())).resolves.toEqual({
			ok: true,
			stat: undefined,
			// Single in → single result out, batch in → array out.
			downloaded: {
				path: "runtime/a.mjs",
				sizeBytes: 3,
				sha256: "a".repeat(64),
				cached: false,
			},
			batched: [
				{
					path: "runtime/b.mjs",
					sizeBytes: 3,
					sha256: "a".repeat(64),
					cached: false,
				},
				{
					path: "runtime/c.mjs",
					sizeBytes: 3,
					sha256: "a".repeat(64),
					cached: false,
				},
			],
		})
		expect(seen[0]).toEqual(["asset-allowed", "runtime/a.mjs"])
		expect(seen[1]).toEqual([
			"asset-allowed",
			{
				url: "https://example.com/runtime/a.mjs",
				dest: "runtime/a.mjs",
			},
		])
		expect(seen[2]).toEqual([
			"asset-allowed",
			[
				{ url: "https://example.com/runtime/b.mjs", dest: "runtime/b.mjs" },
				{ url: "https://example.com/runtime/c.mjs", dest: "runtime/c.mjs" },
			],
		])
	})

	test("a log flood exceeds the per-hook budget and fails the hook", async () => {
		sandbox = createPluginSandbox(fastConfig({ maxLogsPerHook: 10 }))
		const plugin = await sandbox.loadPlugin({
			id: "flood-log",
			mainPath: fixture("flood-log-plugin.mjs"),
			eager: true,
		})
		if (plugin === undefined) throw new Error("plugin load failed")
		await expect(plugin.detect(createStubApi())).rejects.toThrow(
			/log budget exceeded/,
		)
	})

	test("an API-call flood exceeds the per-hook budget and fails the hook", async () => {
		sandbox = createPluginSandbox(fastConfig({ maxApiCallsPerHook: 10 }))
		const plugin = await sandbox.loadPlugin({
			id: "flood-api",
			mainPath: fixture("flood-api-plugin.mjs"),
			eager: true,
		})
		if (plugin === undefined) throw new Error("plugin load failed")
		await expect(plugin.detect(createStubApi())).rejects.toThrow(
			/API call budget exceeded/,
		)
	})
})
