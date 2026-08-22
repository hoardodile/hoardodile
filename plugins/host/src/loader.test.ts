import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginManifest } from "@hoardodile/sdk-types"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createPluginLoader } from "./loader.ts"
import type { PluginSandbox } from "./sandbox/host.ts"
import type { PluginSettingsStore } from "./settings-store.ts"

const SHARED_ID = "11111111-1111-4111-8111-111111111111"

/** Empty settings store — these tests never record plugin settings. */
function createTestSettingsStore(): PluginSettingsStore {
	return {
		get: () => undefined,
		all: () => [],
	}
}

function writePluginDir(dir: string, manifest: PluginManifest): void {
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest))
}

function buildManifest(
	overrides: Partial<PluginManifest> = {},
): PluginManifest {
	return {
		id: SHARED_ID,
		name: "Test Plugin",
		description: "Loader test fixture",
		version: "1.0.0",
		permissions: {
			sourceMeta: false,
			searchMeta: false,
			danmaku: false,
			message: false,
			imageHashes: false,
		},
		...overrides,
	}
}

describe("plugin loader: dev plugin overrides same-id disk plugin", () => {
	let root: string
	let pluginsDir: string
	let devDir: string
	let consoleWarnSpy: ReturnType<typeof vi.spyOn> | undefined
	let consoleInfoSpy: ReturnType<typeof vi.spyOn> | undefined

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-plugin-loader-"))
		pluginsDir = join(root, "plugins")
		devDir = join(root, "dev")
		mkdirSync(pluginsDir, { recursive: true })
		consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
	})

	afterEach(() => {
		consoleWarnSpy?.mockRestore()
		consoleInfoSpy?.mockRestore()
		rmSync(root, { recursive: true, force: true })
	})

	test("only the dev entry survives, disk entry is skipped with a warning", async () => {
		writePluginDir(join(pluginsDir, "shared"), buildManifest())
		writePluginDir(devDir, buildManifest())

		const loader = createPluginLoader({
			pluginsDir,
			devPluginDirs: [devDir],
			settings: createTestSettingsStore(),
		})
		const registry = await loader.loadAll()

		const matching = registry.getAll().filter((e) => e.id === SHARED_ID)
		expect(matching).toHaveLength(1)
		expect(matching[0]?.dev).toBe(true)
		expect(matching[0]?.diskPath).toBe(devDir)

		const skipLogs = consoleWarnSpy?.mock.calls.filter((args: unknown[]) => {
			const first = args[0]
			return (
				typeof first === "string" &&
				first.includes("skipping disk plugin") &&
				first.includes(SHARED_ID)
			)
		})
		expect(skipLogs).toHaveLength(1)
	})

	test("disk entry loads when no dev plugin overrides it", async () => {
		writePluginDir(join(pluginsDir, "shared"), buildManifest())

		const loader = createPluginLoader({
			pluginsDir,
			settings: createTestSettingsStore(),
		})
		const registry = await loader.loadAll()

		const matching = registry.getAll().filter((e) => e.id === SHARED_ID)
		expect(matching).toHaveLength(1)
		expect(matching[0]?.dev).toBe(false)
		expect(matching[0]?.diskPath).toBe(join(pluginsDir, "shared"))
	})

	test("dev plugins are ignored when disableDevPlugins is true", async () => {
		writePluginDir(join(pluginsDir, "shared"), buildManifest())
		writePluginDir(devDir, buildManifest({ name: "Dev Override" }))

		const loader = createPluginLoader({
			pluginsDir,
			devPluginDirs: [devDir],
			disableDevPlugins: true,
			settings: createTestSettingsStore(),
		})
		const registry = await loader.loadAll()

		const matching = registry.getAll().filter((e) => e.id === SHARED_ID)
		expect(matching).toHaveLength(1)
		expect(matching[0]?.dev).toBe(false)
		expect(matching[0]?.diskPath).toBe(join(pluginsDir, "shared"))
	})

	test("manifest with ui.card loads and parses slot templates", async () => {
		writePluginDir(
			join(pluginsDir, "card"),
			buildManifest({
				id: "22222222-2222-4222-8222-222222222222",
				ui: {
					card: {
						image: {
							br: ["{{bytes(file.sizeBytes)}}"],
							bl: ["{{source.width}}×{{source.height}}"],
						},
						video: {
							br: ["{{bytes(file.sizeBytes)}}"],
							tl: ["▶ {{duration(source.durationMs)}}"],
						},
						audio: {
							br: ["{{bytes(file.sizeBytes)}}"],
						},
					},
				},
			}),
		)

		const loader = createPluginLoader({
			pluginsDir,
			settings: createTestSettingsStore(),
		})
		const registry = await loader.loadAll()

		const entry = registry.getById("22222222-2222-4222-8222-222222222222")
		expect(entry).toBeDefined()
		expect(entry?.manifest.ui?.card?.image?.br).toEqual([
			"{{bytes(file.sizeBytes)}}",
		])
		expect(entry?.manifest.ui?.card?.video?.tl).toEqual([
			"▶ {{duration(source.durationMs)}}",
		])
	})

	test("manifest with invalid ui.card kind strips unknown keys", async () => {
		writePluginDir(
			join(pluginsDir, "bad"),
			buildManifest({
				id: "33333333-3333-4333-8333-333333333333",
				ui: {
					card: {
						// @ts-expect-error — injecting an invalid kind for testing
						invalidKind: {
							br: ["bad"],
						},
					},
				},
			}),
		)

		const loader = createPluginLoader({
			pluginsDir,
			settings: createTestSettingsStore(),
		})
		const registry = await loader.loadAll()

		const entry = registry.getById("33333333-3333-4333-8333-333333333333")
		expect(entry).toBeDefined()
		// Zod strips unknown keys during parse, so invalidKind is discarded.
		expect(
			// @ts-expect-error — accessing a stripped key
			entry?.manifest.ui?.card?.invalidKind,
		).toBeUndefined()
	})
})

describe("plugin loader: plugin seeding", () => {
	let root: string
	let pluginsDir: string
	let seedDir: string
	let consoleWarnSpy: ReturnType<typeof vi.spyOn> | undefined
	let consoleInfoSpy: ReturnType<typeof vi.spyOn> | undefined

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-plugin-seed-"))
		pluginsDir = join(root, "plugins")
		seedDir = join(root, "seed")
		mkdirSync(pluginsDir, { recursive: true })
		consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
	})

	afterEach(() => {
		consoleWarnSpy?.mockRestore()
		consoleInfoSpy?.mockRestore()
		rmSync(root, { recursive: true, force: true })
	})

	test("each seed directory is copied into pluginsDir under its manifest id", async () => {
		const firstId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
		const secondId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
		writePluginDir(join(seedDir, "first"), buildManifest({ id: firstId }))
		writePluginDir(join(seedDir, "second"), buildManifest({ id: secondId }))

		const loader = createPluginLoader({
			pluginsDir,
			seedPluginDirs: [join(seedDir, "first"), join(seedDir, "second")],
			settings: createTestSettingsStore(),
		})
		const registry = await loader.loadAll()

		expect(registry.getById(firstId)?.diskPath).toBe(join(pluginsDir, firstId))
		expect(registry.getById(secondId)?.diskPath).toBe(
			join(pluginsDir, secondId),
		)
		expect(existsSync(join(pluginsDir, firstId, "manifest.json"))).toBe(true)
	})

	test("seed replaces an existing installed copy", async () => {
		writePluginDir(join(pluginsDir, SHARED_ID), buildManifest({ name: "old" }))
		writePluginDir(join(seedDir, "plugin"), buildManifest({ name: "new" }))

		const loader = createPluginLoader({
			pluginsDir,
			seedPluginDirs: [join(seedDir, "plugin")],
			settings: createTestSettingsStore(),
		})
		await loader.loadAll()

		const seeded = readFileSync(
			join(pluginsDir, SHARED_ID, "manifest.json"),
			"utf-8",
		)
		expect(JSON.parse(seeded).name).toBe("new")
	})

	test("dev plugin still overrides its seeded disk copy", async () => {
		const devDir = join(root, "dev")
		writePluginDir(join(seedDir, "plugin"), buildManifest({ name: "disk" }))
		writePluginDir(devDir, buildManifest({ name: "dev" }))

		const loader = createPluginLoader({
			pluginsDir,
			devPluginDirs: [devDir],
			seedPluginDirs: [join(seedDir, "plugin")],
			settings: createTestSettingsStore(),
		})
		const registry = await loader.loadAll()

		const matching = registry.getAll().filter((e) => e.id === SHARED_ID)
		expect(matching).toHaveLength(1)
		expect(matching[0]?.dev).toBe(true)
		expect(matching[0]?.diskPath).toBe(devDir)
	})

	test("invalid seed directories are skipped", async () => {
		const loader = createPluginLoader({
			pluginsDir,
			seedPluginDirs: [join(root, "missing"), join(root, "invalid")],
			settings: createTestSettingsStore(),
		})
		const registry = await loader.loadAll()

		expect(registry.getAll()).toEqual([])
		expect(readdirSync(pluginsDir)).toEqual([])
	})
})

describe("plugin loader: same-id dedupe", () => {
	let root: string
	let pluginsDir: string
	let consoleWarnSpy: ReturnType<typeof vi.spyOn> | undefined

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-plugin-dedupe-"))
		pluginsDir = join(root, "plugins")
		mkdirSync(pluginsDir, { recursive: true })
		consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
	})

	afterEach(() => {
		consoleWarnSpy?.mockRestore()
		rmSync(root, { recursive: true, force: true })
	})

	test("two dev dirs with the same id: only the last one survives", async () => {
		const devA = join(root, "dev-a")
		const devB = join(root, "dev-b")
		writePluginDir(devA, buildManifest({ name: "A" }))
		writePluginDir(devB, buildManifest({ name: "B" }))

		const loader = createPluginLoader({
			pluginsDir,
			devPluginDirs: [devA, devB],
			settings: createTestSettingsStore(),
		})
		const registry = await loader.loadAll()

		// One entry per id everywhere — the last dev dir wins.
		expect(registry.getAll().filter((e) => e.id === SHARED_ID)).toHaveLength(1)
		expect(registry.getById(SHARED_ID)?.diskPath).toBe(devB)
		expect(registry.getEnabled()).toHaveLength(1)
	})

	test("a disk copy of the builtin plugin id is skipped", async () => {
		const builtinDir = join(root, "builtin")
		writePluginDir(builtinDir, buildManifest({ name: "Builtin" }))
		writePluginDir(join(pluginsDir, "copy"), buildManifest({ name: "Copy" }))

		const loader = createPluginLoader({
			builtinDir,
			pluginsDir,
			settings: createTestSettingsStore(),
		})
		const registry = await loader.loadAll()

		expect(registry.getAll().filter((e) => e.id === SHARED_ID)).toHaveLength(1)
		expect(registry.getBuiltin()?.id).toBe(SHARED_ID)
		expect(registry.getBuiltin()?.builtin).toBe(true)
		expect(registry.getBuiltin()?.diskPath).toBe(builtinDir)
	})

	test("two disk dirs with the same id: only the first survives", async () => {
		writePluginDir(join(pluginsDir, "first"), buildManifest({ name: "First" }))
		writePluginDir(
			join(pluginsDir, "second"),
			buildManifest({ name: "Second" }),
		)

		const loader = createPluginLoader({
			pluginsDir,
			settings: createTestSettingsStore(),
		})
		const registry = await loader.loadAll()

		expect(registry.getAll().filter((e) => e.id === SHARED_ID)).toHaveLength(1)
		expect(registry.getById(SHARED_ID)?.diskPath).toBe(
			join(pluginsDir, "first"),
		)
	})

	test("a later loadAll after a broken builtin degrades without stranding the registry", async () => {
		const builtinDir = join(root, "builtin")
		writePluginDir(builtinDir, buildManifest({ name: "Builtin" }))

		const loader = createPluginLoader({
			builtinDir,
			pluginsDir,
			settings: createTestSettingsStore(),
		})
		const first = await loader.loadAll()
		expect(first.getBuiltin()?.id).toBe(SHARED_ID)

		// The builtin directory disappears mid-session: the FIRST load at
		// boot fails fast (config error), but a later rescan must not throw
		// — it degrades to a registry without the builtin.
		rmSync(builtinDir, { recursive: true, force: true })
		const second = await loader.rescan()
		expect(second.getBuiltin()).toBeUndefined()
		expect(second).not.toBe(first)
	})
})

describe("plugin loader: loadAll serialization", () => {
	let root: string
	let consoleLogSpy: ReturnType<typeof vi.spyOn> | undefined

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-plugin-loader-"))
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
	})

	afterEach(() => {
		consoleLogSpy?.mockRestore()
		rmSync(root, { recursive: true, force: true })
	})

	test("concurrent loadAll calls never interleave sandbox teardown", async () => {
		const log: string[] = []
		const sandbox: PluginSandbox = {
			loadPlugin: async () => undefined,
			unloadPlugin: () => {},
			disposeExcept: async (keepIds) => {
				log.push("dispose:start")
				await new Promise((resolve) => setTimeout(resolve, 10))
				log.push(`dispose:end:${[...keepIds].length}`)
			},
			disposeAll: async () => {},
		}
		const loader = createPluginLoader({
			pluginsDir: join(root, "plugins"),
			settings: createTestSettingsStore(),
			sandbox,
		})

		const [first, second] = await Promise.all([
			loader.loadAll(),
			loader.loadAll(),
		])
		expect(first).toBeDefined()
		expect(loader.getRegistry()).toBe(second)

		// Every teardown must complete before the next run starts one.
		const starts = log.flatMap((event, i) =>
			event === "dispose:start" ? [i] : [],
		)
		expect(starts).toHaveLength(2)
		for (const i of starts) {
			expect(log[i + 1]).toMatch(/^dispose:end:/)
		}
	})
})
