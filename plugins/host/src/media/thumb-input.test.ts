import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buffer } from "node:stream/consumers"
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import yazl from "yazl"
import { createDirectoryContainer } from "../directory-container.ts"
import { createNestedAwareContainer } from "../nested-view.ts"
import { THUMB_BUFFER_MAX_BYTES } from "../probe/index.ts"
import { withThumbInput } from "./thumb-input.ts"

describe("withThumbInput", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "thumb-input-"))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("small image entries are read into memory without extraction", async () => {
		const png = await sharp({
			create: {
				width: 24,
				height: 24,
				channels: 3,
				background: { r: 4, g: 5, b: 6 },
			},
		})
			.png()
			.toBuffer()
		writeFileSync(join(root, "a.png"), png)

		const container = createDirectoryContainer(root)

		let sawBuffer = false
		await withThumbInput(container, "a.png", "image", async (input) => {
			expect(input.kind).toBe("buffer")
			if (input.kind === "buffer") {
				sawBuffer = true
				expect(input.buffer.equals(png)).toBe(true)
			}
			return "ok"
		})
		expect(sawBuffer).toBe(true)
		expect(png.length).toBeLessThan(THUMB_BUFFER_MAX_BYTES)
	})

	test("literal video entries resolve to the seekable file path", async () => {
		const mp4Bytes = Buffer.from("fake-mp4-bytes")
		writeFileSync(join(root, "clip.mp4"), mp4Bytes)

		const container = createDirectoryContainer(root)

		await withThumbInput(container, "clip.mp4", "video", async (input) => {
			expect(input.kind).toBe("path")
			if (input.kind === "path") {
				expect(input.path).toBe(join(root, "clip.mp4"))
			}
			return "ok"
		})
	})

	test("large literal images resolve to the seekable file path", async () => {
		const big = Buffer.alloc(THUMB_BUFFER_MAX_BYTES + 1, 0xa5)
		writeFileSync(join(root, "big.png"), big)

		const container = createDirectoryContainer(root)

		await withThumbInput(container, "big.png", "image", async (input) => {
			expect(input.kind).toBe("path")
			if (input.kind === "path") {
				expect(input.path).toBe(join(root, "big.png"))
			}
			return "ok"
		})
	})

	test("virtual archive entries keep streaming (no seekable path)", async () => {
		const zip = new yazl.ZipFile()
		zip.addBuffer(Buffer.from("fake-mp4-bytes"), "clip.mp4")
		zip.end()
		const chunks: Buffer[] = []
		for await (const chunk of zip.outputStream) {
			chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
		}
		writeFileSync(join(root, "book.cbz"), Buffer.concat(chunks))

		const container = createNestedAwareContainer(createDirectoryContainer(root))

		await withThumbInput(
			container,
			"book.cbz!clip.mp4",
			"video",
			async (input) => {
				expect(input.kind).toBe("stream")
				if (input.kind === "stream") {
					expect(input.size).toBe(Buffer.byteLength("fake-mp4-bytes"))
					const read = await buffer(await input.openStream())
					expect(read.toString()).toBe("fake-mp4-bytes")
				}
				return "ok"
			},
		)
	})
})
