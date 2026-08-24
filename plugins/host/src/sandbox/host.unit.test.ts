import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { ResourceAPI } from "../types.ts"
import {
	createPluginSandbox,
	DEFAULT_SANDBOX_CONFIG,
	type PluginSandbox,
	type PluginSandboxConfig,
} from "./host.ts"

/**
 * Deterministic lifecycle tests: a scripted fake ChildProcess lets us hit
 * race windows (stale messages, concurrent loads) that real forked
 * processes only reproduce flakily. Only this file sees the mock — the
 * real `spawn` probe answers the first permission-flag candidate so the
 * sandbox never actually starts a process here.
 */
const mocks = vi.hoisted(() => {
	class FakeChild {
		static instances: FakeChild[] = []
		private readonly listeners = new Map<
			string,
			((...args: unknown[]) => void)[]
		>()
		readonly sent: unknown[] = []
		readonly args: unknown[]
		killed = false

		constructor(...args: unknown[]) {
			this.args = args
			FakeChild.instances.push(this)
		}

		on(event: string, fn: (...args: unknown[]) => void): this {
			const list = this.listeners.get(event) ?? []
			list.push(fn)
			this.listeners.set(event, list)
			return this
		}

		emit(event: string, ...args: unknown[]): void {
			for (const fn of this.listeners.get(event) ?? []) fn(...args)
		}

		send(msg: unknown): void {
			this.sent.push(msg)
		}

		kill(): void {
			this.killed = true
		}

		ref(): this {
			return this
		}

		unref(): this {
			return this
		}
	}
	return { FakeChild }
})

vi.mock("node:child_process", () => ({
	fork: (...args: unknown[]) => new mocks.FakeChild(...args),
	spawn: (...args: unknown[]) => {
		const child = new mocks.FakeChild(...args)
		// The permission-flag probe resolves as soon as the listeners are
		// attached — report the first candidate as accepted.
		queueMicrotask(() => child.emit("exit", 0))
		return child
	},
}))

function unitConfig(overrides: Partial<PluginSandboxConfig> = {}) {
	return {
		...DEFAULT_SANDBOX_CONFIG,
		...overrides,
	} satisfies PluginSandboxConfig
}

function lastChild(): InstanceType<typeof mocks.FakeChild> {
	const child = mocks.FakeChild.instances.at(-1)
	if (child === undefined) throw new Error("no sandbox child spawned")
	return child
}

function createStubApi(overrides: Partial<ResourceAPI> = {}): ResourceAPI {
	return {
		logInfo() {},
		logWarn() {},
		logError() {},
		context: { detect: undefined },
		listFileNames: async () => [],
		readFile: async () => new Uint8Array(),
		statFile: async () => ({ sizeBytes: 0 }),
		statFiles: async (paths) => paths.map(() => ({ sizeBytes: 0 })),
		sniff: async () => undefined,
		probe: async () => ({ kind: "unknown", reason: "unavailable" }),
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

/** Flush microtasks and pending macrotasks. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("plugin sandbox lifecycle (fake child process)", () => {
	let sandbox: PluginSandbox | undefined

	beforeEach(() => {
		mocks.FakeChild.instances.length = 0
	})

	afterEach(async () => {
		await sandbox?.disposeAll()
		sandbox = undefined
		vi.restoreAllMocks()
	})

	test("a plugin that fails to load has its sandbox child terminated", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		sandbox = createPluginSandbox(unitConfig())
		const load = sandbox.loadPlugin({
			id: "bad",
			mainPath: "/plugins/bad/main.js",
			eager: true,
		})
		// The fork happens after the (mocked) permission-flag probe settles.
		await flush()
		const child = lastChild()
		child.emit("message", {
			type: "loaded",
			ok: false,
			error: { name: "Error", message: "import exploded" },
		})
		await expect(load).resolves.toBeUndefined()
		expect(child.killed).toBe(true)
	})

	test("messages from a stale child are ignored", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		sandbox = createPluginSandbox(unitConfig())
		// Unload mid-load: the first child's waiter rejects, load returns
		// undefined, and the child is terminated.
		const first = sandbox.loadPlugin({
			id: "p",
			mainPath: "/p/main.js",
			eager: true,
		})
		await flush()
		const stale = lastChild()
		sandbox.unloadPlugin("p")
		await expect(first).resolves.toBeUndefined()
		expect(stale.killed).toBe(true)

		// Respawn for the same id.
		const second = sandbox.loadPlugin({
			id: "p",
			mainPath: "/p/main.js",
			eager: true,
		})
		await flush()
		const current = lastChild()
		expect(current).not.toBe(stale)

		// The stale child's late "loaded" must not resolve the new spawn's
		// load waiter — the second load stays pending until ITS child loads.
		let secondSettled = false
		void second.then(() => {
			secondSettled = true
		})
		stale.emit("message", { type: "loaded", ok: true, hooks: ["detect"] })
		await flush()
		expect(secondSettled).toBe(false)

		current.emit("message", { type: "loaded", ok: true, hooks: ["detect"] })
		const plugin = await second
		if (plugin === undefined) throw new Error("plugin load failed")

		// A stale "result" must not resolve a pending call on the new child.
		const detect = plugin.detect(createStubApi())
		// Let invoke() register the pending call before delivering results.
		await flush()
		stale.emit("message", {
			type: "result",
			callId: 1,
			ok: true,
			value: { ok: false, reasons: ["stale"] },
		})
		current.emit("message", {
			type: "result",
			callId: 1,
			ok: true,
			value: { ok: true },
		})
		await expect(detect).resolves.toEqual({ ok: true })
	})

	test("concurrent loadPlugin calls for the same id keep the newer state alive", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		sandbox = createPluginSandbox(unitConfig())
		const first = sandbox.loadPlugin({
			id: "p",
			mainPath: "/p/old.js",
			eager: true,
		})
		await flush()
		const c1 = lastChild()

		// Second load for the same id while the first is still in flight:
		// the old child is NOT torn down until the new bundle loads — a
		// failed reload must never strand the previous child.
		const second = sandbox.loadPlugin({
			id: "p",
			mainPath: "/p/new.js",
			eager: true,
		})
		await flush()
		expect(c1.killed).toBe(false)
		const c2 = lastChild()
		expect(c2).not.toBe(c1)

		// Both bundles load; the newer state owns the id and retires the
		// previous child only then.
		c1.emit("message", { type: "loaded", ok: true, hooks: ["detect"] })
		await first
		c2.emit("message", { type: "loaded", ok: true, hooks: ["detect"] })
		const plugin = await second
		if (plugin === undefined) throw new Error("plugin load failed")
		expect(c1.killed).toBe(true)

		const detect = plugin.detect(createStubApi())
		await flush()
		c2.emit("message", {
			type: "result",
			callId: 1,
			ok: true,
			value: { ok: true },
		})
		await expect(detect).resolves.toEqual({ ok: true })

		// The newer state is still tracked — dispose terminates its child.
		await sandbox.disposeAll()
		expect(c2.killed).toBe(true)
	})

	test("a failed reload keeps the previous child alive and serving", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		sandbox = createPluginSandbox(unitConfig())
		const first = sandbox.loadPlugin({
			id: "p",
			mainPath: "/p/old.js",
			eager: true,
		})
		await flush()
		const c1 = lastChild()
		c1.emit("message", { type: "loaded", ok: true, hooks: ["detect"] })
		await expect(first).resolves.toBeDefined()

		// Reload with a bundle that fails to import: the load rejects, the
		// previous child must survive and keep answering hooks.
		const reload = sandbox.loadPlugin({
			id: "p",
			mainPath: "/p/broken.js",
			eager: true,
		})
		await flush()
		const c2 = lastChild()
		expect(c2).not.toBe(c1)
		expect(c1.killed).toBe(false)

		c2.emit("message", {
			type: "loaded",
			ok: false,
			error: { name: "Error", message: "import exploded" },
		})
		const restored = await reload
		if (restored === undefined) throw new Error("reload should fall back")
		expect(c1.killed).toBe(false)

		// The restored definition still routes through the old child.
		const detect = restored.detect(createStubApi())
		await flush()
		c1.emit("message", {
			type: "result",
			callId: 1,
			ok: true,
			value: { ok: true },
		})
		await expect(detect).resolves.toEqual({ ok: true })
	})

	test("spawn passes the asset vault dir as an extra read grant and argv", async () => {
		const vaultDir = join(tmpdir(), "vaults", "p")
		sandbox = createPluginSandbox(unitConfig({ assetVaultDir: vaultDir }))
		const plugin = sandbox.loadPlugin({
			id: "vault-grant",
			mainPath: "/p/main.js",
			eager: true,
		})
		await flush()
		const child = lastChild()
		const [, spawnArgs, spawnOpts] = child.args as [
			string,
			string[],
			{ execArgv: string[] },
		]
		expect(spawnArgs.at(2)).toBe(vaultDir)
		// host.ts grants `${resolve(assetVaultDir)}${sep}` — the asserts
		// mirror it so POSIX (sep "/") and Windows (sep "\\") both hold.
		expect(
			spawnOpts.execArgv.includes(`--allow-fs-read=${resolve(vaultDir)}${sep}`),
		).toBe(true)
		child.emit("message", { type: "loaded", ok: true, hooks: ["detect"] })
		await expect(plugin).resolves.toBeDefined()
	})
})
