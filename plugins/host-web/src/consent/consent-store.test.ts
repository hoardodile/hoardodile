import { beforeEach, describe, expect, it } from "vitest"
import {
	closeDownloadConsent,
	type DownloadConsentEntry,
	decideDownloadConsent,
	enqueueDownloadConsent,
	getDownloadConsentSnapshot,
	rehydrateDownloadConsent,
	requestDownloadConsent,
	resetDownloadConsent,
	subscribeDownloadConsent,
} from "./consent-store"

function ticket(ticketId: string, dest = "runtime.mjs"): DownloadConsentEntry {
	return {
		ticketId,
		pluginId: "p-1",
		pluginName: "Test",
		url: "https://example.com/runtime.mjs",
		dest,
	}
}

describe("download consent store", () => {
	beforeEach(() => {
		resetDownloadConsent()
	})

	it("queues tickets FIFO and dedupes by id", () => {
		enqueueDownloadConsent(ticket("a1"))
		enqueueDownloadConsent(ticket("a2"))
		enqueueDownloadConsent(ticket("a1"))
		const { queue } = getDownloadConsentSnapshot()
		expect(queue.map((t) => t.ticketId)).toEqual(["a1", "a2"])
	})

	it("closes a ticket by id and notifies subscribers", () => {
		let notified = 0
		const unsubscribe = subscribeDownloadConsent(() => {
			notified += 1
		})
		try {
			enqueueDownloadConsent(ticket("b1"))
			enqueueDownloadConsent(ticket("b2"))
			closeDownloadConsent("b1")
			expect(getDownloadConsentSnapshot().queue.map((t) => t.ticketId)).toEqual(
				["b2"],
			)
			expect(notified).toBe(3)
		} finally {
			unsubscribe()
		}
	})

	it("rehydrates the whole queue (SSE reconnect / engine restart)", () => {
		enqueueDownloadConsent(ticket("c1"))
		rehydrateDownloadConsent([ticket("c3", "b.mjs"), ticket("c4", "c.mjs")])
		expect(getDownloadConsentSnapshot().queue.map((t) => t.ticketId)).toEqual([
			"c3",
			"c4",
		])
	})

	it("unsubscribe stops notifications", () => {
		let notified = 0
		const unsubscribe = subscribeDownloadConsent(() => {
			notified += 1
		})
		unsubscribe()
		enqueueDownloadConsent(ticket("d1"))
		expect(notified).toBe(0)
	})

	it("request enqueues and waits; decide resolves and closes (engine path)", async () => {
		const consent = requestDownloadConsent(ticket("e1"))
		expect(getDownloadConsentSnapshot().queue).toHaveLength(1)
		decideDownloadConsent("e1", true)
		await expect(consent).resolves.toBe(true)
		expect(getDownloadConsentSnapshot().queue).toHaveLength(0)
	})

	it("denied decision resolves false and closes; unknown ids are no-ops", async () => {
		const consent = requestDownloadConsent(ticket("f1"))
		decideDownloadConsent("unknown", true)
		decideDownloadConsent("f1", false)
		await expect(consent).resolves.toBe(false)
		expect(getDownloadConsentSnapshot().queue).toHaveLength(0)
	})

	it("a duplicate in-flight request resolves false without double queueing", async () => {
		const first = requestDownloadConsent(ticket("g1"))
		const second = requestDownloadConsent(ticket("g1"))
		await expect(second).resolves.toBe(false)
		expect(getDownloadConsentSnapshot().queue).toHaveLength(1)
		decideDownloadConsent("g1", true)
		await expect(first).resolves.toBe(true)
	})

	it("reset resolves every waiter and empties the queue", async () => {
		const consent = requestDownloadConsent(ticket("h1"))
		resetDownloadConsent()
		await expect(consent).resolves.toBe(false)
		expect(getDownloadConsentSnapshot().queue).toHaveLength(0)
	})
})
