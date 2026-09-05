import { once } from "node:events"
import { Readable } from "node:stream"
import { buffer } from "node:stream/consumers"
import { expect, test } from "vitest"
import { streamStoredZip } from "./pack.ts"

test("propagates a deferred entry failure to the export stream", async () => {
	const output = streamStoredZip([
		{
			name: "file.txt",
			size: 5,
			openStream: () =>
				new Readable({
					read() {
						this.destroy(new Error("entry is no longer readable"))
					},
				}),
		},
	])
	await expect(buffer(output)).rejects.toThrow("entry is no longer readable")
})

test("closes queued streams when an export is cancelled", async () => {
	const sources: Readable[] = []
	const output = streamStoredZip(
		["one.txt", "two.txt"].map((name) => ({
			name,
			size: 5,
			openStream: () => {
				const stream = new Readable({ read() {} })
				sources.push(stream)
				return stream
			},
		})),
	)
	const closed = once(output, "close")
	output.destroy()
	await closed
	expect(sources.every((stream) => stream.destroyed)).toBe(true)
})
