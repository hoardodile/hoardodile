import { afterAll, describe, expect, test } from "vitest"
import type { ResourceAPI } from "../types.ts"

/**
 * Shared contract suite for the container-backed {@link ResourceAPI}
 * implementations. Every backend (in-memory fixture, directory, zip
 * archive, and the server's own artifact view) must behave identically:
 * same entries, same bytes, same clamping, same probe semantics.
 *
 * Consumers build each backend from a declarative file map, then run the
 * whole suite with `containerContractSuite([...])` inside a test file.
 */

/** A declarative container case: entry name → content. */
export type ContainerContractCase = {
	readonly name: string
	readonly files: Readonly<Record<string, string | Uint8Array>>
}

export const CONTAINER_CONTRACT_CASES: readonly ContainerContractCase[] = [
	{ name: "empty container", files: {} },
	{
		name: "flat files",
		files: { "a.txt": "alpha", "b.bin": "beta", "c.jpg": "gamma" },
	},
	{
		name: "nested entry names",
		files: { "dir/a.txt": "nested a", "dir/sub/b.txt": "nested b" },
	},
	{
		name: "binary content",
		files: { "blob.bin": Uint8Array.from([0, 1, 2, 250, 255, 128]) },
	},
	{ name: "empty entry", files: { "empty.txt": "" } },
	{
		name: "unicode entry names",
		files: { "Фото/я.jpg": "unicode" },
	},
]

export type ContractBackend = {
	readonly name: string
	/**
	 * Build a {@link ResourceAPI} from a declarative file map. Called
	 * once per case; must produce an independent instance each time.
	 */
	readonly build: (
		files: Readonly<Record<string, string | Uint8Array>>,
	) => Promise<ResourceAPI>
	/** Optional teardown for resources created by `build` calls. */
	readonly cleanup?: () => Promise<void> | void
}

function toBytes(content: string | Uint8Array): Uint8Array {
	return typeof content === "string"
		? new TextEncoder().encode(content)
		: content
}

async function collectManifest(api: ResourceAPI): Promise<unknown> {
	const files = [...(await api.listFileNames())].sort()
	const manifest: Record<string, unknown> = {}
	manifest.files = files
	for (const name of files) {
		manifest[`stat:${name}`] = await api.statFile(name)
		manifest[`read:${name}`] = Array.from(await api.readFile(name))
		manifest[`range:${name}`] = Array.from(
			await api.readFile(name, { start: 1, end: 3 }),
		)
		// Identification must agree across backends too — the sniffer
		// reads through the same container abstraction.
		manifest[`type:${name}`] = await api.sniff(name)
		manifest[`probe:${name}`] = await api.probe(name)
	}
	// Batch stat: positions preserved, missing entries undefined.
	const batched = await api.statFiles(files)
	manifest.statAll = files.map((name, i) => ({
		name,
		stat: batched[i],
	}))
	manifest.missingStat = await api.statFile("missing-entry.bin")
	manifest.missingStatAll = await api.statFiles(["missing-entry.bin"])
	return manifest
}

/**
 * Run the full container contract suite against the given backends.
 * Must be called from within a vitest test file.
 */
export function containerContractSuite(
	backends: readonly ContractBackend[],
): void {
	afterAll(async () => {
		await Promise.all(backends.map((b) => b.cleanup?.()))
	})

	describe("container contract", () => {
		for (const backend of backends) {
			describe(backend.name, () => {
				for (const c of CONTAINER_CONTRACT_CASES) {
					test(`case "${c.name}": core semantics`, async () => {
						const api = await backend.build(c.files)
						const names = Object.keys(c.files)

						expect([...(await api.listFileNames())].sort()).toEqual(
							[...names].sort(),
						)

						for (const name of names) {
							const content = c.files[name]
							if (content === undefined) continue
							const expected = toBytes(content)
							expect(Array.from(await api.readFile(name))).toEqual([
								...expected,
							])

							const mid = await api.readFile(name, {
								start: 1,
								end: Math.min(3, expected.length),
							})
							expect(Array.from(mid)).toEqual([
								...expected.slice(1, Math.min(3, expected.length)),
							])

							const past = await api.readFile(name, {
								start: expected.length + 5,
								end: expected.length + 9,
							})
							expect(past.byteLength).toBe(0)

							expect(await api.statFile(name)).toEqual({
								sizeBytes: expected.length,
							})
						}

						// Missing entries: readFile rejects, statFile is undefined.
						await expect(api.readFile("missing-entry.bin")).rejects.toThrow()
						await expect(
							api.statFile("missing-entry.bin"),
						).resolves.toBeUndefined()

						// Batch stat matches the single-stats, in order.
						const singleStats = names.map((n) =>
							c.files[n] !== undefined
								? { sizeBytes: toBytes(c.files[n]!).length }
								: undefined,
						)
						const batchStats = await api.statFiles(names)
						expect(batchStats.length).toBe(names.length)
						for (let i = 0; i < names.length; i++) {
							expect(batchStats[i]).toEqual(singleStats[i])
						}
						await expect(api.statFiles(["missing-entry.bin"])).resolves.toEqual(
							[undefined],
						)

						// Contract backends wire no probe implementations, so
						// identified media reports the dedicated "no backend"
						// reason instead of looking like a decode failure,
						// while non-media entries still identify normally.
						for (const name of names) {
							const type = await api.sniff(name)
							const probed = await api.probe(name)
							if (type !== undefined && type.kind !== "other") {
								expect(probed).toEqual({
									kind: "unknown",
									reason: "unavailable",
								})
							} else if (type !== undefined) {
								expect(probed).toEqual({ kind: "other", mime: type.mime })
							} else {
								expect(probed).toEqual({
									kind: "unknown",
									reason: "unsupported",
								})
							}
						}

						// Neither call rejects on a missing entry.
						await expect(
							api.sniff("missing-entry.bin"),
						).resolves.toBeUndefined()
						await expect(api.probe("missing-entry.bin")).resolves.toEqual({
							kind: "unknown",
							reason: "unsupported",
						})
					})
				}
			})
		}

		for (const c of CONTAINER_CONTRACT_CASES) {
			test(`case "${c.name}": identical results across backends`, async () => {
				const results = []
				for (const backend of backends) {
					const api = await backend.build(c.files)
					results.push(await collectManifest(api))
				}
				for (let i = 1; i < results.length; i++) {
					expect(results[i]).toEqual(results[0])
				}
			})
		}
	})
}
