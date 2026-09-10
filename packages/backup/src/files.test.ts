import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { renameMock, real } = vi.hoisted(() => ({
	renameMock: vi.fn(),
	real: {
		rename: undefined as unknown as typeof import("node:fs/promises").rename,
	},
}))

/**
 * Windows rejects a rename while another process holds the destination open
 * (file watchers, indexers, antivirus). Only that transient class is mocked
 * here; every other filesystem call stays real.
 */
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>()
	real.rename = actual.rename
	return { ...actual, rename: (...args: unknown[]) => renameMock(...args) }
})

const { atomicWrite } = await import("./files.ts")

const temporary: string[] = []
afterEach(async () => {
	for (const path of temporary.splice(0))
		await rm(path, { recursive: true, force: true })
})

beforeEach(() => {
	renameMock.mockReset()
	renameMock.mockImplementation((from: string, to: string) =>
		real.rename(from, to),
	)
})

async function scratch() {
	const root = await mkdtemp(join(tmpdir(), "hd-atomic-write-"))
	temporary.push(root)
	return root
}

const lockingError = (code = "EPERM") =>
	Object.assign(new Error(`${code}: operation not permitted, rename`), { code })

describe("atomic write", () => {
	it("swaps the content in one rename and leaves no temporary behind", async () => {
		const root = await scratch()
		const path = join(root, "state.json")
		await atomicWrite(path, "first")
		await atomicWrite(path, "second")
		expect(await readFile(path, "utf8")).toBe("second")
		expect(await readdir(root)).toEqual(["state.json"])
		expect(renameMock).toHaveBeenCalledTimes(2)
	})

	it("retries a transiently locked rename instead of losing the write", async () => {
		const root = await scratch()
		const path = join(root, "state.json")
		renameMock
			.mockImplementationOnce(() => Promise.reject(lockingError()))
			.mockImplementationOnce(() => Promise.reject(lockingError("EBUSY")))
			.mockImplementation((from: string, to: string) => real.rename(from, to))
		await atomicWrite(path, "retried")
		expect(await readFile(path, "utf8")).toBe("retried")
		expect(renameMock).toHaveBeenCalledTimes(3)
		expect(await readdir(root)).toEqual(["state.json"])
	})

	it("reports a persistent lock after the retry budget and cleans up", async () => {
		const root = await scratch()
		const path = join(root, "state.json")
		renameMock.mockImplementation(() => Promise.reject(lockingError()))
		await expect(atomicWrite(path, "never")).rejects.toMatchObject({
			code: "EPERM",
		})
		expect(renameMock).toHaveBeenCalledTimes(6)
		expect(await readdir(root)).toEqual([])
	})

	it("fails immediately on a non-transient error", async () => {
		const root = await scratch()
		const path = join(root, "state.json")
		renameMock.mockImplementation(() =>
			Promise.reject(
				Object.assign(new Error("ENOENT: missing"), { code: "ENOENT" }),
			),
		)
		await expect(atomicWrite(path, "never")).rejects.toMatchObject({
			code: "ENOENT",
		})
		expect(renameMock).toHaveBeenCalledTimes(1)
	})
})
