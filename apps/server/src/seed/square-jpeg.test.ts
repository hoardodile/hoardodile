/**
 * @vitest-environment node
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { afterEach, describe, expect, test } from "vitest"
import { writeCenteredSquareJpeg } from "./square-jpeg.ts"

describe("writeCenteredSquareJpeg", () => {
	let dir = ""

	afterEach(async () => {
		if (dir.length > 0) await rm(dir, { recursive: true, force: true })
	})

	test("center-crops a landscape still into a square", async () => {
		dir = await mkdtemp(join(tmpdir(), "seed-square-"))
		const src = join(dir, "wide.png")
		const dest = join(dir, "avatar.jpg")
		await sharp({
			create: {
				width: 40,
				height: 20,
				channels: 3,
				background: { r: 10, g: 20, b: 30 },
			},
		})
			.png()
			.toFile(src)
		await writeCenteredSquareJpeg(src, dest)
		const meta = await sharp(dest).metadata()
		expect(meta.format).toBe("jpeg")
		expect(meta.width).toBe(20)
		expect(meta.height).toBe(20)
	})
})
