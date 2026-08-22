/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	clearUsageBeatQueue,
	enqueueUsageBeat,
	flushUsageBeats,
	queuedBeatCount,
} from "./beatQueue"

beforeEach(async () => {
	await clearUsageBeatQueue()
})

describe("beatQueue", () => {
	it("enqueues and flushes beats", async () => {
		const send = vi.fn().mockResolvedValue(undefined)
		await enqueueUsageBeat({
			sessionId: "s1",
			entityType: "resource",
			entityId: "r1",
			startedAt: 1,
			durationMs: 10_000,
			platform: "web-pc",
		})
		expect(await queuedBeatCount()).toBe(1)
		await flushUsageBeats(send)
		expect(send).toHaveBeenCalledTimes(1)
		expect(await queuedBeatCount()).toBe(0)
	})

	it("keeps failed beats for retry", async () => {
		const send = vi.fn().mockRejectedValueOnce(new Error("network"))
		await enqueueUsageBeat({
			sessionId: "s1",
			entityType: "resource",
			entityId: "r1",
			startedAt: 1,
			durationMs: 10_000,
			platform: "web-pc",
		})
		await flushUsageBeats(send)
		expect(await queuedBeatCount()).toBe(1)
	})

	it("flushes multiple beats in parallel", async () => {
		const send = vi.fn().mockResolvedValue(undefined)
		for (let i = 0; i < 3; i++) {
			await enqueueUsageBeat({
				sessionId: `s${i}`,
				entityType: "resource",
				entityId: "r1",
				startedAt: i,
				durationMs: 10_000,
				platform: "web-pc",
			})
		}
		await flushUsageBeats(send)
		expect(send).toHaveBeenCalledTimes(3)
	})

	it("drops legacy device beats instead of retrying them", async () => {
		const send = vi.fn().mockResolvedValue(undefined)
		const legacyBeat = {
			sessionId: "legacy",
			entityType: "resource" as const,
			entityId: "r1",
			startedAt: 1,
			durationMs: 10_000,
			deviceId: "device-1",
			deviceInfo: { channel: "web" },
		}
		await enqueueUsageBeat(legacyBeat)
		await flushUsageBeats(send)
		expect(send).not.toHaveBeenCalled()
		expect(await queuedBeatCount()).toBe(0)
	})
})
