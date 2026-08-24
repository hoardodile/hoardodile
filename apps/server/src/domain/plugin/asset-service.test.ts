import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStoragePaths } from "@hoardodile/host/hoard"
import type { PluginManifest } from "@hoardodile/sdk-types"
import { afterEach, describe, expect, test } from "vitest"
import {
	createPluginAssetService,
	type PluginAssetService,
} from "./asset-service.ts"
import { type ConsentBroker, createConsentBroker } from "./consent.ts"
import { createPluginDownloader } from "./downloader.ts"

const PLUGIN_ID = "11111111-1111-4111-8111-111111111111"

let server: Server | undefined
let root: string | undefined

afterEach(async () => {
	await new Promise<void>((resolve) => {
		if (server === undefined) return resolve()
		server.close(() => resolve())
		server = undefined
	})
	if (root !== undefined) rmSync(root, { recursive: true, force: true })
	root = undefined
})

type ListenHandler = (req: IncomingMessage, res: ServerResponse) => void

function listen(handler: ListenHandler): Promise<string> {
	server = createServer(handler)
	return new Promise((resolve) => {
		server!.listen(0, "127.0.0.1", () => {
			const addr = server!.address()
			if (addr === null || typeof addr === "string") throw new Error("no addr")
			resolve(`http://127.0.0.1:${addr.port}`)
		})
	})
}

function manifestWith(
	permissions: Partial<PluginManifest["permissions"]> = {},
): PluginManifest {
	return {
		id: PLUGIN_ID,
		name: "Asset Test",
		description: "",
		version: "1.0.0",
		permissions: {
			sourceMeta: false,
			searchMeta: false,
			danmaku: false,
			message: false,
			imageHashes: false,
			container: false,
			download: true,
			...permissions,
		},
	}
}

function serviceWith(opts: { readonly manifest?: PluginManifest } = {}): {
	readonly service: PluginAssetService
	readonly consent: ConsentBroker
	readonly vaultDir: string
} {
	root = mkdtempSync(join(tmpdir(), "hoardodile-asset-"))
	const paths = createStoragePaths({ root })
	const consent = createConsentBroker({
		timeoutMs: 5_000,
		connectionCount: () => 1,
	})
	const downloader = createPluginDownloader({
		maxBytes: 1_000_000,
		timeoutMs: 2_000,
		allowPrivate: true,
	})
	const service = createPluginAssetService({
		paths,
		readOnly: false,
		getPlugin: (pluginId) =>
			pluginId === PLUGIN_ID
				? {
						manifest: opts.manifest ?? manifestWith(),
						enabled: true,
						missing: false,
					}
				: undefined,
		consent,
		downloader,
		maxFileBytes: 1_000_000,
		maxTotalBytes: 10_000_000,
		maxReadAssetBytes: 1_000_000,
	})
	return { service, consent, vaultDir: paths.latest.pluginVaultDir(PLUGIN_ID) }
}

describe("createPluginAssetService", () => {
	test("a present destination resolves cached without consent", async () => {
		const { service, consent, vaultDir } = serviceWith()
		await mkdir(vaultDir, { recursive: true })
		await writeFile(join(vaultDir, "runtime.mjs"), "export const x = 1\n")

		const result = await service.requestDownload(PLUGIN_ID, {
			url: "https://example.com/runtime.mjs",
			dest: "runtime.mjs",
		})
		expect(result).toMatchObject({
			cached: true,
			path: "runtime.mjs",
			sizeBytes: 19,
		})
		expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
		expect(consent.listPending()).toEqual([])
	})

	test("a cached hit still honours the sha256 pin (stale bytes are not silent)", async () => {
		const { service, consent, vaultDir } = serviceWith()
		await mkdir(vaultDir, { recursive: true })
		await writeFile(join(vaultDir, "runtime.mjs"), "old bytes")
		const pin = createHash("sha256").update("new bytes").digest("hex")

		await expect(
			service.requestDownload(PLUGIN_ID, {
				url: "https://example.com/runtime.mjs",
				dest: "runtime.mjs",
				sha256: pin,
			}),
		).rejects.toMatchObject({ name: "POLICY" })
		expect(consent.listPending()).toEqual([])
	})

	test("downloads after consent and commits atomically", async () => {
		const base = await listen((_req, res) => {
			res.writeHead(200)
			res.end("hello runtime")
		})
		const { service, consent, vaultDir } = serviceWith()
		const decision = service.requestDownload(PLUGIN_ID, {
			url: `${base}/runtime.mjs`,
			dest: "runtime/runtime.mjs",
			reason: "live2d runtime",
		})
		const tickets = await until(
			() => consent.listPending(),
			(t) => t.length === 1,
		)
		expect(tickets[0]).toMatchObject({
			pluginId: PLUGIN_ID,
			dest: "runtime/runtime.mjs",
			reason: "live2d runtime",
		})
		consent.decide(tickets[0]!.ticketId, true)
		const result = await decision
		expect(result).toMatchObject({ cached: false, sizeBytes: 13 })

		expect(
			await readFile(join(vaultDir, "runtime", "runtime.mjs"), "utf-8"),
		).toBe("hello runtime")
		expect(await service.statAsset(PLUGIN_ID, "runtime/runtime.mjs")).toEqual({
			sizeBytes: 13,
		})
		expect(
			new TextDecoder().decode(
				await service.readAsset(PLUGIN_ID, "runtime/runtime.mjs"),
			),
		).toBe("hello runtime")
	})

	test("a declined consent rejects DENIED and writes nothing", async () => {
		const base = await listen((_req, res) => {
			res.writeHead(200)
			res.end("hello")
		})
		const { service, consent, vaultDir } = serviceWith()
		const decision = service.requestDownload(PLUGIN_ID, {
			url: `${base}/x.mjs`,
			dest: "x.mjs",
		})
		await until(
			() => consent.listPending(),
			(t) => t.length === 1,
		)
		consent.decide(consent.listPending()[0]!.ticketId, false)
		await expect(decision).rejects.toMatchObject({ name: "DENIED" })
		expect(await service.statAsset(PLUGIN_ID, "x.mjs")).toBeUndefined()
		expect(vaultDir).toBeDefined()
	})

	test("sha256 pins are verified and mismatches never commit", async () => {
		const base = await listen((_req, res) => {
			res.writeHead(200)
			res.end("hello")
		})
		const { service, consent, vaultDir } = serviceWith()
		const sha256 = createHash("sha256").update("hello").digest("hex")
		const good = service.requestDownload(PLUGIN_ID, {
			url: `${base}/pinned.mjs`,
			dest: "pinned.mjs",
			sha256,
		})
		await until(
			() => consent.listPending(),
			(t) => t.length === 1,
		)
		consent.decide(consent.listPending()[0]!.ticketId, true)
		await expect(good).resolves.toMatchObject({ cached: false })

		const bad = service.requestDownload(PLUGIN_ID, {
			url: `${base}/x.mjs`,
			dest: "bad.mjs",
			sha256: "0".repeat(64),
		})
		await until(
			() => consent.listPending(),
			(t) => t.length === 1,
		)
		consent.decide(consent.listPending()[0]!.ticketId, true)
		await expect(bad).rejects.toMatchObject({ name: "POLICY" })
		expect(await service.statAsset(PLUGIN_ID, "bad.mjs")).toBeUndefined()
		expect(await statExisting(join(vaultDir, "pinned.mjs"))).toBeTruthy()
	})

	test("missing permission, unknown plugin and traversal are POLICY before network", async () => {
		const { service } = serviceWith({
			manifest: manifestWith({ download: false }),
		})
		for (const request of [
			{ url: "https://example.com/x", dest: "../main.js" },
			{ url: "https://example.com/x", dest: "a/../../main.js" },
			{ url: "ftp://example.com/x", dest: "x" },
		]) {
			await expect(
				service.requestDownload(PLUGIN_ID, request),
			).rejects.toMatchObject({ name: "POLICY" })
		}
		await expect(
			service.requestDownload("unknown-plugin", {
				url: "https://example.com/x",
				dest: "x",
			}),
		).rejects.toMatchObject({ name: "POLICY" })
	})

	test("deleteAsset is idempotent and confined", async () => {
		const { service, vaultDir } = serviceWith()
		await mkdir(vaultDir, { recursive: true })
		writeFileSync(join(vaultDir, "a.mjs"), "x")

		expect(await service.deleteAsset(PLUGIN_ID, "a.mjs")).toEqual({
			existed: true,
		})
		expect(await service.deleteAsset(PLUGIN_ID, "a.mjs")).toEqual({
			existed: false,
		})
		await expect(
			service.deleteAsset(PLUGIN_ID, "../escape"),
		).rejects.toMatchObject({ name: "POLICY" })
	})
})

async function statExisting(path: string): Promise<boolean> {
	try {
		const { stat } = await import("node:fs/promises")
		await stat(path)
		return true
	} catch {
		return false
	}
}

/** Poll `fn` until `cond` holds (bounded — a hang becomes a clear failure). */
async function until<T>(fn: () => T, cond: (value: T) => boolean): Promise<T> {
	for (let i = 0; i < 50; i++) {
		const value = fn()
		if (cond(value)) return value
		await new Promise((resolve) => setTimeout(resolve, 1))
	}
	throw new Error("until: condition never held")
}
