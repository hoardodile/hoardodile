import { mkdtempSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import {
	commitVaultFile,
	discardVaultTempFile,
	PluginVaultPathError,
	parsePluginVaultDest,
	vaultFileSha256,
	vaultReadFile,
	vaultRemoveFile,
	vaultStatFile,
	vaultTempFile,
	vaultTotalSize,
} from "./plugin-vault.ts"

const roots: string[] = []

function vaultDir(): string {
	const root = mkdtempSync(join(tmpdir(), "hoardodile-vault-"))
	roots.push(root)
	return join(root, "vault")
}

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
	)
})

describe("parsePluginVaultDest (isolation)", () => {
	// Portability: the fixture dir must be a real absolute path on every
	// OS — a hardcoded Windows drive path broke the POSIX runners.
	const dir = join(tmpdir(), "vaults", "p")

	test("accepts nested relative destinations", () => {
		expect(parsePluginVaultDest(dir, "runtime/live2d.min.js")).toEqual({
			rel: "runtime/live2d.min.js",
			// assertInside returns `resolve(candidate)`.
			abs: resolve(dir, "runtime", "live2d.min.js"),
		})
	})

	test("rejects traversal", () => {
		for (const dest of ["../main.js", "a/../../main.js", "..", "a/.."]) {
			expect(() => parsePluginVaultDest(dir, dest)).toThrow(
				PluginVaultPathError,
			)
		}
	})

	test("rejects absolute destinations and drive letters", () => {
		for (const dest of ["/etc/passwd", "C:\\windows\\x", "//host/share"]) {
			expect(() => parsePluginVaultDest(dir, dest)).toThrow()
		}
	})

	test("rejects empty segments, reserved names and trailing dots", () => {
		for (const dest of [
			"",
			"a//b",
			"a/",
			"CON",
			"aux.txt",
			"a/.",
			"a..",
			"x.",
		]) {
			expect(() => parsePluginVaultDest(dir, dest)).toThrow()
		}
	})
})

describe("vault primitives", () => {
	test("stat/read/write/commit/remove round-trip with atomic commits", async () => {
		const dir = vaultDir()
		await mkdir(dir, { recursive: true })

		expect(await vaultStatFile(dir, "runtime/a.mjs")).toBeUndefined()
		expect(await vaultRemoveFile(dir, "runtime/a.mjs")).toBe(false)

		const temp = vaultTempFile(dir)
		await writeFile(temp, "const a = 1\n")
		const commit = await commitVaultFile({
			vaultDir: dir,
			rel: "runtime/a.mjs",
			tempPath: temp,
			maxFileBytes: 1024,
			maxTotalBytes: 4096,
		})
		expect(commit.sizeBytes).toBe(12)
		expect(commit.sha256).toMatch(/^[0-9a-f]{64}$/)

		expect(await vaultStatFile(dir, "runtime/a.mjs")).toEqual({
			sizeBytes: 12,
		})
		expect(
			new TextDecoder().decode(
				await vaultReadFile(dir, "runtime/a.mjs", 1_000_000),
			),
		).toBe("const a = 1\n")
		expect(await vaultFileSha256(dir, "runtime/a.mjs")).toBe(commit.sha256)
		expect(await vaultTotalSize(dir)).toBe(12)
		expect(await vaultRemoveFile(dir, "runtime/a.mjs")).toBe(true)
		expect(await vaultTotalSize(dir)).toBe(0)
	})

	test("commit rejects oversized files and over-quota totals (no partial file)", async () => {
		const dir = vaultDir()
		await mkdir(dir, { recursive: true })
		await writeFile(join(dir, "existing.bin"), "x".repeat(100))

		const tooBig = vaultTempFile(dir)
		await writeFile(tooBig, "x".repeat(200 + 1))
		await expect(
			commitVaultFile({
				vaultDir: dir,
				rel: "big.bin",
				tempPath: tooBig,
				maxFileBytes: 100,
				maxTotalBytes: 200,
			}),
		).rejects.toThrow(/download cap/)
		await expect(vaultStatFile(dir, "big.bin")).resolves.toBeUndefined()

		// Replacing an existing file counts the old bytes only once.
		const fresh = vaultTempFile(dir)
		await writeFile(fresh, "y".repeat(150))
		await expect(
			commitVaultFile({
				vaultDir: dir,
				rel: "existing.bin",
				tempPath: fresh,
				maxFileBytes: 1000,
				maxTotalBytes: 200,
			}),
		).resolves.toMatchObject({ sizeBytes: 150 })
		expect(await vaultTotalSize(dir)).toBe(150)
	})

	test("delete refuses directories and outside-the-vault paths", async () => {
		const dir = vaultDir()
		await mkdir(join(dir, "sub"), { recursive: true })
		await expect(vaultRemoveFile(dir, "sub")).rejects.toThrow(/not a file/)
		await expect(vaultRemoveFile(dir, "../outside")).rejects.toThrow()
	})

	test("discard removes temp files without throwing", async () => {
		const dir = vaultDir()
		await mkdir(dir, { recursive: true })
		const temp = vaultTempFile(dir)
		await writeFile(temp, "partial")
		await discardVaultTempFile(temp)
		await expect(readFile(temp)).rejects.toThrow()
		await expect(discardVaultTempFile(temp)).resolves.toBeUndefined()
	})
})
