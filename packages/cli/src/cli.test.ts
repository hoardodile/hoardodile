import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createPluginSandbox, DEFAULT_SANDBOX_CONFIG } from "@hoardodile/host"
import { afterEach, describe, expect, test } from "vitest"
import {
	compareBaseline,
	loadBaseline,
	machineInfo,
	writeReport,
} from "./bench.ts"
import { createCliHooks, resolvePluginTarget, runCliHook } from "./runner.ts"

const PLUGIN_ID = "22222222-2222-4222-8222-222222222222"

const roots: string[] = []

function makePluginDir(): string {
	const root = mkdtempSync(join(tmpdir(), "cli-test-"))
	roots.push(root)
	const pluginDir = join(root, "plugin")
	mkdirSync(pluginDir, { recursive: true })
	writeFileSync(
		join(pluginDir, "main.js"),
		readFileSync(
			fileURLToPath(new URL("./fixtures/echo-plugin.mjs", import.meta.url)),
			"utf-8",
		),
	)
	writeFileSync(
		join(pluginDir, "manifest.json"),
		JSON.stringify({
			id: PLUGIN_ID,
			name: "Echo Fixture",
			description: "CLI test fixture",
			version: "0.0.1",
			permissions: {
				sourceMeta: true,
				searchMeta: false,
				danmaku: false,
				message: false,
			},
		}),
	)
	const dataDir = join(root, "data")
	mkdirSync(dataDir, { recursive: true })
	writeFileSync(join(dataDir, "blob.bin"), Buffer.from([1, 2, 3, 4, 250]))
	return root
}

afterEach(() => {
	for (const root of roots) {
		rmSync(root, { recursive: true, force: true })
	}
	roots.length = 0
})

describe("resolvePluginTarget", () => {
	test("resolves a plugin dir with manifest and main.js", () => {
		const root = makePluginDir()
		const target = resolvePluginTarget({
			pluginDir: join(root, "plugin"),
		})
		expect(target.id).toBe(PLUGIN_ID)
		expect(target.manifest.name).toBe("Echo Fixture")
		expect(target.mainPath.endsWith("main.js")).toBe(true)
	})

	test("falls back to a permissionless manifest without manifest.json", () => {
		const root = makePluginDir()
		rmSync(join(root, "plugin", "manifest.json"))
		const target = resolvePluginTarget({
			pluginDir: join(root, "plugin"),
		})
		expect(target.manifest.permissions).toEqual({
			sourceMeta: false,
			searchMeta: false,
			danmaku: false,
			message: false,
			imageHashes: false,
		})
	})

	test("rejects a missing main.js", () => {
		expect(() =>
			resolvePluginTarget({ pluginDir: join(tmpdir(), "nope") }),
		).toThrow(/main\.js not found/)
	})
})

describe("runCliHook through the worker sandbox", () => {
	test("detect, sourceMeta and listFiles run via the strategy facade", async () => {
		const root = makePluginDir()
		const target = resolvePluginTarget({
			pluginDir: join(root, "plugin"),
		})
		const sandbox = createPluginSandbox(DEFAULT_SANDBOX_CONFIG)
		try {
			const hooks = await createCliHooks(target, sandbox)

			const detect = await runCliHook({
				id: target.id,
				hooks,
				hook: "detect",
				dir: join(root, "data"),
			})
			expect(detect.ok).toBe(true)
			expect(detect.result).toEqual({ ok: true })

			const sourceMeta = await runCliHook({
				id: target.id,
				hooks,
				hook: "sourceMeta",
				dir: join(root, "data"),
			})
			expect(sourceMeta.result).toEqual({ bytes: [1, 2, 3, 4, 250] })

			const listFiles = await runCliHook({
				id: target.id,
				hooks,
				hook: "listFiles",
				dir: join(root, "data"),
			})
			// statFile("id") misses → the echo fixture reports -1, matching
			// the server's directory-API behavior.
			expect(listFiles.result).toEqual(["-1"])
		} finally {
			await sandbox.disposeAll()
		}
	})

	test("sourceMeta is gated by manifest permissions", async () => {
		const root = makePluginDir()
		const pluginDir = join(root, "plugin")
		writeFileSync(
			join(pluginDir, "manifest.json"),
			JSON.stringify({
				id: PLUGIN_ID,
				name: "Echo Fixture",
				description: "CLI test fixture",
				version: "0.0.1",
				permissions: {
					sourceMeta: false,
					searchMeta: false,
					danmaku: false,
					message: false,
				},
			}),
		)
		const target = resolvePluginTarget({ pluginDir })
		const sandbox = createPluginSandbox(DEFAULT_SANDBOX_CONFIG)
		try {
			const hooks = await createCliHooks(target, sandbox)
			const sourceMeta = await runCliHook({
				id: target.id,
				hooks,
				hook: "sourceMeta",
				dir: join(root, "data"),
			})
			// Capability gating: the permissionless manifest denies the hook.
			expect(sourceMeta.result).toBeUndefined()
		} finally {
			await sandbox.disposeAll()
		}
	})
})

describe("bench comparison", () => {
	function makeReport(medianMs: number) {
		return {
			schema: 1 as const,
			kind: "plugin-hook" as const,
			timestamp: new Date().toISOString(),
			config: {
				pluginId: PLUGIN_ID,
				hook: "detect" as const,
				dir: "d",
				repeat: 1,
				warmupRuns: 1,
			},
			machine: machineInfo(),
			caveats: [],
			memoryPeakMb: 1,
			samplesMs: [medianMs],
			stats: {
				medianMs,
				meanMs: medianMs,
				p95Ms: medianMs,
				minMs: medianMs,
				maxMs: medianMs,
			},
		}
	}

	test("compares medians and flags regression past the threshold", () => {
		const report = makeReport(12)
		const baseline = makeReport(10)
		const ok = compareBaseline(report, baseline, 20)
		expect(ok.regressed).toBe(false)
		const bad = compareBaseline(report, makeReport(5), 20)
		expect(bad.regressed).toBe(true)
		expect(bad.message).toMatch(/same machine and environment/)
	})

	test("round-trips a report through loadBaseline", () => {
		const root = makePluginDir()
		const path = join(root, "baseline.json")
		const report = makeReport(3.5)
		report.config.repeat = 2
		report.samplesMs = [3, 4]
		report.stats = {
			medianMs: 3.5,
			meanMs: 3.5,
			p95Ms: 4,
			minMs: 3,
			maxMs: 4,
		}
		writeReport(path, report)
		expect(loadBaseline(path)).toEqual(report)
		expect(() => loadBaseline(join(root, "missing.json"))).toThrow(
			/cannot read baseline/,
		)
	})
})
