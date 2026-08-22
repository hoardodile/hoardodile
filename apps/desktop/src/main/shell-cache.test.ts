import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
	clearShellCache,
	dirSize,
	getShellCacheSize,
	resolveUpdaterCacheDir,
	type ShellCacheSession,
} from "./shell-cache"

function fakeSession(
	overrides?: Partial<ShellCacheSession>,
): ShellCacheSession {
	return {
		getCacheSize: vi.fn().mockResolvedValue(1000),
		clearCache: vi.fn().mockResolvedValue(undefined),
		clearCodeCaches: vi.fn().mockResolvedValue(undefined),
		clearStorageData: vi.fn().mockResolvedValue(undefined),
		...overrides,
	}
}

/** Session whose HTTP cache reads 1000 B before clearing, 0 after. */
function fakeClearingSession(): ShellCacheSession {
	let reads = 0
	return fakeSession({
		getCacheSize: vi.fn().mockImplementation(async () => {
			reads += 1
			return reads === 1 ? 1000 : 0
		}),
	})
}

const tempDirs: string[] = []

async function mkTemp(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "shell-cache-"))
	tempDirs.push(dir)
	return dir
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	)
})

describe("resolveUpdaterCacheDir", () => {
	it("follows the electron-builder formula: <appName-lowercase>-updater", () => {
		expect(
			resolveUpdaterCacheDir({
				localAppData: String.raw`C:\Users\demo\AppData\Local`,
				appName: "hoardodile",
			}),
		).toBe(String.raw`C:\Users\demo\AppData\Local\hoardodile-updater`)
	})
})

describe("dirSize", () => {
	it("sums files and nested directories", async () => {
		const root = await mkTemp()
		await writeFile(join(root, "a.bin"), Buffer.alloc(10))
		await mkdir(join(root, "sub"))
		await writeFile(join(root, "sub", "b.bin"), Buffer.alloc(5))
		expect(await dirSize(root)).toBe(15)
	})

	it("returns 0 for undefined or missing dirs", async () => {
		expect(await dirSize(undefined)).toBe(0)
		expect(await dirSize(join(await mkTemp(), "missing"))).toBe(0)
	})
})

describe("getShellCacheSize", () => {
	it("adds the session cache size and the updater directory", async () => {
		const root = await mkTemp()
		await writeFile(join(root, "update.exe"), Buffer.alloc(200))
		const size = await getShellCacheSize({
			session: fakeSession(),
			updaterCacheDir: root,
			canClearUpdaterCache: true,
		})
		expect(size).toBe(1200)
	})

	it("treats a failing cache-size read as zero", async () => {
		const size = await getShellCacheSize({
			session: fakeSession({
				getCacheSize: vi.fn().mockRejectedValue(new Error("boom")),
			}),
			updaterCacheDir: undefined,
			canClearUpdaterCache: true,
		})
		expect(size).toBe(0)
	})
})

describe("clearShellCache", () => {
	it("clears HTTP + code caches and only cache-like storages", async () => {
		const session = fakeSession()
		await clearShellCache({
			session,
			updaterCacheDir: undefined,
			canClearUpdaterCache: true,
		})
		expect(session.clearCache).toHaveBeenCalledTimes(1)
		expect(session.clearCodeCaches).toHaveBeenCalledWith({ urls: [] })
		expect(session.clearStorageData).toHaveBeenCalledWith({
			storages: ["shadercache", "cachestorage", "serviceworkers"],
		})
		// Never an omnibus clear: cookies / localstorage / indexdb excluded.
		const storages =
			vi.mocked(session.clearStorageData).mock.calls[0]?.[0]?.storages ?? []
		expect(storages).not.toContain("cookies")
		expect(storages).not.toContain("localstorage")
		expect(storages).not.toContain("indexdb")
	})

	it("reports the bytes freed including the updater directory", async () => {
		const root = await mkTemp()
		await writeFile(join(root, "update.exe"), Buffer.alloc(200))
		const session = fakeClearingSession()
		const freed = await clearShellCache({
			session,
			updaterCacheDir: root,
			canClearUpdaterCache: true,
		})
		expect(freed).toBe(1200) // 1000 session + 200 updater
		await expect(readdir(root)).rejects.toMatchObject({ code: "ENOENT" })
	})

	it("keeps the updater directory while an update is downloading or ready", async () => {
		const root = await mkTemp()
		await writeFile(join(root, "update.exe"), Buffer.alloc(200))
		const freed = await clearShellCache({
			session: fakeClearingSession(),
			updaterCacheDir: root,
			canClearUpdaterCache: false,
		})
		expect(freed).toBe(1000) // updater dir untouched
		expect(await readdir(root)).toEqual(["update.exe"])
	})
})
