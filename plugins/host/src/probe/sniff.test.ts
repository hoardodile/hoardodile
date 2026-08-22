import sharp from "sharp"
import { describe, expect, test } from "vitest"
import { sniffBytes } from "./sniff.ts"

/**
 * Sniffing is the layer that decides which probe backend a file reaches,
 * so these cases pin the two branches that matter: a real signature
 * wins over a lying name, and a signature-less format still gets named.
 */

async function pngBytes(): Promise<Buffer> {
	return sharp({
		create: {
			width: 4,
			height: 4,
			channels: 3,
			background: { r: 0, g: 0, b: 0 },
		},
	})
		.png()
		.toBuffer()
}

describe("sniffBytes", () => {
	test("magic bytes win over the extension", async () => {
		await expect(sniffBytes(await pngBytes(), "photo.jpg")).resolves.toEqual({
			mime: "image/png",
			ext: ".png",
			kind: "image",
			source: "magic",
		})
	})

	test("identifies a file with no extension at all", async () => {
		await expect(sniffBytes(await pngBytes(), "001")).resolves.toEqual({
			mime: "image/png",
			ext: ".png",
			kind: "image",
			source: "magic",
		})
	})

	test("falls back to the extension for signature-less formats", async () => {
		const text = new TextEncoder().encode("just words, no signature")
		await expect(sniffBytes(text, "notes.txt")).resolves.toEqual({
			mime: "text/plain",
			ext: ".txt",
			kind: "other",
			source: "extension",
		})
	})

	test("resolves to undefined when neither bytes nor name say anything", async () => {
		const noise = Uint8Array.from([0x11, 0x22, 0x33, 0x44])
		await expect(sniffBytes(noise, "blob.bin")).resolves.toBeUndefined()
	})

	test("an empty head still answers from the name", async () => {
		await expect(sniffBytes(new Uint8Array(), "clip.mp4")).resolves.toEqual({
			mime: "video/mp4",
			ext: ".mp4",
			kind: "video",
			source: "extension",
		})
	})

	test("container MIME types map to the family they usually carry", async () => {
		const ogg = new TextEncoder().encode("OggS\0\0\0\0\0\0\0\0\0\0\0\0\0\0")
		const sniffed = await sniffBytes(ogg, "track.ogg")
		expect(sniffed?.kind).toBe("audio")
	})
})
