// @vitest-environment node

import { describe, expect, it } from "vitest"
import { makeTar, makeZip } from "../__testutils__/zip-fixtures.ts"
import { sniffContainerFormat } from "./format.ts"
import {
	createNestedResolver,
	type OuterEntrySource,
	splitVirtualPath,
} from "./nested-entry.ts"

// ── Fixture helpers ──────────────────────────────────────────────────────────

function outerFrom(files: Readonly<Record<string, Buffer>>): OuterEntrySource {
	return {
		sizeOf: async (rel) => {
			const buf = files[rel]
			return buf === undefined ? undefined : buf.length
		},
		readSlice: async (rel, start, end) => {
			const buf = files[rel]
			if (buf === undefined) throw new Error(`missing fixture entry ${rel}`)
			return buf.subarray(start, Math.min(end, buf.length))
		},
	}
}

// ── splitVirtualPath ─────────────────────────────────────────────────────────

describe("splitVirtualPath", () => {
	it("splits at the first separator", () => {
		expect(splitVirtualPath("a.cbz!Ch1/001.jpg")).toEqual({
			outer: "a.cbz",
			inner: "Ch1/001.jpg",
		})
	})

	it("handles separators inside the inner path", () => {
		expect(splitVirtualPath("a.cbz!b!c.png")).toEqual({
			outer: "a.cbz",
			inner: "b!c.png",
		})
	})

	it("returns undefined without a separator or with an empty inner", () => {
		expect(splitVirtualPath("plain.jpg")).toBeUndefined()
		expect(splitVirtualPath("a.cbz!")).toBeUndefined()
		expect(splitVirtualPath("!a")).toBeUndefined()
	})
})

// ── sniffContainerFormat ─────────────────────────────────────────────────────

describe("sniffContainerFormat", () => {
	it("detects zip and tar magic", () => {
		expect(
			sniffContainerFormat(Uint8Array.from([0x50, 0x4b, 0x03, 0x04])),
		).toBe("zip")
		const tarHead = new Uint8Array(300)
		tarHead.set(Buffer.from("ustar"), 257)
		expect(sniffContainerFormat(tarHead)).toBe("tar")
	})

	it("detects gzip magic (extractable, not a nested container)", () => {
		expect(
			sniffContainerFormat(Uint8Array.from([0x1f, 0x8b, 0x08, 0x00])),
		).toBe("gzip")
	})

	it("returns undefined for other content", () => {
		expect(sniffContainerFormat(new Uint8Array([1, 2, 3, 4]))).toBeUndefined()
		expect(sniffContainerFormat(new Uint8Array(0))).toBeUndefined()
	})
})

// ── createNestedResolver ─────────────────────────────────────────────────────

describe("createNestedResolver", () => {
	const cbz = makeZip([
		{ name: "Ch1/001.jpg", data: Uint8Array.from([1, 2, 3]) },
		{ name: "Ch1/002.jpg", data: Uint8Array.from([4, 5]) },
		{ name: "Ch2/001.jpg", data: Uint8Array.from([6]) },
	])
	const deflated = makeZip([
		{
			name: "page.png",
			data: Uint8Array.from([9, 9, 9, 9, 9, 9, 9, 9, 9, 9]),
			method: 8,
		},
	])
	const tar = makeTar([
		{ name: "Ch1/001.jpg", data: Uint8Array.from([7, 7]) },
		{ name: "Ch1/002.jpg", data: Uint8Array.from([8, 8, 8]) },
	])
	const outer = outerFrom({
		"book.cbz": cbz,
		"flat.png": Buffer.from([1, 2]),
		"tome.tar": tar,
		"weird!name.txt": Buffer.from("literal"),
	})

	it("resolves zip entries with sizes", async () => {
		const resolver = createNestedResolver(outer)
		const resolved = await resolver.resolve("book.cbz!Ch1/001.jpg")
		expect(resolved.kind).toBe("container")
		if (resolved.kind !== "container") return
		expect(resolved.outer).toBe("book.cbz")
		expect(resolved.entry).toEqual({ name: "Ch1/001.jpg", sizeBytes: 3 })
	})

	it("streams STORED entry bytes", async () => {
		const resolver = createNestedResolver(outer)
		const resolved = await resolver.resolve("book.cbz!Ch1/002.jpg")
		if (resolved.kind !== "container") throw new Error("expected container")
		const chunks: Buffer[] = []
		for await (const chunk of resolved.openStream()) {
			chunks.push(Buffer.from(chunk))
		}
		expect(Buffer.concat(chunks)).toEqual(Buffer.from([4, 5]))
	})

	it("streams DEFLATE entry bytes", async () => {
		const resolver = createNestedResolver(outerFrom({ "d.zip": deflated }))
		const resolved = await resolver.resolve("d.zip!page.png")
		if (resolved.kind !== "container") throw new Error("expected container")
		const chunks: Buffer[] = []
		for await (const chunk of resolved.openStream()) {
			chunks.push(Buffer.from(chunk))
		}
		expect(Buffer.concat(chunks)).toEqual(
			Buffer.from([9, 9, 9, 9, 9, 9, 9, 9, 9, 9]),
		)
		expect(resolved.entry.sizeBytes).toBe(10)
	})

	it("does not address tar archives as nested containers", async () => {
		const resolver = createNestedResolver(outer)
		const resolved = await resolver.resolve("tome.tar!Ch1/001.jpg")
		expect(resolved.kind).toBe("literal")
		expect(await resolver.list("tome.tar")).toBeUndefined()
	})

	it("falls back to literal when the inner entry is missing", async () => {
		const resolver = createNestedResolver(outer)
		const resolved = await resolver.resolve("book.cbz!missing.jpg")
		expect(resolved.kind).toBe("literal")
	})

	it("falls back to literal when the outer is not a container", async () => {
		const resolver = createNestedResolver(outer)
		const resolved = await resolver.resolve("flat.png!x")
		expect(resolved.kind).toBe("literal")
	})

	it("keeps literal files whose names contain the separator", async () => {
		const resolver = createNestedResolver(outer)
		const resolved = await resolver.resolve("weird!name.txt")
		expect(resolved.kind).toBe("literal")
	})

	it("lists container entries memoized per outer", async () => {
		const resolver = createNestedResolver(outer)
		const first = await resolver.list("book.cbz")
		const second = await resolver.list("book.cbz")
		expect(first?.map((e) => e.name)).toEqual([
			"Ch1/001.jpg",
			"Ch1/002.jpg",
			"Ch2/001.jpg",
		])
		expect(second).toBe(first)
		expect(await resolver.list("flat.png")).toBeUndefined()
	})

	it("rejects encrypted entries with a clear error", async () => {
		// DEFLATE, not STORED: for stored files yauzl rejects the
		// inconsistent sizes at central-directory parse time, so the
		// per-entry encrypted rejection could never fire.
		const encrypted = makeZip([
			{
				name: "page.png",
				data: Uint8Array.from([1, 2, 3]),
				method: 8,
				encrypted: true,
			},
		])
		const resolver = createNestedResolver(
			outerFrom({ "locked.zip": encrypted }),
		)
		const resolved = await resolver.resolve("locked.zip!page.png")
		expect(resolved.kind).toBe("container")
		if (resolved.kind !== "container") return
		expect(() => resolved.openStream()).toThrow(/encrypted/)
	})
})
