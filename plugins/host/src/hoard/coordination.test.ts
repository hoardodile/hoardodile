import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { storageCoordinator } from "./coordination.ts"

function deferred() {
	let resolve: () => void = () => {}
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

describe("storage coordination", () => {
	it("drains complete commits and permits nested writes before freezing", async () => {
		const gate = storageCoordinator(join(tmpdir(), randomUUID()))
		const resume = deferred()
		const started = deferred()
		const events: string[] = []
		const writer = gate.write(async () => {
			events.push("db")
			started.resolve()
			await resume.promise
			await gate.write(() => {
				events.push("file")
			})
		})
		await started.promise
		const backup = gate.freeze({
			operation: () => {
				events.push("snapshot")
			},
		})
		await Promise.resolve()
		expect(gate.state().frozen).toBe(true)
		resume.resolve()
		await Promise.all([writer, backup])
		expect(events).toEqual(["db", "file", "snapshot"])
	})
	it("holds later writes until the backup actually finishes", async () => {
		const gate = storageCoordinator(join(tmpdir(), randomUUID()))
		const resume = deferred()
		const started = deferred()
		const backup = gate.freeze({
			operation: async () => {
				started.resolve()
				await resume.promise
			},
		})
		await started.promise
		let committed = false
		const write = gate.write(() => {
			committed = true
		})
		await Promise.resolve()
		expect(committed).toBe(false)
		resume.resolve()
		await Promise.all([backup, write])
		expect(committed).toBe(true)
	})
	it("unblocks submissions when a drain is cancelled", async () => {
		const gate = storageCoordinator(join(tmpdir(), randomUUID()))
		const pending = deferred()
		const active = gate.write(() => pending.promise)
		const controller = new AbortController()
		const backup = gate.freeze({
			signal: controller.signal,
			operation: () => {
				throw new Error("Unexpected snapshot")
			},
		})
		await Promise.resolve()
		controller.abort()
		await expect(backup).rejects.toThrow()
		expect(gate.state().frozen).toBe(false)
		pending.resolve()
		await active
		await expect(gate.write(() => "ok")).resolves.toBe("ok")
	})
})
