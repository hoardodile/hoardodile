import { once } from "node:events"
import { link, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buffer } from "node:stream/consumers"
import { createDirectoryContainer } from "@hoardodile/host"
import { afterEach, beforeEach, expect, it } from "vitest"
import { parseByteRange, sliceStream } from "./byte-range.ts"

let root: string
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "checked-file-range-"))
	await mkdir(join(root, "data"))
	await writeFile(join(root, "data", "inside.txt"), "inside")
	await writeFile(join(root, "outside.txt"), "outside")
})
afterEach(async () => {
	await rm(root, { recursive: true, force: true })
})

it("seeks on the verified file descriptor even after the pathname is replaced", async () => {
	const container = createDirectoryContainer(join(root, "data"))
	const entry = await container.openEntryStream("inside.txt")
	const closed = once(entry.stream, "close")
	try {
		await rename(
			join(root, "data", "inside.txt"),
			join(root, "data", "old.txt"),
		)
		await link(join(root, "outside.txt"), join(root, "data", "inside.txt"))
		const ranged = sliceStream(entry.stream, 1, 3)
		expect((await buffer(ranged)).toString()).toBe("nsi")
		await closed
		expect(entry.stream.destroyed).toBe(true)
	} finally {
		entry.stream.destroy()
	}
})

it("closes the source descriptor when a range response is cancelled before reading", async () => {
	const entry = await createDirectoryContainer(
		join(root, "data"),
	).openEntryStream("inside.txt")
	const closed = once(entry.stream, "close")
	const ranged = sliceStream(entry.stream, 1, 3)
	ranged.destroy()
	await closed
	expect(entry.stream.destroyed).toBe(true)
})

it("rejects fractional and unsafe offsets before opening range streams", () => {
	for (const value of [
		"bytes=1.5-3",
		"bytes=0-3.4",
		"bytes=-0.5",
		"bytes=-9007199254740992",
	])
		expect(parseByteRange(value, 100).ok).toBe(false)
})
