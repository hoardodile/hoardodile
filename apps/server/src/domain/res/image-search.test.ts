import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import {
	buildImageSearchSessions,
	type ImageSearchSessionsDeps,
} from "./image-search.ts"

const tmpBases: string[] = []

async function makeSessions(overrides?: Partial<ImageSearchSessionsDeps>) {
	const tmpBase = await mkdtemp(join(tmpdir(), "image-search-test-"))
	tmpBases.push(tmpBase)
	let seq = 0
	return buildImageSearchSessions({
		tmpBase,
		// A non-flat grayscale grid so dhash/phash derive from it.
		decodeGrayGrid: async () =>
			new Uint8Array(1024).map((_, i) => (i * 7) % 256),
		newId: () => `session-${++seq}`,
		now: () => Date.now(),
		...overrides,
	})
}

afterEach(async () => {
	await Promise.all(
		tmpBases
			.splice(0)
			.map((base) => rm(base, { recursive: true, force: true })),
	)
})

async function storeImage(
	sessions: ReturnType<typeof buildImageSearchSessions>,
) {
	const { sessionId, imagePath } = await sessions.beginSession(".png")
	await writeFile(imagePath, new Uint8Array([1, 2, 3]))
	await sessions.finalizeSession(sessionId)
	return sessionId
}

describe("buildImageSearchSessions", () => {
	test("begin/finalize persists dhash and phash for a decodable image", async () => {
		const sessions = await makeSessions()
		const sessionId = await storeImage(sessions)

		const hashes = sessions.loadQueryHashes(sessionId)
		expect(hashes.map((hash) => hash.type)).toEqual(["dhash", "phash"])
		expect(hashes[0]?.value).toMatch(/^[0-9a-f]{16}$/)

		const image = await sessions.queryImage(sessionId)
		expect(image?.ext).toBe(".png")
	})

	test("flat images produce no hashes but keep the session", async () => {
		const sessions = await makeSessions({
			decodeGrayGrid: async () => new Uint8Array(1024).fill(0),
		})
		const sessionId = await storeImage(sessions)
		expect(sessions.loadQueryHashes(sessionId)).toEqual([])
	})

	test("undecodable images remove the session and report failure", async () => {
		const sessions = await makeSessions({
			decodeGrayGrid: async () => undefined,
		})
		const { sessionId, imagePath } = await sessions.beginSession(".png")
		await writeFile(imagePath, new Uint8Array([1, 2, 3]))

		expect(await sessions.finalizeSession(sessionId)).toBe(false)
		expect(await sessions.queryImage(sessionId)).toBeUndefined()
		expect(() => sessions.loadQueryHashes(sessionId)).toThrow()
	})

	test("loadQueryHashes throws for unknown sessions", async () => {
		const sessions = await makeSessions()
		expect(() => sessions.loadQueryHashes("session-nope")).toThrow()
	})

	test("sweep removes sessions older than the max age", async () => {
		const sessions = await makeSessions()
		const sessionId = await storeImage(sessions)

		await sessions.sweep(60 * 60 * 1000)
		expect(await sessions.queryImage(sessionId)).toBeDefined()

		await sessions.sweep(0)
		expect(await sessions.queryImage(sessionId)).toBeUndefined()
	})

	test("discard removes the session", async () => {
		const sessions = await makeSessions()
		const sessionId = await storeImage(sessions)

		await sessions.discard(sessionId)
		expect(await sessions.queryImage(sessionId)).toBeUndefined()
		expect(() => sessions.loadQueryHashes(sessionId)).toThrow()
	})
})
