import type { ClientPlatform, UsageEntityType } from "@hoardodile/schemas"
import { type DBSchema, type IDBPDatabase, openDB } from "idb"

export type QueuedBeat = {
	readonly sessionId: string
	readonly entityType: UsageEntityType
	readonly entityId: string
	readonly startedAt: number
	readonly durationMs: number
	readonly platform?: ClientPlatform
}

type StoredBeat = QueuedBeat & {
	readonly id: number
	readonly enqueuedAt: number
}

interface UsageQueueSchema extends DBSchema {
	usageBeats: {
		key: number
		value: StoredBeat
	}
}

const DB_NAME = "hoardodile-usage-queue"
const STORE_NAME = "usageBeats"
const DB_VERSION = 1

class InMemoryQueue {
	private beats: StoredBeat[] = []
	private nextId = 1

	async add(beat: QueuedBeat): Promise<void> {
		this.beats.push({
			...beat,
			id: this.nextId++,
			enqueuedAt: Date.now(),
		})
	}

	async list(): Promise<readonly StoredBeat[]> {
		return this.beats.slice()
	}

	async remove(id: number): Promise<void> {
		this.beats = this.beats.filter((b) => b.id !== id)
	}

	async clear(): Promise<void> {
		this.beats = []
	}
}

class IndexedDbQueue {
	private db: IDBPDatabase<UsageQueueSchema> | undefined

	async init(): Promise<void> {
		if (this.db !== undefined) return
		this.db = await openDB<UsageQueueSchema>(DB_NAME, DB_VERSION, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, {
						keyPath: "id",
						autoIncrement: true,
					})
				}
			},
		})
	}

	async add(beat: QueuedBeat): Promise<void> {
		await this.init()
		if (this.db === undefined) return
		await this.db.add(STORE_NAME, {
			...beat,
			enqueuedAt: Date.now(),
		} as StoredBeat)
	}

	async list(): Promise<readonly StoredBeat[]> {
		await this.init()
		if (this.db === undefined) return []
		return this.db.getAll(STORE_NAME)
	}

	async remove(id: number): Promise<void> {
		if (this.db === undefined) return
		await this.db.delete(STORE_NAME, id)
	}

	async clear(): Promise<void> {
		if (this.db === undefined) return
		await this.db.clear(STORE_NAME)
	}
}

function createQueue(): InMemoryQueue | IndexedDbQueue {
	try {
		if (typeof indexedDB === "undefined") {
			return new InMemoryQueue()
		}
		return new IndexedDbQueue()
	} catch {
		return new InMemoryQueue()
	}
}

const queue = createQueue()

export type BeatSender = (beat: QueuedBeat) => Promise<void>

/**
 * Enqueue a usage heartbeat for later delivery.
 *
 * The queue survives page reloads (when IndexedDB is available) so beats sent
 * while offline are retried on the next flush.
 */
export async function enqueueUsageBeat(beat: QueuedBeat): Promise<void> {
	await queue.add(beat)
}

/**
 * Legacy beats enqueued before the device → platform migration still carry
 * `deviceId`/`deviceInfo`; the server rejects them, so drop them instead of
 * retrying forever.
 */
function isLegacyBeat(beat: StoredBeat): boolean {
	return "deviceId" in beat || "deviceInfo" in beat
}

/**
 * Flush all queued beats through the provided sender.
 *
 * Successfully sent beats are removed from the queue. Failures are kept and
 * will be retried on the next flush.
 */
export async function flushUsageBeats(send: BeatSender): Promise<void> {
	const beats = await queue.list()
	if (beats.length === 0) return

	await Promise.all(
		beats.map(async (beat) => {
			if (isLegacyBeat(beat)) {
				await queue.remove(beat.id)
				return
			}
			try {
				await send(beat)
				await queue.remove(beat.id)
			} catch {
				// Keep in queue for retry.
			}
		}),
	)
}

/**
 * Number of beats currently queued.
 */
export async function queuedBeatCount(): Promise<number> {
	const beats = await queue.list()
	return beats.length
}

/**
 * Clear the queue. Intended for tests.
 */
export async function clearUsageBeatQueue(): Promise<void> {
	await queue.clear()
}
