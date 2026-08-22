import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { ResourceAPI } from "../types.ts"
import {
	createPluginSandbox,
	DEFAULT_SANDBOX_CONFIG,
	type PluginSandbox,
	type PluginSandboxConfig,
} from "./host.ts"

/**
 * Deterministic lifecycle tests: a scripted fake Worker lets us hit race
 * windows (stale messages, concurrent loads) that real worker threads only
 * reproduce flakily. Only this file sees the mock.
 */
const mocks = vi.hoisted(() => {
	class FakeWorker {
		static instances: FakeWorker[] = []
		private readonly listeners = new Map<
			string,
			((...args: unknown[]) => void)[]
		>()
		readonly posted: unknown[] = []
		terminated = false

		constructor(..._args: unknown[]) {
			FakeWorker.instances.push(this)
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

		postMessage(msg: unknown): void {
			this.posted.push(msg)
		}

		terminate(): Promise<number> {
			this.terminated = true
			return Promise.resolve(0)
		}

		unref(): this {
			return this
		}
	}
	return { FakeWorker }
})

vi.mock("node:worker_threads", () => ({ Worker: mocks.FakeWorker }))

function unitConfig(overrides: Partial<PluginSandboxConfig> = {}) {
	return {
		...DEFAULT_SANDBOX_CONFIG,
		...overrides,
	} satisfies PluginSandboxConfig
}

function lastWorker(): InstanceType<typeof mocks.FakeWorker> {
	const worker = mocks.FakeWorker.instances.at(-1)
	if (worker === undefined) throw new Error("no worker spawned")
	return worker
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
		...overrides,
	}
}

/** Flush microtasks and pending macrotasks. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("plugin sandbox lifecycle (fake worker)", () => {
	let sandbox: PluginSandbox | undefined

	beforeEach(() => {
		mocks.FakeWorker.instances.length = 0
	})

	afterEach(async () => {
		await sandbox?.disposeAll()
		sandbox = undefined
		vi.restoreAllMocks()
	})

	test("a plugin that fails to load has its worker terminated", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		sandbox = createPluginSandbox(unitConfig())
		const load = sandbox.loadPlugin({
			id: "bad",
			mainPath: "/plugins/bad/main.js",
			eager: true,
		})
		const worker = lastWorker()
		worker.emit("message", {
			type: "loaded",
			ok: false,
			error: { name: "Error", message: "import exploded" },
		})
		await expect(load).resolves.toBeUndefined()
		expect(worker.terminated).toBe(true)
	})

	test("messages from a stale worker are ignored", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		sandbox = createPluginSandbox(unitConfig())
		// Unload mid-load: the first worker's waiter rejects, load returns
		// undefined, and the worker is terminated.
		const first = sandbox.loadPlugin({
			id: "p",
			mainPath: "/p/main.js",
			eager: true,
		})
		const stale = lastWorker()
		sandbox.unloadPlugin("p")
		await expect(first).resolves.toBeUndefined()
		expect(stale.terminated).toBe(true)

		// Respawn for the same id.
		const second = sandbox.loadPlugin({
			id: "p",
			mainPath: "/p/main.js",
			eager: true,
		})
		const current = lastWorker()
		expect(current).not.toBe(stale)

		// The stale worker's late "loaded" must not resolve the new spawn's
		// load waiter — the second load stays pending until ITS worker loads.
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

		// A stale "result" must not resolve a pending call on the new worker.
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
		const w1 = lastWorker()

		// Second load for the same id while the first is still in flight:
		// the old worker is NOT torn down until the new bundle loads — a
		// failed reload must never strand the previous worker.
		const second = sandbox.loadPlugin({
			id: "p",
			mainPath: "/p/new.js",
			eager: true,
		})
		await flush()
		expect(w1.terminated).toBe(false)
		const w2 = lastWorker()
		expect(w2).not.toBe(w1)

		// Both bundles load; the newer state owns the id and retires the
		// previous worker only then.
		w1.emit("message", { type: "loaded", ok: true, hooks: ["detect"] })
		await first
		w2.emit("message", { type: "loaded", ok: true, hooks: ["detect"] })
		const plugin = await second
		if (plugin === undefined) throw new Error("plugin load failed")
		expect(w1.terminated).toBe(true)

		const detect = plugin.detect(createStubApi())
		await flush()
		w2.emit("message", {
			type: "result",
			callId: 1,
			ok: true,
			value: { ok: true },
		})
		await expect(detect).resolves.toEqual({ ok: true })

		// The newer state is still tracked — dispose terminates its worker.
		await sandbox.disposeAll()
		expect(w2.terminated).toBe(true)
	})

	test("a failed reload keeps the previous worker alive and serving", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		sandbox = createPluginSandbox(unitConfig())
		const first = sandbox.loadPlugin({
			id: "p",
			mainPath: "/p/old.js",
			eager: true,
		})
		const w1 = lastWorker()
		w1.emit("message", { type: "loaded", ok: true, hooks: ["detect"] })
		await expect(first).resolves.toBeDefined()

		// Reload with a bundle that fails to import: the load rejects, the
		// previous worker must survive and keep answering hooks.
		const reload = sandbox.loadPlugin({
			id: "p",
			mainPath: "/p/broken.js",
			eager: true,
		})
		const w2 = lastWorker()
		expect(w2).not.toBe(w1)
		expect(w1.terminated).toBe(false)

		w2.emit("message", {
			type: "loaded",
			ok: false,
			error: { name: "Error", message: "import exploded" },
		})
		const restored = await reload
		if (restored === undefined) throw new Error("reload should fall back")
		expect(w1.terminated).toBe(false)

		// The restored definition still routes through the old worker.
		const detect = restored.detect(createStubApi())
		await flush()
		w1.emit("message", {
			type: "result",
			callId: 1,
			ok: true,
			value: { ok: true },
		})
		await expect(detect).resolves.toEqual({ ok: true })
	})
})
