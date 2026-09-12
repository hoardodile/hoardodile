import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { writeMock, real } = vi.hoisted(() => ({
	writeMock: vi.fn(),
	real: {
		atomicWrite:
			undefined as unknown as typeof import("./files.ts").atomicWrite,
	},
}))

/**
 * Record writes are the layer under test: only `atomicWrite` is intercepted
 * so a locked record file can be simulated (see files.test.ts for the real
 * Windows behaviour); the filesystem stays real otherwise.
 */
vi.mock("./files.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./files.ts")>()
	real.atomicWrite = actual.atomicWrite
	return { ...actual, atomicWrite: (...args: unknown[]) => writeMock(...args) }
})

const { createJobManager } = await import("./jobs.ts")

const temporary: string[] = []
afterEach(async () => {
	for (const path of temporary.splice(0))
		await rm(path, { recursive: true, force: true })
})

beforeEach(() => {
	writeMock.mockReset()
	writeMock.mockImplementation((path: string, content: string) =>
		real.atomicWrite(path, content),
	)
})

async function scratch() {
	const root = await mkdtemp(join(tmpdir(), "hd-jobs-"))
	temporary.push(root)
	return join(root, "jobs")
}

type Manager = Awaited<ReturnType<typeof createJobManager>>

async function settle(jobs: Manager, id: string) {
	for (let attempt = 0; attempt < 200; attempt++) {
		const job = jobs.get(id)
		if (
			job &&
			["succeeded", "failed", "cancelled", "interrupted"].includes(job.state)
		)
			return job
		await delay(10)
	}
	throw new Error("the job did not settle")
}

const record = (directory: string, id: string) =>
	readFile(join(directory, `${id}.json`), "utf8")

describe("job manager records", () => {
	it("runs a job and records its result", async () => {
		const directory = await scratch()
		const handler = vi.fn(async () => ({ ok: true }))
		const jobs = await createJobManager({
			directory,
			handlers: { probe: handler },
		})
		const job = await jobs.start("probe", { value: 1 })
		try {
			const settled = await settle(jobs, job.id)
			expect(settled.state).toBe("succeeded")
			expect(settled.result).toEqual({ ok: true })
			expect(handler).toHaveBeenCalledTimes(1)
		} finally {
			await jobs.close()
		}
		// Status writes are best effort and trail the in-memory state, so the
		// record is read only once close() has drained the write queue.
		expect(JSON.parse(await record(directory, job.id)).state).toBe("succeeded")
	})

	it("runs an accepted job even when its record cannot be written", async () => {
		const directory = await scratch()
		let failures = 2
		writeMock.mockImplementation(async (path: string, content: string) => {
			if (failures > 0) {
				failures -= 1
				throw Object.assign(new Error("EPERM: operation not permitted"), {
					code: "EPERM",
				})
			}
			return real.atomicWrite(path, content)
		})
		const errors: unknown[] = []
		const handler = vi.fn(async () => ({ ran: true }))
		const jobs = await createJobManager({
			directory,
			handlers: { probe: handler },
			onError: (error) => errors.push(error),
		})
		const job = await jobs.start("probe", {})
		try {
			const settled = await settle(jobs, job.id)
			// The operation ran despite the two lost status writes, and the
			// failures were reported instead of silently swallowed.
			expect(handler).toHaveBeenCalledTimes(1)
			expect(settled.state).toBe("succeeded")
			expect(errors).toHaveLength(2)
		} finally {
			await jobs.close()
		}
		// The first write that reaches the disk is the one in the finally
		// above, so the record only exists once close() drained the queue.
		expect(JSON.parse(await record(directory, job.id)).state).toBe("succeeded")
	})

	it("records a failing handler", async () => {
		const directory = await scratch()
		const errors: unknown[] = []
		const jobs = await createJobManager({
			directory,
			handlers: {
				probe: async () => {
					throw new Error("boom")
				},
			},
			onError: (error) => errors.push(error),
		})
		try {
			const job = await jobs.start("probe", {})
			const settled = await settle(jobs, job.id)
			expect(settled.state).toBe("failed")
			expect(settled.error?.code).toBe("operation_failed")
			expect(errors).toHaveLength(1)
		} finally {
			await jobs.close()
		}
	})
})
